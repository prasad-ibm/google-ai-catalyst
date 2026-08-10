/**
 * Tests for assets/filter-bar.js (window.GAIC_FILTERS).
 *  - Pure URL/query helpers: readURL, writeURL, toQuery (jsdom for URL + history).
 *  - DOM: mount() renders 4 selects + search + Clear, fetches facets, and a
 *    select change fires onChange + persists to the URL.
 *
 * Run with: node filter-bar.test.js
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

// Load filter-bar.js into a fresh jsdom window and return window.GAIC_FILTERS.
function loadModule(url) {
  const src = fs.readFileSync(path.join(__dirname, 'assets', 'filter-bar.js'), 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="fb"></div></body>', {
    url: url || 'http://localhost/portfolio-map.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.eval(src);
  return { window, F: window.GAIC_FILTERS };
}

async function main() {
  // ---- toQuery (pure) --------------------------------------------------
  {
    const { F } = loadModule();
    ok('toQuery empty -> ""', F.toQuery({}, null) === '');
    ok('toQuery wsId only', F.toQuery({}, 'ws-1') === '?workspace_id=ws-1');
    ok('toQuery skips empty keys',
      F.toQuery({ department: '', sponsor: 'ET-DCG', stage: '', status: '', q: '' }, null)
        === '?sponsor=ET-DCG');
    const q = F.toQuery({ department: 'Data Center Group', q: 'llm' }, 'ws-9');
    ok('toQuery encodes + orders wsId first',
      q === '?workspace_id=ws-9&department=Data%20Center%20Group&q=llm');
    ok('toQuery encodes special chars',
      F.toQuery({ q: 'a&b=c' }, null) === '?q=a%26b%3Dc');
  }

  // ---- readURL (pure) --------------------------------------------------
  {
    const { F } = loadModule('http://localhost/dashboard.html?department=Legal&q=chat&status=GO');
    const s = F.readURL();
    ok('readURL parses present keys', s.department === 'Legal' && s.q === 'chat' && s.status === 'GO');
    ok('readURL defaults missing keys to ""', s.sponsor === '' && s.stage === '');
    ok('readURL always returns all 5 keys',
      ['department', 'sponsor', 'stage', 'status', 'q'].every((k) => k in s));
  }

  // ---- writeURL (pure) -------------------------------------------------
  {
    const { window, F } = loadModule('http://localhost/kanban.html?workspace_id=ws-7');
    F.writeURL({ department: 'Finance', sponsor: '', stage: '', status: '', q: 'audit' });
    const sp = new window.URLSearchParams(window.location.search);
    ok('writeURL sets non-empty keys', sp.get('department') === 'Finance' && sp.get('q') === 'audit');
    ok('writeURL omits empty keys', sp.get('sponsor') === null && sp.get('stage') === null);
    ok('writeURL preserves other params (workspace_id)', sp.get('workspace_id') === 'ws-7');
    // Clearing removes the key.
    F.writeURL({ department: '', sponsor: '', stage: '', status: '', q: '' });
    const sp2 = new window.URLSearchParams(window.location.search);
    ok('writeURL clears removed keys', sp2.get('department') === null && sp2.get('q') === null);
    ok('writeURL still preserves workspace_id after clear', sp2.get('workspace_id') === 'ws-7');
  }

  // ---- FACET_RESPONSE_KEYS (contract) ----------------------------------
  // The server keys facet buckets by the PLURAL name; the singular filter key
  // is what we send as a query param. This map is the source of truth for that
  // translation and MUST match the shape used by the mount() mock below.
  {
    const { F } = loadModule();
    ok('exposes plural facet-key map', F.FACET_RESPONSE_KEYS &&
      F.FACET_RESPONSE_KEYS.department === 'departments' &&
      F.FACET_RESPONSE_KEYS.sponsor === 'sponsors' &&
      F.FACET_RESPONSE_KEYS.stage === 'stages' &&
      F.FACET_RESPONSE_KEYS.status === 'statuses');
  }

  // ---- mount() DOM -----------------------------------------------------
  {
    const { window, F } = loadModule('http://localhost/portfolio-map.html');
    const el = window.document.getElementById('fb');

    const facetCalls = [];
    // NOTE: this mirrors the REAL GET /api/portfolio/facets contract, which
    // returns PLURAL bucket keys (departments/sponsors/stages/statuses). The
    // previous mock used singular keys, which masked the client/server key
    // mismatch (DEF-01) and let dropdowns render empty in production.
    const fakeApi = (path) => {
      facetCalls.push(path);
      return Promise.resolve({
        departments: [{ value: 'Data Center Group', count: 12 }, { value: 'Legal', count: 3 }],
        sponsors: [{ value: 'ET-DCG', count: 9 }],
        stages: [{ value: 'Pilot', count: 5 }],
        statuses: [{ value: 'active', count: 20 }, { value: 'completed', count: 4 }],
      });
    };

    let changeState = null, changeCount = 0;
    const ctrl = F.mount({
      el: el,
      apiFetch: fakeApi,
      wsId: 'ws-1',
      onChange: (s) => { changeCount++; changeState = s; },
    });
    ok('mount returns a controller', ctrl && typeof ctrl.getState === 'function');

    const selects = el.querySelectorAll('select.filterbar__select');
    ok('mount renders 4 selects', selects.length === 4);
    ok('mount renders a search input', !!el.querySelector('input[data-key="q"]'));
    ok('mount renders a Clear button', !!el.querySelector('[data-action="clear"]'));
    ok('mount requests facets on init', facetCalls.some((p) => p.indexOf('/portfolio/facets') === 0));
    ok('mount facets query carries wsId', facetCalls[0].indexOf('workspace_id=ws-1') !== -1);

    await sleep(10); // let the facets promise resolve + fill selects

    const deptSel = el.querySelector('select[data-key="department"]');
    // "All" + 2 facet options
    ok('facets fill dept select w/ counts (plural key)',
      deptSel.options.length === 3 && /Data Center Group \(12\)/.test(deptSel.options[1].textContent));

    // Every select populated from its plural bucket.
    const sponsorSel = el.querySelector('select[data-key="sponsor"]');
    const stageSel = el.querySelector('select[data-key="stage"]');
    const statusSel = el.querySelector('select[data-key="status"]');
    ok('facets fill sponsor select (plural key)',
      sponsorSel.options.length === 2 && /ET-DCG \(9\)/.test(sponsorSel.options[1].textContent));
    ok('facets fill stage select (plural key)',
      stageSel.options.length === 2 && /Pilot \(5\)/.test(stageSel.options[1].textContent));
    ok('facets fill status select (irregular plural "statuses")',
      statusSel.options.length === 3 && /completed \(4\)/.test(statusSel.options[2].textContent));

    // Simulate the user choosing a department.
    deptSel.value = 'Legal';
    deptSel.dispatchEvent(new window.Event('change', { bubbles: true }));

    ok('select change fires onChange', changeCount === 1);
    ok('onChange carries new state', changeState && changeState.department === 'Legal');
    ok('select change persists to URL',
      new window.URLSearchParams(window.location.search).get('department') === 'Legal');
    ok('getState reflects change', ctrl.getState().department === 'Legal');

    await sleep(10); // emit() re-pulls facets
    const lastFacet = facetCalls[facetCalls.length - 1];
    ok('re-pull facets includes the new filter', lastFacet.indexOf('department=Legal') !== -1);

    // Clear resets everything.
    el.querySelector('[data-action="clear"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    ok('clear resets state', ctrl.getState().department === '' && ctrl.getState().q === '');
    ok('clear removes URL params',
      new window.URLSearchParams(window.location.search).get('department') === null);
  }

  // ---- legacy singular fallback ----------------------------------------
  // Defensive: if a server still emits singular keys, the bar must still fill.
  {
    const { window, F } = loadModule('http://localhost/portfolio-map.html');
    const el = window.document.getElementById('fb');
    const fakeApi = () => Promise.resolve({
      department: [{ value: 'Legal', count: 3 }],
    });
    F.mount({ el: el, apiFetch: fakeApi, wsId: null, onChange: () => {} });
    await sleep(10);
    const deptSel = el.querySelector('select[data-key="department"]');
    ok('singular-key fallback still fills dept select',
      deptSel.options.length === 2 && /Legal \(3\)/.test(deptSel.options[1].textContent));
  }

  console.log('\nfilter-bar: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
