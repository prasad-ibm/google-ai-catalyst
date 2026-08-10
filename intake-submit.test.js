/* H3 regression test for intake.html submit navigation.
 * Run with: node intake-submit.test.js
 *
 * Verifies the fix for the core-journey data-loss bug: the submit handler must
 * wait for GAIC_API.createUseCase to resolve, capture the REAL uc.id, persist it
 * as gaic_use_case_id, and navigate to bxt.html?id=<newId> — never bare bxt.html
 * carrying a PRIOR case's stale id.
 *
 * jsdom silently ignores `window.location.href = ...`, so we assert on the
 * `window.__gaic.lastNav` test seam that records the resolved navigation target,
 * plus on the persisted localStorage id.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'intake.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; console.log('  \u2713 '+name); } else { fail++; console.log('  \u2717 '+name); } }

// Silence jsdom's "Not implemented: navigation" noise — expected & irrelevant.
function quietConsole(){
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  return vc;
}

// Fill the two required fields (name + desc) so submit is allowed, then jump to
// the last tab and click "Submit to BXT Gate".
function fillAndSubmit(w){
  const d = w.document;
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, {bubbles:true}));
  const click = el => el.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  const nm = d.getElementById('f_name'); nm.value = 'Invoice Reconciliation Bot'; fire(nm, 'input');
  const ds = d.getElementById('f_desc'); ds.value = 'Automate 3-way match of invoices to POs and receipts.'; fire(ds, 'input');
  // DEF-08: Department is now required — select one so submit is allowed.
  const dp = d.getElementById('f_dept'); if (dp) { dp.value = 'Finance'; fire(dp, 'change'); }
  w.__gaic.goTo(w.__gaic.TABS.length - 1);
  click(d.getElementById('btnNext'));
}

// ---------------------------------------------------------------------------
// Test 1 — API resolves with a real id: navigate to bxt.html?id=<newId>,
// persist it, and DO NOT carry the prior (AskHR) id.
// ---------------------------------------------------------------------------
function testSuccess(){
  return new Promise(resolve => {
    console.log('\n== 1. createUseCase resolves {id:"NEW123"} ==');
    const dom = new JSDOM(html, {
      runScripts:'dangerously', pretendToBeVisual:true,
      url:'https://example.com/intake.html', virtualConsole: quietConsole(),
      beforeParse(w){
        // Simulate a PRIOR case's stale id (AskHR) sitting in localStorage.
        w.localStorage.setItem('gaic_use_case_id', 'ASKHR_STALE');
        w.GAIC_API = {
          createUseCase: () => Promise.resolve({ id:'NEW123', name:'Invoice Reconciliation Bot' })
        };
      }
    });
    setTimeout(() => {
      const w = dom.window;
      fillAndSubmit(w);
      // Let the resolved promise microtask + _go run.
      setTimeout(() => {
        ok('navigated to bxt.html?id=NEW123', w.__gaic.lastNav === 'bxt.html?id=NEW123');
        ok('did NOT navigate to bare bxt.html', w.__gaic.lastNav !== 'bxt.html');
        ok('did NOT carry the prior AskHR id in the URL', !/ASKHR_STALE/.test(w.__gaic.lastNav || ''));
        ok('gaic_use_case_id persisted as NEW123', w.localStorage.getItem('gaic_use_case_id') === 'NEW123');
        resolve();
      }, 30);
    }, 60);
  });
}

// ---------------------------------------------------------------------------
// Test 2 — slow/never-settling POST: the honest 8s fallback must NOT fire early
// and must NEVER reuse the prior AskHR id (the old 1500ms race regression).
// ---------------------------------------------------------------------------
function testSlow(){
  return new Promise(resolve => {
    console.log('\n== 2. createUseCase is slow (never settles in test window) ==');
    const dom = new JSDOM(html, {
      runScripts:'dangerously', pretendToBeVisual:true,
      url:'https://example.com/intake.html', virtualConsole: quietConsole(),
      beforeParse(w){
        w.localStorage.setItem('gaic_use_case_id', 'ASKHR_STALE');
        w.GAIC_API = { createUseCase: () => new Promise(() => {}) }; // never resolves
      }
    });
    setTimeout(() => {
      const w = dom.window;
      fillAndSubmit(w);
      setTimeout(() => {
        ok('no premature navigation before 8s fallback', !w.__gaic.lastNav);
        ok('stale AskHR id was cleared at submit start (not reused)',
           w.localStorage.getItem('gaic_use_case_id') === null);
        resolve();
      }, 50);
    }, 60);
  });
}

// ---------------------------------------------------------------------------
// Test 3 — offline fallback: createUseCase resolves {_offline:true} with NO id.
// Must navigate to bare bxt.html (scores from flat localStorage), must NOT
// fabricate or reuse the prior AskHR id.
// ---------------------------------------------------------------------------
function testOffline(){
  return new Promise(resolve => {
    console.log('\n== 3. createUseCase resolves {_offline:true} (no id) ==');
    const dom = new JSDOM(html, {
      runScripts:'dangerously', pretendToBeVisual:true,
      url:'https://example.com/intake.html', virtualConsole: quietConsole(),
      beforeParse(w){
        w.localStorage.setItem('gaic_use_case_id', 'ASKHR_STALE');
        w.GAIC_API = { createUseCase: () => Promise.resolve({ _offline:true, data:{} }) };
      }
    });
    setTimeout(() => {
      const w = dom.window;
      fillAndSubmit(w);
      setTimeout(() => {
        ok('offline: navigates to bare bxt.html', w.__gaic.lastNav === 'bxt.html');
        ok('offline: no id fabricated / prior id not reused',
           w.localStorage.getItem('gaic_use_case_id') === null);
        ok('offline: non-blocking "syncing" notice shown', !!w.document.getElementById('syncNotice'));
        resolve();
      }, 30);
    }, 60);
  });
}

// ---------------------------------------------------------------------------
// Test 4 (integration) — the REAL bxt.html, opened with the ?id=NEW123 that our
// fix now emits, must resolve THAT case (not the stale AskHR id) and wire the
// Continue-to-Feasibility link with the SAME id.
// ---------------------------------------------------------------------------
const DEEPLINK_JS = fs.readFileSync(path.join(__dirname, 'assets', 'deep-link.js'), 'utf8');
const NEW_ROW = {
  id:'NEW123', name:'Invoice Reconciliation Bot', department:'Finance',
  business_context:{}, current_state:{}, technical_context:{}, risk_compliance:{},
  bxt:{ business_score:80, experience_score:72, technology_score:78, verdict:'PASS',
        detail:{ weakKey:'X', weakName:'Experience', weakScore:72, factors:{B:{},X:{},T:{}} } }
};
function testBxtHandoff(){
  return new Promise(resolve => {
    console.log('\n== 4. bxt.html?id=NEW123 resolves the new case & wires Continue ==');
    var raw = fs.readFileSync(path.join(__dirname, 'bxt.html'), 'utf8');
    var mock = 'window.GAIC_API={getUseCase:function(id){window.__lastFetchId=id;return Promise.resolve('
      + JSON.stringify(NEW_ROW) + ');},saveGate:function(){return Promise.resolve({});}};';
    var htmlB = raw
      .replace('<script src="assets/api-client.js"></script>', '<script>'+mock+'<\/script>')
      .replace('<script src="assets/deep-link.js"></script>', '<script>'+DEEPLINK_JS+'<\/script>');
    var dom = new JSDOM(htmlB, {
      runScripts:'dangerously', pretendToBeVisual:true,
      url:'https://example.com/bxt.html?id=NEW123', virtualConsole: quietConsole(),
      beforeParse(w){ w.localStorage.setItem('gaic_use_case_id', 'ASKHR_STALE'); }
    });
    setTimeout(() => {
      var w = dom.window, d = w.document;
      ok('bxt fetched the NEW123 id from the URL (not AskHR)', w.__lastFetchId === 'NEW123');
      var cont = d.getElementById('btnContinue');
      ok('Continue link points at feasibility.html', /feasibility\.html/.test(cont.getAttribute('href')));
      ok('Continue-to-Feasibility carries id=NEW123', /[?&]id=NEW123/.test(cont.getAttribute('href')));
      ok('Continue link does NOT carry the stale AskHR id', !/ASKHR_STALE/.test(cont.getAttribute('href')));
      resolve();
    }, 120);
  });
}

// ---------------------------------------------------------------------------
// Test 5 (H3 workspace_id) — no cached gaic_workspace_id. Submit must call
// listWorkspaces(), pick the Intel workspace, cache its id, and carry THAT
// workspace_id in the createUseCase POST body — so the server no longer 400s
// with 'workspace_id is required' and the case actually persists + mints ?id=.
// ---------------------------------------------------------------------------
function testWorkspaceResolution(){
  return new Promise(resolve => {
    console.log('\n== 5. no gaic_workspace_id -> resolves Intel workspace for the POST ==');
    const WORKSPACES = [
      { id:'WS_ACME', name:'Acme Corp' },
      { id:'WS_INTEL', name:'Intel' },
      { id:'WS_OTHER', name:'Globex' }
    ];
    let postedBody = null;
    const dom = new JSDOM(html, {
      runScripts:'dangerously', pretendToBeVisual:true,
      url:'https://example.com/intake.html', virtualConsole: quietConsole(),
      beforeParse(w){
        // Fresh user: NO gaic_workspace_id set (never ran setup).
        w.GAIC_API = {
          listWorkspaces: () => Promise.resolve(WORKSPACES),
          createUseCase: (body) => {
            postedBody = body;
            return Promise.resolve({ id:'NEW_WS_CASE', name:body.name });
          }
        };
      }
    });
    setTimeout(() => {
      const w = dom.window;
      fillAndSubmit(w);
      // Allow: _resolveWorkspaceId promise -> createUseCase promise -> _go.
      setTimeout(() => {
        ok('POST body carried the Intel workspace_id', postedBody && postedBody.workspace_id === 'WS_INTEL');
        ok('gaic_workspace_id cached as the Intel id', w.localStorage.getItem('gaic_workspace_id') === 'WS_INTEL');
        ok('navigated to bxt.html?id=NEW_WS_CASE', w.__gaic.lastNav === 'bxt.html?id=NEW_WS_CASE');
        resolve();
      }, 60);
    }, 60);
  });
}

// ---------------------------------------------------------------------------
// Test 6 (H3 workspace_id) — a cached gaic_workspace_id must be used verbatim
// WITHOUT calling listWorkspaces (no redundant network round-trip).
// ---------------------------------------------------------------------------
function testWorkspaceCached(){
  return new Promise(resolve => {
    console.log('\n== 6. cached gaic_workspace_id is used without listing ==');
    let listCalled = false;
    let postedBody = null;
    const dom = new JSDOM(html, {
      runScripts:'dangerously', pretendToBeVisual:true,
      url:'https://example.com/intake.html', virtualConsole: quietConsole(),
      beforeParse(w){
        w.localStorage.setItem('gaic_workspace_id', 'WS_CACHED');
        w.GAIC_API = {
          listWorkspaces: () => { listCalled = true; return Promise.resolve([]); },
          createUseCase: (body) => { postedBody = body; return Promise.resolve({ id:'C2', name:body.name }); }
        };
      }
    });
    setTimeout(() => {
      const w = dom.window;
      fillAndSubmit(w);
      setTimeout(() => {
        ok('POST body carried the cached workspace_id', postedBody && postedBody.workspace_id === 'WS_CACHED');
        ok('listWorkspaces was NOT called when cache present', listCalled === false);
        resolve();
      }, 60);
    }, 60);
  });
}

(async () => {
  await testSuccess();
  await testSlow();
  await testOffline();
  await testBxtHandoff();
  await testWorkspaceResolution();
  await testWorkspaceCached();
  console.log('\n---------------------------------------------');
  console.log('  RESULT: '+pass+' passed, '+fail+' failed');
  console.log('---------------------------------------------');
  process.exit(fail ? 1 : 0);
})();
