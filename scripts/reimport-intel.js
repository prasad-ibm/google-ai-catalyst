#!/usr/bin/env node
/* ==========================================================================
 * reimport-intel.js  --  DROP-and-REINSERT the Intel use cases from the CSV
 * for 100% accuracy. Fixes encoding (mixed cp1252 + double-encoded UTF-8),
 * resolves departments against the canonical allowlist, injects workspace_id,
 * and maps every column exactly like the app's bulk importer.
 *
 * SAFETY:
 *   - DRY RUN by default: prints exactly what it WOULD delete/insert. No writes.
 *   - Requires --apply to make any change. All writes run in ONE transaction
 *     (BEGIN … DELETE … INSERT … COMMIT); any error ROLLS BACK everything.
 *   - Scope is TIGHT: only the use cases whose name matches a row in THIS CSV,
 *     within the target workspace. DELETE FROM use_cases WHERE workspace_id =
 *     <target> AND name = ANY(<csv names>). Other rows in the workspace (and
 *     all other workspaces) are never touched.
 *
 * USAGE (from repo root, e.g. C:\google-ai-catalyst):
 *   # 0. If you don't know the workspace id, list them:
 *   railway run node scripts/reimport-intel.js --list-workspaces
 *
 *   # 1. DRY RUN (no writes) — review the plan:
 *   railway run node scripts/reimport-intel.js --workspace <uuid> --csv "C:\path\to\Intel.csv"
 *
 *   # 2. APPLY for real (transactional):
 *   railway run node scripts/reimport-intel.js --workspace <uuid> --csv "C:\path\to\Intel.csv" --apply
 *
 * FLAGS:
 *   --workspace <uuid>   target workspace (required unless --list-workspaces)
 *   --csv <path>         path to the Intel CSV (required unless --list-workspaces)
 *   --apply              actually delete+insert (omit = dry run)
 *   --list-workspaces    print id + name of all workspaces and exit
 * ========================================================================== */
'use strict';
const fs = require('fs');
const { Client } = require('pg');
const { resolveDepartment } = require('../departments');

/* ---- args ---------------------------------------------------------------- */
function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] || '') : undefined;
}
const APPLY = process.argv.includes('--apply');
const LIST_WS = process.argv.includes('--list-workspaces');
const WORKSPACE = arg('--workspace');
const CSV_PATH = arg('--csv');

function connString() {
  const a = process.argv[2] && /^postgres/i.test(process.argv[2]) ? process.argv[2] : null;
  return a || process.env.DATABASE_URL;
}

/* ---- encoding repair ----------------------------------------------------- */
// The file is Windows-1252 with SOME double-encoded UTF-8 fragments baked in
// (e.g. "â€”" for an em-dash, "â†’" for an arrow). Decode as cp1252 then repair
// the known double-encoded fragments. Verified to leave ZERO mojibake.
const MOJIBAKE_REPL = {
  'â€”': '\u2014', 'â€“': '\u2013', 'â€˜': '\u2018', 'â€™': '\u2019',
  'â€œ': '\u201c', 'â€\x9d': '\u201d', 'â€¢': '\u2022', 'â€¦': '\u2026',
  'â†’': '\u2192', 'â‚¬': '\u20ac', 'Â®': '\u00ae', 'Â©': '\u00a9',
  'Â ': ' ', 'Â': '', 'Ã©': '\u00e9', 'Ã¨': '\u00e8', 'Ã¢': '\u00e2',
};
function repairText(s) {
  if (s == null) return s;
  let out = String(s);
  for (const [bad, good] of Object.entries(MOJIBAKE_REPL)) out = out.split(bad).join(good);
  return out;
}
function decodeCsv(buf) {
  const text = new TextDecoder('windows-1252').decode(buf);
  return repairText(text);
}

/* ---- CSV parse (RFC-4180) ------------------------------------------------ */
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(c => (c || '').trim() !== ''))
    .map(r => { const o = {}; header.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; }); return o; });
}

/* ---- column mapping (mirrors server.js buildUseCaseValues) --------------- */
const CTX = {
  business_context: ['driver', 'value', 'users', 'align', 'justif'],
  current_state: ['maturity', 'spend', 'volume', 'pain', 'tools'],
  technical_context: ['sources', 'dataavail', 'integrations', 'realtime', 'technotes'],
  risk_compliance: ['sensitivity', 'autonomy', 'pii', 'audit', 'adoption', 'change', 'delivery', 'addnotes'],
};
function pick(o, keys) {
  const x = {};
  for (const k of keys) if (o[k] != null && String(o[k]).trim() !== '') x[k] = String(o[k]);
  return Object.keys(x).length ? x : null;
}
function normalizeStatus(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return (s === 'completed' || s === 'delivered' || s === 'done') ? 'completed' : 'active';
}
function normalizeDeliveredAt(v) {
  if (v == null || String(v).trim() === '') return null;
  const d = new Date(String(v).trim());
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const cap = (v, n) => v == null ? null : (String(v).length > n ? String(v).slice(0, n) : String(v));

function rowToValues(r, workspaceId) {
  const rawDept = r.department ?? r.dept ?? null;
  const dept = resolveDepartment(rawDept);        // canonical-or-null
  const stage = (r.stage && String(r.stage).trim()) || 'intake';
  return {
    coercedDept: rawDept && !dept ? rawDept : null,       // report if lost
    normalizedDept: rawDept && dept && dept !== String(rawDept).trim() ? dept : null,
    values: [
      workspaceId,
      cap(r.name ?? null, 200),
      cap(dept, 400),
      cap(r.sponsor ?? r.executive_sponsor ?? null, 400),
      cap(r.submitter ?? r.submitted_by ?? null, 400),
      cap(r.email ?? r.contact_email ?? null, 400),
      cap(r.desc ?? r.description ?? null, 8000),
      (() => { const b = pick(r, CTX.business_context); return b ? JSON.stringify(b) : null; })(),
      (() => { const b = pick(r, CTX.current_state); return b ? JSON.stringify(b) : null; })(),
      (() => { const b = pick(r, CTX.technical_context); return b ? JSON.stringify(b) : null; })(),
      (() => { const b = pick(r, CTX.risk_compliance); return b ? JSON.stringify(b) : null; })(),
      stage,
      normalizeStatus(r.status),
      normalizeDeliveredAt(r.delivered_at ?? r.delivered),
    ],
  };
}

const INSERT_COLS = [
  'workspace_id', 'name', 'department', 'executive_sponsor', 'submitted_by',
  'contact_email', 'description', 'business_context', 'current_state',
  'technical_context', 'risk_compliance', 'stage', 'status', 'delivered_at',
];

/* ---- main ---------------------------------------------------------------- */
(async () => {
  const cs = connString();
  if (!cs) { console.error('ERROR: no DATABASE_URL. Run under `railway run` or pass a connstring as arg 1.'); process.exit(1); }
  const client = new Client({ connectionString: cs });
  await client.connect();

  if (LIST_WS) {
    const ws = (await client.query('SELECT id, name FROM workspaces ORDER BY name')).rows;
    console.log('Workspaces:');
    ws.forEach(w => console.log(`  ${w.id}   ${w.name}`));
    await client.end();
    return;
  }

  if (!WORKSPACE) { console.error('ERROR: --workspace <uuid> is required (or use --list-workspaces).'); process.exit(1); }
  if (!CSV_PATH) { console.error('ERROR: --csv <path> is required.'); process.exit(1); }
  if (!fs.existsSync(CSV_PATH)) { console.error('ERROR: CSV not found: ' + CSV_PATH); process.exit(1); }

  // Parse + repair CSV
  const rows = parseCsv(decodeCsv(fs.readFileSync(CSV_PATH)));
  const mapped = rows.map(r => rowToValues(r, WORKSPACE));
  const lostDept = mapped.filter(m => m.coercedDept);
  const normDept = mapped.filter(m => m.normalizedDept);
  const blankName = mapped.filter(m => !m.values[1]).length;

  // Verify no mojibake remains anywhere
  const MRE = /â€|â†|Ã.|\uFFFD/;
  const mojiLeft = rows.filter(r => MRE.test(JSON.stringify(r))).length;

  // Names from the CSV are the delete key (verified unique, no special chars).
  const csvNames = mapped.map(m => m.values[1]).filter(Boolean);

  // Current state of target workspace
  const wsRow = (await client.query('SELECT name FROM workspaces WHERE id = $1', [WORKSPACE])).rows[0];
  const totalInWs = (await client.query('SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = $1', [WORKSPACE])).rows[0].n;
  // How many of the CSV names actually exist in this workspace right now?
  const matchRows = (await client.query(
    'SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = $1 AND name = ANY($2::text[])',
    [WORKSPACE, csvNames]
  )).rows[0].n;
  const existing = matchRows;

  console.log('============================================================');
  console.log(APPLY ? ' REIMPORT — APPLY MODE (writes in a transaction)' : ' REIMPORT — DRY RUN (no writes)');
  console.log('============================================================');
  console.log('Workspace     :', WORKSPACE, wsRow ? `(${wsRow.name})` : '(NOT FOUND — check the id!)');
  console.log('CSV           :', CSV_PATH);
  console.log('CSV rows      :', rows.length);
  console.log('Blank names   :', blankName, blankName ? ' <== would be skipped/invalid' : '');
  console.log('Mojibake left :', mojiLeft, mojiLeft ? ' <== WARNING encoding not fully clean' : '(clean)');
  console.log('Dept lost     :', lostDept.length, lostDept.length ? '(non-canonical → null): ' + [...new Set(lostDept.map(m => m.coercedDept))].join(', ') : '(none — all resolve)');
  console.log('Dept normalized:', normDept.length, normDept.length ? '(e.g. ' + normDept.slice(0, 3).map(m => m.normalizedDept).join(', ') + ')' : '');
  console.log('Rows in WS    :', totalInWs, '(total use cases in this workspace)');
  console.log('CSV-name match:', matchRows, 'of', csvNames.length, 'CSV names found in this workspace');
  console.log('WILL DELETE   :', existing, 'rows (ONLY those matching a CSV name — other', (totalInWs - matchRows), 'rows untouched)');
  console.log('WILL INSERT   :', rows.length, 'rows');
  console.log('------------------------------------------------------------');
  console.log('Sample (row 1):');
  console.log('  name  :', mapped[0].values[1]);
  console.log('  dept  :', mapped[0].values[2]);
  console.log('  stage :', mapped[0].values[11], '| status:', mapped[0].values[12]);
  console.log('  business_context:', String(mapped[0].values[7]).slice(0, 90));

  if (!APPLY) {
    console.log('\nDRY RUN complete — nothing changed. Re-run with --apply to execute.');
    await client.end();
    return;
  }

  if (wsRow == null) { console.error('\nABORT: workspace id not found. No changes made.'); await client.end(); process.exit(1); }
  if (blankName) { console.error('\nABORT: ' + blankName + ' rows have blank name. Fix the CSV first.'); await client.end(); process.exit(1); }

  // Transactional delete + insert
  const ph = INSERT_COLS.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `INSERT INTO use_cases (${INSERT_COLS.join(', ')}) VALUES (${ph})`;
  try {
    await client.query('BEGIN');
    const del = await client.query(
      'DELETE FROM use_cases WHERE workspace_id = $1 AND name = ANY($2::text[])',
      [WORKSPACE, csvNames]
    );
    let ins = 0;
    for (const m of mapped) { await client.query(insertSql, m.values); ins++; }
    await client.query('COMMIT');
    console.log(`\nAPPLIED: deleted ${del.rowCount}, inserted ${ins}. Committed.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nERROR — ROLLED BACK, no changes made:', e.message);
    await client.end();
    process.exit(1);
  }

  // Post-verify
  const after = (await client.query(
    'SELECT count(*)::int n, count(*) FILTER (WHERE department IS NULL) nulldept FROM use_cases WHERE workspace_id = $1', [WORKSPACE]
  )).rows[0];
  console.log('Post-verify   :', after.n, 'rows now in workspace |', after.nulldept, 'null department');
  await client.end();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
