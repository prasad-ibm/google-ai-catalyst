const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const dir=path.join(__dirname,'..');
let html=fs.readFileSync(path.join(dir,'portfolio-map.html'),'utf8');
const lz=fs.readFileSync(path.join(dir,'assets','lazy-list.js'),'utf8');
html=html.replace('<head>','<head>\n<script>'+lz+'</script>');
html=html.replace('<script src="assets/lazy-list.js"></script>','');
// find the test-rows hook used by portfolio-map
const hook=(html.match(/window\.__[A-Z_]*TEST_ROWS/)||[])[0];
console.log('test hook:', hook);
const depts=['Finance','HR','Legal','Data Center Group','Sales','Marketing','IT','Ops','R&D','Support','Product','Design','Security','Data','Comms'];
const rows=[];depts.forEach(function(dp,di){for(let i=0;i<20;i++)rows.push({id:'UC-'+di+'-'+i,name:dp+' Case '+i,department:dp,stage:'Gate 3',roi_p50:100+i,verdict:(i%3===0?'GO':'COND'),feasibility_composite:3});});
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/portfolio-map.html',
  beforeParse(w){ if(hook){ w[hook.replace('window.','')]=rows; } }});
setTimeout(function(){
  const d=dom.window.document;
  const sections=d.querySelectorAll('#content > section, #content > .deptsec, #content > div.dept');
  const anySections=d.querySelectorAll('#content > *');
  console.log('GAIC_LAZY:', typeof dom.window.GAIC_LAZY);
  console.log('#content direct children:', anySections.length, '(expect 4 — first chunk of 15 depts)');
  console.log('first child tag:', anySections[0] && anySections[0].tagName);
  console.log('status:', JSON.stringify((d.getElementById('mapStatus')||{}).textContent||''));
  const btn=d.querySelector('#mapSentinel .lazy-more');
  console.log('show-more btn:', btn?btn.textContent.trim():'(none)');
  if(btn){for(let k=0;k<5;k++)btn.click();
    console.log('after load-all children:', d.querySelectorAll('#content > *').length, '(expect 15)');
  }
},80);
