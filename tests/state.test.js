import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defaultScene, extremeScene, STORAGE_KEY, SNAPSHOT_KEY } from '../src/state.js';
import { createMemoryStorage } from './mock-context.js';

test('异常参数：返回结构化原因且保留上一次可用画面', () => {
  const storage = createMemoryStorage();
  const store = createStore(storage);
  const before = JSON.stringify(store.getState());
  const layerId = store.getState().layers[0].id;

  const badNumber = store.applyLayerUpdate(layerId, { weight: 9001 });
  assert.equal(badNumber.ok, false);
  assert.match(badNumber.reason, /字重/);

  const nan = store.applyLayerUpdate(layerId, { slant: 'abc' });
  assert.equal(nan.ok, false);
  assert.match(nan.reason, /倾斜角/);

  const longText = store.applyLayerUpdate(layerId, { text: 'x'.repeat(501) });
  assert.equal(longText.ok, false);
  assert.match(longText.reason, /500/);

  const badColor = store.applyLayerUpdate(layerId, { color: 'red' });
  assert.equal(badColor.ok, false);
  assert.match(badColor.reason, /#RRGGBB/);

  assert.equal(JSON.stringify(store.getState()), before, '状态必须保持上一次可用值');
  assert.equal(JSON.stringify(store.lastValid), before);
});

test('合法更新生效并自动持久化，刷新后对象数量与位置一致', () => {
  const storage = createMemoryStorage();
  const store = createStore(storage);
  const layerId = store.getState().layers[0].id;
  store.applyLayerUpdate(layerId, {
    text: 'PERSIST CHECK',
    weight: 700,
    position: { x: 55, y: 77 }
  });
  store.applyScenePatch({ view: { zoom: 1.5, panX: 12, panY: -8, rotation: 9 } });

  assert.ok(storage.getItem(STORAGE_KEY));
  const reloaded = createStore(storage);
  const result = reloaded.restore();
  assert.equal(result.restored, true);
  const state = reloaded.getState();
  assert.equal(state.layers.length, 1);
  assert.deepEqual(state.layers[0].position, { x: 55, y: 77 });
  assert.equal(state.layers[0].weight, 700);
  assert.equal(state.layers[0].text, 'PERSIST CHECK');
  assert.deepEqual(state.view, { zoom: 1.5, panX: 12, panY: -8, rotation: 9 });
});

test('损坏存档不白屏：恢复失败并回退默认可用场景', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, '{not-json');
  const store = createStore(storage);
  const result = store.restore();
  assert.equal(result.restored, false);
  assert.ok(result.reason);
  assert.equal(store.getState().layers.length, defaultScene().layers.length);
});

test('存档中非法图层参数被拒绝并给出原因', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({
    layers: [{ ...defaultScene().layers[0], weight: 42 }]
  }));
  const store = createStore(storage);
  const result = store.restore();
  assert.equal(result.restored, false);
  assert.match(result.reason, /字重/);
});

test('显式保存写入快照，包含保存时间', () => {
  const storage = createMemoryStorage();
  const store = createStore(storage);
  const snapshot = store.saveSnapshot('manual');
  assert.ok(snapshot.savedAt);
  const parsed = JSON.parse(storage.getItem(SNAPSHOT_KEY));
  assert.equal(parsed.label, 'manual');
  assert.equal(parsed.layers.length, 1);
});

test('图层增删与顺序调整带边界保护', () => {
  const store = createStore(createMemoryStorage());
  const firstId = store.getState().layers[0].id;
  assert.equal(store.addLayer().ok, true);
  const secondId = store.getState().layers[1].id;
  assert.deepEqual(store.getState().layers.map((l) => l.id), [firstId, secondId]);
  assert.equal(store.moveLayer(secondId, -1).ok, true);
  assert.deepEqual(store.getState().layers.map((l) => l.id), [secondId, firstId]);
  assert.equal(store.moveLayer(secondId, -1).ok, false, '已在顶层不能继续上移');
  assert.equal(store.removeLayer(firstId).ok, true);
  assert.equal(store.removeLayer(secondId).ok, false, '至少保留一个图层');
});

test('重置在默认与极端两组预设间切换', () => {
  const store = createStore(createMemoryStorage());
  store.resetAll('extreme');
  assert.equal(store.getState().layers.length, extremeScene().layers.length);
  const extreme = store.getState().layers[0];
  assert.equal(extreme.weight, 900);
  assert.equal(extreme.slant, 45);
  store.resetAll('default');
  const restored = store.getState().layers[0];
  const expected = defaultScene().layers[0];
  const { id: _ignored, ...restoredWithoutId } = restored;
  const { id: _expectedId, ...expectedWithoutId } = expected;
  assert.deepEqual(restoredWithoutId, expectedWithoutId);
});

test('视角与换行宽度越界被拒绝，画面参数保持不变', () => {
  const store = createStore(createMemoryStorage());
  const before = JSON.stringify(store.getState());
  const badZoom = store.applyScenePatch({ view: { zoom: 99, panX: 0, panY: 0, rotation: 0 } });
  assert.equal(badZoom.ok, false);
  assert.match(badZoom.reason, /视角/);
  const badRotation = store.applyScenePatch({
    view: { zoom: 1, panX: 0, panY: 0, rotation: 240 }
  });
  assert.equal(badRotation.ok, false);
  const badWrap = store.applyScenePatch({ wrapWidth: 10 });
  assert.equal(badWrap.ok, false);
  assert.match(badWrap.reason, /换行宽度/);
  assert.equal(JSON.stringify(store.getState()), before);
});
