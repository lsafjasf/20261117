// 矿井通风协同模拟引擎（无 DOM 依赖，可在浏览器与 Node 中运行）

export const CONFIG = Object.freeze({
  targetSafeSeconds: 600, // 两区域同时保持安全的目标时长（10 分钟）
  failAfterUnsafeSeconds: 30, // 连续不安全超过该时长即任务失败
  gasCritical: 60, // 瓦斯立即失败阈值
  timeoutSeconds: 12, // 单侧无输入超时，进入保护状态
  energy: { max: 100, drain: 2.6, recharge: 3.2, unlockAt: 12 },
  fan: { min: 0, max: 100, start: 50, rate: 38, safeMin: 45, safeMax: 85, protectTarget: 62 },
  door: { min: 20, max: 80, start: 50, rate: 22, protectTarget: 50 },
  flow: { factor: 1.2, safeMin: 30, safeMax: 52, target: 40, backflow: 2 },
  pressure: { safeMin: 22, safeMax: 50, spikeRate: 55 },
  gas: { safeMax: 25, rise: 4.2, vent: 0.35, backflowBoost: 6 },
  disturbance: { minGap: 22, maxGap: 40, resistanceMin: 0.7, resistanceMax: 1.5 },
});

export const STATIONS = Object.freeze({
  upstream: {
    id: 'upstream',
    label: '上游风机',
    player: '玩家 1',
    keys: ['W', 'S'],
    actions: ['fanUp', 'fanDown'],
  },
  downstream: {
    id: 'downstream',
    label: '下游风门',
    player: '玩家 2',
    keys: ['←', '→'],
    actions: ['doorLeft', 'doorRight'],
  },
});

const ACTION_OWNER = {
  fanUp: 'upstream',
  fanDown: 'upstream',
  doorLeft: 'downstream',
  doorRight: 'downstream',
};

const LOG_LIMIT = 120;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function makeZone(name) {
  return {
    name,
    flow: 0,
    pressure: 0,
    gas: 8,
    resistance: 1,
    safe: false,
    backflow: false,
    spike: false,
    unsafeReasons: [],
    unsafeTime: 0,
  };
}

function makeStation() {
  return {
    connected: true,
    protected: false,
    lastInputAt: -Infinity,
    human: true,
    auto: false,
    held: {}, // 当前按住的动作
    conflict: false,
  };
}

export class VentilationGame {
  constructor(opts = {}) {
    this.rng = opts.rng || Math.random;
    this.targetSafeSeconds = opts.targetSafeSeconds ?? CONFIG.targetSafeSeconds;
    this.timeoutSeconds = opts.timeoutSeconds ?? CONFIG.timeoutSeconds;
    this.reset();
  }

  reset() {
    this.status = 'ready'; // ready | running | paused | succeeded | failed
    this.mode = 'normal'; // normal | debug
    this.timeScale = 1;
    this.humanStation = null; // 单人调试时人类操控的工位
    this.simTime = 0;
    this.safeElapsed = 0;
    this.unsafeRun = 0;
    this.totalUnsafe = 0;
    this.fan = CONFIG.fan.start;
    this.door = CONFIG.door.start;
    this.energy = CONFIG.energy.max;
    this.energyLocked = false;
    this.zones = [makeZone('A 工作面'), makeZone('B 工作面')];
    this.stations = { upstream: makeStation(), downstream: makeStation() };
    this.events = [];
    this.log = [];
    this.stats = {
      spikes: 0,
      backflows: 0,
      conflicts: 0,
      protections: 0,
      disturbance: 0,
      rejectedInput: 0,
      unsafeBySide: { upstream: 0, downstream: 0, shared: 0 },
    };
    this.nextDisturbance = this._randGap();
    this._disturbTimer = this.nextDisturbance;
    this._lastDt = 1 / 60;
    this._aggression = 1.6;
    this._holdTime = { upstream: 0, downstream: 0 };
    this._lastConflictAt = -Infinity;
    this._lastZonePressure = [0, 0];
    this.failReason = '';
    return this.getState();
  }

  _updateTimeouts() {
    for (const id of ['upstream', 'downstream']) {
      const st = this.stations[id];
      if (
        !st.connected ||
        st.protected ||
        st.auto ||
        !st.human
      ) {
        continue;
      }
      const idleFrom = st.lastInputAt === -Infinity ? 0 : st.lastInputAt;
      if (this.simTime - idleFrom > this.timeoutSeconds) {
        this._enterTimeoutProtection(id);
      }
    }
  }

  _applyActuators(dt) {
    const up = this.stations.upstream;
    const down = this.stations.downstream;
    this._holdTime ??= { upstream: 0, downstream: 0 };
    const upHeld = Object.values(up.held).some(Boolean);
    const downHeld = Object.values(down.held).some(Boolean);
    this._holdTime.upstream = upHeld && !up.protected && !up.auto
      ? this._holdTime.upstream + dt : 0;
    this._holdTime.downstream = downHeld && !down.protected && !down.auto
      ? this._holdTime.downstream + dt : 0;
    const simultaneous = upHeld && downHeld;
    const longestHold = Math.max(this._holdTime.upstream, this._holdTime.downstream);
    // 常规点按(<0.25s)不产生尖峰；持续猛调或两侧同时操作逐步压低尖峰阈值
    this._aggression = clamp(
      1.6 - longestHold * 1.8 - (simultaneous ? 0.75 : 0),
      0.28,
      1.6,
    );

    // 共享能量：操作消耗，静置恢复；耗尽则执行器锁定，回到阈值后解锁
    const anyoneActing = upHeld || downHeld;
    if (this.energyLocked) {
      this.energy = clamp(this.energy + CONFIG.energy.recharge * dt, 0, CONFIG.energy.max);
      if (this.energy >= CONFIG.energy.unlockAt) {
        this.energyLocked = false;
        this.record('resource', 'shared', '共享能量恢复，执行器重新解锁');
      }
    } else if (anyoneActing) {
      this.energy = clamp(this.energy - CONFIG.energy.drain * dt, 0, CONFIG.energy.max);
      if (this.energy <= 0) {
        this.energyLocked = true;
        up.held = {};
        down.held = {};
        this.record('resource', 'shared', '共享能量耗尽：双方执行器临时锁定');
      }
    } else {
      this.energy = clamp(this.energy + CONFIG.energy.recharge * dt, 0, CONFIG.energy.max);
    }

    // 风机（仅上游职责）
    if (up.protected || up.auto) {
      this._approach('fan', CONFIG.fan.protectTarget, CONFIG.fan.rate * 0.7 * dt);
      if (up.auto) this._debugAssistFan(dt);
    } else if (!this.energyLocked) {
      if (up.held.fanUp) this._approach('fan', CONFIG.fan.max, CONFIG.fan.rate * dt);
      if (up.held.fanDown) this._approach('fan', CONFIG.fan.min, CONFIG.fan.rate * dt);
    }

    // 风门（仅下游职责）
    if (down.protected || down.auto) {
      this._approach('door', CONFIG.door.protectTarget, CONFIG.door.rate * 0.7 * dt);
      if (down.auto) this._debugAssistDoor(dt);
    } else if (!this.energyLocked) {
      if (down.held.doorLeft) this._approach('door', CONFIG.door.min, CONFIG.door.rate * dt);
      if (down.held.doorRight) this._approach('door', CONFIG.door.max, CONFIG.door.rate * dt);
    }
  }

  _approach(prop, target, delta) {
    const cur = this[prop];
    this[prop] = clamp(cur + clamp(target - cur, -delta, delta),
      prop === 'fan' ? CONFIG.fan.min : CONFIG.door.min,
      prop === 'fan' ? CONFIG.fan.max : CONFIG.door.max);
  }

  // 单人调试：自动侧的简易 PID 风格辅助（只操作自己的执行器）
  _debugAssistFan(dt) {
    const avgGas = (this.zones[0].gas + this.zones[1].gas) / 2;
    const target = clamp(
      CONFIG.fan.protectTarget + (avgGas - 10) * 1.2 + (this.unsafeRun > 2 ? 10 : 0),
      CONFIG.fan.min + 5,
      CONFIG.fan.max - 5,
    );
    this._approach('fan', target, CONFIG.fan.rate * 0.9 * dt);
  }

  _debugAssistDoor(dt) {
    const diff = this.zones[0].gas - this.zones[1].gas;
    const target = clamp(CONFIG.door.protectTarget - diff * 1.5,
      CONFIG.door.min + 2, CONFIG.door.max - 2);
    this._approach('door', target, CONFIG.door.rate * 0.9 * dt);
  }

  _applyDisturbances() {
    if (this._disturbTimer === undefined) this._disturbTimer = this.nextDisturbance;
    this._disturbTimer -= this._lastDt; // 与实际帧长挂钩，避免帧率耦合
    if (this._disturbTimer <= 0) {
      const d = CONFIG.disturbance;
      for (const z of this.zones) {
        z.resistance = d.resistanceMin + this.rng() * (d.resistanceMax - d.resistanceMin);
      }
      this._disturbTimer = this._randGap();
      this.stats.disturbance++;
      this.record('disturbance', 'shared', '巷道阻力扰动出现，需要两侧协同重新配风');
    }
  }

  _applyPhysics(dt) {
    const F = CONFIG.flow;
    const P = CONFIG.pressure;
    const G = CONFIG.gas;
    const totalAir = this.fan * F.factor;
    const shareA = this.door / 100;
    const shares = [shareA, 1 - shareA];

    this.zones.forEach((z, i) => {
      const lastPressure = this._lastZonePressure[i];
      const flow = totalAir * shares[i] / z.resistance;
      z.flow = flow;
      z.backflow = flow < F.backflow;

      // 压力：随风量与风门偏置变化；过快的变化率形成压力尖峰
      const bias = i === 0 ? this.door - 50 : 50 - this.door;
      const pressure = flow * 0.95 + 12 + bias * 0.18;
      z.pressure = pressure;
      const rate = Math.abs(pressure - lastPressure) / Math.max(dt, 1e-4);
      const actuatorAggression = this._aggression;
      z.spike = lastPressure > 0 && rate > P.spikeRate * actuatorAggression;
      this._lastZonePressure[i] = pressure;

      // 瓦斯：低风量时涌出，正常通风时稀释；回流时污染迅速累积
      const ventilation = G.vent * flow;
      const emission = (G.rise * F.safeMin) / Math.max(flow, 1);
      let gas = z.gas + (emission - ventilation) * dt;
      if (z.backflow) gas += CONFIG.gas.backflowBoost * dt;
      z.gas = clamp(gas, 0, 100);
    });
  }

  _evaluateSafety(dt) {
    const F = CONFIG.flow;
    const P = CONFIG.pressure;
    const G = CONFIG.gas;
    let allSafe = true;

    this.zones.forEach((z, i) => {
      const reasons = [];
      if (z.flow < F.safeMin) reasons.push('风量不足');
      if (z.flow > F.safeMax) reasons.push('风量超限');
      if (z.pressure < P.safeMin) reasons.push('压力过低');
      if (z.pressure > P.safeMax) reasons.push('压力过高');
      if (z.spike) reasons.push('压力尖峰');
      if (z.backflow) reasons.push('污染回流');
      if (z.gas > G.safeMax) reasons.push('瓦斯超限');
      z.unsafeReasons = reasons;
      z.safe = reasons.length === 0;
      if (!z.safe) {
        allSafe = false;
        z.unsafeTime += dt;
      }
      if (!z.safe && (z._lastSafe ?? true)) {
        this.record('hazard', this._hazardSide(reasons),
          `${z.name} 进入不安全状态：${reasons.join('、')}`);
      }
      z._lastSafe = z.safe;
      if (z.spike) {
        this.stats.spikes++;
        this.record('hazard', i === 0 ? 'downstream' : 'upstream',
          `${z.name} 出现压力尖峰（压力 ${z.pressure.toFixed(1)}）`);
      }
      if (z.backflow && !z._wasBackflow) {
        this.stats.backflows++;
        this.record('hazard', 'downstream', `${z.name} 发生污染回流`);
      }
      z._wasBackflow = z.backflow;
      if (z.gas >= CONFIG.gasCritical && this.status === 'running') {
        this.status = 'failed';
        this.failReason = `${z.name} 瓦斯达到临界值，立即撤离`;
        this.record('lifecycle', 'shared', this.failReason);
      }
    });

    if (allSafe) {
      this.safeElapsed += dt;
      this.unsafeRun = 0;
    } else {
      this.unsafeRun += dt;
      this.totalUnsafe += dt;
      this._attributeUnsafe(dt);
    }
  }

  _hazardSide(reasons) {
    const fanReasons = reasons.some((r) => r.includes('风量') || r.includes('尖峰'));
    const doorReasons = reasons.some((r) => r.includes('回流') || r.includes('压力'));
    if (fanReasons && !doorReasons) return 'upstream';
    if (doorReasons && !fanReasons) return 'downstream';
    return 'shared';
  }

  // 将不安全时间按诱因归属到具体一侧，证明任一侧都无法独自包揽
  _attributeUnsafe(dt) {
    const fanBad = this.fan < CONFIG.fan.safeMin || this.fan > CONFIG.fan.safeMax;
    const doorBad = this.door < CONFIG.door.min + 6 || this.door > CONFIG.door.max - 6;
    const key = fanBad && doorBad ? 'shared' : fanBad ? 'upstream' : doorBad ? 'downstream' : 'shared';
    this.stats.unsafeBySide[key] += dt;
  }

  // ---- 状态快照（回放与测试共用）----------------------------------------
  getState() {
    return {
      status: this.status,
      mode: this.mode,
      timeScale: this.timeScale,
      humanStation: this.humanStation,
      simTime: this.simTime,
      safeElapsed: this.safeElapsed,
      targetSafeSeconds: this.targetSafeSeconds,
      unsafeRun: this.unsafeRun,
      remaining: Math.max(0, this.targetSafeSeconds - this.safeElapsed),
      fan: this.fan,
      door: this.door,
      energy: this.energy,
      energyLocked: this.energyLocked,
      zones: this.zones.map((z) => ({
        name: z.name,
        flow: z.flow,
        pressure: z.pressure,
        gas: z.gas,
        resistance: z.resistance,
        safe: z.safe,
        backflow: z.backflow,
        spike: z.spike,
        unsafeReasons: [...z.unsafeReasons],
        unsafeTime: z.unsafeTime,
      })),
      stations: {
        upstream: { ...this.stations.upstream, held: { ...this.stations.upstream.held } },
        downstream: { ...this.stations.downstream, held: { ...this.stations.downstream.held } },
      },
      stats: JSON.parse(JSON.stringify(this.stats)),
      log: [...this.log],
      failReason: this.failReason,
    };
  }
  _randGap() {
    const d = CONFIG.disturbance;
    return d.minGap + this.rng() * (d.maxGap - d.minGap);
  }

  // ---- 事件 / 日志 -------------------------------------------------------
  record(type, side, msg) {
    const ev = { t: this.simTime, type, side, msg };
    this.events.push(ev);
    this.log.push(ev);
    if (this.log.length > LOG_LIMIT) this.log.shift();
    return ev;
  }

  // ---- 流程控制 ---------------------------------------------------------
  start() {
    if (this.status === 'ready') {
      this.status = 'running';
      this.record('lifecycle', 'shared', '任务开始，维持两工作面安全 10 分钟');
    }
  }

  pause() {
    if (this.status === 'running') {
      this.status = 'paused';
      this.record('lifecycle', 'shared', '任务暂停');
    }
  }

  resume() {
    if (this.status === 'paused') {
      this.status = 'running';
      this.record('lifecycle', 'shared', '任务继续');
    }
  }

  restart() {
    const snapshot = this.reset();
    this.record('lifecycle', 'shared', '任务重开：仪表、目标与计时全部复位');
    return snapshot;
  }

  // ---- 单人调试 ---------------------------------------------------------
  setDebug(enabled, humanStation = 'upstream', timeScale = 1) {
    this.mode = enabled ? 'debug' : 'normal';
    this.humanStation = enabled ? humanStation : null;
    this.timeScale = enabled ? clamp(timeScale, 1, 20) : 1;
    for (const id of ['upstream', 'downstream']) {
      const st = this.stations[id];
      st.human = !enabled || id === humanStation;
      st.auto = enabled && id !== humanStation;
      st.protected = false;
    }
    this.record(
      'lifecycle',
      'shared',
      enabled
        ? `单人调试：人类操控${STATIONS[humanStation].label}，另一侧自动辅助，${this.timeScale}x 加速`
        : '退出单人调试，恢复双人操作',
    );
  }

  // ---- 断开 / 超时保护 ---------------------------------------------------
  setConnected(stationId, connected) {
    const st = this.stations[stationId];
    if (!st || st.connected === connected) return;
    st.connected = connected;
    if (!connected) {
      st.protected = true;
      st.held = {};
      this.stats.protections++;
      this.record('protection', stationId, `${STATIONS[stationId].label} 断开，进入安全保护状态`);
    } else {
      st.protected = false;
      st.lastInputAt = this.simTime;
      this.record('protection', stationId, `${STATIONS[stationId].label} 已重连，交回人工操作`);
    }
  }

  _enterTimeoutProtection(stationId) {
    const st = this.stations[stationId];
    st.protected = true;
    this.stats.protections++;
    this.record(
      'protection',
      stationId,
      `${STATIONS[stationId].label} ${this.timeoutSeconds}s 无输入，自动进入保护状态`,
    );
  }

  // ---- 输入路由：动作只属于固定的一侧，另一侧无法代替 ---------------------
  input(stationId, action, pressed) {
    const owner = ACTION_OWNER[action];
    const st = this.stations[stationId];
    if (!st) return false;
    if (owner !== stationId) {
      this.stats.rejectedInput++;
      this.record(
        'input-reject',
        stationId,
        `拒绝越权操作：${STATIONS[stationId].label} 无法执行 ${action}（属于${STATIONS[owner].label}）`,
      );
      return false;
    }
    if (!st.connected) {
      this.stats.rejectedInput++;
      return false;
    }
    if (pressed && this.status === 'ready') this.start();
    if (this.status !== 'running') {
      if (!pressed) st.held[action] = false;
      return false;
    }
    if (pressed && !st.held[action]) {
      st.lastInputAt = this.simTime;
      if (st.protected && !st.auto) {
        st.protected = false;
        this.record('protection', stationId, `${STATIONS[stationId].label} 恢复操作，退出保护状态`);
      }
      this._checkConflict(stationId, action);
    }
    st.held[action] = !!pressed;
    return true;
  }

  _checkConflict(stationId, action) {
    const otherId = stationId === 'upstream' ? 'downstream' : 'upstream';
    const other = this.stations[otherId];
    const otherHolding = Object.values(other.held).some(Boolean);
    if (!otherHolding) return;
    if (this.simTime - this._lastConflictAt < 1.5) return;
    this._lastConflictAt = this.simTime;
    this.stats.conflicts++;
    other.conflict = true;
    this.stations[stationId].conflict = true;
    this.record(
      'conflict',
      'shared',
      `冲突时刻：风机 ${action.startsWith('fan') ? '调速' : ''}与风门同时操作，压力出现尖峰风险`,
    );
  }

  // ---- 主循环 -----------------------------------------------------------
  step(dt) {
    if (this.status !== 'running') return this.getState();
    dt = clamp(dt, 0, 0.1) * this.timeScale;
    if (dt <= 0) return this.getState();
    this._lastDt = dt;
    this.simTime += dt;

    this._updateTimeouts();
    this._applyActuators(dt);
    this._applyDisturbances();
    this._applyPhysics(dt);
    this._evaluateSafety(dt);
    this._checkEndConditions(dt);
    return this.getState();
  }

  _checkEndConditions(dt) {
    if (this.status !== 'running') return;
    if (this.safeElapsed >= this.targetSafeSeconds - dt * 0.5) {
      this.status = 'succeeded';
      this.record('lifecycle', 'shared', '成功：两区域持续安全 10 分钟');
    } else if (this.unsafeRun >= CONFIG.failAfterUnsafeSeconds - dt * 0.5) {
      this.status = 'failed';
      this.failReason = '不安全状态持续超时，通风任务失败';
      this.record('lifecycle', 'shared', this.failReason);
    }
  }
}

export function keyToAction(code) {
  switch (code) {
    case 'KeyW': return { station: 'upstream', action: 'fanUp' };
    case 'KeyS': return { station: 'upstream', action: 'fanDown' };
    case 'ArrowLeft': return { station: 'downstream', action: 'doorLeft' };
    case 'ArrowRight': return { station: 'downstream', action: 'doorRight' };
    default: return null;
  }
}

