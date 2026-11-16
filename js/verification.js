(function (global) {
  'use strict';

  const SIM = global.GlazeSimulation;
  if (!SIM) throw new Error('GlazeSimulation must load before verification');

  const round = SIM.round;

  function advanceFor(sim, seconds, dt = 0.1) {
    let remaining = seconds;
    while (remaining > 1e-9) {
      const slice = Math.min(dt, remaining);
      sim._advance(slice, { force: false, source: 'validation' });
      remaining -= slice;
    }
  }

  function setParams(sim, source) {
    sim.setParameter('soakTime', 4.5, { source });
    sim.setParameter('rotation', 42, { source });
    sim.setParameter('dripSpeed', 0.6, { source });
  }

  function dippingToDrip(sim, seconds = 6.4) {
    sim.beginDip();
    advanceFor(sim, seconds);
    if (sim.phase !== 'drip') throw new Error(`Expected drip phase, got ${sim.phase}`);
  }

  function finishRemaining(sim) {
    while (sim.batch && !sim.batch.complete) {
      dippingToDrip(sim);
      const finished = sim.finishPiece({ source: 'validation' });
      if (!finished.ok) throw new Error(`Could not finish piece: ${finished.reason}`);
    }
  }

  function resultOf(sim) {
    return {
      goodCount: sim.goodCount,
      finishedCount: sim.finishedCount,
      yieldRate: round(sim.yieldRate, 4),
      peakThickness: round(sim.peakThickness),
      peakPowerW: sim.peakPowerW,
      batchSuccess: sim.batch ? sim.batch.success : false,
      batchId: sim.batch ? sim.batch.id : null,
      stopReasons: sim.batch ? sim.batch.stopReasons.slice() : [],
      pieces: sim.batch
        ? sim.batch.pieces.map((piece) => ({
            name: piece.name,
            thickness: piece.thickness,
            range: piece.range,
            status: piece.status,
            defect: piece.defect
          }))
        : []
    };
  }

  function evidenceOf(sim) {
    const latest = sim.cache[sim.cache.length - 1] || null;
    return {
      simTime: round(sim.simTime, 2),
      cacheCount: sim.cache.length,
      latestCacheTime: latest ? latest.simTime : null,
      clockAligned: Boolean(latest && Math.abs(latest.simTime - sim.simTime) < 1),
      energyKWh: round(sim.energyKWh, 5),
      eventTail: sim.events.slice(-24).map((entry) => ({
        t: entry.simTime,
        type: entry.type,
        message: entry.message,
        level: entry.level
      }))
    };
  }

  function normalScenario() {
    const sim = new SIM({ id: 'validate-normal' });
    setParams(sim, 'validation-normal');
    sim.startBatch({ id: 'VALID-NORMAL' });
    sim.beginDip();
    advanceFor(sim, 0.6);

    const beforePause = sim.simTime;
    const levelAtPause = sim.level;
    sim.pause('验收：暂停检查');
    sim.advance(0.5);
    const frozenClock = sim.simTime;
    sim.step(0.1);
    const afterStep = sim.simTime;
    const thicknessAtStep = sim.thickness;
    const pausePassed = Math.abs(frozenClock - beforePause) < 1e-9 && Math.abs(afterStep - frozenClock - 0.1) < 1e-9;
    sim.resume();
    const resumeAt = sim.simTime;

    advanceFor(sim, 5.5);
    sim.finishPiece({ source: 'validation-normal' });
    finishRemaining(sim);

    const result = resultOf(sim);
    const passed = result.batchSuccess && result.goodCount === 3 && pausePassed && evidenceOf(sim).clockAligned;
    return {
      id: 'normal',
      name: '正常生产',
      passed,
      triggerAt: round(beforePause, 2),
      triggerLabel: '正常生产 / 暂停检查',
      reading: {
        simTime: round(afterStep, 2),
        phase: 'dip',
        thickness: round(thicknessAtStep),
        level: round(levelAtPause, 2),
        pauseFrozen: Math.abs(frozenClock - beforePause) < 1e-9,
        singleStepSeconds: round(afterStep - frozenClock, 2)
      },
      recovery: {
        required: false,
        at: round(resumeAt, 2),
        result: pausePassed ? '暂停、单步与恢复均保持当前批次' : '暂停或单步时钟不一致'
      },
      anomalyLocation: result.batchSuccess ? '无' : '生产流程 / 厚度未达标',
      result,
      evidence: evidenceOf(sim)
    };
  }

  function limitScenario() {
    const sim = new SIM({ id: 'validate-limit' });
    setParams(sim, 'validation-limit');
    sim.startBatch({ id: 'VALID-LIMIT' });
    sim.beginDip();
    advanceFor(sim, 1.0);

    const attempt = sim.setParameter('soakTime', 12, { source: 'validation-limit' });
    const fault = sim.fault;
    const limitEvent = sim.events.find((entry) => entry.type === 'param-limit') || null;
    const anomaly = sim.anomalies.find((item) => item.source === 'validation-limit') || null;
    const reading = {
      simTime: fault ? fault.at : round(sim.simTime, 2),
      attempted: 12,
      currentSoakTime: sim.params.soakTime,
      thickness: fault ? fault.thickness : round(sim.thickness),
      level: fault ? fault.level : round(sim.level, 2),
      phase: fault ? fault.phase : sim.phase,
      powerW: fault ? fault.powerW : sim.currentPowerW,
      rejected: Boolean(attempt && attempt.ok === false)
    };

    const recoveryAttempt = sim.recoverEquipment({ source: 'validation-recovery' });
    sim.setParameter('soakTime', 4.5, { source: 'validation-recovery' });
    advanceFor(sim, 5.5);
    if (sim.phase !== 'drip') throw new Error(`Limit recovery did not reach drip: ${sim.phase}`);
    sim.finishPiece({ source: 'validation-recovery' });
    finishRemaining(sim);

    const result = resultOf(sim);
    const recovery = recoveryAttempt.recovery || {};
    const passed = Boolean(
      reading.rejected && fault && limitEvent && recoveryAttempt.ok &&
      result.batchSuccess && result.goodCount === 3 &&
      recovery.at >= reading.simTime
    );
    return {
      id: 'limit',
      name: '参数越限',
      passed,
      triggerAt: reading.simTime,
      triggerLabel: '浸釉时长写入 12s',
      reading,
      recovery: {
        required: true,
        at: recovery.at,
        phase: recovery.phase,
        thickness: recovery.thickness,
        level: recovery.level,
        result: recoveryAttempt.ok ? '限值拒绝后恢复设备并完成当前批次' : '恢复失败'
      },
      anomalyLocation: anomaly ? anomaly.location : '参数 / 浸釉时长',
      result,
      evidence: evidenceOf(sim),
      triggerEvent: limitEvent
    };
  }

  function stopScenario() {
    const sim = new SIM({ id: 'validate-stop' });
    setParams(sim, 'validation-stop');
    sim.startBatch({ id: 'VALID-STOP' });
    sim.beginDip();
    advanceFor(sim, 1.2);

    const stop = sim.emergencyStop('旋转电机过流', 'validation-stop');
    const fault = stop.fault;
    const reading = {
      simTime: fault.at,
      phase: fault.phase,
      thickness: fault.thickness,
      level: fault.level,
      powerW: fault.powerW,
      deviceStates: fault.devices
    };
    const recoveryAttempt = sim.recoverEquipment({ source: 'validation-recovery' });
    advanceFor(sim, 5.3);
    if (sim.phase !== 'drip') throw new Error(`Stop recovery did not reach drip: ${sim.phase}`);
    sim.finishPiece({ source: 'validation-recovery' });
    finishRemaining(sim);

    const result = resultOf(sim);
    const recovery = recoveryAttempt.recovery || {};
    const passed = Boolean(
      stop.ok && recoveryAttempt.ok && result.batchSuccess && result.goodCount === 3 &&
      result.stopReasons.includes('旋转电机过流')
    );
    return {
      id: 'stop',
      name: '设备停机',
      passed,
      triggerAt: reading.simTime,
      triggerLabel: '旋转电机过流',
      reading,
      recovery: {
        required: true,
        at: recovery.at,
        phase: recovery.phase,
        thickness: recovery.thickness,
        level: recovery.level,
        result: recoveryAttempt.ok ? '急停后恢复设备并继续同一批次' : '恢复失败'
      },
      anomalyLocation: '设备 / 旋转电机',
      result,
      evidence: evidenceOf(sim),
      triggerEvent: sim.events.find((entry) => entry.type === 'emergency-stop') || null
    };
  }

  function runAll() {
    const scenarios = [];
    const runners = [normalScenario, limitScenario, stopScenario];
    for (const runner of runners) {
      try {
        scenarios.push(runner());
      } catch (error) {
        scenarios.push({
          id: 'error',
          name: '验收执行异常',
          passed: false,
          triggerAt: null,
          triggerLabel: error.message,
          reading: {},
          recovery: { required: false, result: '未完成' },
          anomalyLocation: '验收器 / 运行时',
          result: { goodCount: 0, finishedCount: 0, yieldRate: 0, peakThickness: 0, peakPowerW: 0, batchSuccess: false, stopReasons: [] },
          evidence: {}
        });
      }
    }

    const goodCount = scenarios.reduce((sum, item) => sum + item.result.goodCount, 0);
    const finishedCount = scenarios.reduce((sum, item) => sum + item.result.finishedCount, 0);
    const stopReasons = [...new Set(scenarios.flatMap((item) => item.result.stopReasons || []))];
    const anomalies = [...new Set(scenarios.map((item) => item.anomalyLocation).filter((item) => item && item !== '无'))];
    const report = {
      schema: 'glaze-validation/v1',
      runAt: new Date().toISOString(),
      engine: 'GlazeSimulation',
      scenarios,
      summary: {
        allPassed: scenarios.length === 3 && scenarios.every((item) => item.passed),
        scenarioCount: scenarios.length,
        goodCount,
        finishedCount,
        yieldRate: finishedCount ? round(goodCount / finishedCount, 4) : 0,
        peakThickness: Math.max(...scenarios.map((item) => item.result.peakThickness || 0)),
        peakPowerW: Math.max(...scenarios.map((item) => item.result.peakPowerW || 0)),
        stopReasons,
        anomalyLocations: anomalies
      }
    };
    return report;
  }

  global.GlazeVerification = { runAll };
})(window);
