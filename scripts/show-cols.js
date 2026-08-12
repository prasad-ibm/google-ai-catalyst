#!/usr/bin/env node
'use strict';
const { Client } = require('pg');
const CONN = (process.argv[2] && /^postgres/i.test(process.argv[2])) ? process.argv[2] : process.env.DATABASE_URL;
if (!CONN) { console.error('ERROR: pass connection string as arg 1.'); process.exit(1); }
(async () => {
  const c = new Client({ connectionString: CONN });
  await c.connect();
  for (const t of ['feasibility_scores','evaluation_summaries','panel_verdicts']) {
    const r = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
    console.log(`\n=== ${t} ===`);
    r.rows.forEach(x => console.log(`  ${x.column_name}  (${x.data_type})`));
  }
  await c.end();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
