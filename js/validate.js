/* 可复现验收：正常路线、碰撞、搁浅恢复、seed 复现、存档往返、完整重开。 */
(function (G) {
  'use strict';
  const { CFG, currentWind } = G.TowConfig;
  const Sim = G.TowSim;
  const Nav = G.TowNav;

  function check(name, pass, detail) {
    return { name, pass: !!pass, detail: detail || '' };
  }

  function ensureMissionState(sim) {
    return {
      allPending: sim.cargoStates.every((c) => c.status === 'pending'),
      resources: JSON.stringify(sim.resources),
      progress: JSON.stringify(sim.progress),
      delivered: sim.progress.delivered,
      checkpoints: sim.checkpoints.length
    };
  }

  function runNormal(seed) {
    const sim = Sim.createSimulation(seed);
    const legs = [];
    for (let stage = 0; stage < 3 && sim.phase === 'playing'; stage++) {
      let mission = Sim.activeMission(sim);
      const pickupDrive = Nav.driveTo(sim, mission.pickup, 150);
      const attach = Sim.tryAttach(sim);
      if (!attach.ok) {
        legs.push({ stage: stage + 1, pickupDrive: pickupDrive.ok, attach: false, reason: attach.reason });
        break;
      }
      if (stage === 2 && sim.attachedId) {
        Nav.reverseToward(sim, { x: sim.truck.x, y: 430 }, 38);
      }
      mission = Sim.activeMission(sim);
      const dropDrive = Nav.driveTo(sim, mission.drop, 230);
      const drop = Sim.tryDrop(sim);
      legs.push({
        stage: stage + 1,
        cargoId: mission.cargoId,
        pickupDrive: pickupDrive.ok,
        dropDrive: dropDrive.ok,
        delivered: drop.ok,
        reason: drop.reason || ''
      });
      if (!drop.ok) break;
    }
    return { sim, legs };
  }

  function runPartial(seed) {
    const sim = Sim.createSimulation(seed);
    const mission = Sim.activeMission(sim);
    Nav.driveTo(sim, mission.pickup, 100);
    Sim.tryAttach(sim);
    Nav.driveTo(sim, mission.drop, 140);
    Sim.tryDrop(sim);
    return sim;
  }

  function collisionScenario(seed) {
    const sim = Sim.createSimulation(seed);
    const startY = sim.truck.y;
    sim.truck.heading = Math.PI / 2;
    let steps = 0;
    while (sim.phase === 'playing' && sim.stats.collisions === 0 && steps++ < 600) {
      Sim.setInput(sim, { throttle: 0.8, steer: 0, brake: false });
      Sim.step(sim, CFG.DT);
    }
    return {
      sim,
      collided: sim.stats.collisions > 0,
      damage: 100 - sim.resources.drawbar,
      traveledSouth: sim.truck.y - startY
    };
  }

  function recoveryScenario(seed) {
    const sim = runPartial(seed);
    const beforeFail = Sim.currentCheckpoint(sim);
    const deliveredBefore = sim.progress.delivered;
    sim.truck.heading = -Math.PI / 2;
    sim.truck.x = 360;
    let guard = 0;
    while (sim.phase === 'playing' && guard++ < 1200) {
      Sim.setInput(sim, { throttle: 1, steer: 0, brake: false });
      Sim.step(sim, CFG.DT);
    }
    const failedReason = sim.lastFailureReason || '';
    const failedType = sim.failure ? sim.failure.type : '';
    const restore = Sim.restoreLatestCheckpoint(sim);
    return {
      sim,
      beforeFail,
      deliveredBefore,
      failedReason,
      failedType,
      restore,
      restoredDelivered: sim.progress.delivered,
      restoredResourceMatch: beforeFail &&
        JSON.stringify(sim.resources) === JSON.stringify(beforeFail.data.resources),
      failureKeptVisible: sim.lastFailureReason === failedReason,
      recoveryCount: sim.recoveryCount
    };
  }

  function deterministicScenario(seed) {
    const a = Sim.createSimulation(seed);
    const b = Sim.createSimulation(seed);
    const c = Sim.createSimulation(seed + 1);
    Sim.setInput(a, { throttle: 0.45, steer: 0.35, brake: false });
    Sim.setInput(b, { throttle: 0.45, steer: 0.35, brake: false });
    for (let i = 0; i < 600; i++) {
      Sim.step(a, CFG.DT);
      Sim.step(b, CFG.DT);
    }
    return {
      sameWorld: JSON.stringify(a.world) === JSON.stringify(b.world),
      sameMissionOrder: JSON.stringify(a.world.mission.map((m) => m.cargoId)) ===
        JSON.stringify(b.world.mission.map((m) => m.cargoId)),
      sameObstacleOrder: JSON.stringify(a.world.obstacles.map((o) => o.id)) ===
        JSON.stringify(b.world.obstacles.map((o) => o.id)),
      sameTrajectory: JSON.stringify(Sim.criticalState(a)) === JSON.stringify(Sim.criticalState(b)),
      differentSeed: a.world.signature !== c.world.signature,
      signature: a.world.signature
    };
  }

  function saveLoadScenario(seed) {
    const sim = Sim.createSimulation(seed);
    const mission = Sim.activeMission(sim);
    Nav.driveTo(sim, mission.pickup, 100);
    Sim.tryAttach(sim);
    Sim.setInput(sim, { throttle: 0.3, steer: -0.2, brake: false });
    for (let i = 0; i < 90; i++) Sim.step(sim, CFG.DT);
    const before = Sim.criticalState(sim);
    const payload = Sim.serializeSimulation(sim);
    const loaded = Sim.deserializeSimulation(JSON.parse(JSON.stringify(payload)));
    const after = Sim.criticalState(loaded);
    return {
      sim,
      loaded,
      before,
      after,
      exact: JSON.stringify(before) === JSON.stringify(after),
      checkpointCount: loaded.checkpoints.length,
      conditions: loaded.winLossConditions ? loaded.winLossConditions() : Sim.winLossConditions(loaded)
    };
  }

  function restartScenario(seed) {
    const initial = Sim.createSimulation(seed);
    const expected = ensureMissionState(initial);
    const played = runPartial(seed);
    const reset = Sim.createSimulation(seed);
    const actual = ensureMissionState(reset);
    return {
      initial,
      played,
      reset,
      expected,
      actual,
      fullReset: actual.allPending &&
        actual.resources === expected.resources &&
        actual.progress === expected.progress &&
        actual.checkpoints === 1 &&
        reset.phase === 'playing' &&
        reset.lastFailureReason === null,
      sameWorld: JSON.stringify(initial.world) === JSON.stringify(reset.world)
    };
  }

  function debugScenario(seed) {
    const sim = Sim.createSimulation(seed);
    const mission = Sim.activeMission(sim);
    const path = Nav.findPath(sim.world, sim.truck, mission.pickup, 25);
    return {
      seed,
      signature: sim.world.signature,
      missionOrder: sim.world.mission.map((m) => m.cargoId),
      obstacleOrder: sim.world.obstacles.map((o) => o.id + ':' + o.type),
      path,
      load: Sim.loadInfo(sim),
      wind: currentWind(sim.world, sim.t),
      conditions: Sim.winLossConditions(sim)
    };
  }

  function runAll(seed) {
    seed = Number(seed) || CFG.SEED_DEFAULT;
    const normal = runNormal(seed);
    const collision = collisionScenario(seed);
    const recovery = recoveryScenario(seed);
    const deterministic = deterministicScenario(seed);
    const saveLoad = saveLoadScenario(seed);
    const restart = restartScenario(seed);
    const debug = debugScenario(seed);
    const checks = [];

    checks.push(check('正常路线：三个货柜按序交付并获胜',
      normal.sim.phase === 'won' && normal.sim.progress.delivered === 3,
      '用时 ' + Sim.fmtTime(normal.sim.t) + '，碰撞 ' + normal.sim.stats.collisions +
      ' 次，牵引杆 ' + normal.sim.resources.drawbar.toFixed(1) + '%'));
    checks.push(check('正常路线：每段均完成挂接与交付',
      normal.legs.length === 3 && normal.legs.every((l) => l.attach !== false && l.delivered),
      normal.legs.map((l) => l.cargoId || ('第' + l.stage + '段')).join(' → ')));
    checks.push(check('碰撞：真实碰撞会损伤牵引杆',
      collision.collided && collision.damage > 0,
      '牵引杆损伤 ' + collision.damage.toFixed(1) + '%，向南行驶 ' + collision.traveledSouth.toFixed(0)));
    checks.push(check('失败：可驶出码头边缘并记录搁浅原因',
      recovery.failedType === 'stranded' && /搁浅/.test(recovery.failedReason),
      recovery.failedReason));
    checks.push(check('恢复：从最近检查点恢复且货柜进度不回退',
      recovery.restore.ok && recovery.restoredDelivered === recovery.deliveredBefore,
      '失败前已交付 ' + recovery.deliveredBefore + '/3，恢复后 ' + recovery.restoredDelivered + '/3'));
    checks.push(check('恢复：检查点资源一致，失败原因仍可见',
      recovery.restoredResourceMatch && recovery.failureKeptVisible && recovery.recoveryCount === 1,
      '恢复次数 ' + recovery.recoveryCount + '，最近失败已保留'));
    checks.push(check('复现：同 seed 地图、任务和障碍顺序一致',
      deterministic.sameWorld && deterministic.sameMissionOrder && deterministic.sameObstacleOrder,
      '签名 ' + deterministic.signature + '，任务 ' + debug.missionOrder.join(' → ')));
    checks.push(check('复现：同 seed 同输入 600 步轨迹无分叉',
      deterministic.sameTrajectory,
      deterministic.sameTrajectory ? '600 步状态完全一致' : '轨迹发生分叉'));
    checks.push(check('复现：不同 seed 生成不同地图签名',
      deterministic.differentSeed,
      'seed=' + seed + ' → ' + deterministic.signature));
    checks.push(check('存档：保存后载入，关键对象位置与胜负条件不变',
      saveLoad.exact && saveLoad.checkpointCount > 1,
      '载入后检查点 ' + saveLoad.checkpointCount + ' 个，有载重状态逐字段一致'));
    checks.push(check('重开：目标、载重进度、资源与检查点全部重置',
      restart.fullReset,
      '交付 ' + restart.actual.delivered + '/3，电池与牵引杆恢复初始值，检查点重置为 1 个'));
    checks.push(check('重开：同 seed 地图仍一致',
      restart.sameWorld,
      'seed=' + seed + ' 地图签名 ' + restart.reset.world.signature));
    checks.push(check('调试场景：路径、载重与当前风向可读取',
      debug.path.length >= 2 && debug.load.percent === 0 && Number.isFinite(debug.wind.angle),
      debug.wind.label + ' ' + debug.wind.speed + ' m/s，路径 ' + debug.path.length + ' 点'));

    return {
      seed,
      signature: debug.signature,
      allPass: checks.every((c) => c.pass),
      checks,
      comparisons: {
        normal: {
          before: { delivered: 0, battery: 100, drawbar: 100 },
          after: {
            delivered: normal.sim.progress.delivered,
            battery: Number(normal.sim.resources.battery.toFixed(1)),
            drawbar: Number(normal.sim.resources.drawbar.toFixed(1))
          }
        },
        collision: {
          before: { drawbar: 100, collisions: 0 },
          after: {
            drawbar: Number(collision.sim.resources.drawbar.toFixed(1)),
            collisions: collision.sim.stats.collisions
          }
        },
        recovery: {
          before: { delivered: recovery.deliveredBefore, reason: recovery.failedReason },
          after: {
            delivered: recovery.restoredDelivered,
            checkpoint: recovery.restore.checkpoint ? recovery.restore.checkpoint.id : null
          }
        }
      },
      debug
    };
  }

  G.TowValidate = {
    runAll,
    runNormal,
    runPartial,
    collisionScenario,
    recoveryScenario,
    deterministicScenario,
    saveLoadScenario,
    restartScenario,
    debugScenario
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.TowValidate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
