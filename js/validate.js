/* 自动化验证：稳态、临界事件、处置失败、seed 复现、恢复后残留 */
(function (G) {
  const { CFG } = G.BeeConfig;
  const Sim = G.BeeSim;

  function runUntil(sim, predicate, maxT) {
    let guard = 0;
    while (!predicate(sim) && sim.t < (maxT || 600) && guard < 10000) {
      Sim.step(sim);
      guard++;
    }
    return predicate(sim);
  }

  // 场景一：稳态 —— 松装 + 通风 + 喷淋，三箱安全授粉
  function scenarioSteady(seed) {
    const sim = Sim.createSimulation(seed);
    Sim.actions.setRoute(sim, 'A');
    Sim.actions.setArrangement(sim, 'loose');
    Sim.actions.depart(sim);
    const maxObsTemp = { value: -Infinity, t: 0 };
    while (sim.phase !== 'pollinated' && sim.phase !== 'failed' && sim.t < 400) {
      // 反应式喷淋：观测箱温接近预警才开，降温后关闭以节水
      if (sim.phase === 'transport') {
        const hottest = Math.max(...sim.observed.temp.filter((v) => v !== null));
        if (hottest >= 34 && !sim.spray && sim.water > 0) Sim.actions.toggleSpray(sim);
        if (hottest < 33 && sim.spray) Sim.actions.toggleSpray(sim);
      }
      Sim.step(sim);
      const hot = sim.observed.temp.filter((v) => v !== null);
      const hottest = hot.length ? Math.max(...hot) : -Infinity;
      if (hottest > maxObsTemp.value) { maxObsTemp.value = hottest; maxObsTemp.t = sim.t; }
    }
    runUntil(sim, (s) => s.postRunLeft === 0, 500);
    return { sim, maxObsTemp };
  }

  // 场景二：临界事件 —— 热浪触发温度告警，及时强通风+喷淋后救回
  function scenarioCritical(seed) {
    const sim = Sim.createSimulation(seed);
    Sim.actions.setRoute(sim, 'B');
    Sim.actions.setArrangement(sim, 'tight');
    Sim.actions.depart(sim);
    const heat = sim.world.events.find((e) => e.type === 'heatwave');
    const fired = { tempWarn: null, intervention: null, recovered: null };
    let intervened = false;
    while (sim.phase !== 'pollinated' && sim.phase !== 'failed' && sim.t < 400) {
      Sim.step(sim);
      for (const h of sim.alarmHistory) {
        if (h.key === 'temp' && h.to === 'warn' && fired.tempWarn === null) fired.tempWarn = h.t;
        if (h.key === 'temp' && h.to === 'ok' && intervened) fired.recovered = h.t;
      }
      // 临界处置：告警后立即强通风 + 喷淋
      if (sim.alarms.temp !== 'ok' && !intervened && sim.phase === 'transport') {
        if (!sim.vent) Sim.actions.toggleVent(sim);
        if (!sim.spray && sim.water > 0) Sim.actions.toggleSpray(sim);
        intervened = true;
        fired.intervention = sim.t;
      }
    }
    runUntil(sim, (s) => s.postRunLeft === 0, 500);
    return { sim, fired, heat };
  }

  // 场景三：处置失败 —— 紧装 + 关闭通风 + 不喷淋，热浪中过热损毁
  function scenarioFailure(seed) {
    const sim = Sim.createSimulation(seed);
    Sim.actions.setRoute(sim, 'B');
    Sim.actions.setArrangement(sim, 'tight');
    Sim.actions.depart(sim);
    sim.vent = false; // 处置错误：关闭通风
    const firstLethal = { t: null, hive: null, actualTemp: null };
    const alarmTrace = [];
    while (sim.phase !== 'failed' && sim.t < 400) {
      Sim.step(sim);
      if (sim.alarms.temp !== 'ok') alarmTrace.push({ t: sim.t, level: sim.alarms.temp });
      if (firstLethal.t === null) {
        const dead = sim.hives.find((h) => !h.alive);
        if (dead) {
          firstLethal.t = dead.lethalAt;
          firstLethal.hive = dead.id;
          firstLethal.actualTemp = dead.temp;
        }
      }
    }
    return { sim, firstLethal, alarmTrace };
  }

  // 重开复现：同 seed 的天气序列与目标分布必须一致
  // 场景四：处置失败（时间维度）—— 全程低速，错过花期窗口
  function scenarioWindowFail(seed) {
    const sim = Sim.createSimulation(seed);
    Sim.actions.setRoute(sim, 'A');
    Sim.actions.setSpeed(sim, 'slow');
    Sim.actions.depart(sim);
    const windowAlarms = [];
    while (sim.phase !== 'failed' && sim.t < 400) {
      Sim.step(sim);
      if (sim.alarms.window !== 'ok') windowAlarms.push({ t: sim.t, level: sim.alarms.window });
    }
    runUntil(sim, (s) => s.postRunLeft === 0, 500);
    return { sim, windowAlarms };
  }

  // 结束后固定观察：期间不允许出现新的告警跃迁或蜂箱状态变化
  function residualCheck(sim) {
    const historyLen = sim.alarmHistory.length;
    const aliveCount = sim.hives.filter((h) => h.alive).length;
    const startT = sim.t;
    runUntil(sim, (s) => s.postRunLeft === 0, startT + CFG.POST_RUN_TIME + 10);
    return {
      noNewAlarms: sim.alarmHistory.length === historyLen,
      noNewLoss: sim.hives.filter((h) => h.alive).length === aliveCount,
      ranFullPeriod: sim.t >= startT + CFG.POST_RUN_TIME - CFG.DT,
      endT: sim.t
    };
  }

  function scenarioRepro(seed) {
    const a = Sim.createSimulation(seed);
    const b = Sim.createSimulation(seed);
    const sameEvents = JSON.stringify(a.world.events) === JSON.stringify(b.world.events);
    const sameTargets = JSON.stringify(a.world.targets) === JSON.stringify(b.world.targets);
    const samePatches = JSON.stringify(a.world.patches) === JSON.stringify(b.world.patches);
    // 同操作序列下状态轨迹也应一致
    Sim.actions.depart(a);
    Sim.actions.depart(b);
    let diverge = null;
    for (let i = 0; i < 300; i++) {
      Sim.step(a);
      Sim.step(b);
      if (JSON.stringify(a.hives) !== JSON.stringify(b.hives) || a.t !== b.t) {
        diverge = a.t;
        break;
      }
    }
    return { sameEvents, sameTargets, samePatches, diverge, eventsA: a.world.events, targetsA: a.world.targets };
  }

  function check(name, pass, detail) {
    return { name, pass: !!pass, detail: detail || '' };
  }

  function runAll(seed) {
    seed = seed || 42;
    const checks = [];
    const steady = scenarioSteady(seed);
    const critical = scenarioCritical(seed);
    const failure = scenarioFailure(seed);
    const windowFail = scenarioWindowFail(seed);
    const repro = scenarioRepro(seed);
    const residual = residualCheck(failure.sim);

    checks.push(check('稳态：三箱安全授粉成功',
      steady.sim.phase === 'pollinated' &&
      steady.sim.hives.every((h) => h.alive) &&
      steady.sim.arrivalTime <= CFG.BLOOM_WINDOW,
      '到场 ' + Sim.fmt(steady.sim.arrivalTime) + '，峰值观测温度 ' + steady.maxObsTemp.value.toFixed(1) +
      '°C @ ' + Sim.fmt(steady.maxObsTemp.t)));

    checks.push(check('稳态：峰值观测温度低于致死实际阈值',
      steady.maxObsTemp.value < CFG.TEMP_LETHAL,
      '峰值观测 ' + steady.maxObsTemp.value.toFixed(1) + '°C < 致死 ' + CFG.TEMP_LETHAL + '°C'));

    checks.push(check('临界：热浪期间预警阈值（实际箱温 ' + CFG.TEMP_WARN + '°C）被触发',
      critical.fired.tempWarn !== null,
      '热浪窗口 ' + Sim.fmt(critical.heat.start) + '–' + Sim.fmt(critical.heat.end) +
      '，首次预警@' + (critical.fired.tempWarn !== null ? Sim.fmt(critical.fired.tempWarn) : '—')));

    checks.push(check('临界：及时处置后预警解除且任务成功',
      critical.fired.intervention !== null && critical.fired.recovered !== null &&
      critical.sim.phase === 'pollinated',
      '干预@' + Sim.fmt(critical.fired.intervention) + '，解除@' + Sim.fmt(critical.fired.recovered)));

    const failAlertT = failure.alarmTrace.find((a) => a.level === 'alert');
    checks.push(check('临界：不干预会突破告警阈值（实际箱温 ' + CFG.TEMP_ALERT + '°C）',
      !!failAlertT && failAlertT.t < failure.firstLethal.t,
      '无干预运行中 alert@' + Sim.fmt(failAlertT.t) + '，早于致死@' + Sim.fmt(failure.firstLethal.t)));

    checks.push(check('失败：错误处置导致至少一箱过热损毁',
      failure.firstLethal.t !== null && failure.sim.phase === 'failed',
      '蜂箱#' + (failure.firstLethal.hive + 1) + ' 实际温度 ' + failure.firstLethal.actualTemp.toFixed(1) +
      '°C 达致死阈值 ' + CFG.TEMP_LETHAL + '°C @ ' + Sim.fmt(failure.firstLethal.t)));

    checks.push(check('失败：告警早于损毁，记录含触发时刻',
      failure.alarmTrace.length > 0 && failure.alarmTrace[0].t <= failure.firstLethal.t,
      '首次告警@' + Sim.fmt(failure.alarmTrace[0].t) + ' 早于损毁@' + Sim.fmt(failure.firstLethal.t)));

    checks.push(check('失败：低速行驶错过花期窗口',
      windowFail.sim.phase === 'failed' && /花期窗口/.test(windowFail.sim.failReason),
      '失败原因：' + windowFail.sim.failReason + ' @ ' + Sim.fmt(windowFail.sim.t)));
    checks.push(check('窗口：超时前 ETA 告警已触发（含触发时刻）',
      windowFail.windowAlarms.length > 0 && windowFail.windowAlarms[0].t < CFG.BLOOM_WINDOW,
      '首次窗口告警@' + Sim.fmt(windowFail.windowAlarms[0].t) +
      '（' + windowFail.windowAlarms[0].level + '），早于窗口截止 ' + Sim.fmt(CFG.BLOOM_WINDOW)));

    checks.push(check('恢复后：固定运行 ' + CFG.POST_RUN_TIME + 's 无隐藏残留',
      residual.ranFullPeriod && residual.noNewAlarms && residual.noNewLoss,
      '残留观察结束@' + Sim.fmt(residual.endT) + '，新告警跃迁=' + (residual.noNewAlarms ? '无' : '有') +
      '，新损毁=' + (residual.noNewLoss ? '无' : '有')));

    checks.push(check('重开：同 seed 天气序列完全复现', repro.sameEvents,
      repro.eventsA.map((e) => e.type + ':' + e.start + '-' + e.end).join('，')));
    checks.push(check('重开：同 seed 目标分布完全复现', repro.sameTargets && repro.samePatches,
      '3 个落点 ' + JSON.stringify(repro.targetsA.map((p) => [p.x.toFixed(1), p.y.toFixed(1)]))));
    checks.push(check('重开：同操作序列状态轨迹无分叉', repro.diverge === null,
      repro.diverge === null ? '300 步完全一致' : '分叉于 t=' + repro.diverge));

    return {
      seed,
      checks,
      allPass: checks.every((c) => c.pass),
      comparisons: {
        steady: { before: steady.sim.snapshotStart, after: steady.sim.snapshotEnd },
        critical: { before: critical.sim.snapshotStart, after: critical.sim.snapshotEnd },
        failure: { before: failure.sim.snapshotStart, after: failure.sim.snapshotEnd },
        windowFail: { before: windowFail.sim.snapshotStart, after: windowFail.sim.snapshotEnd }
      }
    };
  }

  G.BeeValidate = { runAll, scenarioSteady, scenarioCritical, scenarioFailure, scenarioWindowFail, scenarioRepro };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.BeeValidate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
