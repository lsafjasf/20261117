/* 引擎自动化测试：固定 seed 复现、正常路线、碰撞/搁浅、恢复、存档、重开 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const { buildWorld } = require('../src/world.js');

const SEED = 20261117;

function runAutopilot(s, opts = {}) {
  let wp = 1;
  const maxFrames = opts.maxFrames || 60 * 240;
  const cap = opts.maxThrottle || 1;
  let frames = 0;
  while (s.status === 'playing' && frames < maxFrames) {
    const d = Math.hypot(s.rover.x - s.world.waypoints[wp].x,
      s.rover.y - s.world.waypoints[wp].y);
    if (d < 40 && wp < 7) wp++;
    E.step(s, 1 / 60, E.autopilotInput(s, wp, cap));
    frames++;
  }
  return { frames, wp };
}

function drive(s, input, seconds) {
  let frames = Math.round(seconds * 60);
  while (frames-- > 0 && s.status === 'playing') {
    E.step(s, 1 / 60, typeof input === 'function' ? input(s) : input);
  }
  return s;
}

test('同 seed 下地图、任务与障碍顺序完全一致', () => {
  const a = buildWorld(SEED);
  const b = buildWorld(SEED);
  const c = buildWorld(SEED + 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify({ ...a, rngState: undefined })),
    JSON.parse(JSON.stringify({ ...b, rngState: undefined }))
  );
  assert.deepEqual(a.obstacles.map(o => o.id), b.obstacles.map(o => o.id));
  assert.deepEqual(a.obstacles.map(o => o.order), b.obstacles.map(o => o.order));
  assert.notDeepEqual(
    a.obstacles.map(o => [o.x, o.y]),
    c.obstacles.map(o => [o.x, o.y])
  );
  assert.equal(a.pods.length, 3);
  assert.equal(a.windSchedule.length, b.windSchedule.length);
});

test('同 seed、同输入下模拟轨迹逐帧一致', () => {
  const s1 = E.createGame(SEED);
  const s2 = E.createGame(SEED);
  const input = { throttle: 1, left: 1 };
  for (let i = 0; i < 300; i++) {
    E.step(s1, 1 / 60, input);
    E.step(s2, 1 / 60, input);
  }
  assert.deepEqual(
    { x: s1.rover.x, y: s1.rover.y, vx: s1.rover.vx, vy: s1.rover.vy,
      battery: s1.battery, time: s1.time },
    { x: s2.rover.x, y: s2.rover.y, vx: s2.rover.vx, vy: s2.rover.vy,
      battery: s2.battery, time: s2.time }
  );
});

test('暂停时物理与资源完全冻结，解除后继续', () => {
  const s = E.createGame(SEED);
  drive(s, { throttle: 1 }, 2);
  s.paused = true;
  const frozen = JSON.parse(JSON.stringify({ rover: s.rover, battery: s.battery, time: s.time }));
  drive(s, { throttle: 1 }, 2);
  assert.deepEqual({ rover: s.rover, battery: s.battery, time: s.time }, frozen);
  s.paused = false;
  drive(s, { throttle: 1 }, 1);
  assert.ok(s.time > frozen.time);
});

test('障碍顺序字段 order 与数组顺序一致且同 seed 复现', () => {
  const a = buildWorld(SEED);
  a.obstacles.forEach((o, i) => assert.equal(o.order, i));
  const b = buildWorld(SEED);
  assert.deepEqual(
    a.obstacles.map(o => [o.id, o.kind, o.x, o.y, o.radius]),
    b.obstacles.map(o => [o.id, o.kind, o.x, o.y, o.radius])
  );
});

test('正常路线：三舱交付并返回着陆器，判定胜利', () => {
  const s = E.createGame(SEED);
  runAutopilot(s);
  assert.equal(s.status, 'won');
  assert.equal(s.world.pods.every(p => p.delivered), true);
  assert.deepEqual(s.delivered, { water: 3, seeds: 3 });
  assert.equal(s.cargo.water, 0);
  assert.equal(s.cargo.seeds, 0);
  assert.ok(s.battery > 0);
  assert.ok(s.lastFailure === null);
});

test('载荷越重制动距离越长', () => {
  const s = E.createGame(SEED);
  const loaded = E.brakingDistance(s, 200);
  s.cargo.water = 0; s.cargo.seeds = 0;
  const empty = E.brakingDistance(s, 200);
  assert.ok(loaded > empty);
  assert.ok(E.roverMass({ cargo: { water: 3, seeds: 3 } })
    > E.roverMass({ cargo: { water: 0, seeds: 0 } }));
});

test('高速撞岩触发失败，并可从最近检查点恢复继续', () => {
  const s = E.createGame(SEED);
  // 先开到一号中继检查点，留下恢复点
  drive(s, () => E.autopilotInput(s, 1, 1), 6);
  assert.ok(s.checkpoints.find(c => c.id === 'cp1').visited);
  const rock = s.world.rocks[0];
  const angle = Math.atan2(rock.y - s.rover.y, rock.x - s.rover.x);
  s.rover.heading = angle;
  s.rover.vx = Math.cos(angle) * 230;
  s.rover.vy = Math.sin(angle) * 230;
  drive(s, { throttle: 1 }, 3);
  assert.equal(s.status, 'failed');
  assert.match(s.lastFailure.reason, /碰撞/);
  const cpPos = { ...s.checkpoints.find(c => c.id === s.lastCheckpointId) };
  const ok = E.continueFromCheckpoint(s);
  assert.equal(ok, true);
  assert.equal(s.status, 'playing');
  assert.ok(Math.hypot(s.rover.x - cpPos.x, s.rover.y - cpPos.y) <= 56);
  assert.equal(s.lastFailure === null, true);
});

test('陨坑滞留触发搁浅，恢复操作可解除失败', () => {
  const s = E.createGame(SEED);
  const crater = s.world.craters[0];
  s.rover.x = crater.x; s.rover.y = crater.y;
  s.rover.vx = 0; s.rover.vy = 0;
  // 每帧钉在坑心，模拟陷坑后无法驶出
  drive(s, () => {
    s.rover.x = crater.x; s.rover.y = crater.y;
    s.rover.vx = 0; s.rover.vy = 0;
    return { throttle: 0 };
  }, 6);
  assert.equal(s.status, 'failed');
  assert.match(s.lastFailure.reason, /搁浅/);
  assert.equal(E.continueFromCheckpoint(s), true);
  assert.equal(s.status, 'playing');
});

test('坑缘高速穿越触发滑坡失败', () => {
  const s = E.createGame(SEED);
  const crater = s.world.craters[1];
  const a = crater.radius - 6;
  s.rover.x = crater.x - a; s.rover.y = crater.y;
  s.rover.heading = 0;
  s.rover.vx = 200; s.rover.vy = 0;
  drive(s, { throttle: 1 }, 2);
  assert.equal(s.status, 'failed');
  assert.match(s.lastFailure.reason, /滑坡/);
});

test('电量耗尽失败：脱离着陆器持续耗电', () => {
  const s = E.createGame(SEED);
  s.rover.x = 1200; s.rover.y = 800;
  s.battery = 3;
  drive(s, { throttle: 1 }, 5);
  assert.equal(s.status, 'failed');
  assert.match(s.lastFailure.reason, /电量/);
});

test('保存后重新载入：对象位置与胜负条件不变', () => {
  const s = E.createGame(SEED);
  runAutopilot(s, { maxFrames: 60 * 20 });
  const json = E.saveState(s);
  const restored = E.loadState(json);
  assert.deepEqual(restored.rover, s.rover);
  assert.deepEqual(restored.world.obstacles, s.world.obstacles);
  assert.deepEqual(restored.world.pods, s.world.pods);
  assert.equal(restored.status, s.status);
  assert.equal(restored.battery, s.battery);
  // 载入后继续模拟，与原状态继续模拟结果一致
  E.step(s, 1 / 60, E.autopilotInput(s, 7, 1));
  E.step(restored, 1 / 60, E.autopilotInput(restored, 7, 1));
  assert.deepEqual(restored.rover, s.rover);
});

test('胜利后存档/读档仍保持胜利判定', () => {
  const s = E.createGame(SEED);
  runAutopilot(s);
  const restored = E.loadState(E.saveState(s));
  assert.equal(restored.status, 'won');
  assert.deepEqual(restored.delivered, s.delivered);
});

test('重新开始恢复全部目标与资源，而非只重置位置', () => {
  const s = E.createGame(SEED);
  runAutopilot(s, { maxFrames: 60 * 25 });
  const usedBattery = s.battery;
  const deliveredCount = s.world.pods.filter(p => p.delivered).length;
  assert.ok(deliveredCount > 0 || usedBattery < 220);
  E.restart(s);
  assert.equal(s.status, 'playing');
  assert.deepEqual(s.cargo, { water: 3, seeds: 3, capacity: 3 });
  assert.equal(s.battery, 220);
  assert.equal(s.world.pods.every(p => p.delivered === false), true);
  assert.equal(s.checkpoints.filter(c => c.visited).length, 1);
  assert.equal(s.checkpoints[0].id, 'cp0');
  assert.equal(s.checkpointSnapshots.length, 1);
  assert.equal(s.rover.x, s.world.lander.x);
  assert.equal(s.lastFailure, null);
});
