'use strict';

/*
 * Pure unit tests for the use-case CSV template builder. No DB, no network —
 * runs under `node --test use-case-template.test.js` (and via `npm test`).
 * Verifies the CSV maps to the intake/use_cases fields and carries the 5
 * existing Intel use cases as example rows.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  TEMPLATE_COLUMNS,
  TEMPLATE_ROWS,
  buildTemplateCsv,
  csvEscape,
} = require('./use-case-template');

// Minimal RFC4180-ish parser for assertions (handles quotes + embedded commas/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c === '\r') {
      /* ignore CR; CRLF handled by the \n branch */
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('columns include the core use_cases identity fields', () => {
  for (const col of ['name', 'department', 'executive_sponsor', 'submitted_by', 'contact_email', 'description']) {
    assert.ok(TEMPLATE_COLUMNS.includes(col), 'missing column ' + col);
  }
});

test('columns include the four intake context groups (flat keys mapUseCaseContexts accepts)', () => {
  const business = ['driver', 'value', 'users', 'align', 'justif'];
  const current = ['maturity', 'spend', 'volume', 'pain', 'tools'];
  const technical = ['sources', 'dataavail', 'integrations', 'realtime', 'technotes'];
  const risk = ['sensitivity', 'autonomy', 'pii', 'audit', 'adoption', 'change', 'delivery', 'addnotes'];
  for (const col of [...business, ...current, ...technical, ...risk]) {
    assert.ok(TEMPLATE_COLUMNS.includes(col), 'missing intake column ' + col);
  }
});

test('there are 5 active Intel example rows + 1 completed/delivered example', () => {
  assert.strictEqual(TEMPLATE_ROWS.length, 6);
  const names = TEMPLATE_ROWS.map((r) => r.name);
  assert.deepStrictEqual(names, [
    'AskHR',
    'Contract Leakage',
    'Demand Forecasting & Supply Chain Planning',
    'Predictive Asset Maintenance',
    'Quality Defect Prediction & Root Cause Analysis',
    'Automated Invoice Matching (DELIVERED EXAMPLE)',
  ]);
});

test('lifecycle columns exist and the completed example is well-formed', () => {
  assert.ok(TEMPLATE_COLUMNS.includes('status'), 'status column present');
  assert.ok(TEMPLATE_COLUMNS.includes('delivered_at'), 'delivered_at column present');
  const completed = TEMPLATE_ROWS.find((r) => r.status === 'completed');
  assert.ok(completed, 'a completed example row exists');
  assert.strictEqual(completed.delivered_at, '2026-03-15');
  assert.strictEqual(completed.stage, 'panel');
});

test('csvEscape quotes fields with comma, quote, or newline and doubles quotes', () => {
  assert.strictEqual(csvEscape('plain'), 'plain');
  assert.strictEqual(csvEscape('a,b'), '"a,b"');
  assert.strictEqual(csvEscape('has "q"'), '"has ""q"""');
  assert.strictEqual(csvEscape('line1\nline2'), '"line1\nline2"');
  assert.strictEqual(csvEscape(null), '');
  assert.strictEqual(csvEscape(undefined), '');
});

test('buildTemplateCsv produces a header + 6 data rows, all with the same column count', () => {
  const csv = buildTemplateCsv();
  const parsed = parseCsv(csv);
  assert.strictEqual(parsed.length, 7, 'expected 1 header + 6 rows');
  assert.deepStrictEqual(parsed[0], TEMPLATE_COLUMNS);
  for (let i = 1; i < parsed.length; i++) {
    assert.strictEqual(parsed[i].length, TEMPLATE_COLUMNS.length, 'row ' + i + ' column count mismatch');
  }
});

test('the first data row round-trips AskHR values into the right columns', () => {
  const csv = buildTemplateCsv();
  const parsed = parseCsv(csv);
  const header = parsed[0];
  const row = parsed[1];
  const get = (col) => row[header.indexOf(col)];
  assert.strictEqual(get('name'), 'AskHR');
  assert.strictEqual(get('department'), 'HR');
  assert.strictEqual(get('executive_sponsor'), 'CHRO');
  assert.strictEqual(get('pii'), 'true');
  assert.ok(get('description').includes('self-service'), 'description preserved through quoting');
});
