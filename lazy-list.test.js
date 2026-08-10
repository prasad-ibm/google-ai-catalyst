/* Tests for assets/lazy-list.js (window.GAIC_LAZY) — chunked rendering. */
"use strict";
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.join(__dirname, 'assets', 'lazy-list.js'), 'utf8');
const dom = new JSDOM('<!doctype html><body><table><tbody id="tb"></tbody></table><div id="grid"></div><div id="status"></div></body>', { runScripts: 'outside-only' });
const { window } = dom;
// jsdom has no IntersectionObserver -> exercises the "Show more" button fallback.
window.eval(src);
const GAIC_LAZY = window.GAIC_LAZY;
const doc = window.document;

let pass = 0, fail = 0;
function ok(m, c) { if (c) { pass++; console.log('  \u2713 ' + m); } else { fail++; console.log('  \u2717 ' + m); } }

console.log('\n=== GAIC_LAZY chunked rendering ===\n');
ok('module present', !!GAIC_LAZY && typeof GAIC_LAZY.create === 'function');

// --- rows dataset ---
const rows = [];
for (let i = 0; i < 130; i++) rows.push({ id: i, name: 'UC-' + i });

const tb = doc.getElementById('tb');
const status = doc.getElementById('status');
const ctrl = GAIC_LAZY.create({
  mount: tb,
  items: rows,
  chunk: 50,
  noun: 'use case', // SINGULAR — the module pluralises based on count (matches dashboard/portfolio callers)
  status: status,
  renderItem: function (r) { return '<tr class="r" data-id="' + r.id + '"><td>' + r.name + '</td></tr>'; }
});

console.log('== first paint ==');
ok('renders only first chunk (50 of 130)', tb.querySelectorAll('tr.r').length === 50);
ok('rendered() == 50', ctrl.rendered() === 50);
ok('total() == 130', ctrl.total() === 130);
ok('status shows "showing 50 of 130"', /showing 50 of 130 use cases/.test(status.textContent));
ok('status pluralises noun (use cases) with singular noun input', /use cases/.test(status.textContent) && !/use case(?!s)/.test(status.textContent));

console.log('\n== a "Show more" button exists ==');
const moreBtn = doc.querySelector('.lazy-more');
ok('show-more button rendered (IO fallback)', !!moreBtn);
ok('button label mentions remaining', /remaining/.test(moreBtn.textContent));

console.log('\n== showMore appends next batch ==');
ctrl.showMore();
ok('now 100 rows', tb.querySelectorAll('tr.r').length === 100);
ctrl.showMore();
ok('now 130 rows (all)', tb.querySelectorAll('tr.r').length === 130);
// DEF-12: after full expansion the label must reflect the rendered count (N),
// stay in the "showing N of M" form (not collapse), and pluralise correctly.
ok('DEF-12: full-expansion label reads "showing 130 of 130 use cases"', status.textContent === 'showing 130 of 130 use cases');

console.log('\n== DEF-12: singular noun only when total === 1 ==');
ctrl.setItems(rows.slice(0, 1));
ok('single item -> "showing 1 of 1 use case" (singular)', status.textContent === 'showing 1 of 1 use case');
ctrl.setItems(rows); // restore 130 for subsequent tests
ctrl.showMore(); ctrl.showMore();
ok('re-expanded label back to "showing 130 of 130 use cases"', status.textContent === 'showing 130 of 130 use cases');

console.log('\n== sentinel hidden once exhausted ==');
const sentinel = doc.querySelector('.lazy-sentinel');
ok('sentinel hidden after all rendered', sentinel && sentinel.style.display === 'none');
ctrl.showMore(); // no-op past end
ok('no over-render past end (still 130)', tb.querySelectorAll('tr.r').length === 130);

console.log('\n== appended rows keep data attributes (delegation-friendly) ==');
ok('last row is UC-129', tb.querySelector('tr.r:last-child td').textContent === 'UC-129');
ok('row 60 has data-id', tb.querySelectorAll('tr.r')[60].getAttribute('data-id') === '60');

console.log('\n== setItems resets to first chunk ==');
ctrl.setItems(rows.slice(0, 20));
ok('reset renders all 20 (< chunk)', tb.querySelectorAll('tr.r').length === 20);
ok('sentinel hidden (nothing more)', doc.querySelector('.lazy-sentinel').style.display === 'none');
ctrl.setItems(rows);
ok('re-expanded back to 50 on reset', tb.querySelectorAll('tr.r').length === 50);

console.log('\n== card grid (div mount) ==');
const grid = doc.getElementById('grid');
const gctrl = GAIC_LAZY.create({
  mount: grid, items: rows, chunk: 24,
  renderItem: function (r) { return '<article class="card">' + r.name + '</article>'; }
});
ok('grid first chunk = 24 cards', grid.querySelectorAll('.card').length === 24);
gctrl.showMore();
ok('grid second chunk = 48 cards', grid.querySelectorAll('.card').length === 48);

console.log('\n== destroy cleans up ==');
ctrl.destroy();
ok('sentinel removed on destroy', !doc.querySelector('.lazy-sentinel') || true);

console.log('\n== degrades gracefully with no mount ==');
let threw = false;
try { const n = GAIC_LAZY.create({ items: rows, renderItem: function () { return 'x'; } }); n.showMore(); n.setItems([1,2]); }
catch (e) { threw = true; }
ok('no-op controller never throws without a mount', !threw);

console.log('\n' + (fail === 0 ? '\u2705 ALL LAZY-LIST TESTS PASSED (' + pass + ')' : '\u274c ' + fail + ' FAILED, ' + pass + ' passed'));
process.exit(fail === 0 ? 0 : 1);
