import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultParams, validateParams, validateField, mergeParams, PARAM_SCHEMA,
} from '../src/js/params.js';
import { generateScene, countObjects, layerOffsetX, LAYER_PROFILES } from '../src/js/geometry.js';
import { mulberry32 } from '../src/js/rng.js';
import { loadParams, saveParams, saveViewDraft, loadViewDraft, PARAMS_KEY, VIEW_KEY } from '../src/js/storage.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

// ---------- 默认参数组 ----------
test('默认参数：全部字段符合 schema 且场景可生成', () => {
  const params = defaultParams();
  for (const [key, spec] of Object.entries(PARAM_SCHEMA)) {
    const result = validateField(key, params[key]);
    assert.equal(result.ok, true, `默认值 ${key} 应通过校验`);
  }
  const scene = generateScene(params);
  const stats = countObjects(scene);
  assert.equal(stats.layers, 4);
  assert.ok(stats.buildings > 10);
  assert.ok(stats.windows > stats.buildings);
  assert.ok(stats.lit > 0);
  assert.equal(scene.width, 1280);
  assert.equal(scene.height, 720);
});

test('默认参数：同种子两次生成的几何位置完全一致', () => {
  const params = defaultParams();
  const a = JSON.stringify(generateScene(params));
  const b = JSON.stringify(generateScene(params));
  assert.equal(a, b);
});

test('默认参数：图层按深度从远到近排序且视差递增', () => {
  const scene = generateScene(defaultParams());
  const depths = scene.layers.map((l) => l.depth);
  const parallaxes = scene.layers.map((l) => l.parallax);
  assert.deepEqual(depths, [...depths].sort((x, y) => x - y));
  assert.deepEqual(parallaxes, [...parallaxes].sort((x, y) => x - y));
  assert.equal(scene.layers[0].layerIndex, 0);
});

test('默认参数：所有建筑坐标落在地面线以上且在瓦片范围内', () => {
  const scene = generateScene(defaultParams());
  for (const layer of scene.layers) {
    for (const b of layer.buildings) {
      assert.ok(b.top >= 40, '顶部不能超出画布上方太多');
      assert.ok(b.base <= 720);
      assert.ok(b.base > b.top);
      assert.ok(b.x >= -60, `建筑起点 ${b.x} 不应超出左侧接缝余量`);
      assert.ok(b.x + b.w <= 1680 + 220, '建筑终点不应超出右侧接缝余量');
      for (const win of b.windows) {
        assert.ok(win.x >= b.x - 1 && win.x + win.w <= b.x + b.w + 1, '窗洞必须在建筑内');
        assert.ok(win.y >= b.top && win.y + win.h <= b.base);
      }
    }
  }
});

// ---------- 边界参数组 ----------
test('边界参数：最小与最大边界值均被接受', () => {
  const minima = {};
  const maxima = {};
  for (const [key, spec] of Object.entries(PARAM_SCHEMA)) {
    if (spec.type === 'boolean') { minima[key] = false; maxima[key] = true; }
    else { minima[key] = spec.min; maxima[key] = spec.max; }
  }
  assert.equal(validateParams(minima).ok, true);
  assert.equal(validateParams(maxima).ok, true);
  const minScene = generateScene(mergeParams(defaultParams(), minima));
  const maxScene = generateScene(mergeParams(defaultParams(), maxima));
  assert.equal(countObjects(minScene).layers, 2);
  assert.equal(countObjects(maxScene).layers, 6);
});

test('边界参数：2 层与 6 层场景都能生成且深度顺序正确', () => {
  for (const layerCount of [2, 6]) {
    const scene = generateScene({ ...defaultParams(), layerCount });
    assert.equal(scene.layers.length, layerCount);
    const depths = scene.layers.map((l) => l.depth);
    assert.deepEqual(depths, [...depths].sort((x, y) => x - y));
  }
});

test('边界参数：亮窗比例 0 时无亮窗，1 时全部窗亮', () => {
  const dark = countObjects(generateScene({ ...defaultParams(), windowLitRatio: 0 }));
  assert.equal(dark.lit, 0);
  const bright = countObjects(generateScene({ ...defaultParams(), windowLitRatio: 1 }));
  assert.ok(bright.lit > bright.windows * 0.7, '最远层会被深度因子压暗一些');
  assert.ok(bright.lit <= bright.windows);
});

test('边界参数：视差强度 0 时所有层偏移为 0，为 2 时近层偏移最大', () => {
  const near = LAYER_PROFILES[LAYER_PROFILES.length - 1];
  assert.ok(Object.is(layerOffsetX(1, near, 0), -0) || layerOffsetX(1, near, 0) === 0);
  const shifted = layerOffsetX(1, near, 2);
  assert.ok(shifted < -400);
  const far = LAYER_PROFILES[0];
  assert.ok(Math.abs(layerOffsetX(1, far, 1)) < Math.abs(layerOffsetX(1, near, 1)));
});

// ---------- 异常参数组 ----------
test('异常参数：越界、NaN、字符串和错误类型全部被拒绝并给出原因', () => {
  const cases = [
    [{ layerCount: 1 }, /超出允许范围/],
    [{ layerCount: 7 }, /超出允许范围/],
    [{ sunsetHue: 361 }, /超出允许范围/],
    [{ zoom: 0 }, /超出允许范围/],
    [{ zoom: 99 }, /超出允许范围/],
    [{ seed: 1.5 }, /必须是整数/],
    [{ seed: 'abc' }, /必须是整数/],
    [{ buildingDensity: NaN }, /必须是有限数字/],
    [{ buildingDensity: Infinity }, /必须是有限数字/],
    [{ lightBeams: 'yes' }, /必须是布尔值/],
    [{ unknownField: 1 }, /未知参数/],
  ];
  for (const [patch, pattern] of cases) {
    const result = validateParams(patch);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), pattern);
  }
});

test('异常参数：部分合法部分非法时只接受合法字段且保留错误原因', () => {
  const result = validateParams({ sunsetHue: 120, zoom: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.params.sunsetHue, 120);
  assert.equal('zoom' in result.params, false);
  assert.match(result.errors[0], /zoom/);
});

test('异常参数：非对象输入被拒绝', () => {
  assert.equal(validateParams(null).ok, false);
  assert.equal(validateParams([1, 2, 3]).ok, false);
  assert.equal(validateParams('nope').ok, false);
});

// ---------- 持久化与 RNG ----------
test('存储：保存后可读回且与原参数一致', () => {
  const storage = new MemoryStorage();
  const params = { ...defaultParams(), sunsetHue: 200, seed: 42 };
  assert.equal(saveParams(params, storage), true);
  const loaded = loadParams(storage);
  assert.deepEqual(loaded.params, params);
  assert.equal(loaded.errors.length, 0);
});

test('存储：损坏 JSON 回退默认参数并报告原因，不抛异常', () => {
  const storage = new MemoryStorage();
  storage.setItem(PARAMS_KEY, '{not-json');
  const loaded = loadParams(storage);
  assert.deepEqual(loaded.params, defaultParams());
  assert.ok(loaded.errors.length > 0);
});

test('存储：越界的保存数据被逐字段拒绝', () => {
  const storage = new MemoryStorage();
  storage.setItem(PARAMS_KEY, JSON.stringify({ layerCount: 99, sunsetHue: 30 }));
  const loaded = loadParams(storage);
  assert.equal(loaded.params.layerCount, defaultParams().layerCount);
  assert.equal(loaded.params.sunsetHue, 30);
  assert.match(loaded.errors.join(' '), /layerCount/);
});

test('存储：视角草稿保存与恢复，且越界值被裁剪', () => {
  const storage = new MemoryStorage();
  assert.equal(loadViewDraft(storage), null);
  saveViewDraft({ viewX: 0.4, viewY: -0.8 }, storage);
  assert.deepEqual(loadViewDraft(storage), { viewX: 0.4, viewY: -0.8 });
  storage.setItem(VIEW_KEY, JSON.stringify({ viewX: 5, viewY: -5 }));
  assert.deepEqual(loadViewDraft(storage), { viewX: 1, viewY: -1 });
});

test('RNG：同种子序列相同，不同种子序列不同', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  const c = mulberry32(8);
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
});
