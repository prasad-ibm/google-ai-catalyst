/*
 * GAIC use-case picker — additive, optional. Exposes window.GAIC_UCPICKER.
 *
 * Renders an in-page "Use case:" dropdown so the user can switch which use
 * case a gate page is evaluating WITHOUT hand-editing the ?id= URL param.
 * Deep-linking via ?id=<use_case_id> already works (assets/deep-link.js);
 * this just drives that mechanism from a <select>.
 *
 * Usage: window.GAIC_UCPICKER.mount('#ucPicker')
 *   - Populates the given <select> from window.GAIC_API.listPortfolio(wsId)
 *     (falls back to fetch('/api/portfolio')).
 *   - Marks the currently-active use case (?id= param, or deep-link state) as
 *     selected.
 *   - On change, navigates to the same page with ?id=<selectedId>.
 *   - If the portfolio fetch fails or is empty, hides the picker gracefully.
 *
 * Include AFTER api-client.js:
 *   <script src="assets/uc-picker.js" defer></script>
 */
(function () {
  'use strict';

  // Current ?id= param (reuse deep-link helper if present, else parse).
  function currentId() {
    try {
      if (window.GAIC_DEEPLINK && typeof window.GAIC_DEEPLINK.getId === 'function') {
        return window.GAIC_DEEPLINK.getId();
      }
      var id = new URLSearchParams(window.location.search).get('id');
      return id && id.trim() ? id.trim() : null;
    } catch (e) {
      return null;
    }
  }

  // Best-effort workspace id the page already knows about, else null.
  function currentWorkspaceId() {
    try {
      var params = new URLSearchParams(window.location.search);
      var ws = params.get('workspace_id') || params.get('ws');
      if (ws && ws.trim()) return ws.trim();
      if (window.GAIC_WORKSPACE_ID) return window.GAIC_WORKSPACE_ID;
    } catch (e) { /* ignore */ }
    return null;
  }

  // Fetch the portfolio array. Uses GAIC_API when available; falls back to a
  // raw fetch. Always resolves to an array (empty on any failure).
  function loadPortfolio(wsId) {
    if (window.GAIC_API && typeof window.GAIC_API.listPortfolio === 'function') {
      return window.GAIC_API.listPortfolio(wsId).then(function (rows) {
        return Array.isArray(rows) ? rows : [];
      }).catch(function () { return []; });
    }
    var q = wsId ? ('?workspace_id=' + encodeURIComponent(wsId)) : '';
    return fetch('/api/portfolio' + q)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return Array.isArray(rows) ? rows : []; })
      .catch(function () { return []; });
  }

  function verdictOf(row) {
    return row.verdict || row.advisory_verdict || row.advisory_tier || '—';
  }

  // Hide a select (and its wrapper/label, if any) without erroring.
  function hide(sel) {
    try {
      var host = sel.closest ? sel.closest('.uc-picker') : null;
      (host || sel).style.display = 'none';
    } catch (e) { /* ignore */ }
  }

  function mount(selector) {
    var sel;
    try {
      sel = typeof selector === 'string' ? document.querySelector(selector) : selector;
    } catch (e) { sel = null; }
    if (!sel) return;

    var wsId = currentWorkspaceId();
    loadPortfolio(wsId).then(function (rows) {
      if (!rows || !rows.length) { hide(sel); return; }

      var active = currentId();
      var frag = document.createDocumentFragment();
      var matched = false;

      rows.forEach(function (row) {
        if (!row || row.id == null) return;
        var opt = document.createElement('option');
        opt.value = String(row.id);
        opt.textContent = (row.name || row.id) + ' — ' + verdictOf(row);
        if (active != null && String(row.id) === String(active)) {
          opt.selected = true;
          matched = true;
        }
        frag.appendChild(opt);
      });

      if (!frag.childNodes.length) { hide(sel); return; }

      // If nothing matched the active id, prepend a neutral placeholder.
      if (!matched) {
        var ph = document.createElement('option');
        ph.value = '';
        ph.textContent = 'Select a use case…';
        ph.selected = true;
        ph.disabled = true;
        sel.appendChild(ph);
      }
      sel.appendChild(frag);

      sel.addEventListener('change', function () {
        var id = sel.value;
        if (!id) return;
        // Deep-linking already works: reload same page with the chosen id.
        window.location.search = '?id=' + encodeURIComponent(id);
      });
    }).catch(function () { hide(sel); });
  }

  window.GAIC_UCPICKER = { mount: mount };

  // Auto-mount on DOM ready if a #ucPicker exists (no-op if the page already
  // calls mount itself — mount is idempotent enough for a single select).
  function autoMount() {
    if (document.getElementById('ucPicker')) {
      mount('#ucPicker');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
})();
