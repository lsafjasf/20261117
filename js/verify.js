// 自动验证:稳态 / 临界事件 / 处置失败 / seed 复现 / 恢复后残留检查
(function (global) {
  'use strict';
  const SIM = global.RanchSim || require('./sim.js');
  const { Sim, CONFIG } = SIM;

  function autoManage(sim) {
    if (sim.waterPointsLeft > 0) {
      for (const p of sim.pastures) if (!p.waterPoint) { sim.placeWater(p.id); break; }
    }
    for (const h of sim.herds) {
      const cur = sim.pastures[h.pasture];
      const waterLow = cur.waterPoint && cur.water < 35;
      if (cur.grass < 38 || waterLow || cur.pollution > 50) {
        let best = null;
        for (const p of sim.pastures) {
          if (p.id === cur.id) continue;
          const score = p.grass + (p.waterPoint && p.water > 30 ? 20 : 0) - p.pollution;
          if (!best || score > best.score) best = { p, score };
        }
        if (best) sim.moveHerd(h.id, best.p.id);
      }
    }
  }

  function runHours(sim, hours, policy) {
    for (let t = 0; t < hours && !sim.finished; t++) {
      sim.step(1);
      if (policy && sim.hour % 24 === 0) policy(sim);
    }
  }

  function snap(sim) {
    const m = sim.metrics();
    return {
      time: sim.timeStr(),
      grass: +m.grass.toFixed(1), water: +m.water.toFixed(1),
      pollution: +m.pollution.toFixed(1), diversity: +m.diversity.toFixed(1),
      waterCoverage: m.waterCoverage,
    };
  }

  function runVerification(seed) {
    const report = [];
    const check = (name, pass, detail) => report.push({ name, pass, detail });
    const sim = new Sim(seed || 'ranch-verify');

    // 1. 稳态:自动轮牧 10 天,草量波动应有限
    const samples = [];
    for (let d = 0; d < 10 && !sim.finished; d++) {
      runHours(sim, 24, autoManage);
      samples.push(sim.metrics().grass);
    }
    const swing = Math.max(...samples) - Math.min(...samples);
    const steady = samples[samples.length - 1];
    check('稳态运行', swing < 25 && steady > 30,
      `10天轮牧,草量波动 ${swing.toFixed(1)},末值 ${steady.toFixed(1)} @${sim.timeStr()}`);

    // 2. 临界事件:停止轮牧,全部畜群压到同一块草地,直到触发告警
    const pastureP = sim.herds[0].pasture;
    for (const h of sim.herds) {
      if (h.pasture !== pastureP) sim.moveHerd(h.id, pastureP);
    }
    const logStart = sim.logs.length;
    let guard = 0;
    while (!Object.keys(sim.activeAlerts).length && guard++ < 24 * 20 && !sim.finished) sim.step(1);
    const alertLog = sim.logs.slice(logStart).find(l => l.type === 'alert');
    check('临界阈值告警', !!alertLog,
      alertLog ? `触发于 ${alertLog.time}:${alertLog.msg}` : '未触发告警');

    // 3. 处置失败:目标草地被啃到草量不足后,转入请求应被拒绝
    const worst = sim.pastures[pastureP];
    let g2 = 0;
    while (worst.grass >= CONFIG.minGrassForMove && g2++ < 24 * 15 && !sim.finished) sim.step(1);
    const before = snap(sim);
    const beforeP = { grass: worst.grass, water: worst.water, pollution: worst.pollution, diversity: worst.diversity };
    const evac = sim.moveHerd(1, sim.pastures.reduce((a, b) => (a.grass > b.grass ? a : b)).id);
    const res = sim.moveHerd(1, worst.id);
    runHours(sim, 24);
    const after = snap(sim);
    const failLogged = sim.logs.some(l => l.type === 'fail' && l.msg.includes('处置失败'));
    check('处置失败拦截', !res.ok && failLogged && worst.grass < CONFIG.minGrassForMove,
      `疏散${evac.ok ? '成功' : '失败'},回转被拒:${res.reason || ''} @${sim.timeStr()};` +
      `草地${worst.name} 草量 ${beforeP.grass.toFixed(1)}→${worst.grass.toFixed(1)},` +
      `水位 ${beforeP.water.toFixed(1)}→${worst.water.toFixed(1)},污染 ${beforeP.pollution.toFixed(1)}→${worst.pollution.toFixed(1)},` +
      `物种 ${beforeP.diversity.toFixed(1)}→${worst.diversity.toFixed(1)}`);
    check('操作前后指标对比', true,
      `全局:草量 ${before.grass}→${after.grass},水位 ${before.water}→${after.water},` +
      `污染 ${before.pollution}→${after.pollution},物种 ${before.diversity}→${after.diversity}`);

    // 4. seed 复现:天气序列与目标分布必须一致
    const weatherA = sim.weather.join(',');
    const targetsA = JSON.stringify(sim.targets);
    sim.reset(sim.seed);
    const sameWeather = sim.weather.join(',') === weatherA;
    const sameTargets = JSON.stringify(sim.targets) === targetsA;
    check('同seed重开复现', sameWeather && sameTargets,
      `天气序列${sameWeather ? '一致' : '不一致'},目标分布${sameTargets ? '一致' : '不一致'} @${sim.timeStr()}`);

    // 5. 恢复 + 固定时间残留检查
    runHours(sim, 24 * 8, autoManage);
    const recoverMark = sim.logs.length;
    runHours(sim, 24 * 5, autoManage); // 恢复后继续固定 5 天
    const tail = sim.logs.slice(recoverMark);
    const hidden = tail.filter(l => l.type === 'alert' || l.type === 'fail');
    const mEnd = sim.metrics();
    check('恢复后无隐藏残留', hidden.length === 0 && mEnd.pollution <= CONFIG.thresholds.pollution,
      `恢复后连续运行5天至 ${sim.timeStr()},残留告警/失败 ${hidden.length} 条,污染 ${mEnd.pollution.toFixed(1)}`);

    return { report, logs: sim.logs, pass: report.every(r => r.pass) };
  }

  const api = { runVerification };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.RanchVerify = api;
})(typeof window !== 'undefined' ? window : globalThis);
