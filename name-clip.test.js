'use strict';

/*
 * DEF-03 — name clipping at the API / CSV ingest layer.
 *
 * Run with:  node --test name-clip.test.js
 *
 * Pure unit tests (no DB, no HTTP): they exercise the exact helpers the
 * `/api/portfolio` read path and the single-create / bulk-CSV ingest path use
 * to cap an oversized use-case name at NAME_MAX. A pathologically long name
 * (e.g. pasted prose, a malformed CSV cell) must never reach the client or the
 * database uncapped, because Compare / Dashboard render it into fixed-width
 * cells and a huge string would bloat the payload and break layout.
 */

require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert');

const { capStr, buildUseCaseValues, NAME_MAX } = require('./server');
const { parseCsv } = require('./use-case-template');

test('NAME_MAX is a sane, documented bound', () => {
  assert.strictEqual(typeof NAME_MAX, 'number');
  assert.ok(NAME_MAX > 0 && NAME_MAX <= 500, 'NAME_MAX in a reasonable range');
});

test('capStr clips a string longer than max to exactly max chars', () => {
  const long = 'X'.repeat(NAME_MAX + 250);
  const out = capStr(long, NAME_MAX);
  assert.strictEqual(out.length, NAME_MAX, 'clipped to NAME_MAX');
  assert.ok(long.startsWith(out), 'clip keeps the leading prefix');
});

test('capStr leaves a short string untouched and passes null through', () => {
  assert.strictEqual(capStr('AskHR', NAME_MAX), 'AskHR');
  assert.strictEqual(capStr(null, NAME_MAX), null);
  assert.strictEqual(capStr(undefined, NAME_MAX), null);
});

test('ingest (buildUseCaseValues) clips an oversized name — CSV/API write path', () => {
  // buildUseCaseValues() is the single shared mapper used by both the single
  // create endpoint and the bulk/CSV upload loop; name is the first column.
  const long = 'Y'.repeat(1000);
  const values = buildUseCaseValues({ name: long, department: 'Ops' }, 'ws-test');
  // buildUseCaseValues() returns positional column values; index 0 is
  // workspace_id and index 1 is the name.
  const storedName = values[1];
  assert.strictEqual(storedName.length, NAME_MAX, 'stored name capped at NAME_MAX');
  assert.ok(long.startsWith(storedName), 'stored name is a prefix of the input');
});

test('full CSV -> parse -> ingest clips the name end to end', () => {
  // Simulate a bulk-upload CSV whose first row carries a 900-char name.
  const bigName = 'Z'.repeat(900);
  const csv = [
    'name,department,description',
    `"${bigName}","Finance","normal description"`,
  ].join('\r\n');

  const rows = parseCsv(csv);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name.length, 900, 'parser preserves the raw cell');

  // The ingest mapper is what actually persists — it must clip.
  const values = buildUseCaseValues(rows[0], 'ws-test');
  assert.strictEqual(values[1].length, NAME_MAX, 'ingested name capped at NAME_MAX');
});
