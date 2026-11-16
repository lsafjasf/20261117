/* 电动拖车仿真内核：固定步长、顺序任务、碰撞/搁浅、检查点与存档。 */
(function (G) {
  'use strict';
  const { CFG, generateWorld, currentWind, wetSurface, clone, round } = G.TowConfig;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function log(sim, msg, level) {
    const safe = String(msg);
    sim.log.push({ t: round(sim.t), msg: safe, level: level || 'info' });
    if (sim.log.length > 240) sim.log.shift();
    sim.lastMessage = safe;
  }

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds || 0));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function cargoStatesFromWorld(world) {
    return world.mission.map((m) => ({
      cargoId: m.cargoId,
      seq: m.seq,
      status: 'pending',
      x: m.pickup.x,
      y: m.pickup.y,
      heading: Math.PI / 2
    }));
  }

  function createSimulation(seed) {
    seed = Number(seed);
    if (!Number.isFinite(seed)) seed = CFG.SEED_DEFAULT;
    seed = Math.abs(Math.floor(seed)) >>> 0;
    const world = generateWorld(seed);
    const start = world.start;
    const sim = {
      seed,
      world,
      phase: 'playing',
      t: 0,
      truck: {
        x: start.x,
        y: start.y,
        heading: start.heading,
        speed: 0,
        steer: 0
      },
      input: { throttle: 0, steer: 0, brake: false },
      cargoStates: cargoStatesFromWorld(world),
      attachedId: null,
      progress: { delivered: 0, activeIndex: 0, attached: false, won: false },
      resources: {
        battery: 100,
        drawbar: 100,
        shiftLeft: CFG.SHIFT_SECONDS
      },
      stats: {
        distance: 0,
        collisions: 0,
        motorWork: 0,
        maxSpeed: 0,
        attachments: 0,
        deliveries: 0
      },
      collisionCooldown: 0,
      collisionFlash: 0,
      lastFailureReason: null,
      failure: null,
      recoveryCount: 0,
      recoveredFrom: null,
      checkpointCounter: 0,
      currentCheckpointId: null,
      checkpoints: [],
      log: [],
      lastMessage: '',
      createdAt: new Date().toISOString()
    };
    log(sim, '调试场景 seed=' + seed + ' 已生成，障碍顺序 ' + world.signature + '。按顺序拖走 3 个故障货柜。', 'info');
    createCheckpoint(sim, '任务开始');
    return sim;
  }

  function activeMission(sim) {
    return sim.world.mission[sim.progress.activeIndex] || null;
  }

  function attachedCargo(sim) {
    if (!sim.attachedId) return null;
    return sim.cargoStates.find((c) => c.cargoId === sim.attachedId) || null;
  }

  function attachedWeight(sim) {
    const cargo = attachedCargo(sim);
    if (!cargo) return 0;
    const mission = sim.world.mission.find((m) => m.cargoId === cargo.cargoId);
    return mission ? mission.weight : 0;
  }

  function loadInfo(sim) {
    const weight = attachedWeight(sim);
    const ratio = weight / 8;
    return {
      weight: round(weight),
      ratio: clamp(ratio, 0, 1),
      percent: Math.round(ratio * 100),
      cargoId: sim.attachedId,
      label: sim.attachedId ? sim.attachedId + ' · ' + weight.toFixed(1) + 't' : '空载'
    };
  }

  function cargoPose(sim, cargo) {
    if (!cargo || cargo.status !== 'attached') {
      return cargo ? { x: cargo.x, y: cargo.y, heading: cargo.heading || 0 } : null;
    }
    const angle = sim.truck.heading;
    const back = 36;
    return {
      x: sim.truck.x - Math.cos(angle) * back,
      y: sim.truck.y - Math.sin(angle) * back,
      heading: angle
    };
  }

  function syncAttachedCargo(sim) {
    const cargo = attachedCargo(sim);
    if (!cargo) return;
    const pose = cargoPose(sim, cargo);
    cargo.x = round(pose.x);
    cargo.y = round(pose.y);
    cargo.heading = round(pose.heading);
  }

  function snapshotCore(sim) {
    return {
      t: sim.t,
      truck: clone(sim.truck),
      input: clone(sim.input),
      cargoStates: clone(sim.cargoStates),
      attachedId: sim.attachedId,
      progress: clone(sim.progress),
      resources: clone(sim.resources),
      stats: clone(sim.stats),
      collisionCooldown: sim.collisionCooldown,
      collisionFlash: sim.collisionFlash,
      lastFailureReason: sim.lastFailureReason,
      failure: clone(sim.failure),
      recoveryCount: sim.recoveryCount,
      recoveredFrom: sim.recoveredFrom
    };
  }

  function createCheckpoint(sim, label) {
    sim.checkpointCounter += 1;
    const cp = {
      id: 'CP-' + String(sim.checkpointCounter).padStart(2, '0'),
      label,
      t: round(sim.t),
      delivered: sim.progress.delivered,
      createdAt: new Date().toISOString(),
      data: snapshotCore(sim)
    };
    sim.checkpoints.push(cp);
    if (sim.checkpoints.length > 12) sim.checkpoints.shift();
    sim.currentCheckpointId = cp.id;
    return cp;
  }

  function applyCore(sim, data) {
    sim.t = data.t;
    sim.truck = clone(data.truck);
    sim.input = clone(data.input || { throttle: 0, steer: 0, brake: false });
    sim.cargoStates = clone(data.cargoStates);
    sim.attachedId = data.attachedId;
    sim.progress = clone(data.progress);
    sim.resources = clone(data.resources);
    sim.stats = clone(data.stats);
    sim.collisionCooldown = data.collisionCooldown || 0;
    sim.collisionFlash = data.collisionFlash || 0;
    sim.recoveryCount = data.recoveryCount || sim.recoveryCount || 0;
    sim.recoveredFrom = data.recoveredFrom || sim.recoveredFrom || null;
  }

  function currentCheckpoint(sim) {
    if (!sim.checkpoints.length) return null;
    const found = sim.checkpoints.find((cp) => cp.id === sim.currentCheckpointId);
    return found || sim.checkpoints[sim.checkpoints.length - 1];
  }

  function restoreLatestCheckpoint(sim, id) {
    const cp = id ? sim.checkpoints.find((item) => item.id === id) : currentCheckpoint(sim);
    if (!cp) return { ok: false, reason: '没有可用检查点' };
    const failureReason = sim.lastFailureReason;
    const failure = clone(sim.failure);
    applyCore(sim, cp.data);
    sim.phase = 'playing';
    sim.lastFailureReason = failureReason;
    sim.failure = failure;
    sim.recoveredFrom = cp.id;
    sim.recoveryCount = (sim.recoveryCount || 0) + 1;
    sim.currentCheckpointId = cp.id;
    sim.input = { throttle: 0, steer: 0, brake: false };
    log(sim, '已从 ' + cp.id + '「' + cp.label + '」恢复；目标、载重与资源回到检查点。', 'recovery');
    return { ok: true, checkpoint: cp };
  }

  function isWet(sim) {
    return wetSurface(sim.world, sim.truck.x, sim.truck.y);
  }

  function collisionShapes(sim) {
    const a = sim.world.alley;
    const shapes = [
      { type: 'rect', name: '狭窄通道左墙', x: a.left - 10, y: a.top, w: 10, h: a.bottom - a.top },
      { type: 'rect', name: '狭窄通道右墙', x: a.right, y: a.top, w: 10, h: a.bottom - a.top },
      { type: 'rect', name: '狭窄通道尽头', x: a.left - 10, y: a.top - 10, w: a.right - a.left + 20, h: 10 },
      { type: 'rect', name: '西侧护岸', x: 24, y: CFG.WATER_Y, w: 16, h: CFG.WORLD_H - CFG.WATER_Y },
      { type: 'rect', name: '东侧护岸', x: CFG.WORLD_W - 40, y: CFG.WATER_Y, w: 16, h: CFG.WORLD_H - CFG.WATER_Y },
      { type: 'rect', name: '南侧护栏', x: 24, y: CFG.WORLD_H - 40, w: CFG.WORLD_W - 48, h: 16 }
    ];
    for (const o of sim.world.obstacles) {
      if (o.type === 'stack') {
        shapes.push({ ...o, type: 'rect', name: '货柜堆 ' + o.id });
      } else {
        shapes.push({ ...o, type: 'circle', radius: o.radius || 9, name: '系缆桩 ' + o.id });
      }
    }
    return shapes;
  }

  function circleRect(pos, radius, rect) {
    const nx = clamp(pos.x, rect.x, rect.x + rect.w);
    const ny = clamp(pos.y, rect.y, rect.y + rect.h);
    let dx = pos.x - nx;
    let dy = pos.y - ny;
    let d = Math.hypot(dx, dy);
    if (d >= radius) return null;
    if (d < 0.0001) {
      const left = Math.abs(pos.x - rect.x);
      const right = Math.abs(rect.x + rect.w - pos.x);
      const top = Math.abs(pos.y - rect.y);
      const bottom = Math.abs(rect.y + rect.h - pos.y);
      const min = Math.min(left, right, top, bottom);
      if (min === left) { dx = -1; dy = 0; }
      else if (min === right) { dx = 1; dy = 0; }
      else if (min === top) { dx = 0; dy = -1; }
      else { dx = 0; dy = 1; }
      d = 0;
    }
    const len = Math.hypot(dx, dy) || 1;
    return { nx: dx / len, ny: dy / len, penetration: radius - d + 0.2 };
  }

  function circleCircle(pos, radius, other) {
    const dx = pos.x - other.x;
    const dy = pos.y - other.y;
    const rr = radius + (other.radius || 9);
    const d = Math.hypot(dx, dy);
    if (d >= rr) return null;
    const len = d || 1;
    return { nx: dx / len, ny: dy / len, penetration: rr - d + 0.2 };
  }

  function hitTest(pos, radius, shape) {
    if (shape.type === 'rect') return circleRect(pos, radius, shape);
    return circleCircle(pos, radius, shape);
  }

  function resolveCollisions(sim) {
    const shapes = collisionShapes(sim);
    const points = [{ pos: sim.truck, radius: CFG.TRUCK_RADIUS, part: '拖车' }];
    const cargo = attachedCargo(sim);
    if (cargo) {
      const pose = cargoPose(sim, cargo);
      points.push({ pos: pose, radius: CFG.CARGO_RADIUS, part: '货柜' });
    }
    let worst = null;
    for (const point of points) {
      for (const shape of shapes) {
        const hit = hitTest(point.pos, point.radius, shape);
        if (hit && (!worst || hit.penetration > worst.penetration)) {
          worst = { ...hit, shape, part: point.part };
        }
      }
    }
    if (!worst) return false;
    sim.truck.x += worst.nx * worst.penetration;
    sim.truck.y += worst.ny * worst.penetration;
    const impact = Math.abs(sim.truck.speed);
    sim.truck.speed *= -0.12;
    if (impact > 8 && sim.collisionCooldown <= 0) {
      const damage = clamp(2.5 + impact * 0.12, 2.5, 18);
      sim.resources.drawbar = Math.max(0, sim.resources.drawbar - damage);
      sim.stats.collisions += 1;
      sim.collisionCooldown = 0.75;
      sim.collisionFlash = 1;
      log(sim, worst.part + '碰撞' + worst.shape.name + '，牵引杆完整性 -' + damage.toFixed(1) + '%。', 'alarm');
      if (sim.resources.drawbar <= 0) {
        fail(sim, 'drawbar', '牵引杆断裂：连续碰撞耗尽了牵引杆完整性。');
      }
    }
    return true;
  }

  function fail(sim, type, reason) {
    if (sim.phase !== 'playing') return false;
    sim.phase = 'failed';
    sim.progress.attached = !!sim.attachedId;
    sim.failure = {
      type,
      reason,
      t: round(sim.t),
      x: round(sim.truck.x),
      y: round(sim.truck.y),
      checkpointId: sim.currentCheckpointId
    };
    sim.lastFailureReason = reason;
    sim.truck.speed = 0;
    sim.input = { throttle: 0, steer: 0, brake: false };
    log(sim, '任务失败：' + reason, 'alarm');
    return true;
  }

  function step(sim, dt) {
    if (sim.phase !== 'playing') return sim;
    dt = Math.min(dt || CFG.DT, 0.1);
    sim.t += dt;
    sim.resources.shiftLeft = Math.max(0, CFG.SHIFT_SECONDS - sim.t);
    sim.collisionCooldown = Math.max(0, sim.collisionCooldown - dt);
    sim.collisionFlash = Math.max(0, sim.collisionFlash - dt * 2.4);

    const throttle = clamp(Number(sim.input.throttle) || 0, -1, 1);
    const steerInput = clamp(Number(sim.input.steer) || 0, -1, 1);
    const wet = isWet(sim);
    const cargo = attachedCargo(sim);
    const loadKg = attachedWeight(sim);
    const loadFactor = 1 + loadKg / (CFG.TRUCK_MASS * 2.15);
    const steeringLoss = 1 / (1 + loadKg / (CFG.TRUCK_MASS * 3.1));
    const traction = wet ? 0.74 : 1;
    const grip = wet ? 0.8 : 1;
    let speed = sim.truck.speed;

    if (sim.input.brake) {
      const brake = CFG.BRAKE_ACCEL / loadFactor * (wet ? 0.57 : 1);
      if (Math.abs(speed) <= brake * dt) speed = 0;
      else speed -= Math.sign(speed) * brake * dt;
    } else if (throttle > 0) {
      if (speed < 0) {
        speed = Math.min(0, speed + CFG.BRAKE_ACCEL * traction * dt);
      } else {
        const maxFwd = CFG.MAX_FORWARD / loadFactor * (wet ? 0.92 : 1);
        const accel = CFG.ENGINE_ACCEL * traction / loadFactor;
        speed = Math.min(maxFwd, speed + accel * throttle * dt);
      }
    } else if (throttle < 0) {
      if (speed > 0) {
        speed = Math.max(0, speed - CFG.BRAKE_ACCEL * traction * dt);
      } else {
        const maxRev = CFG.MAX_REVERSE / Math.sqrt(loadFactor) * (wet ? 0.9 : 1);
        speed = Math.max(-maxRev, speed - CFG.ENGINE_ACCEL * 0.58 * traction / loadFactor * (-throttle) * dt);
      }
    } else {
      const rolling = (wet ? 13 : 26) * dt;
      if (Math.abs(speed) <= rolling) speed = 0;
      else speed -= Math.sign(speed) * rolling;
    }

    const speedRatio = Math.abs(speed) / CFG.MAX_FORWARD;
    const steerTarget = steerInput * CFG.MAX_STEER * steeringLoss * (1 - speedRatio * 0.23);
    sim.truck.steer += (steerTarget - sim.truck.steer) * Math.min(1, dt * 9);
    if (Math.abs(speed) > 0.2) {
      const yaw = (speed / CFG.WHEELBASE) * Math.tan(sim.truck.steer) * grip;
      sim.truck.heading = normAngle(sim.truck.heading + yaw * dt);
    }

    const dx = Math.cos(sim.truck.heading) * speed * dt;
    const dy = Math.sin(sim.truck.heading) * speed * dt;
    sim.truck.x += dx;
    sim.truck.y += dy;
    sim.truck.speed = speed;
    sim.stats.distance += Math.abs(speed) * dt;
    sim.stats.maxSpeed = Math.max(sim.stats.maxSpeed, Math.abs(speed));
    syncAttachedCargo(sim);
    resolveCollisions(sim);

    const motorLoad = clamp(
      Math.abs(throttle) * (0.32 + loadFactor * 0.34) + Math.abs(speed) / 180 * 0.28,
      Math.abs(speed) > 0.5 ? 0.08 : 0,
      1.25
    );
    sim.stats.motorWork = motorLoad;
    const drawingPower = Math.abs(speed) > 0.5 || Math.abs(throttle) > 0.001;
    if (drawingPower) {
      sim.resources.battery = Math.max(0, sim.resources.battery - dt * (0.07 + motorLoad * 0.72));
    }

    if (sim.truck.y <= CFG.WATER_Y + 2 && sim.phase === 'playing') {
      fail(sim, 'stranded', '拖车越过码头边缘并搁浅在港池内。');
      return sim;
    }
    if (sim.resources.battery <= 0) {
      fail(sim, 'battery', '动力电池耗尽，拖车失去动力。');
      return sim;
    }
    if (sim.t >= CFG.SHIFT_SECONDS) {
      fail(sim, 'time', '班次时间耗尽，未完成三个货柜的顺序转运。');
      return sim;
    }
    if (sim.attachedId) syncAttachedCargo(sim);
    return sim;
  }

  function setInput(sim, patch) {
    if (!patch) return;
    if ('throttle' in patch) sim.input.throttle = clamp(Number(patch.throttle) || 0, -1, 1);
    if ('steer' in patch) sim.input.steer = clamp(Number(patch.steer) || 0, -1, 1);
    if ('brake' in patch) sim.input.brake = !!patch.brake;
  }

  function nearestCargoMessage(sim) {
    const active = activeMission(sim);
    if (!active) return '所有货柜都已交付。';
    let nearest = null;
    for (const cargo of sim.cargoStates) {
      const mission = sim.world.mission.find((m) => m.cargoId === cargo.cargoId);
      const d = distance(sim.truck, mission.pickup);
      if (!nearest || d < nearest.d) nearest = { cargo, d };
    }
    if (nearest && nearest.cargo.cargoId !== active.cargoId && nearest.d < CFG.HOOK_RANGE) {
      return '顺序锁定：现在必须先拖走 ' + active.cargoId + '，不能挂接 ' + nearest.cargo.cargoId + '。';
    }
    return '靠近当前目标 ' + active.cargoId + '（距离 ' + distance(sim.truck, active.pickup).toFixed(0) + '）后按 E 挂接。';
  }

  function tryAttach(sim) {
    if (sim.phase !== 'playing') return { ok: false, reason: '任务未在运行' };
    if (sim.attachedId) return { ok: false, reason: '已挂接货柜，请先完成交付' };
    const mission = activeMission(sim);
    if (!mission) return { ok: false, reason: '没有待拖运货柜' };
    const cargo = sim.cargoStates.find((c) => c.cargoId === mission.cargoId);
    const d = distance(sim.truck, mission.pickup);
    if (d > CFG.HOOK_RANGE) {
      const message = nearestCargoMessage(sim);
      log(sim, message, 'info');
      return { ok: false, reason: message };
    }
    if (Math.abs(sim.truck.speed) > 24) {
      const message = '挂接失败：车速需低于 24 km/h。';
      log(sim, message, 'alarm');
      return { ok: false, reason: message };
    }
    cargo.status = 'attached';
    sim.attachedId = cargo.cargoId;
    sim.progress.attached = true;
    sim.stats.attachments += 1;
    syncAttachedCargo(sim);
    const message = '已挂接 ' + cargo.cargoId + '（' + mission.weight.toFixed(1) + 't），载重降低加速度与转向。';
    log(sim, message, 'ok');
    createCheckpoint(sim, '已挂接 ' + cargo.cargoId);
    return { ok: true, cargoId: cargo.cargoId, message };
  }

  function tryDrop(sim) {
    if (sim.phase !== 'playing') return { ok: false, reason: '任务未在运行' };
    const cargo = attachedCargo(sim);
    if (!cargo) return { ok: false, reason: '当前没有挂接货柜' };
    const mission = activeMission(sim);
    const pose = cargoPose(sim, cargo);
    const d = distance(pose, mission.drop);
    if (d > CFG.DROP_RANGE) {
      const message = '交付失败：货柜需进入 ' + mission.drop.x + ',' + mission.drop.y + ' 标记槽（当前偏差 ' + d.toFixed(0) + '）。';
      log(sim, message, 'info');
      return { ok: false, reason: message };
    }
    if (Math.abs(sim.truck.speed) > CFG.DROP_SPEED) {
      const message = '交付失败：停车至 18 km/h 以下才能放下货柜。';
      log(sim, message, 'alarm');
      return { ok: false, reason: message };
    }
    cargo.status = 'delivered';
    cargo.x = mission.drop.x;
    cargo.y = mission.drop.y;
    cargo.heading = Math.PI / 2;
    sim.attachedId = null;
    sim.progress.attached = false;
    sim.progress.delivered += 1;
    sim.progress.activeIndex = Math.min(sim.world.mission.length, sim.progress.activeIndex + 1);
    sim.stats.deliveries += 1;
    log(sim, '货柜 ' + cargo.cargoId + ' 已按序交付（' + sim.progress.delivered + '/3）。', 'ok');
    createCheckpoint(sim, '已交付 ' + sim.progress.delivered + '/3');
    if (sim.progress.delivered >= 3) {
      sim.progress.won = true;
      sim.phase = 'won';
      sim.truck.speed = 0;
      log(sim, '任务完成：三个故障货柜按顺序转运完毕，全部目标与资源状态有效。', 'success');
      return { ok: true, won: true, message: '三个货柜全部按序交付' };
    }
    return { ok: true, won: false, message: '已交付 ' + cargo.cargoId };
  }

  function interact(sim) {
    return sim.attachedId ? tryDrop(sim) : tryAttach(sim);
  }

  function advance(sim, seconds, onStep) {
    const steps = Math.max(0, Math.round((seconds || 0) / CFG.DT));
    for (let i = 0; i < steps && sim.phase === 'playing'; i++) {
      if (onStep) onStep(sim, i);
      step(sim, CFG.DT);
    }
    return sim;
  }

  function navTarget(sim) {
    const mission = activeMission(sim);
    if (!mission) return null;
    if (sim.attachedId) {
      return { x: mission.drop.x, y: mission.drop.y, kind: 'drop', cargoId: mission.cargoId };
    }
    return { x: mission.pickup.x, y: mission.pickup.y, kind: 'pickup', cargoId: mission.cargoId };
  }

  function winLossConditions(sim) {
    return {
      win: {
        delivered: 3,
        ordered: true,
        drawbarAbove: 0,
        batteryAbove: 0,
        shiftLeftAbove: 0
      },
      loss: {
        strandedAtWater: sim.world.waterY,
        drawbarAtOrBelow: 0,
        batteryAtOrBelow: 0,
        timeAtOrAbove: CFG.SHIFT_SECONDS
      },
      current: {
        phase: sim.phase,
        delivered: sim.progress.delivered,
        activeIndex: sim.progress.activeIndex,
        attachedId: sim.attachedId,
        drawbar: round(sim.resources.drawbar),
        battery: round(sim.resources.battery),
        shiftLeft: round(sim.resources.shiftLeft)
      }
    };
  }

  function criticalState(sim) {
    return {
      seed: sim.seed,
      signature: sim.world.signature,
      truck: clone(sim.truck),
      mission: sim.world.mission.map((m) => ({
        seq: m.seq,
        cargoId: m.cargoId,
        weight: m.weight,
        pickup: { ...m.pickup },
        drop: { ...m.drop }
      })),
      obstacles: sim.world.obstacles.map((o) => ({
        id: o.id, type: o.type, x: o.x, y: o.y, order: o.order
      })),
      cargoStates: clone(sim.cargoStates),
      phase: sim.phase,
      progress: clone(sim.progress),
      resources: clone(sim.resources),
      lastFailureReason: sim.lastFailureReason,
      checkpointId: sim.currentCheckpointId,
      conditions: winLossConditions(sim)
    };
  }

  function serializeSimulation(sim) {
    return {
      schemaVersion: CFG.SAVE_VERSION,
      savedAt: new Date().toISOString(),
      state: clone(sim)
    };
  }

  function deserializeSimulation(payload) {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!parsed || parsed.schemaVersion !== CFG.SAVE_VERSION || !parsed.state) {
      throw new Error('存档版本不兼容或格式损坏');
    }
    const state = clone(parsed.state);
    if (!state.world || !Array.isArray(state.world.mission) || state.world.mission.length !== 3) {
      throw new Error('存档缺少有效任务定义');
    }
    if (!Array.isArray(state.world.obstacles) || !Array.isArray(state.cargoStates)) {
      throw new Error('存档缺少障碍或货柜状态');
    }
    const expected = G.TowConfig.worldSignature(state.world);
    if (state.world.signature !== expected) {
      throw new Error('地图签名校验失败');
    }
    if (!['playing', 'failed', 'won'].includes(state.phase)) {
      throw new Error('存档胜负状态无效');
    }
    if (!Array.isArray(state.checkpoints) || state.checkpoints.length === 0) {
      throw new Error('存档无可用检查点');
    }
    state.world.mission.forEach((m, i) => {
      if (m.seq !== i + 1 || !Number.isFinite(m.pickup.x) || !Number.isFinite(m.drop.x)) {
        throw new Error('任务顺序或目标坐标损坏');
      }
    });
    state.world.obstacles.forEach((o, i) => {
      if (o.order !== i || !Number.isFinite(o.x) || !Number.isFinite(o.y)) {
        throw new Error('障碍顺序或坐标损坏');
      }
    });
    return state;
  }

  function saveToStorage(sim, storage) {
    const target = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target) throw new Error('当前环境不支持本地存档');
    const payload = serializeSimulation(sim);
    target.setItem('quayTow.save.v1', JSON.stringify(payload));
    return payload;
  }

  function loadFromStorage(storage) {
    const target = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target) throw new Error('当前环境不支持本地存档');
    const raw = target.getItem('quayTow.save.v1');
    if (!raw) throw new Error('没有可读取的存档');
    return deserializeSimulation(raw);
  }

  function windInfo(sim) {
    return currentWind(sim.world, sim.t);
  }

  G.TowSim = {
    createSimulation,
    step,
    advance,
    setInput,
    interact,
    tryAttach,
    tryDrop,
    fail,
    activeMission,
    attachedCargo,
    cargoPose,
    loadInfo,
    navTarget,
    currentCheckpoint,
    createCheckpoint,
    restoreLatestCheckpoint,
    serializeSimulation,
    deserializeSimulation,
    saveToStorage,
    loadFromStorage,
    criticalState,
    winLossConditions,
    fmtTime,
    log
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.TowSim;
})(typeof globalThis !== 'undefined' ? globalThis : this);


