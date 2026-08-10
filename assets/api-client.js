/*
 * GAIC API client — additive, optional. Exposes window.GAIC_API.
 * Every method tries the same-origin REST API first; on ANY network or API
 * error it falls back to the existing localStorage gaic_* keys and never
 * throws to the page. Include with <script src="assets/api-client.js"></script>.
 */
(function () {
  'use strict';

  var BASE = '/api';

  // Tiny localStorage JSON helper.
  var _ls = {
    get: function (key) {
      try {
        var raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    set: function (key, val) {
      try {
        window.localStorage.setItem(key, JSON.stringify(val));
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  // Map a gate name to its localStorage mirror key.
  var GATE_KEYS = {
    bxt: 'gaic_bxt',
    feasibility: 'gaic_feasibility',
    advisory: 'gaic_advisory',
    summary: 'gaic_summary',
    verdict: 'gaic_panel',
  };

  function req(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(BASE + path, opts).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          var err = new Error(j.error || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        });
      }
      return r.json();
    });
  }

  var GAIC_API = {
    /* Save the enterprise workspace profile (setup.html state). */
    saveWorkspace: function (obj) {
      return req('POST', '/workspaces', obj).catch(function () {
        _ls.set('gaic_enterprise_profile', obj);
        return { _offline: true, data: obj };
      });
    },

    getWorkspace: function (id) {
      return req('GET', '/workspaces/' + encodeURIComponent(id)).catch(function () {
        return _ls.get('gaic_enterprise_profile');
      });
    },

    /* List all workspaces. Resolves to an array (empty on any failure) so
     * callers can safely pick one (e.g. the Intel workspace) without a null
     * guard. Used by intake to resolve a valid workspace_id when the user has
     * not completed setup (no cached gaic_workspace_id). */
    listWorkspaces: function () {
      return req('GET', '/workspaces').then(function (list) {
        return Array.isArray(list) ? list : [];
      }).catch(function () {
        return [];
      });
    },

    createUseCase: function (obj) {
      return req('POST', '/use-cases', obj).catch(function () {
        _ls.set('gaic_intake', obj);
        return { _offline: true, data: obj };
      });
    },

    getUseCase: function (id) {
      return req('GET', '/use-cases/' + encodeURIComponent(id)).catch(function () {
        return {
          _offline: true,
          intake: _ls.get('gaic_intake'),
          bxt: _ls.get('gaic_bxt'),
          feasibility: _ls.get('gaic_feasibility'),
          advisory: _ls.get('gaic_advisory'),
          summary: _ls.get('gaic_summary'),
        };
      });
    },

    /* gate in bxt|feasibility|advisory|summary|verdict */
    saveGate: function (id, gate, obj) {
      var path = '/use-cases/' + encodeURIComponent(id) + '/' + gate;
      return req('PUT', path, obj).catch(function () {
        var key = GATE_KEYS[gate] || ('gaic_' + gate);
        _ls.set(key, obj);
        return { _offline: true, data: obj };
      });
    },

    listPortfolio: function (wsId) {
      var q = wsId ? ('?workspace_id=' + encodeURIComponent(wsId)) : '';
      return req('GET', '/portfolio' + q).catch(function () {
        return [];
      });
    },

    _ls: _ls,
  };

  window.GAIC_API = GAIC_API;
})();
