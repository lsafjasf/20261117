/* tests/run-tests.js — 标准案例与极端案例的规则/导出一致性测试。
 * 运行：node tests/run-tests.js */
'use strict';
const assert = require('node:assert');
const Core = require('../js/icon-core.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    console.error('    ' + err.message);
    process.exitCode = 1;
  }
}

console.log('标准案例');
const standard = Core.createStandardState();

test('三枚图标且结构完整', function () {
  assert.strictEqual(standard.icons.length, 3);
  standard.icons.forEach(function (icon) {
    assert.ok(icon.shapes.length >= 4, icon.id + ' 应包含图形与文本');
  });
});

test('标准案例通过全部排版规则（无错误也无警告）', function () {
  assert.deepStrictEqual(Core.validateState(standard), []);
});

test('统一风格令牌被三枚图标共享', function () {
  const next = Core.clone(standard);
  next.style.strokeWidth = 4;
  next.style.cornerRadius = 2;
  next.style.colorPrimary = '#111111';
  next.icons.forEach(function (icon, i) {
    const svg = Core.svgForIcon(next, i);
    assert.ok(svg.includes('stroke-width="4"'), '线宽应生效');
    assert.ok(svg.includes('rx="2"') || !svg.includes('rx='), '圆角应继承统一值');
    assert.ok(svg.includes('#111111'), '主色应生效');
  });
});

test('单独调整一枚图标，其余两枚保持不变', function () {
  const next = Core.clone(standard);
  next.icons[0].shapes[0].x += 5;
  next.icons[0].name = '改名';
  assert.deepStrictEqual(next.icons[1], standard.icons[1]);
  assert.deepStrictEqual(next.icons[2], standard.icons[2]);
  assert.notStrictEqual(Core.svgForIcon(next, 0), Core.svgForIcon(standard, 0));
});

test('SVG 导出确定且结构合法（预览与导出同源）', function () {
  for (let i = 0; i < 3; i += 1) {
    const a = Core.svgForIcon(standard, i);
    const b = Core.svgForIcon(standard, i);
    assert.strictEqual(a, b, '同一状态两次导出必须一致');
    assert.ok(a.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(a.includes('viewBox="0 0 48 48"'));
    assert.ok(a.trim().endsWith('</svg>'));
    assert.ok(a.includes('<text'), '文本应以 <text> 保留可编辑性');
  }
});

test('24px 导出尺寸正确且等效线宽 ≥ 1px', function () {
  const svg = Core.svgForIcon(standard, 0, { size: 24 });
  assert.ok(svg.includes('width="24" height="24"'));
  assert.ok(Core.effectiveStrokeAt(standard.style, 24) >= Core.MIN_EFFECTIVE_STROKE);
});

test('index.json 索引与图标一一对应', function () {
  const index = Core.indexJson(standard, '2026-11-17T00:00:00.000Z');
  assert.strictEqual(index.generatedAt, '2026-11-17T00:00:00.000Z');
  assert.strictEqual(index.icons.length, 3);
  index.icons.forEach(function (entry, i) {
    assert.strictEqual(entry.svg, standard.icons[i].id + '.svg');
    assert.strictEqual(entry.width, Core.GRID);
  });
});

console.log('极端案例（超长文本 / 越界 / 重叠 / 过细线宽）');
const extreme = Core.createExtremeState();

test('极端案例触发 R1–R5 全部规则类别', function () {
  const rules = new Set(Core.validateState(extreme).map(function (i) { return i.rule; }));
  ['R1 裁切检查', 'R2 安全边距', 'R3 重叠检查', 'R4 文本规则', 'R5 小尺寸辨识'].forEach(function (rule) {
    assert.ok(rules.has(rule), '缺少规则：' + rule);
  });
});

test('每条问题都附带具体修复建议', function () {
  Core.validateState(extreme).forEach(function (issue) {
    assert.ok(issue.message.length > 0);
    assert.ok(issue.fix.length > 0, issue.rule + ' 缺少修复建议');
  });
});

test('超长文本输入被拒绝且保留原有内容', function () {
  const before = Core.clone(standard);
  const textShape = standard.icons[0].shapes.find(function (s) { return s.type === 'text'; });
  const res = Core.commitText(standard, 0, textShape.id, '这是一段远远超过十二字上限的功能名称文本');
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors[0].includes('R4 文本规则'), '应指出违反的规则');
  assert.ok(res.errors[0].includes('修复'), '应给出修复方式');
  assert.deepStrictEqual(standard, before, '非法输入不得改动已有内容');
});

test('空文本与超宽文本同样被拒绝', function () {
  const textShape = standard.icons[0].shapes.find(function (s) { return s.type === 'text'; });
  assert.strictEqual(Core.commitText(standard, 0, textShape.id, '   ').ok, false);
  assert.strictEqual(Core.commitText(standard, 0, textShape.id, 'ABCDEFGHIJKLM').ok, false);
  assert.strictEqual(Core.commitText(standard, 0, textShape.id, '保存').ok, true);
});

test('非法数值输入被拒绝并说明范围', function () {
  assert.strictEqual(Core.commitNumber('abc', { min: 0, max: 10, label: '线宽' }).ok, false);
  const tooBig = Core.commitNumber('99', { min: 0, max: 10, label: '线宽' });
  assert.strictEqual(tooBig.ok, false);
  assert.ok(tooBig.error.includes('不能大于 10'));
  assert.ok(tooBig.error.includes('已保留原值'));
  assert.deepStrictEqual(Core.commitNumber('5', { min: 0, max: 10, label: '线宽' }), { ok: true, value: 5 });
});

test('极端案例在 24px 下给出过细线宽警告', function () {
  assert.ok(Core.effectiveStrokeAt(extreme.style, 24) < Core.MIN_EFFECTIVE_STROKE);
  const warnings = Core.validateState(extreme).filter(function (i) { return i.rule === 'R5 小尺寸辨识'; });
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].severity, 'warning');
});

test('极端案例导出仍保持 XML 转义与结构完整（不静默丢内容）', function () {
  const svg = Core.svgForIcon(extreme, 0);
  assert.ok(svg.includes('超级长的功能名称文本示例ABC'), '超长文本应原样保留在导出中');
  assert.ok(svg.trim().endsWith('</svg>'));
  const tricky = Core.clone(standard);
  tricky.icons[0].shapes.find(function (s) { return s.type === 'text'; }).content = 'A<B&"C"';
  const escaped = Core.svgForIcon(tricky, 0);
  assert.ok(escaped.includes('A&lt;B&amp;&quot;C&quot;'), '特殊字符必须转义');
});

console.log('\n通过 ' + passed + ' 项测试' + (process.exitCode ? '（存在失败）' : ''));
