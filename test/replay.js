/* Replay determinism: two full demo runs with the same seed must match step by step. */
const assert = require('assert');
const BG = require('../src/game.js');
const BD = require('../src/demo.js');
const { Game } = BG;
const { DemoRunner } = BD;

const SEED = Number(process.argv[2]) || 20261117;

function fingerprint(g) {
  return {
    t: Number(g.time.toFixed(6)),
    x: Number(g.boat.x.toFixed(6)),
    y: Number(g.boat.y.toFixed(6)),
    h: Number(g.boat.heading.toFixed(6)),
    vx: Number(g.boat.vx.toFixed(6)),
    vy: Number(g.boat.vy.toFixed(6)),
    fuel: Number(g.fuel.toFixed(6)),
    markers: g.markersLeft,
    status: g.status,
    cables: g.world.cables.map((c) => c.marked),
    rng: g.rng.state
  };
}

function fullRun(seed) {
  const g = new Game(seed);
  const runner = new DemoRunner(g);
  const trace = [fingerprint(g)];
  let n = 0;
  while (g.status === 'running' || g.status === 'failed') {
    runner.step();
    trace.push(fingerprint(g));
    n += 1;
    if (n > 9000) throw new Error('回放超出步数上限');
  }
  return { g, trace, failures: g.failures.map((f) => f.code) };
}

const a = fullRun(SEED);
const b = fullRun(SEED);
assert.strictEqual(a.trace.length, b.trace.length, '两次运行步数不一致');
for (let i = 0; i < a.trace.length; i++) {
  assert.deepStrictEqual(b.trace[i], a.trace[i], `第 ${i} 步状态不一致`);
}
assert.strictEqual(a.g.status, 'won');
assert.ok(a.failures.includes('collision'), '演示必须包含碰撞失败');

const g = new Game(SEED);
const runner = new DemoRunner(g);
for (let i = 0; i < 140; i++) runner.step();
const saved = Game.deserialize(g.serialize());
assert.deepStrictEqual(
  JSON.parse(saved.serialize()),
  JSON.parse(g.serialize()),
  '序列化 -> 反序列化 -> 再序列化必须幂等'
);
assert.deepStrictEqual(saved.world.cables, g.world.cables);

console.log(`回放复现通过：seed=${SEED}，${a.trace.length} 个时间点逐帧一致`);
console.log(`失败顺序：${a.failures.join(' -> ')}；恢复次数：${a.g.recoveryCount}`);
console.log('存档幂等性通过：关键对象位置与胜负条件不变');
