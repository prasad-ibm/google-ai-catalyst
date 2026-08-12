const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const dir=path.join(__dirname,'..');
let html=fs.readFileSync(path.join(dir,'compare.html'),'utf8');
const lz=fs.readFileSync(path.join(dir,'assets','lazy-list.js'),'utf8');
html=html.replace('<head>','<head>\n<script>'+lz+'</script>');
html=html.replace('<script src="assets/lazy-list.js"></script>','');
const LONG='X'.repeat(5000);
const rows=[
 {id:'a',name:LONG,department:LONG,roi_p10:100,roi_p50:200,roi_p90:300,verdict:'GO',feasibility_composite:4},
 {id:'b',name:'Normal Case',department:'Finance',roi_p10:50,roi_p50:150,roi_p90:250,verdict:'COND',feasibility_composite:3},
];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/compare.html?ids=a,b',
  beforeParse(w){ w.fetch=function(u){u=String(u);let b=(u.indexOf('/api/workspaces')!==-1)?[{id:'ws',name:'Intel'}]:(u.indexOf('/api/portfolio')!==-1?rows:[]);return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(b);}});}; }});
setTimeout(function(){
  const d=dom.window.document;
  // Report method: check the widest cell's CSS + whether nowrap/ellipsis/clip are set.
  const nameCell=d.querySelector('.cmphd__name');
  const td=d.querySelector('table.cmp td:not(.attr)');
  function cs(el){return el?dom.window.getComputedStyle(el):{};}
  const ncs=cs(nameCell), tcs=cs(td);
  console.log('.cmphd__name present:', !!nameCell);
  console.log('  white-space :', ncs.whiteSpace, '(want nowrap)');
  console.log('  overflow    :', ncs.overflow, '(want hidden)');
  console.log('  text-overflow:', ncs.textOverflow, '(want ellipsis)');
  console.log('  max-width   :', ncs.maxWidth);
  console.log('td (value cell):');
  console.log('  overflow    :', tcs.overflow, '(want hidden)');
  console.log('  max-width   :', tcs.maxWidth, '(want bounded, not none)');
  console.log('  word-break  :', tcs.wordBreak);
  // table-layout on the table
  const tbl=d.querySelector('table.cmp');
  console.log('table.cmp table-layout:', cs(tbl).tableLayout, '(want fixed)');
  console.log('table.cmp width attr present, columns bounded by max-width:220px in CSS');
  console.log('name text length in DOM:', (nameCell?nameCell.textContent.length:0), '(5000 injected)');
},80);
