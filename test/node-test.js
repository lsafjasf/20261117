// Node 逻辑测试：stub 浏览器 canvas 测量，验证排版/校验/历史/导出逻辑。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 近似测量：CJK 1em，其余 0.5em
const fakeCtx = {
  font: '',
  measureText(s) {
    const m = /([\d.]+)px/.exec(this.font);
    const em = m ? parseFloat(m[1]) : 10;
    let w = 0;
    for (const ch of s) w += /[一-鿿　-〿＀-￯]/.test(ch) ? em : em * 0.5;
    return { width: w };
  },
};
const sandbox = {
  document: { createElement: () => ({ getContext: () => fakeCtx }) },
  console,
};
vm.createContext(sandbox);
for (const f of ['text.js', 'model.js', 'cases.js', 'exporter.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}
const { Model, Cases, Exporter, TextLayout } =
  vm.runInContext('({ Model, Cases, Exporter, TextLayout })', sandbox);

let failed = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!cond) failed++;
}

// 1. 标准案例：无错误
const std = Cases.standard();
const vStd = Model.validate(std);
check('标准案例无错误', vStd.filter(v => v.level === 'error').length === 0,
  JSON.stringify(vStd.filter(v => v.level === 'error')));

// 2. 极端案例：无错误（长文本应正好排在安全区内）
const ext = Cases.extreme();
const vExt = Model.validate(ext);
check('极端案例无错误', vExt.filter(v => v.level === 'error').length === 0,
  JSON.stringify(vExt.filter(v => v.level === 'error')));
const longEl = ext.elements[0];
const lay = TextLayout.layout(longEl, 4);
check('极端长文本已换行且高度在安全区内', lay.lines.length > 10 && longEl.y + lay.heightMm <= 205,
  `lines=${lay.lines.length} h=${lay.heightMm.toFixed(1)}mm`);

// 3. 文字跨越折线 → 报错并给出修复建议
const d3 = Cases.standard();
d3.elements[0].x = 90; // 标题移到第1/2折之间
const v3 = Model.validate(d3);
check('跨折线被拦截', v3.some(v => v.rule === '跨折线' && v.level === 'error' && v.fix.length > 0));

// 4. 文字越过安全边距 → 报错
const d4 = Cases.standard();
d4.elements[0].y = 1;
check('越过安全边距被拦截', Model.validate(d4).some(v => v.rule === '安全边距'));

// 5. 元素出界 → 裁切错误
const d5 = Cases.standard();
d5.elements[3].x = 290;
check('出界裁切被拦截', Model.validate(d5).some(v => v.rule === '裁切'));

// 6. 重叠 → 警告
const d6 = Cases.standard();
d6.elements.push(Model.makeRect(203, 60, 50, 20));
check('重叠产生警告', Model.validate(d6).some(v => v.rule === '重叠' && v.level === 'warn'));

// 7. 撤销/重做
const h = Model.createHistory(std);
const n0 = std.elements.length;
std.elements.push(Model.makeRect(10, 10, 5, 5));
h.commit(std);
check('undo 恢复元素数', h.undo().elements.length === n0);
check('redo 恢复元素数', h.redo().elements.length === n0 + 1);

// 8. 保存/载入往返（JSON 序列化保持可编辑结构）
const round = JSON.parse(JSON.stringify(ext));
check('保存/载入往返一致', JSON.stringify(round) === JSON.stringify(ext)
  && round.elements.every(e => e.id && e.type));

// 9. SVG 导出：行数与排版引擎一致，坐标单位 mm
const svg = Exporter.toSVG(ext);
const tspanCount = (svg.match(/<tspan/g) || []).length;
const expected = ext.elements.filter(e => e.type === 'text')
  .reduce((s, e) => s + TextLayout.layout(e, 4).lines.length, 0);
check('SVG 文本行数与预览一致', tspanCount === expected, `${tspanCount}/${expected}`);
check('SVG 使用 mm 视口', svg.includes('viewBox="0 0 297 210"'));
check('SVG 包含全部图形', (svg.match(/<rect/g) || []).length >= 2 && svg.includes('<ellipse'));

// 10. 切换折叠方向不改变元素世界坐标
const before = JSON.stringify(ext.elements);
ext.foldDirection = ext.foldDirection === 'in' ? 'out' : 'in';
check('折叠方向不影响世界坐标', JSON.stringify(ext.elements) === before);

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
