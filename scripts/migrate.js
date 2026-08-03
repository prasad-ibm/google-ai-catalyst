'use strict';

/**
 * Idempotent migration runner.
 * Loads schema.sql, applies it against the live DATABASE_URL, then lists the
 * base tables in the public schema (one per line). Exit 0 on success.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../db');

async function main() {
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  await query(sql);

  const res = await query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );

  for (const row of res.rows) {
    console.log(row.table_name);
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Migration failed:', err.message);
    try { await pool.end(); } catch (_) { /* noop */ }
    process.exit(1);
  });
