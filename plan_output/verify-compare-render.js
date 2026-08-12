// Render compare.html in jsdom with fixtures + Chart stub via beforeParse,
// apply presets, and print the visible structure to confirm the v2 layout.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'compare.html'), 'utf8');

const portfolio = [
  {id:'uc-1',name:'Fraud Signal Triage',department:'Risk & Compliance',feasibility_composite:3.8,roi_p10:12,roi_p50:45,roi_p90:90,verdict:'GO',quadrant:'Quick Win',advisory_tier:'Extend',recommended_platform:'Vertex AI',citizen_dev_pct:30},
  {id:'uc-2',name:'Contract Summarizer',department:'Legal',feasibility_composite:4.2,roi_p10:20,roi_p50:60,roi_p90:120,verdict:'CONDITIONAL GO',quadrant:'Big Bet',advisory_tier:'Scale',recommended_platform:'Gemini',citizen_dev_pct:55},
  {id:'uc-3',name:'Shelf Vision',department:'Retail Ops',feasibility_composite:2.9,roi_p10:-5,roi_p50:15,roi_p90:40,verdict:'NO-GO',quadrant:'Money Pit',advisory_tier:'Pilot',recommended_platform:'AutoML',citizen_dev_pct:10},
  {id:'uc-4',name:'Ticket Router',department:'Support',feasibility_composite:3.1,roi_p10:8,roi_p50:30,roi_p90:70,verdict:'GO',quadrant:'Incremental',advisory_tier:'Pilot',recommended_platform:'Vertex AI',citizen_dev_pct:25},
  {id:'uc-5',name:'Sales Copilot',department:'Sales',feasibility_composite:3.5,roi_p10:10,roi_p50:40,roi_p90:80,verdict:'GO',quadrant:'Quick Win',advisory_tier:'Extend',recommended_platform:'Gemini',citizen_dev_pct:40},
  {id:'uc-6',name:'Demand Forecaster',department:'Supply Chain',feasibility_composite:3.9,roi_p10:15,roi_p50:52,roi_p90:100,verdict:'GO',quadrant:'Big Bet',advisory_tier:'Scale',recommended_platform:'Vertex AI',citizen_dev_pct:35},
];
const workspaces = [{id:'ws',name:'Intel'}];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', resources: undefined, pretendToBeVisual: true,
  beforeParse(window) {
    window.Chart = function(ctx,cfg){ this.cfg=cfg; this.destroy=function(){}; window.__charts=(window.__charts||0)+1; };
    window.matchMedia = window.matchMedia || function(){return {matches:false,addListener(){},removeListener(){}};};
    window.fetch = function (u) {
      u = String(u);
      let body = [];
      if (u.indexOf('/api/workspaces') !== -1) body = workspaces;
      else if (u.indexOf('/api/portfolio') !== -1) body = portfolio;
      return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(body) });
    };
  },
});
const { window } = dom; const doc = window.document;
const tick = () => new Promise(r=>setTimeout(r,30));
(async () => {
  await tick(); await tick(); await tick(); await tick();
  const q = s => doc.querySelectorAll(s).length;
  console.log('SEARCH input:', !!doc.getElementById('selSearch'));
  console.log('PRESETS present:', ['presetTopRoi','presetGo','presetDept','presetClear'].map(id=>!!doc.getElementById(id)).join(','));
  console.log('DEPT dropdown options:', doc.getElementById('presetDept').options.length, '->', Array.from(doc.getElementById('presetDept').options).map(o=>o.textContent).join(' | '));
  console.log('LIST rows:', q('#selList .sellist__row'));

  doc.getElementById('presetTopRoi').dispatchEvent(new window.Event('click'));
  await tick(); await tick();
  console.log('\n--- after TOP ROI preset ---');
  console.log('PILLS:', q('#selPills .selpill'), '->', Array.from(doc.querySelectorAll('#selPills .selpill')).map(p=>p.textContent.replace(/[×✕]/,'').trim()).join(' | '));
  console.log('TABLE case columns:', q('#cmpTable thead th')-1, '| body rows:', q('#cmpTable tbody tr'));
  console.log('cmpCount:', JSON.stringify(doc.getElementById('cmpCount').textContent));
  console.log('cmpIntro:', JSON.stringify(doc.getElementById('cmpIntro').textContent));
  console.log('RADAR canvases:', q('#radars canvas'), '(cap 4)');
  console.log('radarCount:', JSON.stringify(doc.getElementById('radarCount').textContent));
  console.log('radarNote hidden?', doc.getElementById('radarNote').classList.contains('hidden'));

  doc.getElementById('presetGo').dispatchEvent(new window.Event('click'));
  await tick(); await tick();
  console.log('\n--- after GO-ONLY preset ---');
  console.log('selected (table cols):', q('#cmpTable thead th')-1, '| radars:', q('#radars canvas'), '| radarNote hidden?', doc.getElementById('radarNote').classList.contains('hidden'));
  console.log('radarNote text:', JSON.stringify(doc.getElementById('radarNote').textContent.trim()));
  console.log('\nSMOKE OK');
})().catch(e=>{ console.error('FAIL', e); process.exit(1); });
