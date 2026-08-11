'use strict';

/*
 * R12-N4 regression test — isolated. Run: node put-merge.test.js
 *
 * Guards the CRITICAL data-loss bug where a partial PUT /api/use-cases/:id
 * (e.g. {stage:'archived'}) returned 200 but SILENTLY NULLed all four JSONB
 * detail blobs (business_context, current_state, technical_context,
 * risk_compliance — 23 fields total).
 *
 * Strategy:
 *   (a) Unit-test the pure selector server.exports.selectUseCaseUpdate — it
 *       decides EXACTLY which use_cases columns a body should update.
 *   (b) Replicate the PUT handler's identical SET-clause / params build loop
 *       against that selector and assert the generated UPDATE SQL. This is the
 *       same 5-line loop the live route uses, so it faithfully proves that a
 *       partial {stage} body touches ONLY stage (+ updated_at) and none of the
 *       four jsonb columns.
 *
 * NOTE (project memory): requiring server.js constructs a lazy pg Pool but
 * opens NO connection (pg pools connect on first query), so this file never
 * touches a real DB and will not hang. We call process.exit() at the end.
 * Do NOT run server.test.js here — that suite opens a real DB pool and hangs.
 */

const assert = require('node:assert');
const { selectUseCaseUpdate } = require('./server');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name); }
}

const JSONB_COLS = new Set(['business_context', 'current_state', 'technical_context', 'risk_compliance']);

// Mirror of the live PUT handler's SET/params builder (server.js ~645-662).
// This is a "mock query" harness: instead of hitting Postgres we capture the
// exact SQL + params the route would generate for a given body.
function buildUpdate(id, body) {
  const fieldMap = selectUseCaseUpdate(body);
  const setClauses = [];
  const params = [];
  let i = 1;
  for (const [col, val] of Object.entries(fieldMap)) {
    setClauses.push(`${col} = $${i}`);
    params.push(JSONB_COLS.has(col) && val !== null ? JSON.stringify(val) : val);
    i++;
  }
  if (!setClauses.length) return { sql: null, params: [], cols: [] };
  const cols = setClauses.map((c) => c.split(' = ')[0]);
  setClauses.push('updated_at = now()');
  params.push(id);
  const sql = `UPDATE use_cases SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`;
  return { sql, params, cols };
}

/* ---------------------------------------------------------------------- */
/* (b) The crux: a partial {stage} body must NOT write any jsonb column.  */
/* ---------------------------------------------------------------------- */

{
  const { sql, params, cols } = buildUpdate('uc-1', { stage: 'archived' });
  ok('partial {stage}: SET touches exactly one data column', cols.length === 1);
  ok('partial {stage}: that column is stage', cols[0] === 'stage');
  ok('partial {stage}: NO business_context in SET', !cols.includes('business_context'));
  ok('partial {stage}: NO current_state in SET', !cols.includes('current_state'));
  ok('partial {stage}: NO technical_context in SET', !cols.includes('technical_context'));
  ok('partial {stage}: NO risk_compliance in SET', !cols.includes('risk_compliance'));
  ok('partial {stage}: SQL sets stage then updated_at',
    sql === 'UPDATE use_cases SET stage = $1, updated_at = now() WHERE id = $2 RETURNING *');
  ok('partial {stage}: params are [value, id]',
    params.length === 2 && params[0] === 'archived' && params[1] === 'uc-1');
}

/* ---------------------------------------------------------------------- */
/* Seed-style: a fully-populated row's blobs are untouched by a partial   */
/* PUT. We simulate the existing row, apply the selector's decision, and  */
/* assert none of the 4 blobs would be overwritten.                       */
/* ---------------------------------------------------------------------- */

{
  const existing = {
    business_context: { driver: 'd', value: 'v', users: 'u', align: 'a', justif: 'j' },
    current_state: { maturity: 'm', spend: 's', volume: 'vo', pain: 'p', tools: 't' },
    technical_context: { sources: 'so', dataavail: 'da', integrations: 'in', realtime: 'rt', technotes: 'tn' },
    risk_compliance: { sensitivity: 'se', autonomy: 'au', pii: 'pi', audit: 'ad', adoption: 'adp', change: 'ch', delivery: 'de', addnotes: 'an' },
    stage: 'intake',
  };
  const decided = selectUseCaseUpdate({ stage: 'archived' });
  // Merge decided over existing exactly as the DB UPDATE would.
  const merged = { ...existing, ...decided };
  ok('seed: only stage changed', merged.stage === 'archived');
  ok('seed: business_context preserved', merged.business_context === existing.business_context);
  ok('seed: current_state preserved', merged.current_state === existing.current_state);
  ok('seed: technical_context preserved', merged.technical_context === existing.technical_context);
  ok('seed: risk_compliance preserved', merged.risk_compliance === existing.risk_compliance);
  ok('seed: selector emitted no jsonb keys',
    !('business_context' in decided) && !('current_state' in decided) &&
    !('technical_context' in decided) && !('risk_compliance' in decided));
}

/* ---------------------------------------------------------------------- */
/* (a) Pure selector unit tests.                                          */
/* ---------------------------------------------------------------------- */

// Empty body updates nothing.
{
  const d = selectUseCaseUpdate({});
  ok('empty body -> no columns', Object.keys(d).length === 0);
}

// A group carried by its GROUPED key is written.
{
  const d = selectUseCaseUpdate({ business_context: { driver: 'x' } });
  ok('grouped key present -> business_context written', 'business_context' in d);
  ok('grouped-only body writes exactly that column', Object.keys(d).length === 1);
}

// A group carried by ANY flat intake key is written.
{
  ok('flat driver -> business_context carried', 'business_context' in selectUseCaseUpdate({ driver: 'x' }));
  ok('flat maturity -> current_state carried', 'current_state' in selectUseCaseUpdate({ maturity: 'x' }));
  ok('flat sources -> technical_context carried', 'technical_context' in selectUseCaseUpdate({ sources: 'x' }));
  ok('flat sensitivity -> risk_compliance carried', 'risk_compliance' in selectUseCaseUpdate({ sensitivity: 'x' }));
  ok('flat addnotes -> risk_compliance carried', 'risk_compliance' in selectUseCaseUpdate({ addnotes: 'x' }));
}

// A group NOT carried is omitted (the whole point of the fix).
{
  const d = selectUseCaseUpdate({ driver: 'x' });
  ok('unrelated groups omitted when only driver present',
    'business_context' in d && !('current_state' in d) &&
    !('technical_context' in d) && !('risk_compliance' in d));
}

// Explicit null / empty are honored as intentional writes.
{
  const dNull = selectUseCaseUpdate({ business_context: null });
  ok('explicit {business_context:null} is written', 'business_context' in dNull && dNull.business_context === null);

  const dEmpty = selectUseCaseUpdate({ driver: '' });
  ok('explicit {driver:""} carries business_context', 'business_context' in dEmpty);
  ok('explicit {driver:""} keeps empty string value', dEmpty.business_context && dEmpty.business_context.driver === '');
}

// Scalar aliasing + presence discipline.
{
  ok('dept alias -> department', selectUseCaseUpdate({ dept: 'Eng' }).department === 'Eng');
  ok('department canonical -> department', selectUseCaseUpdate({ department: 'Eng' }).department === 'Eng');
  ok('sponsor alias -> executive_sponsor', selectUseCaseUpdate({ sponsor: 'A' }).executive_sponsor === 'A');
  ok('submitter alias -> submitted_by', selectUseCaseUpdate({ submitter: 'B' }).submitted_by === 'B');
  ok('email alias -> contact_email', selectUseCaseUpdate({ email: 'e@x.co' }).contact_email === 'e@x.co');
  ok('desc alias -> description', selectUseCaseUpdate({ desc: 'D' }).description === 'D');
  ok('name present -> name', selectUseCaseUpdate({ name: 'N' }).name === 'N');
  ok('absent scalar not written', !('name' in selectUseCaseUpdate({ stage: 's' })));
  ok('explicit empty scalar honored', selectUseCaseUpdate({ name: '' }).name === '');
  ok('explicit null scalar honored',
    (() => { const d = selectUseCaseUpdate({ description: null }); return 'description' in d && d.description === null; })());
}

// status / delivered_at presence discipline.
{
  ok('status only-if-present (absent)', !('status' in selectUseCaseUpdate({ stage: 's' })));
  ok('status written when present', selectUseCaseUpdate({ status: 'live' }).status === 'live');
  ok('delivered_at only-if-present (absent)', !('delivered_at' in selectUseCaseUpdate({ stage: 's' })));
  ok('delivered_at written when present', selectUseCaseUpdate({ delivered_at: '2026-01-01' }).delivered_at === '2026-01-01');
}

// A full multi-group body still works.
{
  const d = selectUseCaseUpdate({
    name: 'N', stage: 'summary', driver: 'x', maturity: 'm', sources: 'so', sensitivity: 'se',
  });
  ok('full body carries all four blobs + scalars',
    'business_context' in d && 'current_state' in d && 'technical_context' in d &&
    'risk_compliance' in d && d.name === 'N' && d.stage === 'summary');
}

console.log('\n---------------------------------------------');
console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------------');
assert.strictEqual(fail, 0, 'put-merge.test.js had failures');
process.exit(fail ? 1 : 0);
