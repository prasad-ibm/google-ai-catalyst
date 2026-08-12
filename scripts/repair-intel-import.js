#!/usr/bin/env node
/* ==========================================================================
 * repair-intel-import.js
 *
 * Repairs the already-imported Intel bulk-upload rows IN PLACE, using the
 * original CSV as the SOURCE OF TRUTH. Does NOT reimport or create rows.
 *
 * It fixes the two things the audit found were actually wrong:
 *   (1) DEPARTMENT  — 57 rows lost/nulled their department at import because
 *       Client Computing / Foundry weren't canonical. They now are, so this
 *       backfills each row's TRUE department from the CSV (via resolveDepartment).
 *   (2) MOJIBAKE    — ~21 rows have garbled smart punctuation because the file
 *       is mixed UTF-8 / Windows-1252. Re-decoding the CSV as Windows-1252
 *       yields the correct text; this rewrites the 4 JSONB context blobs +
 *       description with the clean values.
 *
 * All 23 detail fields are ALREADY stored (audit: 23.0/23, 0 empty), so this
 * only overwrites values that differ — it never blanks a populated field.
 *
 * Rows are matched to the CSV by EXACT name (verified: names contain zero
 * smart punctuation and are identical under either decoding — a safe join key).
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply. Writes run in a single
 * transaction and are idempotent (re-running after a successful apply is a
 * no-op). Only rows whose values actually change are updated.
 *
 * USAGE (from repo root, e.g. C:\google-ai-catalyst):
 *   # 1. Dry run — shows exactly what WOULD change, writes nothing:
 *   railway run node scripts/repair-intel-import.js --csv "C:\path\to\intel.csv"
 *
 *   # 2. Apply for real (after reviewing the dry run):
 *   railway run node scripts/repair-intel-import.js --csv "C:\path\to\intel.csv" --apply
 *
 *   # With an explicit connection string instead of railway:
 *   node scripts/repair-intel-import.js --csv "...csv" \
 *        "postgresql://postgres:PASS@shinkansen.proxy.rlwy.net:37409/railway" --apply
 *
 * OPTIONS:
 *   --csv <path>     Path to the Intel CSV (REQUIRED).
 *   --apply          Perform the writes. Omit for a dry run.
 *   --workspace <id> Only repair rows in this workspace_id (recommended if the
 *                    table holds more than the Intel import).
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Reuse the exact canonical resolver the app uses, so departments land on the
// same 16-item taxonomy the UI/API enforce.
const { resolveDepartment } = require(path.join(__dirname, '..', 'departments'));

// The four JSONB context columns and the flat CSV keys that populate each.
// Mirrors server.js mapUseCaseContexts().
const CTX = {
  business_context: ['driver', 'value', 'users', 'align', 'justif'],
  current_state: ['maturity', 'spend', 'volume', 'pain', 'tools'],
  technical_context: ['sources', 'dataavail', 'integrations', 'realtime', 'technotes'],
  risk_compliance: ['sensitivity', 'autonomy', 'pii', 'audit', 'adoption', 'change', 'delivery', 'addnotes'],
};

const MOJIBAKE_RE = /â€|Ã.|Â[^\s]|\uFFFD/;

// ---- args --------------------------------------------------------------
function parseArgs() {
  const a = process.argv.slice(2);
  const out = { apply: false, csv: null, workspace: null, conn: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--apply') out.apply = true;
    else if (a[i] === '--csv') out.csv = a[++i];
    else if (a[i] === '--workspace') out.workspace = a[++i];
    else if (/^postgres/i.test(a[i])) out.conn = a[i];
  }
  return out;
}

function connString(args) {
  if (args.conn) return args.conn;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  console.error('ERROR: no connection string. Pass a postgres:// URL or run under `railway run`.');
  process.exit(1);
}

// ---- minimal RFC-4180 CSV parser (handles quoted fields + embedded newlines) ----
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') { inQ = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(c => (c || '').trim() !== ''))
    .map(r => { const o = {}; header.forEach((h, i) => { o[h] = (r[i] != null ? r[i] : ''); }); return o; });
}

// Build the clean context blob for a CSV row (only keys that have a value).
function buildBlob(csvRow, keys) {
  const o = {};
  for (const k of keys) {
    const v = csvRow[k];
    if (v != null && String(v).trim() !== '') o[k] = String(v);
  }
  return Object.keys(o).length ? o : null;
}

function asObj(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// Does merging csvBlob into the stored blob actually change anything?
// We only ever SET a key to the clean CSV value; we never delete stored keys.
function mergeBlob(stored, csvBlob) {
  const base = asObj(stored) || {};
  if (!csvBlob) return { changed: false, value: base, fixed: 0 };
  const next = { ...base };
  let changed = false, fixed = 0;
  for (const [k, v] of Object.entries(csvBlob)) {
    if (next[k] !== v) {
      if (next[k] != null && MOJIBAKE_RE.test(String(next[k]))) fixed++;
      next[k] = v;
      changed = true;
    }
  }
  return { changed, value: next, fixed };
}

(async () => {
  const args = parseArgs();
  if (!args.csv) { console.error('ERROR: --csv <path> is required.'); process.exit(1); }
  if (!fs.existsSync(args.csv)) { console.error('ERROR: CSV not found:', args.csv); process.exit(1); }

  // Decode as Windows-1252 → correct smart punctuation (the fix for mojibake).
  const csvText = new TextDecoder('windows-1252').decode(fs.readFileSync(args.csv));
  const csvRows = parseCsv(csvText);
  const byName = new Map();
  for (const r of csvRows) {
    const nm = (r.name || '').trim();
    if (nm) byName.set(nm, r);
  }

  console.log('============================================================');
  console.log(' INTEL IMPORT REPAIR ', args.apply ? '(APPLY — will write)' : '(DRY RUN — no writes)');
  console.log('============================================================');
  console.log('CSV       :', args.csv);
  console.log('CSV rows  :', csvRows.length, '| unique names:', byName.size);
  if (args.workspace) console.log('Workspace :', args.workspace);
  console.log('');

  const client = new Client({ connectionString: connString(args) });
  await client.connect();

  const where = args.workspace ? 'WHERE workspace_id = $1' : '';
  const params = args.workspace ? [args.workspace] : [];
  const dbRows = (await client.query(
    `SELECT id, name, department, description,
            business_context, current_state, technical_context, risk_compliance
     FROM use_cases ${where}`, params)).rows;

  let matched = 0, deptFixes = 0, mojiRowsFixed = 0, rowsToUpdate = 0;
  const plan = [];

  for (const db of dbRows) {
    const csv = byName.get((db.name || '').trim());
    if (!csv) continue;               // not part of this import
    matched++;

    const sets = [];
    const vals = [];
    let deptFrom = db.department, deptTo = db.department, deptChanged = false;
    let mojiFixedThisRow = 0;

    // (1) department — resolve the CSV's true value against the canonical list
    const csvDept = resolveDepartment(csv.department);
    if (csvDept && csvDept !== db.department) {
      deptTo = csvDept; deptChanged = true; deptFixes++;
      sets.push('department'); vals.push(csvDept);
    }

    // (2) the four JSONB context blobs
    for (const [col, keys] of Object.entries(CTX)) {
      const clean = buildBlob(csv, keys);
      const { changed, value, fixed } = mergeBlob(db[col], clean);
      if (changed) { sets.push(col); vals.push(JSON.stringify(value)); mojiFixedThisRow += fixed; }
    }

    // (3) description
    const csvDesc = (csv.desc || csv.description || '').trim();
    if (csvDesc && csvDesc !== db.description) {
      if (db.description && MOJIBAKE_RE.test(String(db.description))) mojiFixedThisRow++;
      sets.push('description'); vals.push(csvDesc);
    }

    if (mojiFixedThisRow > 0) mojiRowsFixed++;

    if (sets.length) {
      rowsToUpdate++;
      plan.push({ id: db.id, name: db.name, deptChanged, deptFrom, deptTo, mojiFixedThisRow, sets, vals });
    }
  }

  console.log('Matched to CSV        :', matched, '/', dbRows.length, 'db rows');
  console.log('Rows needing update   :', rowsToUpdate);
  console.log('  - department fixes   :', deptFixes);
  console.log('  - rows w/ mojibake fixed:', mojiRowsFixed);
  console.log('');

  // show a preview of department changes (the most consequential)
  const deptChanges = plan.filter(p => p.deptChanged);
  if (deptChanges.length) {
    console.log('DEPARTMENT changes (first 60):');
    deptChanges.slice(0, 60).forEach(p =>
      console.log(`   [${String(p.deptFrom == null ? '(null)' : p.deptFrom).padEnd(20)}] -> ${p.deptTo.padEnd(20)}  ${p.name.slice(0, 45)}`));
    console.log('');
  }

  if (!args.apply) {
    console.log('DRY RUN complete — no changes written. Re-run with --apply to write.');
    await client.end();
    return;
  }

  if (!rowsToUpdate) {
    console.log('Nothing to update — DB already matches the CSV (idempotent no-op).');
    await client.end();
    return;
  }

  // APPLY — single transaction
  console.log('Applying', rowsToUpdate, 'updates in a transaction...');
  await client.query('BEGIN');
  try {
    let done = 0;
    for (const p of plan) {
      const setSql = p.sets.map((c, i) => `${c} = $${i + 2}`).join(', ');
      await client.query(`UPDATE use_cases SET ${setSql} WHERE id = $1`, [p.id, ...p.vals]);
      done++;
    }
    await client.query('COMMIT');
    console.log('COMMIT OK —', done, 'rows updated.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK — no changes committed. Error:', e.message);
    process.exitCode = 1;
  }

  await client.end();
})().catch(e => { console.error('REPAIR FAILED:', e.message); process.exit(1); });
