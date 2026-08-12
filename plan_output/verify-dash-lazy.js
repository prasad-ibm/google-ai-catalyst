const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const dir=path.join(__dirname,'..');
let html=fs.readFileSync(path.join(dir,'dashboard.html'),'utf8');
const lz=fs.readFileSync(path.join(dir,'assets','lazy-list.js'),'utf8');
html=html.replace('<head>','<head>\n<script>'+lz+'</script>');
html=html.replace('<script src="assets/lazy-list.js"></script>','');
function mk(n,off){const r=[];for(let i=0;i<n;i++)r.push({id:'UC-'+(off||0)+'-'+i,name:'Use Case '+i,department:(i%4===0?'Finance':'HR'),stage:'Gate 3',roi_p10:50+i,roi_p50:100+i,roi_p90:150+i,verdict:(i%3===0?'GO':'COND'),feasibility_composite:3+(i%3)});return r;}
const rows=mk(130,0);
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/dashboard.html',beforeParse(w){w.__DASH_TEST_ROWS=rows;}});
setTimeout(function(){
  const d=dom.window.document, W=dom.window;
  function count(sel){return d.querySelectorAll(sel).length;}
  console.log('== initial (130 rows) ==');
  console.log('table rows :', count('#pfBody tr.pf-row'), '(expect 50)');
  console.log('roi rows   :', count('#roilist .roirow'), '(expect 50)');
  console.log('table btn  :', (d.querySelector('#pfSentinel .lazy-more')||{}).textContent);
  console.log('roi btn    :', (d.querySelector('#roiSentinel .lazy-more')||{}).textContent);
  // load all
  d.querySelectorAll('.lazy-more').forEach(function(b){for(let k=0;k<5;k++)b.click();});
  console.log('after load-all: table', count('#pfBody tr.pf-row'), 'roi', count('#roilist .roirow'), '(expect 130 / 130)');
  // RE-RENDER with a different, smaller dataset -> scale + rows must reset, no stale rows
  W.__dash.render(mk(20,9));
  setTimeout(function(){
    console.log('\n== re-render (20 rows) ==');
    console.log('table rows :', count('#pfBody tr.pf-row'), '(expect 20, no stale 130)');
    console.log('roi rows   :', count('#roilist .roirow'), '(expect 20)');
    console.log('roi first name:', (d.querySelector('#roilist .roirow__name')||{}).textContent, '(expect Use Case 0 from new set)');
    console.log('table btn hidden:', (d.querySelector('#pfSentinel').style.display==='none'), '(expect true, <=chunk)');
  },20);
},60);
