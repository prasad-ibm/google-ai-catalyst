/*
 * GAIC bulk use-case upload — additive, optional. Exposes window.GAIC_BULK.
 *
 * Drives the "Bulk upload" modal on the dashboard:
 *   - lets the PM pick a target workspace (loaded from GET /api/workspaces),
 *   - reads a chosen .csv file and parses it IN THE BROWSER (RFC 4180, matching
 *     the server-side parser in use-case-template.js) into row objects,
 *   - POSTs { workspace_id, rows } as JSON to POST /api/use-cases/bulk,
 *   - renders the per-row results ({ inserted, failed, results:[...] }).
 *
 * The template guide is downloadable from GET /api/use-cases/template.csv.
 *
 * Include AFTER api-client.js (optional dependency):
 *   <script src="assets/bulk-upload.js" defer></script>
 * then call window.GAIC_BULK.mount({ open: '#bulkUploadBtn' }).
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  // Browser global.
  if (typeof window !== 'undefined') window.GAIC_BULK = api;
  // Node export (used by tests to assert parser parity with the server).
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this, function () {
  'use strict';

  var TEMPLATE_URL = '/api/use-cases/template.csv';
  var BULK_URL = '/api/use-cases/bulk';
  var MAX_ROWS = 500; // mirror server-side BULK_MAX_ROWS

  /* ----------------------------------------------------------------------- *
   * CSV parsing — a faithful browser port of use-case-template.js parseCsv:
   * quoted fields (commas/CRLF/LF inside), "" -> " escaping, CRLF/LF/bare-CR
   * line endings, trailing-newline tolerance, ragged rows filled with '',
   * extra columns dropped. First non-empty record is the header.
   * ----------------------------------------------------------------------- */
  function parseCsv(text) {
    if (text === null || text === undefined) return [];
    var str = String(text);

    var records = [];
    var field = '';
    var record = [];
    var inQuotes = false;
    var i = 0;
    var n = str.length;
    var fieldStartedWithQuote = false;

    function pushField() {
      record.push(field);
      field = '';
      fieldStartedWithQuote = false;
    }
    function pushRecord() {
      pushField();
      records.push(record);
      record = [];
    }

    while (i < n) {
      var ch = str[i];

      if (inQuotes) {
        if (ch === '"') {
          if (str[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        field += ch; i += 1; continue;
      }

      if (ch === '"' && field === '') {
        inQuotes = true;
        fieldStartedWithQuote = true;
        i += 1; continue;
      }
      if (ch === ',') { pushField(); i += 1; continue; }
      if (ch === '\r') {
        pushRecord();
        if (str[i + 1] === '\n') i += 2; else i += 1;
        continue;
      }
      if (ch === '\n') { pushRecord(); i += 1; continue; }
      field += ch; i += 1;
    }
    if (field !== '' || record.length > 0 || fieldStartedWithQuote) {
      pushRecord();
    }

    var nonEmpty = records.filter(function (r) {
      return !(r.length === 1 && r[0].trim() === '');
    });
    if (!nonEmpty.length) return [];

    var header = nonEmpty[0].map(function (h) { return h.trim(); });
    var out = [];
    for (var r = 1; r < nonEmpty.length; r++) {
      var cells = nonEmpty[r];
      var obj = {};
      for (var c = 0; c < header.length; c++) {
        var key = header[c];
        if (!key) continue;
        var raw = c < cells.length ? cells[c] : '';
        obj[key] = typeof raw === 'string' ? raw.trim() : raw;
      }
      out.push(obj);
    }
    return out;
  }

  /* ----------------------------------------------------------------------- *
   * Browser-only DOM + network wiring below. Guarded so the module still
   * loads (parser-only) under Node.
   * ----------------------------------------------------------------------- */
  var hasDom = typeof document !== 'undefined';

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(fr.error || new Error('Could not read file')); };
      fr.readAsText(file);
    });
  }

  function loadWorkspaces() {
    return fetch('/api/workspaces', { headers: { 'Content-Type': 'application/json' } })
      .then(function (r) {
        if (r.status === 401) { window.location.href = '/login.html'; throw new Error('unauthorized'); }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (list) { return Array.isArray(list) ? list : []; });
  }

  function postBulk(workspaceId, rows) {
    return fetch(BULK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, rows: rows }),
    }).then(function (r) {
      if (r.status === 401) { window.location.href = '/login.html'; throw new Error('unauthorized'); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  // ---- Modal markup (injected once) ----------------------------------------
  var MODAL_ID = 'gaicBulkModal';

  function buildModal() {
    var wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.className = 'gbu-overlay hidden';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'gbuTitle');
    wrap.innerHTML =
      '<div class="gbu-modal">' +
        '<div class="gbu-head">' +
          '<h2 id="gbuTitle" class="gbu-title">Bulk upload use cases</h2>' +
          '<button type="button" class="gbu-x" data-gbu-close aria-label="Close">✕</button>' +
        '</div>' +
        '<p class="gbu-sub">Upload a CSV to create many use cases at once. ' +
          'Need the format? <a href="' + TEMPLATE_URL + '" class="gbu-link" download>Download the template CSV</a> ' +
          '(pre-filled with the 5 Intel example use cases).</p>' +

        '<div class="gbu-field">' +
          '<label class="gbu-label" for="gbuWs">Target workspace</label>' +
          '<select id="gbuWs" class="gbu-select"><option value="">Loading workspaces…</option></select>' +
        '</div>' +

        '<div class="gbu-field">' +
          '<label class="gbu-label" for="gbuFile">CSV file</label>' +
          '<input id="gbuFile" class="gbu-file" type="file" accept=".csv,text/csv" />' +
          '<div class="gbu-hint" id="gbuFileHint">Rows are parsed in your browser before upload (max ' + MAX_ROWS + ').</div>' +
        '</div>' +

        '<div class="gbu-msg hidden" id="gbuMsg"></div>' +
        '<div class="gbu-results hidden" id="gbuResults"></div>' +

        '<div class="gbu-actions">' +
          '<button type="button" class="gc-btn gc-btn--ghost gc-btn--sm" data-gbu-close>Close</button>' +
          '<button type="button" class="gc-btn gc-btn--primary gc-btn--sm" id="gbuSubmit" disabled>Upload</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    return wrap;
  }

  function injectStyles() {
    if (document.getElementById('gbu-styles')) return;
    var css =
      '.gbu-overlay{position:fixed;inset:0;z-index:1000;background:rgba(3,6,12,.72);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:64px 16px 24px;overflow:auto;}' +
      '.gbu-overlay.hidden{display:none;}' +
      '.gbu-modal{width:100%;max-width:640px;background:var(--surface,#161b22);border:1px solid var(--border,#2a2f3a);border-radius:var(--radius-lg,8px);box-shadow:0 12px 48px rgba(0,0,0,.6);padding:24px 26px 22px;}' +
      '.gbu-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}' +
      '.gbu-title{font-size:20px;font-weight:500;color:var(--text,#e8eaed);}' +
      '.gbu-x{background:transparent;border:none;color:var(--text-dim,#9aa0a6);font-size:18px;cursor:pointer;line-height:1;padding:4px;}' +
      '.gbu-x:hover{color:var(--text,#e8eaed);}' +
      '.gbu-sub{color:var(--text-muted,rgba(232,234,237,.65));font-size:13.5px;margin:6px 0 18px;}' +
      '.gbu-link{color:var(--g-blue-l,#8ab4f8);text-decoration:underline;}' +
      '.gbu-field{margin-bottom:16px;}' +
      '.gbu-label{display:block;font-family:var(--font-mono,monospace);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim,#9aa0a6);margin-bottom:6px;}' +
      '.gbu-select,.gbu-file{width:100%;font-family:var(--font-sans,sans-serif);font-size:14px;color:var(--text,#e8eaed);background:var(--surface-2,#1c2230);border:1px solid var(--border,#2a2f3a);border-radius:var(--radius-sm,4px);padding:9px 12px;}' +
      '.gbu-select:hover{border-color:var(--g-blue-l,#8ab4f8);}' +
      '.gbu-file{padding:8px 12px;}' +
      '.gbu-hint{font-family:var(--font-mono,monospace);font-size:11px;color:var(--text-dim,#9aa0a6);margin-top:6px;}' +
      '.gbu-msg{font-size:13px;border-radius:var(--radius-sm,4px);padding:10px 12px;margin-bottom:14px;}' +
      '.gbu-msg.is-err{color:#f28b82;background:rgba(234,67,53,.12);border:1px solid rgba(234,67,53,.4);}' +
      '.gbu-msg.is-ok{color:#81c995;background:rgba(52,168,83,.12);border:1px solid rgba(52,168,83,.4);}' +
      '.gbu-msg.is-info{color:var(--text-muted,#9aa0a6);background:var(--surface-2,#1c2230);border:1px solid var(--border,#2a2f3a);}' +
      '.gbu-msg.hidden,.gbu-results.hidden{display:none;}' +
      '.gbu-results{margin-bottom:16px;max-height:280px;overflow:auto;border:1px solid var(--border,#2a2f3a);border-radius:var(--radius-sm,4px);}' +
      '.gbu-rtable{width:100%;border-collapse:collapse;font-size:12.5px;}' +
      '.gbu-rtable th{position:sticky;top:0;text-align:left;font-family:var(--font-mono,monospace);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#9aa0a6);background:var(--surface-2,#1c2230);padding:8px 12px;border-bottom:1px solid var(--border,#2a2f3a);}' +
      '.gbu-rtable td{padding:8px 12px;border-bottom:1px solid var(--border-soft,rgba(232,234,237,.08));color:var(--text-muted,#9aa0a6);vertical-align:top;}' +
      '.gbu-rtable tr:last-child td{border-bottom:none;}' +
      '.gbu-badge{display:inline-block;font-family:var(--font-mono,monospace);font-size:10.5px;font-weight:500;padding:2px 8px;border-radius:100px;border:1px solid;}' +
      '.gbu-badge.ok{color:#81c995;border-color:rgba(52,168,83,.4);background:rgba(52,168,83,.12);}' +
      '.gbu-badge.err{color:#f28b82;border-color:rgba(234,67,53,.4);background:rgba(234,67,53,.12);}' +
      '.gbu-actions{display:flex;justify-content:flex-end;gap:10px;}' +
      '.gc-btn[disabled]{opacity:.5;cursor:not-allowed;}';
    var style = document.createElement('style');
    style.id = 'gbu-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---- Controller ----------------------------------------------------------
  var state = {
    overlay: null,
    els: null,
    parsedRows: null,
    defaultWorkspaceId: null,
    workspacesLoaded: false,
  };

  function show(msg, kind) {
    var m = state.els.msg;
    m.className = 'gbu-msg is-' + (kind || 'info');
    m.textContent = msg;
  }
  function hideMsg() { state.els.msg.className = 'gbu-msg hidden'; }

  function refreshSubmitEnabled() {
    // L4: keep Upload clickable once a workspace exists even before a file is
    // chosen, so a click with no file surfaces an inline hint (see onSubmit)
    // rather than doing nothing. A missing workspace is a hard block.
    var hasWs = !!state.els.ws.value;
    state.els.submit.disabled = !hasWs;
  }

  function populateWorkspaces() {
    if (state.workspacesLoaded) return Promise.resolve();
    return loadWorkspaces().then(function (list) {
      state.workspacesLoaded = true;
      var sel = state.els.ws;
      if (!list.length) {
        sel.innerHTML = '<option value="">No workspaces found</option>';
        return;
      }
      sel.innerHTML = list.map(function (w) {
        return '<option value="' + esc(w.id) + '">' + esc(w.name || 'Untitled workspace') + '</option>';
      }).join('');
      // Prefer a caller-provided default (the dashboard's active workspace).
      if (state.defaultWorkspaceId) {
        sel.value = String(state.defaultWorkspaceId);
        if (!sel.value) sel.selectedIndex = 0; // fall back if id not present
      }
      refreshSubmitEnabled();
    }).catch(function (e) {
      if (e && e.message === 'unauthorized') return;
      state.els.ws.innerHTML = '<option value="">Could not load workspaces</option>';
    });
  }

  function onFileChange() {
    hideMsg();
    state.els.results.className = 'gbu-results hidden';
    state.parsedRows = null;
    var file = state.els.file.files && state.els.file.files[0];
    if (!file) { refreshSubmitEnabled(); return; }
    readFileText(file).then(function (text) {
      var rows;
      try {
        rows = parseCsv(text);
      } catch (e) {
        show('Could not parse CSV: ' + e.message, 'err');
        refreshSubmitEnabled();
        return;
      }
      if (!rows.length) {
        show('No data rows found in the file (need a header row plus at least one row).', 'err');
        refreshSubmitEnabled();
        return;
      }
      if (rows.length > MAX_ROWS) {
        show('Too many rows: ' + rows.length + ' (max ' + MAX_ROWS + ').', 'err');
        state.parsedRows = null;
        refreshSubmitEnabled();
        return;
      }
      state.parsedRows = rows;
      show('Parsed ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' — ready to upload.', 'info');
      refreshSubmitEnabled();
    }).catch(function (e) {
      show('Could not read file: ' + (e && e.message ? e.message : e), 'err');
      refreshSubmitEnabled();
    });
  }

  function renderResults(data) {
    var results = (data && Array.isArray(data.results)) ? data.results : [];
    var inserted = data && typeof data.inserted === 'number' ? data.inserted : 0;
    var failed = data && typeof data.failed === 'number' ? data.failed : 0;

    show(inserted + ' inserted, ' + failed + ' failed.', failed ? (inserted ? 'info' : 'err') : 'ok');

    var body = results.map(function (r) {
      var rowNum = (typeof r.row === 'number' ? r.row + 1 : '—'); // 1-based for humans
      var badge = r.ok
        ? '<span class="gbu-badge ok">OK</span>'
        : '<span class="gbu-badge err">FAIL</span>';
      var detail = r.ok
        ? esc(r.name || '') + (r.id ? ' <span style="color:var(--text-dim,#9aa0a6)">#' + esc(String(r.id)).slice(0, 8) + '</span>' : '')
        : '<span style="color:#f28b82">' + esc(r.error || 'error') + '</span>';
      return '<tr><td>' + rowNum + '</td><td>' + badge + '</td><td>' + detail + '</td></tr>';
    }).join('');

    state.els.results.className = 'gbu-results';
    state.els.results.innerHTML =
      '<table class="gbu-rtable"><thead><tr><th>Row</th><th>Status</th><th>Result</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>';
  }

  function onSubmit() {
    // L4: no file chosen (or an empty parse) -> inline guidance, not a no-op.
    if (!state.parsedRows || !state.parsedRows.length) {
      show('Please choose a CSV file first.', 'err');
      return;
    }
    var wsId = state.els.ws.value;
    if (!wsId) { show('Pick a target workspace first.', 'err'); return; }

    state.els.submit.disabled = true;
    state.els.submit.textContent = 'Uploading…';
    postBulk(wsId, state.parsedRows).then(function (data) {
      renderResults(data);
      // Any success means the portfolio changed — invite a refresh.
      if (data && data.inserted) {
        if (typeof state.onInserted === 'function') {
          try { state.onInserted(data); } catch (e) { /* noop */ }
        }
      }
    }).catch(function (e) {
      if (e && e.message === 'unauthorized') return;
      show('Upload failed: ' + (e && e.message ? e.message : e), 'err');
    }).then(function () {
      state.els.submit.textContent = 'Upload';
      refreshSubmitEnabled();
    });
  }

  // opts.workspaceId may be a value or a getter fn (so the dashboard can hand
  // us its *current* selection at open time, not whatever was set at mount).
  function resolveWorkspaceId(v) {
    return typeof v === 'function' ? v() : v;
  }

  function open(opts) {
    opts = opts || {};
    var wsId = resolveWorkspaceId(opts.workspaceId);
    if (wsId) state.defaultWorkspaceId = wsId;
    hideMsg();
    state.els.results.className = 'gbu-results hidden';
    state.parsedRows = null;
    state.els.file.value = '';
    state.els.submit.disabled = true;
    state.overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    populateWorkspaces();
  }

  function close() {
    state.overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function mount(opts) {
    if (!hasDom) return;
    opts = opts || {};
    injectStyles();

    var overlay = document.getElementById(MODAL_ID) || buildModal();
    state.overlay = overlay;
    state.els = {
      ws: overlay.querySelector('#gbuWs'),
      file: overlay.querySelector('#gbuFile'),
      submit: overlay.querySelector('#gbuSubmit'),
      msg: overlay.querySelector('#gbuMsg'),
      results: overlay.querySelector('#gbuResults'),
    };
    state.onInserted = typeof opts.onInserted === 'function' ? opts.onInserted : null;
    var mountWs = resolveWorkspaceId(opts.workspaceId);
    if (mountWs) state.defaultWorkspaceId = mountWs;

    // Wire once.
    if (!overlay.__gbuWired) {
      overlay.__gbuWired = true;
      overlay.addEventListener('click', function (ev) {
        if (ev.target === overlay || ev.target.hasAttribute('data-gbu-close')) close();
      });
      state.els.file.addEventListener('change', onFileChange);
      state.els.ws.addEventListener('change', refreshSubmitEnabled);
      state.els.submit.addEventListener('click', onSubmit);
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && !overlay.classList.contains('hidden')) close();
      });
    }

    // Bind the opener trigger(s), if given.
    if (opts.open) {
      var triggers = typeof opts.open === 'string'
        ? Array.prototype.slice.call(document.querySelectorAll(opts.open))
        : [opts.open];
      triggers.forEach(function (t) {
        if (t && t.addEventListener) {
          t.addEventListener('click', function (ev) { ev.preventDefault(); open(opts); });
        }
      });
    }
  }

  return { mount: mount, open: open, close: close, parseCsv: parseCsv };
});
