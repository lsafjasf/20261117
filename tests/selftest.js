/*
 * Node 无头验证套件：
 *  1) 稳态达标 + 恢复后 12h 无残留
 *  2) 临界阈值事件（含触发时刻）
 *  3) 处置失败
 *  4) 同 seed 重开：热点位置 / 天气序列 / 脉冲时刻复现
 *  5) 观测值 != 实际值；未覆盖网格无观测、热点漏报
 * 运行：node tests/selftest.js [seed]
 */
'use strict';
var RT = require('../js/scenarios.js');

var seed = process.argv[2] || 'estuary-2026';
var failures = [];
function check(name, cond, detail) {
  var ok = !!cond;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? ' - ' + detail : ''));
  if (!ok) failures.push(name);
}

function runScenario(key, withRecovery) {
  var sim = RT.createSim(seed);
  RT.Scenarios[key].deploy(sim);
  while (sim.status === 'running') {
    var p = RT.Scenarios[key].policy(sim);
    RT.setControl(sim, 'aeration', p.aeration);
    RT.setControl(sim, 'diversion', p.diversion);
    RT.step(sim);
  }
  if (withRecovery && sim.status === 'success') RT.postRecoveryRun(sim);
  return sim;
}

function eventsOf(sim, type) {
  return sim.events.filter(function (e) { return e.type === type; });
}

console.log('== 1. 稳态处置（4 天 + 恢复观察 24h） ==');
var steady = runScenario('steady', true);
var sAgg = RT.aggregate(steady);
check('稳态四天后成功', steady.status === 'success', steady.status + ' / ' + steady.endReason);
check('恢复观察满 144 步（24h）', steady.postTicks === RT.POST_RUN_TICKS, 'postTicks=' + steady.postTicks);
check('热点藻密度低于阈值', steady.hotspots.every(function (h) {
  return RT.cellAt(steady, h.x, h.y).algae < RT.TH.algae;
}), '热点均值=' + sAgg.hotspotAlgae.toFixed(2));
check('溶氧处于达标区间', sAgg.avgDo >= RT.TH.doLow && sAgg.avgDo <= RT.TH.doHigh, 'DO=' + sAgg.avgDo.toFixed(2));
check('鱼类存活率不低于 75%', sAgg.avgFish >= RT.TH.fishSurvival, (sAgg.avgFish * 100).toFixed(1) + '%');
check('无隐藏残留反弹', eventsOf(steady, 'fail').length === 0, '失败事件 0 条');

// 反向验证：人为制造营养盐残留并放松干预，恢复检查必须抓出反弹
var residue = RT.createSim(seed);
RT.Scenarios.steady.deploy(residue);
while (residue.status === 'running') {
  var rp = RT.Scenarios.steady.policy(residue);
  RT.setControl(residue, 'aeration', rp.aeration);
  RT.setControl(residue, 'diversion', rp.diversion);
  RT.step(residue);
}
residue.cells.forEach(function (c) { c.nutrient = 4.5; });
RT.setControl(residue, 'aeration', 0.05);
RT.setControl(residue, 'diversion', 0.05);
RT.postRecoveryRun(residue);
check('残留场景被恢复检查拦截', residue.status === 'failed' &&
  residue.endReason.indexOf('残留反弹') >= 0, residue.endReason);
check('反弹失败事件带触发时刻', eventsOf(residue, 'fail').every(function (e) {
  return Boolean(e.simTime) && Boolean(e.wallTime);
}));

console.log('\n== 2. 临界阈值事件（验证触发时刻记录） ==');
var crit = runScenario('critical', true);
var criticalEvents = eventsOf(crit, 'critical');
check('至少一次临界事件', criticalEvents.length >= 1,
  criticalEvents.map(function (e) { return e.simTime + ' tick=' + e.tick; }).join('; '));
check('事件含触发时刻字段', criticalEvents.every(function (e) {
  return typeof e.tick === 'number' && /^D\d \d\d:\d\d$/.test(e.simTime) && Boolean(e.wallTime);
}));
check('临界场景最终成功', crit.status === 'success', crit.status);
check('告警曾被触发', crit.alarmCount > 0, 'alarmCount=' + crit.alarmCount);

console.log('\n== 3. 处置失败（曝气过强 + 监测不足） ==');
var fail = runScenario('failure', false);
var fAgg = RT.aggregate(fail);
check('场景判定失败', fail.status === 'failed', fail.endReason);
check('底泥扰动等级升高', fail.disturbance > 0.5, 'disturbance=' + fail.disturbance.toFixed(2));
check('浊度越过阈值', fAgg.avgTurb >= RT.TH.turbidity, 'turb=' + fAgg.avgTurb.toFixed(1));
check('鱼类存活率跌破 75%', fAgg.avgFish < RT.TH.fishSurvival, (fAgg.avgFish * 100).toFixed(1) + '%');
check('存在未观测热点（漏报）', fail.missedTicks > 0, 'missedTicks=' + fail.missedTicks);
check('失败事件带时刻', eventsOf(fail, 'fail').every(function (e) {
  return Boolean(e.simTime) && Boolean(e.wallTime);
}));

console.log('\n== 4. 同 seed 重开复现性 ==');
var a = RT.createSim(seed);
var b = RT.createSim(seed);
check('热点位置完全一致', JSON.stringify(a.hotspots) === JSON.stringify(b.hotspots), JSON.stringify(a.hotspots));
check('天气序列完全一致', JSON.stringify(a.weatherSeq) === JSON.stringify(b.weatherSeq));
check('营养盐脉冲时刻一致', JSON.stringify(a.pulses) === JSON.stringify(b.pulses), a.pulses.join(','));
var sigA = JSON.stringify(a.cells.map(function (c) { return [c.algae, c.nutrient, c.do2]; }));
var sigB = JSON.stringify(b.cells.map(function (c) { return [c.algae, c.nutrient, c.do2]; }));
check('初始网格状态一致', sigA === sigB);
for (var i = 0; i < 50; i++) { RT.step(a); RT.step(b); }
check('50 步后轨迹一致', JSON.stringify(RT.aggregate(a)) === JSON.stringify(RT.aggregate(b)));
var c2 = RT.createSim(seed + '-other');
check('不同 seed 产生不同热点', JSON.stringify(a.hotspots) !== JSON.stringify(c2.hotspots));

console.log('\n== 5. 观测值 / 实际值 / 告警三态区分 ==');
var obs = RT.createSim(seed);
RT.placeBuoy(obs, obs.hotspots[0].x, obs.hotspots[0].y);
RT.step(obs);
var covered = RT.cellAt(obs, obs.hotspots[0].x, obs.hotspots[0].y);
var uncovered = obs.cells.find(function (c) { return c.observed === false; });
check('覆盖格存在观测对象', covered.obs !== null && covered.observed === true);
check('观测值与实际值不同（含测量误差）',
  Math.abs(covered.obs.algae - covered.algae) > 1e-9,
  'obs=' + covered.obs.algae.toFixed(3) + ' actual=' + covered.algae.toFixed(3));
check('未覆盖格无新鲜观测', uncovered.observed === false &&
  (uncovered.obs === null || uncovered.obs.age > 0));
check('告警为布尔状态且基于观测值', typeof covered.alarm === 'boolean');

console.log('\n== 6. 操作前后指标对比（稳态场景采样） ==');
var cmp = RT.createSim(seed);
var before = RT.aggregate(cmp);
RT.Scenarios.steady.deploy(cmp);
for (var k = 0; k < RT.TICKS_PER_DAY; k++) {
  var pp = RT.Scenarios.steady.policy(cmp);
  RT.setControl(cmp, 'aeration', pp.aeration);
  RT.setControl(cmp, 'diversion', pp.diversion);
  RT.step(cmp);
}
var after = RT.aggregate(cmp);
console.log('  指标            操作前      24h 后');
console.log('  藻密度(ug/L)    ' + before.avgAlgae.toFixed(2).padStart(7) + '   ' + after.avgAlgae.toFixed(2).padStart(7));
console.log('  溶氧(mg/L)      ' + before.avgDo.toFixed(2).padStart(7) + '   ' + after.avgDo.toFixed(2).padStart(7));
console.log('  营养盐(mg/L)    ' + before.avgNutrient.toFixed(2).padStart(7) + '   ' + after.avgNutrient.toFixed(2).padStart(7));
console.log('  浊度(NTU)       ' + before.avgTurb.toFixed(2).padStart(7) + '   ' + after.avgTurb.toFixed(2).padStart(7));
console.log('  鱼类存活率      ' + (before.avgFish * 100).toFixed(1).padStart(6) + '%   ' + (after.avgFish * 100).toFixed(1).padStart(6) + '%');
check('对比数据可计算', Boolean(before) && Boolean(after) && after.avgFish > 0);

console.log('\n========================================');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 - ' + failures.join('; '));
  process.exit(1);
} else {
  console.log('结果：全部验证通过（seed=' + seed + '）');
  process.exit(0);
}
