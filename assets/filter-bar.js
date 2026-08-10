/*
 * GAIC shared filter bar — additive, optional. Exposes window.GAIC_FILTERS.
 *
 * A single reusable filter bar used by dashboard.html, portfolio-map.html and
 * kanban.html. Filters: Department, Exec Sponsor, Stage, Status + a search box.
 *
 * State is persisted in the URL query string (?department=&sponsor=&stage=
 * &status=&q=) so a filtered view is shareable and survives reload. Option
 * counts are pulled from /api/portfolio/facets and reflect the CURRENT filter
 * set (they narrow as you filter).
 *
 * ES5 / var style, IIFE, no build step — matches api-client.js / deep-link.js.
 * Never throws to the page: any error degrades to an empty/uncounted bar.
 */
(function () {
  'use strict';

  // The five filter keys, in render order. `q` is the free-text search; the
  // other four are <select> facets backed by /api/portfolio/facets.
  var KEYS = ['department', 'sponsor', 'stage', 'status', 'q'];
  var SELECT_KEYS = ['department', 'sponsor', 'stage', 'status'];
  var LABELS = {
    department: 'Department',
    sponsor: 'Exec Sponsor',
    stage: 'Stage',
    status: 'Status'
  };

  // The query-param key we send to the server is SINGULAR (?department=…), but
  // GET /api/portfolio/facets replies with PLURAL bucket keys
  // ({ departments:[…], sponsors:[…], stages:[…], statuses:[…] }). Map each
  // singular filter key to its plural response key so refreshFacets reads the
  // right bucket. Note the irregular plural for `status` -> `statuses` (a naive
  // key + 's' would produce "statuss"). We still fall back to the singular key
  // so a legacy/singular emitter keeps working.
  var FACET_RESPONSE_KEYS = {
    department: 'departments',
    sponsor: 'sponsors',
    stage: 'stages',
    status: 'statuses'
  };

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- URL state ---------------------------------------------------------
  // Read filter state from the current URL. Missing keys -> ''. Always returns
  // an object with all five keys so callers never have to null-guard.
  function readURL() {
    var state = { department: '', sponsor: '', stage: '', status: '', q: '' };
    try {
      var params = new URLSearchParams(window.location.search);
      KEYS.forEach(function (k) {
        var v = params.get(k);
        if (v != null) state[k] = String(v);
      });
    } catch (e) { /* no-op: default empty state */ }
    return state;
  }

  // Write filter state back to the URL. Only NON-EMPTY keys are set (keeps the
  // URL clean). Preserves any other existing query params (e.g. workspace_id is
  // NOT stored here; wsId lives in app state). Uses replaceState so rapid
  // typing/selecting doesn't spam browser history.
  function writeURL(state) {
    state = state || {};
    try {
      var params = new URLSearchParams(window.location.search);
      KEYS.forEach(function (k) {
        var v = state[k];
        if (v != null && String(v) !== '') params.set(k, String(v));
        else params.delete(k);
      });
      var qs = params.toString();
      var newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      window.history.replaceState(null, '', newUrl);
    } catch (e) { /* no-op */ }
    return state;
  }

  // Build the query string for /api/portfolio (and /facets). Skips empty
  // values, encodes everything. wsId (optional) is added as workspace_id.
  function toQuery(state, wsId) {
    state = state || {};
    var parts = [];
    if (wsId) parts.push('workspace_id=' + encodeURIComponent(wsId));
    KEYS.forEach(function (k) {
      var v = state[k];
      if (v != null && String(v) !== '') {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
      }
    });
    return parts.length ? ('?' + parts.join('&')) : '';
  }

  // ---- mount -------------------------------------------------------------
  // opts = {
  //   el:       mount element (required)
  //   apiFetch: function(path)->Promise  (the page's /api fetch helper)
  //   wsId:     current workspace id or null
  //   initial:  initial state (defaults to readURL())
  //   onChange: function(state) called after any filter change (view reloads)
  // }
  // Returns a small controller { getState, refreshFacets, setState } or null.
  function mount(opts) {
    opts = opts || {};
    var host = opts.el;
    if (!host) return null;

    var state = opts.initial || readURL();
    var apiFetch = typeof opts.apiFetch === 'function' ? opts.apiFetch : null;
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    var currentWs = opts.wsId || null;
    var searchTimer = null;

    // Render the static skeleton once; selects get filled by facet data.
    function skeleton() {
      var html = '<div class="filterbar__row">';
      SELECT_KEYS.forEach(function (k) {
        html += '<label class="filterbar__field">' +
          '<span class="filterbar__lbl">' + esc(LABELS[k]) + '</span>' +
          '<select class="filterbar__select" data-key="' + k + '">' +
            '<option value="">All</option>' +
          '</select>' +
        '</label>';
      });
      html += '<label class="filterbar__field filterbar__field--search">' +
        '<span class="filterbar__lbl">Search</span>' +
        '<input class="filterbar__search" type="search" data-key="q" ' +
          'placeholder="Search use cases…" value="' + esc(state.q || '') + '">' +
      '</label>';
      html += '<button type="button" class="filterbar__clear" data-action="clear">Clear</button>';
      html += '</div>';
      host.innerHTML = html;
    }

    // Fill a <select> with facet options, marking the current selection. If the
    // current value isn't in the facet list (e.g. filtered to zero) it's still
    // shown as a "(0)" option so the user can see + clear it.
    function fillSelect(sel, key, facetArr) {
      facetArr = Array.isArray(facetArr) ? facetArr : [];
      var cur = state[key] || '';
      var opts = ['<option value="">All</option>'];
      var seen = false;
      facetArr.forEach(function (f) {
        if (!f || f.value == null) return;
        var val = String(f.value);
        var selAttr = (val === cur) ? ' selected' : '';
        if (val === cur) seen = true;
        var cnt = (f.count == null) ? '' : (' (' + f.count + ')');
        opts.push('<option value="' + esc(val) + '"' + selAttr + '>' + esc(val) + esc(cnt) + '</option>');
      });
      if (cur && !seen) {
        opts.push('<option value="' + esc(cur) + '" selected>' + esc(cur) + ' (0)</option>');
      }
      sel.innerHTML = opts.join('');
    }

    // Read the facet bucket for a singular filter key out of the server
    // response. The server keys the buckets by PLURAL name; fall back to the
    // singular key for defensiveness / legacy emitters.
    function facetBucket(facets, key) {
      var pluralKey = FACET_RESPONSE_KEYS[key];
      var arr = pluralKey ? facets[pluralKey] : undefined;
      if (arr === undefined) arr = facets[key];
      return arr;
    }

    // Pull /facets for the current state+wsId and repopulate the selects.
    function refreshFacets(wsId) {
      if (wsId !== undefined) currentWs = wsId || null;
      if (!apiFetch) return Promise.resolve(null);
      return apiFetch('/portfolio/facets' + toQuery(state, currentWs))
        .then(function (facets) {
          facets = facets || {};
          SELECT_KEYS.forEach(function (k) {
            var sel = host.querySelector('select[data-key="' + k + '"]');
            if (sel) fillSelect(sel, k, facetBucket(facets, k));
          });
          return facets;
        })
        .catch(function () { return null; });
    }

    function emit() {
      writeURL(state);
      onChange(state);
      // Re-pull counts so the OTHER facets reflect the new narrowing.
      refreshFacets();
    }

    function onSelectChange(e) {
      var t = e.target;
      if (!t || t.getAttribute('data-key') == null) return;
      var key = t.getAttribute('data-key');
      if (SELECT_KEYS.indexOf(key) === -1) return;
      state[key] = t.value || '';
      emit();
    }

    function onSearchInput(e) {
      var t = e.target;
      if (!t || t.getAttribute('data-key') !== 'q') return;
      state.q = t.value || '';
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(emit, 250);
    }

    function onClear() {
      KEYS.forEach(function (k) { state[k] = ''; });
      var searchEl = host.querySelector('input[data-key="q"]');
      if (searchEl) searchEl.value = '';
      SELECT_KEYS.forEach(function (k) {
        var sel = host.querySelector('select[data-key="' + k + '"]');
        if (sel) sel.value = '';
      });
      emit();
    }

    skeleton();
    host.addEventListener('change', onSelectChange);
    host.addEventListener('input', onSearchInput);
    var clearBtn = host.querySelector('[data-action="clear"]');
    if (clearBtn) clearBtn.addEventListener('click', onClear);

    // Initial counts.
    refreshFacets(currentWs);

    return {
      getState: function () { return state; },
      setState: function (s) {
        state = s || state;
        writeURL(state);
        skeleton();
        var cb = host.querySelector('[data-action="clear"]');
        if (cb) cb.addEventListener('click', onClear);
        refreshFacets();
      },
      refreshFacets: refreshFacets
    };
  }

  window.GAIC_FILTERS = {
    KEYS: KEYS,
    SELECT_KEYS: SELECT_KEYS,
    FACET_RESPONSE_KEYS: FACET_RESPONSE_KEYS,
    readURL: readURL,
    writeURL: writeURL,
    toQuery: toQuery,
    mount: mount
  };
})();
