/*
 * GAIC deep-link helper — additive, optional. Exposes window.GAIC_DEEPLINK.
 *
 * Purpose: gate pages (summary.html, panel.html, ...) can be opened with a
 * ?id=<use_case_id> query param that deep-links to a specific persisted use
 * case. This module reads that id, fetches the case + its gates from the REST
 * API (via GAIC_API), and maps the flat DB rows BACK into the in-memory shapes
 * the gate pages' pure compute functions already expect
 * ({ intake, bxt, feas, advisory }).
 *
 * It never throws to the page: on any error it resolves to null so the page
 * falls back to its existing localStorage / demo behaviour.
 *
 * ES5 / var style to match the rest of the codebase (no build step).
 */
(function () {
  'use strict';

  // Read the ?id= query param. Returns a non-empty string or null.
  function getId() {
    try {
      var params = new URLSearchParams(window.location.search);
      var id = params.get('id');
      return id && id.trim() ? id.trim() : null;
    } catch (e) {
      return null;
    }
  }

  var UC_ID_KEY = 'gaic_use_case_id';

  // Resolve the ACTIVE use-case id for a gate page.
  //   1. ?id= query param (deep-link / carried from the previous gate) wins.
  //   2. localStorage['gaic_use_case_id'] fallback (the in-flight case).
  // Side-effect: when a URL id is present it is persisted back to localStorage so
  // that any subsequent gate resolves the SAME case even if its link somehow
  // dropped the query string. This is the core M1/M2 fix — one case flows through
  // every gate instead of gates drifting to different demo/other cases.
  function getUcId() {
    var urlId = getId();
    if (urlId) {
      try { localStorage.setItem(UC_ID_KEY, urlId); } catch (e) {}
      return urlId;
    }
    try {
      var stored = localStorage.getItem(UC_ID_KEY);
      return stored && stored.trim() ? stored.trim() : null;
    } catch (e) {
      return null;
    }
  }

  // Gate pages the id must be carried between. Any in-page <a> pointing at one of
  // these (Continue, Back, override, breadcrumb) gets ?id=<id> appended so the
  // active case survives every hop.
  var GATE_PAGES = ['bxt.html', 'feasibility.html', 'advisory.html', 'summary.html', 'panel.html'];

  // Append (or replace) ?id=<id> on every gate-to-gate link on the page. Called
  // at runtime with the RESOLVED id so it uses the same id the page rendered.
  // No-op when id is falsy. Preserves any other existing query params.
  function wireNav(id, root) {
    if (!id) return;
    var scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelectorAll) return;
    var anchors = scope.querySelectorAll('a[href]');
    Array.prototype.forEach.call(anchors, function (a) {
      var href = a.getAttribute('href');
      if (!href) return;
      // Strip any existing query/hash to inspect just the target file.
      var path = href.split('?')[0].split('#')[0];
      if (GATE_PAGES.indexOf(path) === -1) return;
      a.setAttribute('href', path + '?id=' + encodeURIComponent(id));
    });
  }

  // Merge the four jsonb context blobs + top-level fields back into the flat
  // intake object the gate compute functions read (name, dept, driver, value,
  // sources[], pii, audit, autonomy, sensitivity, ...). Mirrors the grouping in
  // server.js mapUseCaseContexts().
  function mapIntake(row) {
    if (!row) return null;
    var intake = {};
    // top-level identity fields
    if (row.name != null) intake.name = row.name;
    if (row.department != null) intake.dept = row.department;
    if (row.executive_sponsor != null) intake.sponsor = row.executive_sponsor;
    if (row.description != null) intake.desc = row.description;
    // context blobs (each is a jsonb object or null)
    [row.business_context, row.current_state, row.technical_context, row.risk_compliance]
      .forEach(function (blob) {
        if (blob && typeof blob === 'object') {
          for (var k in blob) {
            if (Object.prototype.hasOwnProperty.call(blob, k)) intake[k] = blob[k];
          }
        }
      });
    return Object.keys(intake).length ? intake : null;
  }

  // bxt_scores row -> { scores:{B:{score},X:{score},T:{score}}, verdict:{verdict} }
  function mapBxt(b) {
    if (!b) return null;
    var detail = b.detail && typeof b.detail === 'object' ? b.detail : {};
    var factors = detail.factors || {};
    return {
      scores: {
        B: { score: Number(b.business_score) || 0, factors: factors.B },
        X: { score: Number(b.experience_score) || 0, factors: factors.X },
        T: { score: Number(b.technology_score) || 0, factors: factors.T }
      },
      verdict: { verdict: b.verdict || 'PASS', weakKey: detail.weakKey, weakName: detail.weakName, weakScore: detail.weakScore }
    };
  }

  // feasibility_scores row -> { scores, composite, pillars, quadrant, risk, citizenDev:{pct} }
  function mapFeasibility(f) {
    if (!f) return null;
    return {
      scores: f.criteria && typeof f.criteria === 'object' ? f.criteria : {},
      composite: Number(f.composite) || 0,
      pillars: f.pillars && typeof f.pillars === 'object' ? f.pillars : undefined,
      quadrant: f.quadrant || undefined,
      risk: f.risk_tier || undefined,
      citizenDev: { pct: (f.citizen_dev_pct == null ? undefined : Number(f.citizen_dev_pct)) }
    };
  }

  // advisory_results row -> { tier, verdictName, platform, compliance:{label,ok}, riskTier }
  function mapAdvisory(a) {
    if (!a) return null;
    var reasoning = a.reasoning && typeof a.reasoning === 'object' ? a.reasoning : {};
    return {
      tier: a.tier || undefined,
      verdictName: a.verdict_name || undefined,
      platform: a.recommended_platform || undefined,
      gateLabel: a.gate_resolved || undefined,
      compliance: reasoning.compliance || undefined,
      riskTier: reasoning.riskTier || undefined,
      dims: reasoning.dims || undefined,
      journey: a.journey || undefined
    };
  }

  // evaluation_summaries (Gate 5) row -> the shape panel.html's loadSummary()
  // expects: { useCase, composite, readiness, roi:{p10,p50,p90,...}, frameworks[] }.
  // composite is recomputed from framework scores (the API doesn't persist it).
  function mapPanelSummary(s, intake) {
    if (!s) return null;
    // frameworks may be persisted as an ARRAY [{key,name,score}] (app save) OR as an
    // OBJECT {gadf:88,google_caf:84,...} (seed data). Normalise both to an array.
    var frameworks = [];
    if (Array.isArray(s.frameworks)) {
      frameworks = s.frameworks;
    } else if (s.frameworks && typeof s.frameworks === 'object') {
      var NAMES = { gadf: 'GADF v2', google_caf: 'Google Cloud Adoption', mckinsey_mit: 'McKinsey \u00d7 MIT Sloan', gartner: 'Gartner' };
      frameworks = Object.keys(s.frameworks).map(function (k) {
        return { key: k, name: NAMES[k] || k, score: Number(s.frameworks[k]) };
      });
    }
    var composite = null;
    if (frameworks.length) {
      var sum = 0, n = 0;
      frameworks.forEach(function (f) {
        if (f && f.score != null && !isNaN(Number(f.score))) { sum += Number(f.score); n++; }
      });
      if (n) composite = Math.round(sum / n);
    }
    var roi = {
      p10: (s.roi_p10 == null ? undefined : Number(s.roi_p10)),
      p50: (s.roi_p50 == null ? undefined : Number(s.roi_p50)),
      p90: (s.roi_p90 == null ? undefined : Number(s.roi_p90))
    };
    return {
      useCase: (intake && intake.name) || undefined,
      composite: composite == null ? undefined : composite,
      readiness: s.readiness || 'CONDITIONAL',
      roi: roi,
      frameworks: frameworks,
      governance: s.governance || []
    };
  }

  // Convert a full /api/use-cases/:id response row into compute-input opts.
  function mapUseCase(row) {
    if (!row || typeof row !== 'object') return null;
    // The offline fallback in GAIC_API.getUseCase returns a different (localStorage)
    // shape: { _offline:true, intake, bxt, feasibility, advisory, summary }. In that
    // case the nested objects are ALREADY in gate-page shape, so use them directly.
    if (row._offline) {
      // localStorage gaic_summary is already in panel shape, so pass it through.
      return {
        intake: row.intake || null,
        bxt: row.bxt || null,
        feas: row.feasibility || null,
        advisory: row.advisory || null,
        panelSummary: row.summary || null,
        summary: row.summary || null
      };
    }
    var intake = mapIntake(row);
    return {
      intake: intake,
      bxt: mapBxt(row.bxt),
      feas: mapFeasibility(row.feasibility),
      advisory: mapAdvisory(row.advisory),
      verdict: row.verdict || null,
      // panel-ready Gate 5 summary (null if the case hasn't reached Gate 5 yet)
      panelSummary: mapPanelSummary(row.summary, intake),
      summary: row.summary || null,
      raw: row
    };
  }

  // Fetch + map. Resolves to compute-input opts, or null if no id / no API / error.
  // Only keys with real data are returned; missing gates are null so callers can
  // decide whether to fall back to demo defaults per-gate.
  function load() {
    var id = getId();
    if (!id) return Promise.resolve(null);
    if (!window.GAIC_API || typeof window.GAIC_API.getUseCase !== 'function') {
      return Promise.resolve(null);
    }
    return window.GAIC_API.getUseCase(id)
      .then(function (row) {
        var opts = mapUseCase(row);
        if (opts) opts.id = id;
        return opts;
      })
      .catch(function () { return null; });
  }

  window.GAIC_DEEPLINK = {
    getId: getId,
    getUcId: getUcId,
    wireNav: wireNav,
    UC_ID_KEY: UC_ID_KEY,
    GATE_PAGES: GATE_PAGES,
    mapUseCase: mapUseCase,
    mapIntake: mapIntake,
    mapBxt: mapBxt,
    mapFeasibility: mapFeasibility,
    mapAdvisory: mapAdvisory,
    mapPanelSummary: mapPanelSummary,
    load: load
  };
})();
