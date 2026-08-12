const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const rows = [
  { id:'a', name:'AskHR Assistant', department:'Human Resources', roi_p50:336, verdict:'GO', status:'completed' },
  { id:'b', name:'HR Onboarding Bot', department:'Human Resources', roi_p50:180, verdict:'GO', status:'completed' },
  { id:'c', name:'Finance Close Copilot', department:'Finance', roi_p50:240, verdict:'GO', status:'completed' },
  { id:'d', name:'DCG Capacity Planner', department:'Data Center Group', roi_p50:410, verdict:'GO', status:'completed' },
  { id:'e', name:'Legal Contract Review', department:'Legal', roi_p50:95, verdict:'COND', status:'in_progress' },
];
const html = fs.readFileSync(path.join(__dirname,'..','dashboard.html'),'utf8');
const dom = new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/dashboard.html',beforeParse(w){w.__DASH_TEST_ROWS=rows;}});
setTimeout(function(){
  const d = dom.window.document;
  const sec = d.getElementById('deliveredSec');
  console.log('SECTION visible:', !sec.classList.contains('hidden'));
  console.log('TITLE:', d.querySelector('#deliveredSec .sec__title').textContent);
  console.log('\nDELIVERED KPIs:');
  d.querySelectorAll('#deliveredKpis .kpi').forEach(function(k){
    console.log('  • '+k.querySelector('.kpi__k').textContent+' = '+k.querySelector('.kpi__v').textContent.trim()+'  ('+(k.querySelector('.kpi__note')||{}).textContent+')');
  });
  console.log('\nDELIVERED BY DEPARTMENT:');
  d.querySelectorAll('#deliveredByDept .dvd__row').forEach(function(r){
    var w = (r.querySelector('.dvd__fill').getAttribute('style')||'').match(/width:\s*([\d.]+)/);
    console.log('  • '+r.querySelector('.dvd__label').textContent+'  bar='+(w?w[1]:'?')+'%  '+r.querySelector('.dvd__meta').textContent.replace(/\s+/g,' ').trim());
  });
  console.log('\nMain KPI row still intact:', d.querySelectorAll('#kpis .kpi').length, 'KPIs');
}, 30);
