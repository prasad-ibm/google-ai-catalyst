/*
 * DOM smoke test for assets/bulk-upload.js using jsdom.
 * Verifies: mount, modal open, workspace picker populates, CSV parse preview,
 * POST payload shape, and per-row result rendering.
 *
 * Run with: node bulk-upload-dom.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><button id="btn">Bulk</button></body>',
    { url: 'http://localhost/', runScripts: 'outside-only' }
  );
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.FileReader = window.FileReader;

  // Capture the POST payload.
  let posted = null;
  window.fetch = async (url, opts) => {
    posted = { url, opts, body: JSON.parse(opts.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        inserted: 1,
        failed: 1,
        results: [
          { row: 0, ok: true, id: 'abc12345-0000', name: 'Row One' },
          { row: 1, ok: false, error: 'name is required' },
        ],
      }),
    };
  };
  global.fetch = window.fetch;

  // Mock workspaces API separately: bulk-upload uses fetch for both. Route by URL.
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).indexOf('/api/workspaces') !== -1) {
      return { ok: true, status: 200, json: async () => ([{ id: 'ws-1', name: 'Intel' }, { id: 'ws-2', name: 'Acme' }]) };
    }
    return realFetch(url, opts);
  };
  global.fetch = window.fetch;

  // Load the module (its browser branch attaches window.GAIC_BULK).
  const code = fs.readFileSync(path.join(__dirname, 'assets', 'bulk-upload.js'), 'utf8');
  window.eval(code);

  ok('window.GAIC_BULK defined', !!window.GAIC_BULK && typeof window.GAIC_BULK.mount === 'function');

  window.GAIC_BULK.mount({ open: '#btn', workspaceId: 'ws-2', onInserted: () => { window.__inserted = true; } });

  // Open via the trigger.
  window.document.getElementById('btn').click();
  await sleep(30);

  const MODAL = 'gaicBulkModal';
  ok('modal rendered in DOM', !!window.document.getElementById(MODAL));

  const wsSelect = window.document.querySelector('#gbuWs');
  ok('workspace picker populated', wsSelect && wsSelect.options.length === 2);
  ok('workspace picker defaults to passed id', wsSelect && wsSelect.value === 'ws-2');

  // Simulate choosing a CSV file.
  const csv = 'name,description,category\nRow One,first,Productivity\n,missing name,Ops\n';
  const file = new window.File([csv], 'ucs.csv', { type: 'text/csv' });
  const input = window.document.querySelector('#gbuFile');
  ok('file input present', !!input);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await sleep(60);

  // Preview should reflect 2 parsed rows.
  const previewText = window.document.getElementById(MODAL).textContent;
  ok('parse preview shows 2 rows', /Parsed\s*2\s*rows/i.test(previewText));
  // DEF-04: client-side pre-validation flags the blank-name row before upload.
  ok('preview warns about 1 row missing name', /1 row missing a required "name"/i.test(previewText));
  ok('countMissingName helper returns 1', window.GAIC_BULK && window.GAIC_BULK.countMissingName([{name:'x'},{name:''},{name:'  '}]) === 2);
  // warn-and-allow: submit stays enabled so the server can still skip bad rows.
  ok('submit still enabled despite blank-name warning', !window.document.querySelector('#gbuSubmit').disabled);

  // Submit.
  const submitBtn = window.document.querySelector('#gbuSubmit');
  ok('submit button present', !!submitBtn);
  submitBtn.click();
  await sleep(60);

  ok('POST went to /api/use-cases/bulk', posted && /\/api\/use-cases\/bulk$/.test(posted.url));
  ok('POST body has workspace_id', posted && posted.body.workspace_id === 'ws-2');
  ok('POST body has 2 rows', posted && Array.isArray(posted.body.rows) && posted.body.rows.length === 2);
  ok('POST row parsed correctly', posted && posted.body.rows[0].name === 'Row One' && posted.body.rows[0].category === 'Productivity');

  const resultsHtml = window.document.getElementById(MODAL).innerHTML;
  ok('results show inserted count', /1 inserted/.test(window.document.getElementById(MODAL).textContent));
  ok('results show a failed row error', /name is required/.test(resultsHtml));
  ok('results show inserted row name', /Row One/.test(resultsHtml));
  ok('onInserted callback fired', window.__inserted === true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
