// Build a self-contained visual preview of compare.html (v2) with fixture data
// + a real Chart.js so the artifact screenshot shows presets, pills, unlimited
// table and the 4-pinned radars. No network / auth needed.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(dir, 'compare.html'), 'utf8');

const PORTFOLIO = [
  { id:'uc-1', name:'Fraud Signal Triage', department:'Risk & Compliance', stage:'panel', feasibility_composite:3.8, roi_p10:12, roi_p50:45, roi_p90:90, verdict:'GO', quadrant:'Quick Win', advisory_tier:'Extend', recommended_platform:'Vertex AI', citizen_dev_pct:30 },
  { id:'uc-2', name:'Contract Summarizer', department:'Legal', stage:'panel', feasibility_composite:4.2, roi_p10:20, roi_p50:60, roi_p90:120, verdict:'CONDITIONAL GO', quadrant:'Big Bet', advisory_tier:'Scale', recommended_platform:'Gemini', citizen_dev_pct:55 },
  { id:'uc-3', name:'Shelf Vision', department:'Retail Ops', stage:'panel', feasibility_composite:2.9, roi_p10:-5, roi_p50:15, roi_p90:40, verdict:'NO-GO', quadrant:'Money Pit', advisory_tier:'Pilot', recommended_platform:'AutoML', citizen_dev_pct:10 },
  { id:'uc-4', name:'Ticket Router', department:'Support', stage:'feasibility', feasibility_composite:3.1, roi_p10:8, roi_p50:30, roi_p90:70, verdict:'GO', quadrant:'Incremental', advisory_tier:'Pilot', recommended_platform:'Vertex AI', citizen_dev_pct:25 },
  { id:'uc-5', name:'Sales Copilot', department:'Sales', stage:'bxt', feasibility_composite:3.5, roi_p10:10, roi_p50:40, roi_p90:80, verdict:'GO', quadrant:'Quick Win', advisory_tier:'Extend', recommended_platform:'Gemini', citizen_dev_pct:40 },
  { id:'uc-6', name:'Demand Forecaster', department:'Supply Chain', stage:'panel', feasibility_composite:3.9, roi_p10:15, roi_p50:52, roi_p90:100, verdict:'GO', quadrant:'Big Bet', advisory_tier:'Scale', recommended_platform:'Vertex AI', citizen_dev_pct:35 },
];

// Stub: intercept the app's api-client by pre-seeding window before its IIFE runs.
// Simplest robust approach: replace the <script src="assets/api-client.js"> and
// auth-ui with an inline stub, keep Chart.js CDN, and pre-select 5 via URL hash.
const stub = `<script>
  // ---- offline stub of GAIC_API used by compare.html ----
  window.GAIC_API = {
    fetch: function(pathStr){
      if (pathStr.indexOf('/workspaces') !== -1) return Promise.resolve([{id:'ws-intel',name:'Intel Corp'}]);
      if (pathStr.indexOf('/portfolio') !== -1) return Promise.resolve(${JSON.stringify(PORTFOLIO)});
      return Promise.resolve([]);
    }
  };
</script>`;

// Remove the real api-client + auth-ui script tags; inject the stub before the page IIFE.
html = html.replace(/<script src="assets\/api-client\.js"><\/script>/, stub);
html = html.replace(/<script src="assets\/auth-ui\.js"[^>]*><\/script>/, '');
// Make asset URLs absolute to the app dir so theme.css resolves in the artifact.
html = html.replace(/(href|src)="assets\//g, '$1="../assets/');
// Pre-select all 5 so the screenshot shows unlimited table + 4-pinned radars + note.
html = html.replace('https://example.com', 'about:blank');
html = html.replace('<body', '<body data-preview="1"');
// Seed URL ids by injecting a tiny script that sets location before boot? location is read at boot.
// Easier: force STATE via a boot hook — set window.location via history isn't available in file://.
// Instead, tweak readIdsFromURL fallback: if no ids, default to all for the preview.
html = html.replace(
  'var urlIds = readIdsFromURL().filter(function (id) { return !!STATE.byId[id]; });',
  'var urlIds = readIdsFromURL().filter(function (id) { return !!STATE.byId[id]; }); if(!urlIds.length && document.body.getAttribute("data-preview")){ urlIds = STATE.rows.map(function(r){return String(r.id);}); }'
);

const out = path.join(__dirname, 'compare-preview.html');
fs.writeFileSync(out, html);
console.log('wrote', out, html.length, 'chars');
