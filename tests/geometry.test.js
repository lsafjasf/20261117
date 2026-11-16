import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutLayer, layoutScene } from '../src/layout.js';
import { validateParams, clampParams, PARAM_SPEC } from '../src/validation.js';
import { defaultLayer } from '../src/state.js';
import { glyphPaths } from '../src/render.js';
import { hasGlyph } from '../src/font.js';

test('默认参数：几何位置确定且字形不重叠', () => {
  const layer = defaultLayer({ text: 'AB' });
  const result = layoutLayer(layer, 720);
  assert.equal(result.ok, true);
  assert.equal(result.glyphs.length, 2);
  const [a, b] = result.glyphs;
  assert.equal(a.x, 0);
  assert.equal(b.x, a.cell);
  assert.ok(b.x >= a.x + a.cell - 1e-9, '相邻字形不得侵占前一个字形单元');
  assert.equal(a.y, b.y);
  const pathsA = glyphPaths(a);
  assert.ok(pathsA.length >= 1);
  assert.ok(pathsA.every((path) => path.line || path.dot));
});

test('长句自动换行，每行宽度不超过换行宽度', () => {
  const text = 'WRAP '.repeat(40).trim();
  const layer = defaultLayer({ text, fontSize: 32 });
  const result = layoutLayer(layer, 300);
  assert.equal(result.ok, true);
  assert.ok(result.bounds.lines > 1, '应产生多行');
  const maxLine = new Map();
  for (const glyph of result.glyphs) {
    const right = glyph.x + glyph.cell;
    maxLine.set(glyph.line, Math.max(maxLine.get(glyph.line) ?? 0, right));
  }
  for (const width of maxLine.values()) {
    assert.ok(width <= 300 + 1e-6, '行宽必须落在换行宽度内');
  }
  const baselines = [...new Set(result.glyphs.map((g) => g.y))];
  assert.equal(baselines.length, result.bounds.lines);
});

test('边界参数：上下限被接受，字重映射到合理笔画宽度', () => {
  const extremes = [
    { fontSize: 12, weight: 100, slant: -45, width: 0.5, corner: 0 },
    { fontSize: 200, weight: 900, slant: 45, width: 2, corner: 1 }
  ];
  for (const params of extremes) {
    const check = validateParams({ ...defaultLayer(), ...params });
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    const result = layoutLayer({ ...defaultLayer(), ...params, text: 'M' }, 720);
    assert.equal(result.ok, true);
    assert.ok(result.glyphs[0].strokeWidth > 0);
  }
  const thin = layoutLayer({ ...defaultLayer(), weight: 100, fontSize: 100 }, 720);
  const thick = layoutLayer({ ...defaultLayer(), weight: 900, fontSize: 100 }, 720);
  assert.ok(thick.glyphs[0].strokeWidth > thin.glyphs[0].strokeWidth);
});

test('极端倾斜下字形前进量包含剪切补偿，仍互不重叠', () => {
  const layer = defaultLayer({ text: 'MMMM', slant: 45, width: 2 });
  const result = layoutLayer(layer, 4000);
  for (let i = 1; i < result.glyphs.length; i += 1) {
    const prev = result.glyphs[i - 1];
    const current = result.glyphs[i];
    assert.ok(current.x >= prev.x + prev.cell - 1e-9);
  }
});

test('场景几何：对象数量、图层顺序与位置稳定', () => {
  const scene = {
    wrapWidth: 720,
    layers: [
      defaultLayer({ id: 'a', name: 'A', text: 'ONE', position: { x: 10, y: 20 } }),
      defaultLayer({ id: 'b', name: 'B', text: 'TWO', position: { x: 30, y: 40 } })
    ]
  };
  const first = layoutScene(scene, 720);
  const second = layoutScene(JSON.parse(JSON.stringify(scene)), 720);
  assert.deepEqual(
    first.layers.map((l) => [l.id, l.order, l.position]),
    second.layers.map((l) => [l.id, l.order, l.position])
  );
  assert.equal(first.totalGlyphs, 6);
  assert.equal(first.layers[0].id, 'a');
  assert.equal(first.layers[1].id, 'b');
});

test('全部可打印 ASCII 都有程序化字形数据', () => {
  for (let code = 32; code < 127; code += 1) {
    assert.equal(hasGlyph(String.fromCharCode(code)), true);
  }
});

test('clampParams 将越界值拉回范围', () => {
  const clamped = clampParams({ fontSize: 9999, weight: -5, slant: 200, width: 0, corner: 3 });
  assert.equal(clamped.fontSize, PARAM_SPEC.fontSize.max);
  assert.equal(clamped.weight, PARAM_SPEC.weight.min);
  assert.equal(clamped.slant, PARAM_SPEC.slant.max);
  assert.equal(clamped.width, PARAM_SPEC.width.min);
  assert.equal(clamped.corner, PARAM_SPEC.corner.max);
});
