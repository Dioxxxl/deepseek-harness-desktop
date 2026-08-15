const fs = require('fs');
const p = process.argv[2];
if (!p) { console.error('usage: node patch_v3.js <css>'); process.exit(1); }
if (!fs.existsSync(p)) { console.error('file not found: ' + p); process.exit(1); }

let buf = fs.readFileSync(p, 'utf8');

// 1) strip ALL previously appended anti-flicker blocks (v1 scroll patch + v2 keep-anim)
const markerIdx = buf.indexOf('/* === anti-flicker');
if (markerIdx >= 0) {
  const before = buf.length;
  buf = buf.slice(0, markerIdx);
  console.log('stripped existing anti-flicker blocks (' + (before - buf.length) + ' chars removed)');
} else {
  console.log('no existing anti-flicker blocks found, nothing to strip');
}

// 2) re-derive animating class selectors (those carrying `animation:`)
const animClasses = new Set();
for (const c of buf.split('}')) {
  const i = c.indexOf('{');
  if (i < 0) continue;
  const sel = c.slice(0, i).trim();
  const body = c.slice(i + 1);
  if (sel.startsWith('@')) continue;
  if (/animation\s*:/i.test(body)) {
    const m = sel.match(/\._[A-Za-z0-9_]+(?:_[A-Za-z0-9]+)?/g);
    if (m) m.forEach(x => animClasses.add(x));
  }
}

// 3) re-derive scroll/output container classes (full hash form)
function findClass(token) {
  const re = new RegExp('\\._' + token + '(_[A-Za-z0-9]+)+');
  const m = buf.match(re);
  return m ? m[0] : null;
}
const containers = ['output', 'header', 'sources', 'footer'].map(findClass).filter(Boolean);

// 4) v3: RESTORE glass + blur (no backdrop-filter:none / filter:none),
//    but KEEP harmless stabilizers as a safety net.
const animList = [...animClasses].join(',');
const contList = ['html', 'body', ...containers].join(',');
const v3 =
  `\n/* === anti-flicker v3 (restore glass+blur, keep stabilizers) === */\n` +
  `*,*::before,*::after{backface-visibility:hidden}\n` +
  `${animList}{will-change:transform,opacity;backface-visibility:hidden}\n` +
  `${contList}{scrollbar-gutter:stable}\n` +
  `._output_10eou_162{contain:content}\n`;

fs.writeFileSync(p, buf + v3, 'utf8');
console.log('animClasses=' + animList);
console.log('containers=' + contList);
console.log('new size=' + fs.statSync(p).size);
