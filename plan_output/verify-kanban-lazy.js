const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const dir=path.join(__dirname,'..');
let html=fs.readFileSync(path.join(dir,'kanban.html'),'utf8');
const lz=fs.readFileSync(path.join(dir,'assets','lazy-list.js'),'utf8');
html=html.replace('<head>','<head>\n<script>'+lz+'</script>');
html=html.replace('<script src="assets/lazy-list.js"></script>','');
const portfolio=[];for(let i=0;i<150;i++)portfolio.push({id:'F'+i,name:'Feas Case '+i,department:'Finance',stage:'feasibility',feasibility_composite:3.5,advisory_tier:'Pilot',verdict:null});
for(let i=0;i<20;i++)portfolio.push({id:'I'+i,name:'Intake '+i,department:'HR',stage:'intake',verdict:null});
const workspaces=[{id:'ws-intel',name:'Intel Corp'}];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/kanban.html',
  beforeParse(w){ w.fetch=function(url){const u=String(url);let b=(u.indexOf('/api/workspaces')!==-1)?workspaces:(u.indexOf('/api/portfolio')!==-1?portfolio:[]);return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(b);}});}; }});
setTimeout(function(){
  const d=dom.window.document;
  console.log('GAIC_LAZY:', typeof dom.window.GAIC_LAZY);
  d.querySelectorAll('.col').forEach(function(col){
    const key=col.getAttribute('data-col');
    const cards=col.querySelectorAll('.col__body .card').length;
    const count=(col.querySelector('.col__count')||{}).textContent;
    const btn=col.querySelector('.lazy-more');
    if(count!=='0') console.log('col '+key+': header='+count+', rendered='+cards+(btn?(', btn="'+btn.textContent.trim()+'"'):', no btn'));
  });
  const b=d.querySelector('.col[data-col="feasibility"] .lazy-more');
  if(b){for(let k=0;k<8;k++)b.click();
    console.log('feasibility after load-all:', d.querySelectorAll('.col[data-col="feasibility"] .col__body .card').length,'(expect 150)');
  }
},80);
