#!/usr/bin/env node
/* ==========================================================================
 * verify-intel-cells.js  --  READ-ONLY cell-by-cell reconciliation.
 *
 * Compares EVERY field of all rows in the Intel CSV against what is actually
 * stored in the database, for one workspace. Reports any mismatch down to the
 * individual cell (including inside the JSONB detail blobs). Writes NOTHING.
 *
 * It applies the SAME encoding repair + column mapping the reimport used, so a
 * correct import should produce ZERO mismatches.
 *
 * USAGE (from repo root, e.g. C:\google-ai-catalyst):
 *   node scripts/verify-intel-cells.js "postgresql://user:PASS@host:port/db" \
 *        --workspace 59bf9d50-b0b2-4ed6-ba36-8848f64554f2 \
 *        --csv "use-cases-template - Intel_Aug_10.csv"
 *
 *   # or rely on DATABASE_URL env / railway run:
 *   node scripts/verify-intel-cells.js --workspace <uuid> --csv <file>
 *
 * FLAGS:
 *   --verbose   print every matching row too (default: only mismatches)
 *   --limit N   only check the first N CSV rows (debug)
 * ========================================================================== */
'use strict';
const fs = require('fs');
const { Client } = require('pg');
const { resolveDepartment } = require('../departments.js');

/* ---- args --------------------------------------------------------------- */
function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] || '') : undefined; }
const VERBOSE = process.argv.includes('--verbose');
const LIMIT = flag('--limit') ? parseInt(flag('--limit'), 10) : Infinity;
const WORKSPACE = flag('--workspace');
const CSV_PATH = flag('--csv');

function connString() {
  const a = process.argv[2] && /^postgres/i.test(process.argv[2]) ? process.argv[2] : null;
  return a || process.env.DATABASE_URL;
}

/* ---- encoding repair (identical to reimport) ---------------------------- */
const MOJIBAKE_REPL = {
  'â€”': '\u2014', 'â€“': '\u2013', 'â€˜': '\u2018', 'â€™': '\u2019',
  'â€œ': '\u201c', 'â€\x9d': '\u201d', 'â€¢': '\u2022', 'â€¦': '\u2026',
  'â†’': '\u2192', 'â‚¬': '\u20ac', 'Â®': '\u00ae', 'Â©': '\u00a9',
  'Â ': ' ', 'Â': '', 'Ã©': '\u00e9', 'Ã¨': '\u00e8', 'Ã¢': '\u00e2',
};
function repairText(s) { if (s == null) return s; let o = String(s); for (const [b, g] of Object.entries(MOJIBAKE_REPL)) o = o.split(b).join(g); return o; }
function decodeCsv(buf) { return repairText(new TextDecoder('windows-1252').decode(buf)); }

/* ---- CSV parse (identical to reimport) ---------------------------------- */
function parseCsv(text) {
  const rows = []; let field = '', row = [], inQ = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) { if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c === '\r') { } else field += c; }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(c => (c || '').trim() !== '')).map(r => { const o = {}; header.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; }); return o; });
}

/* ---- expected mapping (identical to reimport) --------------------------- */
const CTX = {
  business_context: ['driver', 'value', 'users', 'align', 'justif'],
  current_state: ['maturity', 'spend', 'volume', 'pain', 'tools'],
  technical_context: ['sources', 'dataavail', 'integrations', 'realtime', 'technotes'],
  risk_compliance: ['sensitivity', 'autonomy', 'pii', 'audit', 'adoption', 'change', 'delivery', 'addnotes'],
};
function pick(o, keys) { const x = {}; for (const k of keys) if (o[k] != null && String(o[k]).trim() !== '') x[k] = String(o[k]); return Object.keys(x).length ? x : null; }
function normalizeStatus(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); return (s === 'completed' || s === 'delivered' || s === 'done') ? 'completed' : 'active'; }
function normalizeDeliveredAt(v) { if (v == null || String(v).trim() === '') return null; const d = new Date(String(v).trim()); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
const cap = (v, n) => v == null ? null : (String(v).length > n ? String(v).slice(0, n) : String(v));

function expectedRow(r) {
  const dept = resolveDepartment(r.department ?? r.dept ?? null);
  return {
    name: cap(r.name ?? null, 200),
    department: cap(dept, 400),
    executive_sponsor: cap(r.sponsor ?? r.executive_sponsor ?? null, 400),
    submitted_by: cap(r.submitter ?? r.submitted_by ?? null, 400),
    contact_email: cap(r.email ?? r.contact_email ?? null, 400),
    description: cap(r.desc ?? r.description ?? null, 8000),
    business_context: pick(r, CTX.business_context),
    current_state: pick(r, CTX.current_state),
    technical_context: pick(r, CTX.technical_context),
    risk_compliance: pick(r, CTX.risk_compliance),
    stage: (r.stage && String(r.stage).trim()) || 'intake',
    status: normalizeStatus(r.status),
    delivered_at: normalizeDeliveredAt(r.delivered_at ?? r.delivered),
  };
}

/* ---- comparison helpers ------------------------------------------------- */
const SCALAR = ['name', 'department', 'executive_sponsor', 'submitted_by', 'contact_email', 'description', 'stage', 'status', 'delivered_at'];
const JSONB = ['business_context', 'current_state', 'technical_context', 'risk_compliance'];

// Normalize for comparison: trim whitespace (the DB insert path trims values)
// and collapse internal runs of whitespace, so cosmetically-identical text with
// stray trailing/leading spaces is treated as a match, not a false mismatch.
function norm(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}
function asObj(v) { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v; }

function diffScalar(field, exp, act) {
  const e = norm(exp), a = norm(field === 'delivered_at' && act ? String(act).slice(0, 10) : act);
  return e === a ? null : { field, expected: e, actual: a };
}
function diffJsonb(col, exp, act) {
  const e = exp || {}, a = asObj(act) || {};
  const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
  const cellDiffs = [];
  for (const k of keys) {
    const ev = norm(e[k]), av = norm(a[k]);
    if (ev !== av) cellDiffs.push({ field: `${col}.${k}`, expected: ev, actual: av });
  }
  return cellDiffs;
}

/* ---- main --------------------------------------------------------------- */
(async () => {
  if (!WORKSPACE) { console.error('ERROR: --workspace <uuid> is required.'); process.exit(1); }
  if (!CSV_PATH || !fs.existsSync(CSV_PATH)) { console.error('ERROR: --csv <file> not found:', CSV_PATH); process.exit(1); }
  const cs = connString();
  if (!cs) { console.error('ERROR: no DATABASE_URL. Pass a connstring as arg 1 or set DATABASE_URL.'); process.exit(1); }

  const csvRows = parseCsv(decodeCsv(fs.readFileSync(CSV_PATH))).slice(0, LIMIT);
  const client = new Client({ connectionString: cs });
  await client.connect();

  const dbRows = (await client.query(
    `SELECT name, department, executive_sponsor, submitted_by, contact_email, description,
            business_context, current_state, technical_context, risk_compliance,
            stage, status, delivered_at
     FROM use_cases WHERE workspace_id = $1`, [WORKSPACE]
  )).rows;
  await client.end();

  const dbByName = new Map(dbRows.map(r => [String(r.name).trim(), r]));

  console.log('============================================================');
  console.log(' CELL-BY-CELL VERIFICATION (read-only)');
  console.log('============================================================');
  console.log('CSV rows      :', csvRows.length);
  console.log('DB rows in WS :', dbRows.length);

  let perfect = 0, mismatchRows = 0, missingInDb = 0, totalCellDiffs = 0;
  const report = [];

  for (const r of csvRows) {
    const exp = expectedRow(r);
    const name = String(exp.name).trim();
    const db = dbByName.get(name);
    if (!db) { missingInDb++; report.push({ name, diffs: [{ field: '(row)', expected: 'present in CSV', actual: 'NOT FOUND in DB' }] }); continue; }

    const diffs = [];
    for (const f of SCALAR) { const d = diffScalar(f, exp[f], db[f]); if (d) diffs.push(d); }
    for (const c of JSONB) diffs.push(...diffJsonb(c, exp[c], db[c]));

    if (diffs.length) { mismatchRows++; totalCellDiffs += diffs.length; report.push({ name, diffs }); }
    else { perfect++; if (VERBOSE) console.log('  OK  ', name.slice(0, 60)); }
  }

  // rows in DB not in CSV
  const csvNames = new Set(csvRows.map(r => String(expectedRow(r).name).trim()));
  const extraInDb = dbRows.filter(d => !csvNames.has(String(d.name).trim()));

  console.log('------------------------------------------------------------');
  if (report.length) {
    console.log('MISMATCHES FOUND:\n');
    for (const row of report) {
      console.log('  ✗', row.name.slice(0, 70));
      for (const d of row.diffs) {
        console.log(`      ${d.field}`);
        console.log(`        expected: ${JSON.stringify(d.expected)}`);
        console.log(`        actual  : ${JSON.stringify(d.actual)}`);
      }
    }
    console.log('');
  }
  if (extraInDb.length) {
    console.log('ROWS IN DB NOT IN CSV (' + extraInDb.length + '):');
    extraInDb.forEach(d => console.log('   +', String(d.name).slice(0, 70)));
    console.log('');
  }

  console.log('============================================================');
  console.log(' SUMMARY');
  console.log('   rows checked      :', csvRows.length);
  console.log('   perfect matches   :', perfect);
  console.log('   rows w/ mismatch  :', mismatchRows);
  console.log('   missing in DB     :', missingInDb);
  console.log('   extra in DB       :', extraInDb.length);
  console.log('   total cell diffs  :', totalCellDiffs);
  console.log('   VERDICT           :', (perfect === csvRows.length && !extraInDb.length)
    ? '✅ 100% MATCH — every cell of every row matches'
    : '❌ differences found (see above)');
  console.log('============================================================');
  process.exit(perfect === csvRows.length && !extraInDb.length ? 0 : 2);
})().catch(e => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
