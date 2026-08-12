const fs=require('fs');
const css=fs.readFileSync('assets/theme.css','utf8');
function check(sel){
  // crude: ensure a light rule exists for this selector and sets --bg to a light value
  const re=new RegExp(sel.replace(/[.[\]="]/g,'\\$&')+'[^{]*\\{','');
  const has=re.test(css.replace(/\n/g,' '));
  return has;
}
const darkBg = /:root\s*\{[^}]*--bg:\s*#0d1117/.test(css.replace(/\n/g,' '));
const lightBlock = /\[data-theme="light"\][\s\S]*?--bg:\s*#f6f8fc/.test(css);
const classBlock = /body\.theme-light[\s\S]*?--bg:\s*#f6f8fc/.test(css) || /\[data-theme="light"\][\s\S]*body\.theme-light\s*\{[\s\S]*?--bg/.test(css);
// both selectors share one block:
const shared = /\[data-theme="light"\][^{]*,\s*[\s\S]*?body\.theme-light\s*\{[\s\S]*?--bg:\s*#f6f8fc[\s\S]*?--text:\s*#1a1f2b/.test(css);
let pass=0,fail=0;const ok=(m,c)=>{console.log((c?'✓':'✗')+' '+m);c?pass++:fail++;};
ok('dark :root still defines --bg #0d1117', darkBg);
ok('light override block sets --bg to light (#f6f8fc)', lightBlock);
ok('shared block covers BOTH [data-theme=light] and body.theme-light with --bg+--text', shared);
console.log('RESULT: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);