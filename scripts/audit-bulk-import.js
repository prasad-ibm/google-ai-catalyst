#!/usr/bin/env node
/* ==========================================================================
 * audit-bulk-import.js  --  READ-ONLY audit of bulk-imported use cases.
 *
 * Writes NOTHING. Runs SELECTs only. Safe to run against production.
 *
 * It reports, for the rows you care about:
 *   1. how many rows match
 *   2. mojibake / encoding damage  (â€, Ã, U+FFFD, stray control chars)
 *   3. department health           (null / non-canonical / canonical)
 *   4. JSONB detail fill-rate      (avg populated fields out of 23)
 *   5. stage / status distribution (rows that skipped intake)
 *   6. a few concrete example rows so you can eyeball the damage
 *
 * USAGE (from the repo root, e.g. C:\ai-catalyst-v2):
 *   railway run node scripts/audit-bulk-import.js
 *     -> uses DATABASE_URL from the Railway environment
 *
 *   node scripts/audit-bulk-import.js "postgresql://user:PASS@shinkansen.proxy.rlwy.net:37409/railway"
 *     -> pass the FULL connection string (with password) as arg 1
 *
 * OPTIONAL scoping (env vars or it audits ALL rows):
 *   WORKSPACE_ID=<uuid>   only rows in that workspace
 *   NAME_LIKE='%...%'     only rows whose name matches (SQL ILIKE)
 *   SINCE='2026-08-10'    only rows created on/after this date (if created_at exists)
 * ========================================================================== */
'use strict';
const { Client } = require('pg');

const CANONICAL = [
  'Sales','Marketing','Finance','HR','Human Resources','IT','Operations',
  'Legal','Procurement','R&D','Customer Support','Supply Chain',
  'Manufacturing','Quality','Security',
];
const CANON_LC = new Set(CANONICAL.map(s => s.toLowerCase()));

// The 23 detail keys packed into the 4 jsonb blobs.
const CTX = {
  business_context: ['driver','value','users','align','justif'],
  current_state:    ['maturity','spend','volume','pain','tools'],
  technical_context:['sources','dataavail','integrations','realtime','technotes'],
  risk_compliance:  ['sensitivity','autonomy','pii','audit','adoption','change','delivery','addnotes'],
};
const TOTAL_DETAIL_FIELDS = Object.values(CTX).reduce((n, a) => n + a.length, 0); // 23

// Heuristics for encoding damage in a string.
const MOJIBAKE_RE = /â€|Ã.|â€"|â€“|â€œ|â€\x9d|Â|\uFFFD/;

function connString() {
  const arg = process.argv[2];
  if (arg && /^postgres/i.test(arg)) return arg;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  console.error('ERROR: no connection string. Pass it as arg 1 or run under `railway run` so DATABASE_URL is set.');
  process.exit(1);
}

function buildWhere() {
  const clauses = [];
  const params = [];
  if (process.env.WORKSPACE_ID) { params.push(process.env.WORKSPACE_ID); clauses.push(`workspace_id = $${params.length}`); }
  if (process.env.NAME_LIKE)    { params.push(process.env.NAME_LIKE);    clauses.push(`name ILIKE $${params.length}`); }
  if (process.env.SINCE)        { params.push(process.env.SINCE);        clauses.push(`created_at >= $${params.length}`); }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

function detailFillCount(row) {
  let filled = 0;
  for (const [col, keys] of Object.entries(CTX)) {
    let blob = row[col];
    if (blob && typeof blob === 'string') { try { blob = JSON.parse(blob); } catch { blob = null; } }
    if (blob && typeof blob === 'object') {
      for (const k of keys) {
        const v = blob[k];
        if (v != null && String(v).trim() !== '') filled++;
      }
    }
  }
  return filled;
}

function rowHasMojibake(row) {
  const parts = [row.name, row.description];
  for (const col of Object.keys(CTX)) {
    let blob = row[col];
    if (blob && typeof blob === 'string') { try { blob = JSON.parse(blob); } catch {} }
    if (blob && typeof blob === 'object') parts.push(JSON.stringify(blob));
  }
  return parts.some(p => p && MOJIBAKE_RE.test(String(p)));
}

(async () => {
  const client = new Client({ connectionString: connString() });
  await client.connect();

  // Detect optional columns so the script works on any schema variant.
  const cols = (await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='use_cases'`
  )).rows.map(r => r.column_name);
  const hasCreatedAt = cols.includes('created_at');

  const { where, params } = buildWhere();
  const sql = `SELECT id, workspace_id, name, department, description,
                      business_context, current_state, technical_context, risk_compliance,
                      stage, status, delivered_at${hasCreatedAt ? ', created_at' : ''}
               FROM use_cases ${where}
               ORDER BY ${hasCreatedAt ? 'created_at DESC' : 'name'}`;
  const rows = (await client.query(sql, params)).rows;

  console.log('============================================================');
  console.log(' BULK IMPORT AUDIT  (read-only, no changes made)');
  console.log('============================================================');
  console.log('Scope   :', where || '(ALL rows in use_cases)');
  console.log('Matched :', rows.length, 'rows\n');
  if (!rows.length) { await client.end(); return; }

  // 1. Encoding
  const moji = rows.filter(rowHasMojibake);
  console.log('1) ENCODING');
  console.log('   rows with mojibake / replacement chars :', moji.length, `(${(100*moji.length/rows.length).toFixed(0)}%)`);

  // 2. Departments
  const nullDept = rows.filter(r => !r.department || !String(r.department).trim());
  const nonCanon = rows.filter(r => r.department && !CANON_LC.has(String(r.department).trim().toLowerCase()));
  const deptCounts = {};
  for (const r of rows) { const d = (r.department && String(r.department).trim()) || '(null)'; deptCounts[d] = (deptCounts[d]||0)+1; }
  console.log('\n2) DEPARTMENTS');
  console.log('   null / blank department :', nullDept.length);
  console.log('   non-canonical (stored but off-list):', nonCanon.length);
  console.log('   distribution:');
  Object.entries(deptCounts).sort((a,b)=>b[1]-a[1]).forEach(([d,n])=>{
    const flag = d==='(null)' ? ' <== LOST' : (CANON_LC.has(d.toLowerCase()) ? '' : ' <== non-canonical');
    console.log(`     ${d.padEnd(24)} ${String(n).padStart(4)}${flag}`);
  });

  // 3. Detail fill-rate
  const fills = rows.map(detailFillCount);
  const avg = (fills.reduce((a,b)=>a+b,0)/rows.length);
  const empty = fills.filter(f=>f===0).length;
  console.log('\n3) JSONB DETAIL FILL-RATE (out of ' + TOTAL_DETAIL_FIELDS + ' fields/row)');
  console.log('   average fields populated :', avg.toFixed(1) + ' / ' + TOTAL_DETAIL_FIELDS);
  console.log('   rows with ZERO detail    :', empty, empty ? ' <== these look truly empty' : '');

  // 4. Stage / status
  const sc = {}, stc = {};
  for (const r of rows) { sc[r.stage||'(null)']=(sc[r.stage||'(null)']||0)+1; stc[r.status||'(null)']=(stc[r.status||'(null)']||0)+1; }
  console.log('\n4) LIFECYCLE (rows not in "intake" skip the intake view)');
  console.log('   stage :', sc);
  console.log('   status:', stc);

  // 5. Examples
  console.log('\n5) SAMPLE ROWS (first 3 with mojibake, else first 3)');
  (moji.length ? moji : rows).slice(0,3).forEach((r,i)=>{
    console.log(`   [${i+1}] ${String(r.name).slice(0,60)}`);
    console.log(`       dept=${JSON.stringify(r.department)} stage=${r.stage} detailFields=${detailFillCount(r)}/${TOTAL_DETAIL_FIELDS}`);
    let bc = r.business_context; if (typeof bc==='string'){try{bc=JSON.parse(bc);}catch{}}
    if (bc && bc.value) console.log(`       business_context.value = ${JSON.stringify(String(bc.value).slice(0,70))}`);
  });

  console.log('\n============================================================');
  console.log(' SUMMARY');
  console.log('   ', rows.length, 'rows stored |', moji.length, 'mojibake |', nullDept.length, 'null dept |', empty, 'zero-detail');
  console.log('   => No writes performed. Use this to choose: reimport / fix-in-place / dept-only.');
  console.log('============================================================');

  await client.end();
})().catch(e => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
