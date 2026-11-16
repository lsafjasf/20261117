/* Node 端校验测试：布局不变量、规则校验、SVG 导出一致性。 */
'use strict';
global.window = global; // 让各模块挂到同一全局对象
const M = require('../js/model.js');
require('../js/pattern.js');
require('../js/render.js');
const S = require('../js/svg.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// 与 app.js 中一致的三组案例
const standard = M.defaults();
const longText = Object.assign(M.defaults(), {
  title: '2026 国际现代戏剧节开幕大戏《漫长告别之夜》全球首演特别加场',
  session: '2026-12-31 23:59 跨年夜特别加长场次（含中场休息两次）',
  seat: 'VIP至尊包厢区 东区 第18排 236座',
  width: 1400, height: 320, fontScale: 0.7
});
const tiny = Object.assign(M.defaults(), {
  width: 200, height: 80, fontScale: 0.5,
  title: '影展', session: '01-01 10:00', seat: '1排1座', date: '01-01', serial: 'NO.1'
});

console.log('案例校验（安全边距/重叠/裁切）');
[['标准', standard], ['极端长文本', longText], ['极小尺寸', tiny]].forEach(([n, st]) => {
  const errs = M.validate(st);
  check(n + '案例通过校验', errs.length === 0, errs.join(' | '));
  const L = M.layout(st);
  const tearPx = L.tearPx, safe = L.safe;
  // 不变量1：编号与纹样完整位于撕线右侧副券区内
  check(n + '：纹样在副券区内', L.pattern.x >= tearPx + safe - 0.01 && L.pattern.x + L.pattern.w <= st.width - safe + 0.01);
  const serial = L.texts.find(t => t.key === 'serial');
  const serialW = M.measure(serial.text, serial.size, st.fontFamily);
  check(n + '：编号不跨撕线', serial.x - serialW / 2 >= tearPx + safe - 0.01);
  // 不变量2：主票区文本不触撕线
  L.texts.filter(t => t.region === 'main').forEach(t => {
    const w = M.measure(t.text, t.size, st.fontFamily);
    check(n + '：' + t.key + ' 不越撕线', t.x + w <= tearPx - safe + 0.01);
  });
  // 不变量3：纹样与编号垂直不重叠
  check(n + '：纹样/编号不重叠', L.pattern.y + L.pattern.h <= serial.y - serial.size + 0.01);
  // 不变量4：所有文本在票面内（不裁切）
  L.texts.forEach(t => {
    check(n + '：' + t.key + ' 垂直不出界', t.y - t.size >= -0.01 && t.y <= st.height + 0.01);
  });
});

console.log('规则拒绝（错误输入须被拦截并给出修复建议）');
let errs = M.validate(Object.assign(M.defaults(), { tearX: 0.3 }));
check('撕线过左被拒绝', errs.some(e => e.includes('撕线')));
errs = M.validate(Object.assign(M.defaults(), { title: '超'.repeat(60) }));
check('超长标题被拒绝并提示主票区', errs.some(e => e.includes('主票区') && e.includes('安全边距')));
errs = M.validate(Object.assign(M.defaults(), { serial: '编号！@#' }));
check('非法编号被拒绝', errs.some(e => e.includes('编号')));
errs = M.validate(Object.assign(M.defaults(), { width: 50 }));
check('超小票宽被拒绝', errs.some(e => e.includes('票宽')));
errs = M.validate(Object.assign(M.defaults(), { tearX: 0.5, width: 300, serial: 'NO.2026-VERY-LONG-SERIAL-9999' }));
check('编号溢出副券区被拒绝', errs.length > 0, '应报错');

console.log('SVG 导出一致性');
const svg = S.buildSVG(standard);
check('SVG 含编号文本', svg.includes('NO.2026-0001'));
check('SVG 含撕线虚线', svg.includes('stroke-dasharray="6 5"'));
check('SVG 含验证纹样路径', (svg.match(/<path /g) || []).length === 3);
check('SVG 含缺口圆', (svg.match(/<circle /g) || []).length === 2);
const L2 = M.layout(standard);
check('SVG 文本坐标与布局一致', svg.includes('x="' + L2.texts[0].x + '" y="' + L2.texts[0].y + '"'));
check('SVG 特殊字符转义', S.buildSVG(Object.assign(M.defaults(), { title: 'A<B&"C"' })).includes('A&lt;B&amp;&quot;C&quot;'));

console.log('批量生成布局一致性');
for (let i = 0; i < 10; i++) {
  const st = Object.assign(M.defaults(), { serial: 'NO.2026-' + String(1 + i).padStart(4, '0') });
  const La = M.layout(st), Lb = M.layout(standard);
  const same = La.tearPx === Lb.tearPx && La.pattern.x === Lb.pattern.x && La.pattern.w === Lb.pattern.w
    && La.texts.every((t, k) => t.x === Lb.texts[k].x && t.y === Lb.texts[k].y && t.size === Lb.texts[k].size);
  if (!same) { failures++; console.error('  ✗ 批量第 ' + i + ' 张布局漂移'); break; }
}
check('批量 10 张布局完全一致', true);

console.log(failures ? '\n失败 ' + failures + ' 项' : '\n全部通过');
process.exit(failures ? 1 : 0);
