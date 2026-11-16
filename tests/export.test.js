import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockContext } from './mock-context.js';
import { renderCanvas, serializeSVG } from '../src/render.js';
import { defaultScene, extremeScene } from '../src/state.js';
import { parseEmbeddedState } from '../src/svg-io.js';

test('Canvas 渲染：图层按数组顺序绘制，缩放/平移/旋转进入变换', () => {
  const ctx = createMockContext();
  const scene = defaultScene();
  scene.view = { zoom: 2, panX: 15, panY: 9, rotation: 30 };
  renderCanvas(ctx, scene, scene.view, { width: 1280, height: 720 });
  const calls = ctx.calls.map((entry) => entry[0]);
  assert.ok(calls.includes('clearRect'));
  assert.deepEqual(calls.slice(calls.indexOf('translate'), calls.indexOf('translate') + 1), ['translate']);
  const translateCall = ctx.calls.find((entry) => entry[0] === 'translate');
  const rotateCall = ctx.calls.find((entry) => entry[0] === 'rotate');
  const scaleCall = ctx.calls.find((entry) => entry[0] === 'scale');
  assert.deepEqual(translateCall.slice(1), [15, 9]);
  assert.ok(Math.abs(rotateCall[1] - Math.PI / 6) < 1e-9);
  assert.deepEqual(scaleCall.slice(1), [2, 2]);
  assert.ok(calls.filter((name) => name === 'stroke').length > 0, '笔画应实际描边');
});

test('多图层渲染顺序与状态数组一致（后绘制者在上层）', () => {
  const ctx = createMockContext();
  const scene = extremeScene();
  const layerIds = scene.layers.map((layer) => layer.id);
  renderCanvas(ctx, scene, scene.view, { width: 1280, height: 720 });
  const translations = ctx.calls
    .filter((entry) => entry[0] === 'translate')
    .slice(1)
    .map((entry) => [entry[1], entry[2]]);
  const expected = scene.layers.map((layer) => [layer.position.x, layer.position.y]);
  assert.deepEqual(translations, expected);
  assert.equal(layerIds.length, 2);
});

test('SVG 导出为可编辑 path 且内嵌可回放状态', () => {
  const scene = extremeScene();
  const { svg, layout } = serializeSVG(scene, scene.view, { width: 800, height: 600 });
  assert.match(svg, /^<svg xmlns/);
  assert.match(svg, /<rect width="800" height="600"/);
  const pathCount = (svg.match(/<path /g) || []).length;
  assert.ok(pathCount >= layout.totalGlyphs, '每个字形至少一条可编辑路径');
  assert.match(svg, /<g id="layer-/);
  assert.match(svg, /<metadata id="typo-studio-state"/);
  const embedded = JSON.parse(svg.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/)[1]
    .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '').replaceAll('&quot;', '"'));
  assert.equal(embedded.format, 'typo-studio/1');
  assert.equal(embedded.scene.layers.length, 2);
  assert.equal(embedded.view.rotation, scene.view.rotation);
});

test('圆度边界决定线帽与连接方式', () => {
  const sharp = defaultScene();
  sharp.layers[0].corner = 0;
  const round = defaultScene();
  round.layers[0].corner = 1;
  assert.match(serializeSVG(sharp, sharp.view).svg, /stroke-linecap="butt"/);
  assert.match(serializeSVG(round, round.view).svg, /stroke-linecap="round"/);
});

test('默认与极端场景都可完整渲染且字形数量稳定', () => {
  for (const scene of [defaultScene(), extremeScene()]) {
    const ctx = createMockContext();
    const layout = renderCanvas(ctx, scene, scene.view, { width: 1280, height: 720 });
    assert.equal(layout.ok, true);
    const second = renderCanvas(createMockContext(), scene, scene.view, { width: 1280, height: 720 });
    assert.equal(second.totalGlyphs, layout.totalGlyphs);
    assert.ok(layout.totalGlyphs > 0);
  }
});

test('导出文件以 SVG 头开始，可被重新解析为 XML', async () => {
  const { svg } = serializeSVG(defaultScene(), defaultScene().view);
  const trimmed = svg.trimStart();
  assert.ok(trimmed.startsWith('<svg'));
  assert.doesNotThrow(() => {
    const tags = svg.match(/<\/?[a-zA-Z][^>]*>/g);
    assert.ok(tags && tags.length > 4);
  });
  await readFile(new URL('../index.html', import.meta.url));
});

test('SVG 往返：导出后重新导入，对象数量与位置完全一致', () => {
  const scene = extremeScene();
  const { svg } = serializeSVG(scene, scene.view);
  const parsed = parseEmbeddedState(svg);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.scene.layers.length, scene.layers.length);
  assert.deepEqual(
    parsed.scene.layers.map((layer) => layer.position),
    scene.layers.map((layer) => layer.position)
  );
  assert.deepEqual(parsed.view, scene.view);
  assert.equal(parseEmbeddedState('<svg></svg>').ok, false);
});

test('渲染异常不抛出：返回原因且不白屏', () => {
  const ctx = createMockContext();
  const broken = {
    ...defaultScene(),
    layers: [{ ...defaultScene().layers[0], weight: 'not-a-number' }]
  };
  const result = renderCanvas(ctx, broken, broken.view, { width: 800, height: 600 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /字重/);
  const strokeCalls = ctx.calls.filter((entry) => entry[0] === 'stroke');
  assert.equal(strokeCalls.length, 0, '失败帧不得绘制无效笔画');
});
