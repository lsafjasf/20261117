// 无头验证:稳态、临界事件、处置失败、种子复现、恢复确认
'use strict';
const { createSim } = require('./sim.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

const SEED = 'mangrove-42';

// 运行一整局:风暴前一天布设拦污带(将在风暴中失效),风暴后补植+收窄潮沟
function runScenario(seed) {
  const sim = createSim(seed);
  const C = sim.constants;
  const totalTicks = C.HORIZON_DAYS * C.TICKS_PER_DAY;
  let boomDeployed = false, recovered = false;
  const steadyWater = [];
  for (let i = 0; i < totalTicks; i++) {
    sim.step();
    const s = sim.getState();
    if (s.phase === 'steady' && s.day > 5 && s.day < 25) steadyWater.push(s.waterActual);
    if (!boomDeployed && s.day >= s.stormStart - 1) {
      sim.applyIntervention('boom');
      boomDeployed = true;
    }
    if (!recovered && s.phase === 'recovery') {
      sim.applyIntervention('plant');
      sim.applyIntervention('channel');
      sim.applyIntervention('boom');
      recovered = true;
    }
  }
  return { sim, state: sim.getState(), log: sim.getLog(), steadyWater };
}

console.log('== 场景运行(seed=' + SEED + ') ==');
const run1 = runScenario(SEED);
const { state, log, steadyWater } = run1;

console.log('== 1. 稳态 ==');
const wMin = Math.min(...steadyWater), wMax = Math.max(...steadyWater);
check('稳态期水位连续波动且在正常范围', wMin >= 0.05 && wMax < 1.2,
  'min=' + wMin.toFixed(2) + ' max=' + wMax.toFixed(2));
check('稳态期样本充足(连续变化)', steadyWater.length > 300, 'n=' + steadyWater.length);

console.log('== 2. 临界事件(含触发时刻) ==');
const crits = log.filter(e => e.type === 'critical');
check('至少发生一次临界阈值事件', crits.length >= 1, JSON.stringify(crits));
check('临界事件记录含触发时刻', crits.every(e => typeof e.day === 'number' && e.day > 0));

console.log('== 3. 处置失败(含触发时刻) ==');
const fails = log.filter(e => e.type === 'failure');
check('至少发生一次处置失败(拦污带风暴中断裂)', fails.length >= 1, JSON.stringify(fails));
check('处置失败记录含触发时刻', fails.every(e => typeof e.day === 'number' && e.day > 0));

console.log('== 4. 干预前后对比 ==');
const compares = log.filter(e => e.type === 'compare');
check('每次干预均有前后指标对比', compares.length >= 4, 'compares=' + compares.length);

console.log('== 5. 恢复确认(固定时间,无隐藏残留) ==');
const rec = log.filter(e => e.type === 'recovery');
check('恢复确认期结束并有结论', rec.length === 1 && state.recoveryChecked, JSON.stringify(rec));
check('恢复后无隐藏残留', state.recoveryClean === true, JSON.stringify(rec));

console.log('== 6. 九十天评估 ==');
check('完成九十天存活率评估', state.evaluated && log.some(e => e.type === 'eval'));
console.log('  存活率=' + (state.survivalRate * 100).toFixed(1) + '% 成功=' + state.success);

console.log('== 7. 同一 seed 重开复现 ==');
const run2 = runScenario(SEED);
const s1 = run1.sim.getState(), s2 = run2.sim.getState();
check('幼苗目标位置一致',
  JSON.stringify(s1.seedlings.map(s => [s.x, s.elevation])) ===
  JSON.stringify(s2.seedlings.map(s => [s.x, s.elevation])));
check('天气序列一致(逐 tick 水位复现)',
  JSON.stringify(run1.log) === JSON.stringify(run2.log) &&
  s1.waterActual === s2.waterActual && s1.turbidity === s2.turbidity);
check('事件日志完全一致(含触发时刻)', JSON.stringify(run1.log) === JSON.stringify(run2.log));

console.log('== 8. 不同 seed 产生不同布局 ==');
const run3 = runScenario('other-seed');
const s3 = run3.sim.getState();
check('不同 seed 目标位置不同',
  JSON.stringify(s1.seedlings.map(s => s.x)) !== JSON.stringify(s3.seedlings.map(s => s.x)));

console.log(failures === 0 ? '\n全部通过' : '\n失败 ' + failures + ' 项');
process.exit(failures === 0 ? 0 : 1);
