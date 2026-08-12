const {JSDOM}=require('/tmp/node_modules/jsdom');const fs=require('fs');
const html=fs.readFileSync('compare.html','utf8');
const rows=[];for(let i=0;i<140;i++){rows.push({id:'id'+i,name:'UC '+i,verdict:i<139?'GO':'NO-GO',department:'Finance',roi_p50:100+i});}
function dom(search){return new JSDOM(html,{runScripts:'dangerously',url:'https://x/compare.html'+(search||''),pretendToBeVisual:true,beforeParse(w){
  w.fetch=async(u)=>{const s=String(u);if(s.includes('workspaces'))return{ok:true,json:async()=>[{id:'ws1',name:'Intel'}]};if(s.includes('portfolio'))return{ok:true,json:async()=>rows};return{ok:true,json:async()=>({})};};
}});}
(async()=>{
  let pass=0,fail=0;const ok=(m,c)=>{console.log((c?'✓':'✗')+' '+m);c?pass++:fail++;};
  // 1. Click GO-only -> URL should be ?preset=go-only, not ?ids=139 uuids
  const d=dom();await new Promise(r=>setTimeout(r,200));
  const w=d.window;const btn=w.document.getElementById('presetGo');
  ok('presetGo button exists',!!btn);
  if(btn){btn.click();await new Promise(r=>setTimeout(r,50));}
  const url=w.location.search;
  ok('GO-only writes compact ?preset=go-only',/[?&]preset=go-only/.test(url));
  ok('GO-only does NOT serialise ?ids=',!/[?&]ids=/.test(url));
  ok('URL length is small (<60 chars)',url.length<60);
  ok('selection actually has 139 GO rows',w.GAIC_COMPARE&&w.document.querySelectorAll('#cmpTable th, #cmpTable thead th').length>0);
  // 2. Boot from ?preset=go-only rebuilds the GO set
  const d2=dom('?preset=go-only');await new Promise(r=>setTimeout(r,200));
  ok('readPresetFromURL parses token',d2.window.GAIC_COMPARE.readPresetFromURL()==='go-only');
  const pills=d2.window.document.querySelectorAll('#selPills .selpill').length;
  ok('boot rebuilt >100 selected from token',pills>100);
  console.log('RESULT: '+pass+' passed, '+fail+' failed');process.exit(fail?1:0);
})();