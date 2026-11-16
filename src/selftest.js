/* Node self-test: deterministic reproducibility, failure/recovery, save-load. */
const assert = require('assert');
const BG = require('./game.js');
const BD = require('./demo.js');
const { Game, generateWorld, depthAt, pointAtDepth, CONFIG } = BG;
const { DemoRunner, runGroundingDemo } = BD;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

const SEED = 20261117;

test('同一 seed 生成完全相同的地图、任务与障碍顺序', () => {
  const a = new Game(SEED);
  const b = new Game(SEED);
  assert.deepStrictEqual(clone(a.world), clone(b.world));
  const orders = a.world.obstacles.map((o) => o.order);
  assert.deepStrictEqual(orders, a.world.obstacles.map((_, i) => i));
  assert.strictEqual(a.world.cables.length, 3);
  for (const cable of a.world.cables) assert.strictEqual(cable.marked, false);
  const g2 = new Game(SEED + 1);
  assert.notDeepStrictEqual(clone(g2.world), clone(a.world));
});

test('演示场景完成正常路线，包含一次碰撞失败与检查点恢复', () => {
  const g = new Game(SEED);
  const runner = new DemoRunner(g);
  const status = runner.run();
  assert.strictEqual(status, 'won');
  assert.strictEqual(g.cablesMarked, 3);
  assert.strictEqual(g.markersLeft, CONFIG.MAX_MARKERS - 3);
  const collision = g.failures.find((f) => f.code === 'collision');
  assert.ok(collision, '应至少发生一次碰撞');
  assert.strictEqual(collision.recovered, true);
  assert.ok(g.recoveryCount >= 1);
  const recoverActions = runner.actions.filter((x) => x.type === 'recover' && x.ok);
  assert.ok(recoverActions.length >= 1);
  const drops = runner.actions.filter((x) => x.type === 'drop');
  assert.strictEqual(drops.length, 3);
  assert.ok(drops.every((x) => x.ok));
  assert.ok(g.fuel > 0 && g.fuel < CONFIG.FUEL_MAX);
});

test('碰撞后从最近检查点恢复：位置、燃料、标记与 RNG 回滚', () => {
  const g = new Game(SEED);
  const runner = new DemoRunner(g);
  while (g.status === 'running') {
    runner.step();
    if (runner.phase && runner.phase.kind === 'crash') break;
  }
  const cpBefore = clone(g.checkpoints[g.checkpoints.length - 1]);
  while (g.status === 'running') runner.step();
  assert.strictEqual(g.status, 'failed');
  assert.strictEqual(g.lastFailure.code, 'collision');
  const r = g.recover();
  assert.ok(r.ok);
  assert.strictEqual(g.status, 'running');
  assert.strictEqual(g.boat.x, cpBefore.boat.x);
  assert.strictEqual(g.boat.y, cpBefore.boat.y);
  assert.strictEqual(g.fuel, cpBefore.fuel);
  assert.strictEqual(g.markersLeft, cpBefore.markersLeft);
  assert.strictEqual(g.rng.state, cpBefore.rngState);
});

test('搁浅场景可稳定触发 grounded 失败并可恢复', () => {
  const g = new Game(SEED);
  const grounded = runGroundingDemo(g);
  assert.ok(grounded);
  assert.strictEqual(g.lastFailure.code, 'grounded');
  assert.ok(g.lastFailure.reason.includes('搁浅'));
  const r = g.recover();
  assert.ok(r.ok);
  assert.strictEqual(g.status, 'running');
  assert.ok(depthAt(g.world, g.boat.x, g.boat.y) > CONFIG.DRAFT);
});

test('错误标记消耗资源并记录原因，耗尽后失败', () => {
  const g = new Game(SEED);
  const r1 = g.dropMarker();
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(g.markersLeft, CONFIG.MAX_MARKERS - 1);
  assert.strictEqual(g.lastFailure.code, 'wrong-marker');
  assert.strictEqual(g.status, 'running');
  for (let i = 0; i < CONFIG.MAX_MARKERS; i++) g.dropMarker();
  assert.strictEqual(g.status, 'failed');
  assert.strictEqual(g.lastFailure.code, 'no-marker');
  const recover = g.recover();
  assert.ok(recover.ok);
  assert.strictEqual(g.markersLeft, g.checkpoints[0].markersLeft);
});

test('存档/读档后关键对象位置、状态与胜负条件不变', () => {
  const g = new Game(SEED);
  const runner = new DemoRunner(g);
  for (let i = 0; i < 90; i++) runner.step();
  const mid = g.serialize();
  const g2 = Game.deserialize(mid);
  assert.deepStrictEqual(clone(g2.world), clone(g.world));
  assert.deepStrictEqual(clone(g2.boat), clone(g.boat));
  assert.strictEqual(g2.status, g.status);
  assert.strictEqual(g2.fuel, g.fuel);
  assert.strictEqual(g2.markersLeft, g.markersLeft);
  for (let i = 0; i < 60; i++) {
    if (g.status === 'failed' || g2.status === 'failed') {
      g.recover();
      g2.recover();
    }
    if (g.status !== 'running') break;
    runner.step();
    const r2 = new DemoRunner(g2);
    r2.phaseIndex = runner.phaseIndex;
    r2.phases = runner.phases;
    r2.step();
  }
  assert.deepStrictEqual(clone(g2.boat), clone(g.boat));
  assert.strictEqual(g2.status, g.status);
  assert.strictEqual(g2.cablesMarked, g.cablesMarked);
  const g3 = Game.deserialize(g.serialize());
  assert.deepStrictEqual(clone(g3.world.cables), clone(g.world.cables));
});

test('失败状态存档读档后仍可从检查点恢复', () => {
  const g = new Game(SEED);
  const runner = new DemoRunner(g);
  while (g.status === 'running') {
    runner.step();
    if (g.status === 'failed') break;
  }
  assert.strictEqual(g.status, 'failed');
  const cp = clone(g.checkpoints[g.checkpoints.length - 1]);
  const g2 = Game.deserialize(g.serialize());
  assert.strictEqual(g2.status, 'failed');
  const r = g2.recover();
  assert.ok(r.ok);
  assert.strictEqual(g2.boat.x, cp.boat.x);
  assert.strictEqual(g2.boat.y, cp.boat.y);
});

test('浅水区大推力被钳制且不会立即失败', () => {
  const g = new Game(SEED);
  const point = pointAtDepth(g.world, CONFIG.DRAFT + 0.2, CONFIG.SHALLOW_DEPTH - 0.2);
  assert.ok(point, '应能找到可航行的浅水点');
  g.boat.x = point.x;
  g.boat.y = point.y;
  assert.ok(depthAt(g.world, g.boat.x, g.boat.y) < CONFIG.SHALLOW_DEPTH);
  assert.ok(depthAt(g.world, g.boat.x, g.boat.y) > CONFIG.DRAFT);
  const st = g.step(1);
  assert.strictEqual(st, 'running');
  assert.strictEqual(g.boat.thrust, CONFIG.SHALLOW_MAX_THRUST);
  assert.ok(g.inShallow);
});

test('重新开始恢复全部目标与资源，而非只重置船', () => {
  const g = new Game(SEED);
  new DemoRunner(g).run();
  assert.strictEqual(g.status, 'won');
  g.reset(SEED);
  assert.strictEqual(g.status, 'running');
  assert.strictEqual(g.markersLeft, CONFIG.MAX_MARKERS);
  assert.strictEqual(g.fuel, CONFIG.FUEL_MAX);
  assert.strictEqual(g.cablesMarked, 0);
  assert.strictEqual(g.recoveryCount, 0);
  assert.strictEqual(g.checkpoints.length, 1);
  assert.strictEqual(g.failures.length, 0);
  for (const cable of g.world.cables) assert.strictEqual(cable.marked, false);
  const fresh = new Game(SEED);
  assert.deepStrictEqual(clone(g.world), clone(fresh.world));
});

test('同 seed 下风向与水流序列逐帧一致', () => {
  const a = new Game(SEED);
  const b = new Game(SEED);
  for (let i = 0; i < 120; i++) {
    a.step(0.5);
    b.step(0.5);
    assert.deepStrictEqual(clone(a.wind), clone(b.wind));
    assert.deepStrictEqual(clone(a.current), clone(b.current));
  }
  assert.strictEqual(a.boat.x, b.boat.x);
  assert.strictEqual(a.boat.y, b.boat.y);
});

test('静态世界生成不依赖调用次数（RNG 顺序一致）', () => {
  const w1 = generateWorld(SEED);
  new Game(999);
  const w2 = generateWorld(SEED);
  assert.deepStrictEqual(clone(w1), clone(w2));
});

console.log(`\n${passed} 项自检通过${process.exitCode ? '（存在失败）' : ''}`);
