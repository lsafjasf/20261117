/* Node 无头测试：node tests/headless.test.js */
const assert = require('assert');
const path = require('path');
const { WetlandSim } = require(path.join(__dirname, '..', 'js', 'sim.js'));
const { ScenarioDirector } = require(path.join(__dirname, '..', 'js', 'director.js'));

function run(mode, seed) {
  const sim = new WetlandSim(seed || 'WETLAND-2026', { mode: mode });
  const director = new ScenarioDirector();
  const trace = [];
  while (!sim.finished) {
    director.beforeStep(sim);
    sim.step(1);
    director.afterStep(sim);
    if (sim.hour % (24 * 30) === 0) {
      trace.push({
        day: sim.hour / 24,
        level: +sim.state.levelCm.toFixed(1),
        birds: Math.round(sim.state.birds),
        species: sim.state.species,
        carbon: +sim.state.carbon.toFixed(2),
        pollution: +sim.state.pollution.toFixed(1),
      });
    }
  }
  return { sim, director, trace };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  PASS  ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures++;
    console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
  }
}

console.log('== 1. 验证模式完整跑批 ==');
const r1 = run('validation');
const sim1 = r1.sim;
console.table(r1.trace);
const cp1 = Object.fromEntries(sim1.checkpoints.map((c) => [c.id, c]));
check('稳态检查点通过', cp1.steady.status === 'pass',
  'status=' + cp1.steady.status + ' stable=' + sim1._steadyMetrics.stable);
check('至少一次 CRITICAL 临界阈值', cp1.critical.status === 'pass',
  'trigger@D' + (cp1.critical.time / 24) + ' latched=' +
  JSON.stringify(sim1.latchedCritical));
check('至少一次处置失败', cp1.failure.status === 'fail',
  'trigger@D' + (cp1.failure.time / 24));
check('恢复后 30 天残留观察通过', cp1.recovery.status === 'pass',
  'recover@D' + (sim1.droughtRecoveredAt / 24));
check('年末双指标达标', sim1.verdict.success === true,
  JSON.stringify(sim1.verdict));

const failSnap = sim1.snapshots.find((s) => s.type === 'harvest' && s.result === 'failure');
check('失败处置含 7 天后对比快照', failSnap && failSnap.settled &&
  failSnap.after.birds < failSnap.before.birds,
  failSnap ? ('birds ' + Math.round(failSnap.before.birds) + ' → ' +
  Math.round(failSnap.after.birds)) : 'missing');

console.log('== 2. 同 seed 复现性 ==');
const a = new WetlandSim('SEED-X', { mode: 'free' });
const b = new WetlandSim('SEED-X', { mode: 'free' });
assert.deepStrictEqual(
  a.weather.map((w) => [w.tempC, w.rainMmH, w.windMs]),
  b.weather.map((w) => [w.tempC, w.rainMmH, w.windMs]),
  '天气序列不一致');
assert.deepStrictEqual(a.sites, b.sites, '目标位点不一致');
const da = new ScenarioDirector();
const db = new ScenarioDirector();
while (!a.finished) { da.beforeStep(a); a.step(1); da.afterStep(a); }
while (!b.finished) { db.beforeStep(b); b.step(1); db.afterStep(b); }
check('重开后天气与目标分布一致', JSON.stringify(a.weather) === JSON.stringify(b.weather) &&
  JSON.stringify(a.sites) === JSON.stringify(b.sites));
check('重开后逐小时状态完全一致', JSON.stringify(a.state) === JSON.stringify(b.state) &&
  JSON.stringify(a.observations) === JSON.stringify(b.observations),
  'birds=' + Math.round(a.state.birds) + '/' + Math.round(b.state.birds));

console.log('== 3. 不同 seed 产生不同分布 ==');
const c = new WetlandSim('SEED-Y', { mode: 'free' });
check('不同 seed 位点不同',
  JSON.stringify(a.sites[0]) !== JSON.stringify(c.sites[0]));
check('不同 seed 天气不同', a.weather[100].rainMmH !== c.weather[100].rainMmH);

console.log('== 4. 自由模式（无自动补水）干旱必触发临界 ==');
const r4 = run('free');
const cp4 = Object.fromEntries(r4.sim.checkpoints.map((c) => [c.id, c]));
check('自由模式仍触发 CRITICAL', cp4.critical.status === 'pass',
  'trigger@D' + (cp4.critical.time / 24));
check('自由模式无脚本化收割失败', cp4.failure.status === 'pending');

console.log(failures === 0 ? '\n全部测试通过 ✔' : '\n有 ' + failures + ' 项失败 ✘');
process.exit(failures === 0 ? 0 : 1);
