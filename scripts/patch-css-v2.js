const fs = require('fs');
const p = process.argv[2];
if (!p) { console.error('usage: node patch_v2.js <windows-absolute-css-path>'); process.exit(2); }
if (!fs.existsSync(p)) { console.error('FILE NOT FOUND: ' + p); process.exit(2); }
const buf = fs.readFileSync(p, 'utf8');
// safety check: must be the dsh frontend css
if (!buf.includes('backdrop-filter') && !buf.includes('@keyframes')) {
  console.error('UNEXPECTED FILE (no backdrop-filter/@keyframes). aborting.'); process.exit(2);
}
const v2Marker = '/* === anti-flicker v2 (keep animations) === */';
// self-heal: strip a previously-appended (possibly malformed) v2 block, then re-apply
let working = buf;
const mi = working.indexOf(v2Marker);
if (mi >= 0) { working = working.slice(0, mi); console.log('(stripped previous v2 block, will re-apply)'); }

// --- parse rules: split on '}' ---
const chunks = working.split('}');
const animSelectors = [];
for (const c of chunks) {
  const i = c.indexOf('{');
  if (i < 0) continue;
  const sel = c.slice(0, i).trim();
  const body = c.slice(i + 1);
  // only real rule bodies that declare animation: (skip @keyframes internals, @media, etc.)
  if (sel.startsWith('@')) continue;
  if (/animation\s*:/i.test(body)) animSelectors.push(sel);
}
// dedupe
const uniq = [...new Set(animSelectors)];

// detect known scroll/output containers by class token (FULL class incl. second hash segment)
function findClass(token) {
  const re = new RegExp('\\._' + token + '_[A-Za-z0-9_]+');
  const m = working.match(re);
  return m ? m[0] : null;
}
const outCls = findClass('output');
const headerCls = findClass('header');
const sourceCls = findClass('source');
const footerCls = findClass('footer');
const containers = [outCls, headerCls, sourceCls, footerCls].filter(Boolean);

const animBlock = uniq.map(s => `${s}{will-change:transform,opacity;backface-visibility:hidden;-webkit-backface-visibility:hidden}`).join('\n');

const patch = `
${v2Marker}
/* 1) 全局兜底：变换/透明度动画在自己的合成层上跑，避免整片重绘闪 */
*,*::before,*::after{backface-visibility:hidden;-webkit-backface-visibility:hidden}
/* 2) 给真正在动的元素提独立 GPU 层（动画照常播，只是不再拖着兄弟区域重绘） */
${animBlock}
/* 3) 滚动条出现/消失不再引起布局位移闪 */
html,body${containers.length ? ',' + containers.join(',') : ''}{scrollbar-gutter:stable}
/* 4) 隔离流式输出区的重绘：插一条消息只重绘那一条，不波及整窗 */
${outCls ? outCls + '{contain:content}' : '/* (output container not detected) */'}
`;
const before = fs.statSync(p).size;
fs.writeFileSync(p, working + patch, 'utf8');
const after = fs.statSync(p).size;
console.log('animating selectors found = ' + uniq.length);
console.log(uniq.join('\n'));
console.log('containers = ' + (containers.join(',') || '(none)'));
console.log('output class = ' + (outCls || '(none)'));
console.log('before bytes=' + before + ' after bytes=' + after + ' added=' + (after - before));
