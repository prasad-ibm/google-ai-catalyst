'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// SSL is required by Railway/hosted Postgres, but a local CI service container
// (GitHub Actions) speaks plaintext. Disable SSL when PGSSLMODE=disable.
const useSsl = process.env.PGSSLMODE !== 'disable';

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

/**
 * Run a parameterized query against the pool.
 * @param {string} text SQL text with $1, $2 placeholders.
 * @param {Array} [params] parameter values.
 * @returns {Promise<import('pg').QueryResult>}
 */
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
