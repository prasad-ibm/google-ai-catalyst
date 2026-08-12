'use strict';

/*
 * DEF-13 (HIGH): the bulk-import path must validate `department` against the
 * canonical 16-item taxonomy and coerce anything unrecognized to null, exactly
 * as the intake authoring dropdown constrains it. This closes the self-polluting
 * facet loop (bulk junk -> facets 14->15 -> DEF-06 dynamic merge -> intake
 * dropdown option 15).
 *
 * These are PURE tests (no DB, no server boot) so they run fast and offline:
 *   (A) resolveDepartment() coerces / normalizes / rejects correctly.
 *   (B) buildUseCaseValues() — the single mapping shared by single-create and
 *       bulk — is exercised the way the bulk loop calls it (dept pre-resolved),
 *       proving a junk department lands as NULL in the INSERT values.
 *   (C) Parity guard: the canonical list in departments.js matches the 16
 *       <option> values shipped in intake.html #f_dept, so the two can never
 *       drift into a second hardcoded copy.
 *
 * Run with:  node --test bulk-upload-departments.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  CANONICAL_DEPARTMENTS,
  resolveDepartment,
  isCanonicalDepartment,
} = require('./departments');
const {
  TEMPLATE_COLUMNS,
  TEMPLATE_ROWS,
  buildTemplateCsv,
  parseCsv,
} = require('./use-case-template');

/* -------------------------------------------------------------------------- */
/* (A) resolveDepartment: the coerce-or-null rule.                            */
/* -------------------------------------------------------------------------- */

test('resolveDepartment: exact canonical values pass through unchanged', () => {
  for (const d of CANONICAL_DEPARTMENTS) {
    assert.strictEqual(resolveDepartment(d), d, `${d} resolves to itself`);
    assert.strictEqual(isCanonicalDepartment(d), true);
  }
  assert.strictEqual(CANONICAL_DEPARTMENTS.length, 16, 'exactly 16 canonical departments');
});

test('resolveDepartment: case-insensitive and whitespace-trimmed match', () => {
  assert.strictEqual(resolveDepartment('  finance  '), 'Finance');
  assert.strictEqual(resolveDepartment('HUMAN RESOURCES'), 'Human Resources');
  assert.strictEqual(resolveDepartment('r&d'), 'R&D');
});

test('resolveDepartment: unknown department is coerced to null (DEF-13 core)', () => {
  // The exact junk value that polluted /facets (14->15) in the QA report.
  assert.strictEqual(resolveDepartment('NotARealDept'), null);
  assert.strictEqual(isCanonicalDepartment('NotARealDept'), false);
  // Genuinely unknown near-misses (NOT canonical, NOT a known alias) reject.
  assert.strictEqual(resolveDepartment('Ops'), null);
  assert.strictEqual(resolveDepartment('Engineering'), null);
  assert.strictEqual(resolveDepartment('Facilities'), null);
});

test('resolveDepartment: known abbreviations resolve to canonical (DEF-13 aliases)', () => {
  // 'HR' is the must-have the QA report calls out — it used to drop to null on
  // bulk import, which silenced legitimate rows.
  assert.strictEqual(resolveDepartment('HR'), 'Human Resources');
  assert.strictEqual(isCanonicalDepartment('HR'), true);
  // A sampling across the other alias groups, exercising trim + case folding.
  assert.strictEqual(resolveDepartment('  hr '), 'Human Resources');
  assert.strictEqual(resolveDepartment('R & D'), 'R&D');
  assert.strictEqual(resolveDepartment('research and development'), 'R&D');
  assert.strictEqual(resolveDepartment('Information Technology'), 'IT');
  assert.strictEqual(resolveDepartment('I.T.'), 'IT');
  assert.strictEqual(resolveDepartment('InfoSec'), 'Security');
  assert.strictEqual(resolveDepartment('Customer Service'), 'Customer Support');
  assert.strictEqual(resolveDepartment('Purchasing'), 'Procurement');
  assert.strictEqual(resolveDepartment('Legal Dept'), 'Legal');
  // Every alias must map to something that is itself canonical (no drift).
  for (const canon of [
    'Human Resources', 'R&D', 'IT', 'Security', 'Customer Support',
    'Procurement', 'Legal',
  ]) {
    assert.ok(CANONICAL_DEPARTMENTS.includes(canon), `${canon} is canonical`);
  }
});

test('resolveDepartment: blank / null / undefined coerce to null', () => {
  assert.strictEqual(resolveDepartment(''), null);
  assert.strictEqual(resolveDepartment('   '), null);
  assert.strictEqual(resolveDepartment(null), null);
  assert.strictEqual(resolveDepartment(undefined), null);
});

/* -------------------------------------------------------------------------- */
/* (B) buildUseCaseValues: a junk dept lands as NULL, a good dept survives.   */
/*     Mirrors how the bulk loop calls it (row.department pre-resolved).       */
/* -------------------------------------------------------------------------- */

test('buildUseCaseValues: canonical department is stored, junk stored as null', () => {
  const { buildUseCaseValues } = require('./server');
  const DEPT_IDX = 2; // 3rd INSERT column is `department` (see USE_CASE_INSERT_COLS)

  // Good row: department preserved verbatim.
  const good = buildUseCaseValues(
    { name: 'Good', department: resolveDepartment('Finance') },
    'ws-1',
  );
  assert.strictEqual(good[DEPT_IDX], 'Finance');

  // Junk row: the bulk loop resolves 'NotARealDept' -> null BEFORE mapping, so
  // the INSERT stores NULL and the value can never become a facet.
  const junk = buildUseCaseValues(
    { name: 'Junk', department: resolveDepartment('NotARealDept') },
    'ws-1',
  );
  assert.strictEqual(junk[DEPT_IDX], null);
});

/* -------------------------------------------------------------------------- */
/* (C) Parity guard: departments.js === intake.html #f_dept options.          */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* (D) Shipped template must round-trip cleanly: every example row's           */
/*     department resolves to a canonical value (none silently nulled on       */
/*     import), and the template carries no dead blank `workspace_id` column.   */
/* -------------------------------------------------------------------------- */

test('template: every shipped example row department survives resolveDepartment (no silent null)', () => {
  assert.ok(TEMPLATE_ROWS.length >= 5, 'template ships >= 5 example rows');
  for (const row of TEMPLATE_ROWS) {
    const resolved = resolveDepartment(row.department);
    assert.notStrictEqual(
      resolved,
      null,
      `template row "${row.name}" has dept "${row.department}" that nulls on import`,
    );
    // And it must be canonical after resolution (no drift).
    assert.ok(
      CANONICAL_DEPARTMENTS.includes(resolved),
      `"${row.name}" resolves to non-canonical "${resolved}"`,
    );
  }
});

test('template: no dead blank workspace_id column (UI/bulk endpoint supplies it)', () => {
  // The old template shipped a `workspace_id` column blank in every row, which
  // confused hand-editors and served no purpose (the bulk endpoint / modal
  // supplies workspace_id out-of-band). It must be gone.
  assert.ok(
    !TEMPLATE_COLUMNS.includes('workspace_id'),
    'workspace_id must not be a template column',
  );
  const csv = buildTemplateCsv();
  const header = csv.split(/\r?\n/)[0];
  assert.ok(
    !/(^|,)workspace_id(,|$)/.test(header),
    'CSV header must not contain workspace_id',
  );
  // The parsed rows still carry every filled example (parity with frontend).
  const rows = parseCsv(csv);
  assert.ok(rows.length >= 5, 'template still parses >= 5 example rows');
});

test('canonical list matches the 16 options in intake.html #f_dept', () => {
  const html = fs.readFileSync(path.join(__dirname, 'intake.html'), 'utf8');

  // Isolate the #f_dept <select> block, then pull every option's TEXT content
  // (the options carry no value attribute — the label IS the value) and decode
  // the HTML entity in 'R&amp;D'. The leading 'Select…' placeholder is blank
  // and filtered out. Comments inside the block never match the option regex.
  const sel = html.match(/<select[^>]*id=["']f_dept["'][\s\S]*?<\/select>/i);
  assert.ok(sel, 'found #f_dept select in intake.html');

  const opts = [];
  const re = /<option([^>]*)>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(sel[0])) !== null) {
    const attrs = m[1];
    const label = m[2].replace(/&amp;/g, '&').trim();
    // Skip the placeholder <option value="">Select…</option>.
    if (/value\s*=\s*["']\s*["']/.test(attrs)) continue;
    if (label !== '') opts.push(label);
  }

  assert.deepStrictEqual(
    opts.slice().sort(),
    CANONICAL_DEPARTMENTS.slice().sort(),
    'intake.html #f_dept options and departments.js must be identical (no drift)',
  );
});
