import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world.js';
import {
  createInitialState,
  step,
  restart,
  resumeFromCheckpoint,
  serialize,
  validateSavedState,
  getHud,
  isWarehouseDelivered,
} from '../src/engine.js';
import { runAutopilot } from '../src/autopilot.js';

const SEED = 'postal-2026';

function runFrames(world, state, frames, inputFactory) {
  const input = { propel: true, steer: 0, throttle: 1 };
  for (let i = 0; i < frames; i++) {
    if (inputFactory) Object.assign(input, inputFactory(world, state, i));
    step(world, state, input);
  }
  return state;
}

function runAi(world, state, maxFrames = 60 * 200) {
  for (let i = 0; i < maxFrames; i++) {
    const ai = runAutopilot(world, state);
    step(world, state, { ...ai, throttle: ai.throttle ?? 1 });
    if (state.status === 'won' || state.status === 'failed') break;
  }
  return state;
}

test('同 seed 生成完全一致的地图、障碍与任务顺序', () => {
  const a = generateWorld(SEED);
  const b = generateWorld(SEED);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

  const c = generateWorld('other-seed');
  assert.notDeepEqual(
    a.obstacles.map((o) => [o.x, o.y]),
    c.obstacles.map((o) => [o.x, o.y])
  );
  assert.deepEqual(
    a.warehouses.map((w) => w.id),
    ['warehouse-0', 'warehouse-1', 'warehouse-2']
  );
  assert.deepEqual(
    a.obstacles.map((o) => o.id),
    [...a.obstacles.keys()].map((i) => `rock-${i}`)
  );
});

test('自动驾驶完成一次正常路线，三封信全部送达', () => {
  const world = generateWorld(SEED);
  const state = runAi(world, createInitialState(world));
  assert.equal(state.status, 'won');
  assert.equal(state.deliveredCount, 3);
  assert.ok(state.letters.every((l) => l.delivered));
  assert.ok(state.boat.hull > 0);
});

test('撞岩石会受损并记录失败原因', () => {
  const world = generateWorld(SEED);
  const state = createInitialState(world);
  const rock = world.obstacles[0];
  state.boat.x = rock.x - 40;
  state.boat.y = rock.y;
  state.boat.angle = 0;
  let hits = 0;
  for (let i = 0; i < 60 * 10 && state.status === 'running'; i++) {
    step(world, state, { propel: true, steer: 0, throttle: 1 });
    if (state.events.at(-1)?.kind === 'damage') hits += 1;
  }
  assert.ok(hits >= 1);
  assert.ok(state.boat.hull < 100);
});

test('搁浅后按住倒车可以恢复航行', () => {
  const world = generateWorld(SEED);
  const state = createInitialState(world);
  const c = 12;
  state.boat.x = c * world.TILE + world.TILE / 2;
  state.boat.y = world.centers[c] + (world.waterHalfTiles - 0.2) * world.TILE;
  runFrames(world, state, 1, () => ({ propel: false, steer: 0, throttle: 0 }));
  assert.equal(state.boat.grounded, true);

  const hullBefore = state.boat.hull;
  runFrames(world, state, 120, () => ({
    propel: false,
    backward: true,
    steer: 0,
    throttle: 0,
  }));
  assert.equal(state.boat.grounded, false);
  assert.equal(state.recoveryCount, 1);
  assert.equal(state.boat.hull, hullBefore);
});

test('失败后从最近检查点继续，位置与资源回到快照', () => {
  const world = generateWorld(SEED);
  const state = runAi(world, createInitialState(world), 60 * 40);
  assert.ok(state.checkpointSnapshot);
  const snap = state.checkpointSnapshot;

  state.boat.hull = 0;
  state.status = 'failed';
  state.failReason = '强制失败用于测试';
  state.lastFailReason = state.failReason;
  resumeFromCheckpoint(world, state);

  assert.equal(state.status, 'running');
  assert.equal(state.failReason, null);
  assert.equal(state.lastFailReason, '强制失败用于测试');
  assert.deepEqual({ x: state.boat.x, y: state.boat.y }, { x: snap.boat.x, y: snap.boat.y });
  assert.equal(state.boat.hull, snap.boat.hull);
  assert.equal(state.boat.fuel, snap.boat.fuel);
  assert.equal(state.deliveredCount, snap.deliveredCount);
});

test('保存后重新载入，关键对象位置与胜负条件不变', () => {
  const world = generateWorld(SEED);
  const state = runAi(world, createInitialState(world), 60 * 60);
  const raw = serialize(world, state);
  const restored = validateSavedState(world, raw);
  assert.ok(restored);

  assert.deepEqual(
    { x: restored.boat.x, y: restored.boat.y, angle: restored.boat.angle },
    { x: state.boat.x, y: state.boat.y, angle: state.boat.angle }
  );
  assert.equal(restored.status, state.status);
  assert.equal(restored.deliveredCount, state.deliveredCount);
  assert.deepEqual(
    restored.letters.map((l) => l.delivered),
    state.letters.map((l) => l.delivered)
  );

  // 载入后的状态继续模拟，和未存档的原状态逐帧一致。
  const twin = validateSavedState(world, serialize(world, state));
  const input = { propel: true, steer: 0.2, throttle: 0.8 };
  for (let i = 0; i < 120; i++) {
    step(world, restored, input);
    step(world, twin, input);
  }
  assert.deepEqual(
    { x: restored.boat.x, y: restored.boat.y },
    { x: twin.boat.x, y: twin.boat.y }
  );
  assert.equal(restored.status, twin.status);

  const otherWorld = generateWorld('different');
  assert.equal(validateSavedState(otherWorld, raw), null);
  assert.equal(validateSavedState(world, 'not-json'), null);
  assert.equal(validateSavedState(world, JSON.stringify({ version: 99, seed: world.seed, state: {} })), null);
});

test('重开恢复全部目标和资源，而不是只重置船的位置', () => {
  const world = generateWorld(SEED);
  const state = runAi(world, createInitialState(world), 60 * 60);
  state.boat.fuel = 12;
  state.boat.hull = 30;
  const fresh = restart(world);

  assert.equal(fresh.deliveredCount, 0);
  assert.ok(fresh.letters.every((l) => !l.delivered));
  assert.equal(fresh.boat.fuel, 320);
  assert.equal(fresh.boat.hull, 100);
  assert.equal(fresh.recoveryCount, 0);
  assert.deepEqual(fresh.checkpointsVisited, [0]);
  assert.equal(isWarehouseDelivered(fresh, 'warehouse-0'), false);

  const hud = getHud(world, fresh);
  assert.equal(hud.delivered, 0);
  assert.equal(hud.fuel, 320);
  assert.equal(hud.hull, 100);
});

test('暂停时世界与帧号完全冻结', () => {
  const world = generateWorld(SEED);
  const state = createInitialState(world);
  runFrames(world, state, 60, () => ({ propel: true, steer: 0, throttle: 1 }));
  const frameBefore = state.frame;
  const posBefore = { ...state.boat };
  state.status = 'paused';
  runFrames(world, state, 120, () => ({ propel: true, steer: 0, throttle: 1 }));
  assert.equal(state.frame, frameBefore);
  assert.deepEqual({ x: state.boat.x, y: state.boat.y }, { x: posBefore.x, y: posBefore.y });
});
