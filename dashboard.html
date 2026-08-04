/*
 * Front-end parser parity test: the browser CSV parser in assets/bulk-upload.js
 * MUST produce the same row objects as the server-side parser in
 * use-case-template.js, so what the user previews == what the server inserts.
 *
 * Run with: node bulk-upload-frontend.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const front = require(path.join(__dirname, 'assets', 'bulk-upload.js'));
const server = require(path.join(__dirname, 'use-case-template.js'));

const serverParse = server.parseCsv || (server.default && server.default.parseCsv);
assert.strictEqual(typeof front.parseCsv, 'function', 'front.parseCsv missing');
assert.strictEqual(typeof serverParse, 'function', 'server parseCsv missing');

let pass = 0, fail = 0;
function check(name, csv) {
  const a = front.parseCsv(csv);
  const b = serverParse(csv);
  try {
    assert.deepStrictEqual(a, b);
    pass++;
    console.log('  PASS ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name);
    console.log('    front : ' + JSON.stringify(a));
    console.log('    server: ' + JSON.stringify(b));
  }
}

console.log('parser parity (front-end vs server):');
check('simple', 'name,description\nA,alpha\nB,beta\n');
check('quoted comma', 'name,description\n"Doe, John","has, comma"\n');
check('escaped quotes', 'name,note\n"She said ""hi""","x"\n');
check('newline in field', 'name,note\n"line1\nline2",ok\n');
check('CRLF endings', 'name,note\r\nA,1\r\nB,2\r\n');
check('bare CR endings', 'name,note\rA,1\rB,2\r');
check('trailing whitespace trim', ' name , note \n A , B \n');
check('ragged short row', 'a,b,c\n1,2\n');
check('ragged long row (extra dropped)', 'a,b\n1,2,3\n');
check('blank lines skipped', 'a,b\n\n1,2\n\n');
check('no trailing newline', 'a,b\n1,2');
check('empty string', '');
check('header only', 'a,b,c\n');
check('empty field key dropped', 'a,,c\n1,2,3\n');

// Parse the real template CSV the server serves, and confirm parity + row count.
const tpl = server.buildTemplateCsv ? server.buildTemplateCsv() : null;
if (tpl) {
  check('real template.csv', tpl);
  const rows = front.parseCsv(tpl);
  try {
    assert.ok(rows.length >= 5, 'template should have >= 5 example rows, got ' + rows.length);
    pass++;
    console.log('  PASS template has ' + rows.length + ' example rows');
  } catch (e) {
    fail++;
    console.log('  FAIL ' + e.message);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
