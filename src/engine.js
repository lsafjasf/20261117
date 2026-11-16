/* global module */
/**
 * 潜水钟协作引擎：固定步长、纯确定性，不依赖 DOM。
 * 浏览器与 Node 共用；UI 层通过 getSnapshot() 渲染，通过 applyAction() 输入。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config.js'));
  } else {
    root.DBEngine = factory(root.DBConfig);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function freshState() {
    const init = C.INITIAL;
    return {
      phase: 'running',            // running | paused | protecting | failed | success
      mode: 'coop',                // coop | debug
      tick: 0,
      time: 0,
      depth: init.depth,
      vSpeed: init.vSpeed,
      drift: init.drift,
      ballast: init.ballast,
      ballastDir: 0,               // -1 排水 | 0 停 | 1 注水
      cablePaid: init.cablePaid,
      cableDir: 0,                 // 1 放缆 | -1 收缆 | 0 停
      cableValve: init.cableValve,
      valveDir: 0,                 // 1 开大 | -1 关小 | 0 停
      o2: init.o2,
      reserve: init.reserve,
      temp: init.temp,
      stress: init.stress,
      current: 0,
      tension: 0,
      tensionState: 'normal',      // normal | tight | slack
      hypoxiaTimer: 0,
      sample: null,                // { stationId, progress, interrupted }
      completed: [],               // 已完成取样点 id
      activeStation: 1,
      idle: { p1: 0, p2: 0 },
      protectedSide: null,         // p1 | p2
      protectReason: null,         // idle | disconnect
      failReason: null,
      lastInputs: { p1: null, p2: null },
      events: [],
      inputs: [],
      conflicts: [],
      rejected: []
    };
  }

  function Engine() {
    this.state = freshState();
    this._eventSeq = 0;
  }

  const E = Engine.prototype;

  E._log = function (type, payload) {
    this.state.events.push({
      seq: this._eventSeq++,
      tick: this.state.tick,
      time: Number(this.state.time.toFixed(3)),
      type,
      payload: payload || {}
    });
  };

  /** 复位：仪表、目标、计时、回放记录全部归零。 */
  E.reset = function (mode) {
    const fresh = freshState();
    if (mode) fresh.mode = mode;
    this.state = fresh;
    this._eventSeq = 0;
    this._log('restart', { mode: this.state.mode });
    return this.getSnapshot();
  };

  E.pause = function () {
    if (this.state.phase === 'running') {
      this.state.phase = 'paused';
      this._log('pause', {});
    }
  };

  E.resume = function () {
    if (this.state.phase === 'paused') {
      this.state.phase = 'running';
      this._log('resume', {});
    }
  };

  E.togglePause = function () {
    if (this.state.phase === 'running') this.pause();
    else if (this.state.phase === 'paused') this.resume();
  };

  /** 模拟单侧断开（调试/保护测试用）。 */
  E.disconnect = function (side) {
    if (this.state.phase !== 'running') return false;
    this._enterProtection(side, 'disconnect');
    return true;
  };

  /** 断开侧恢复连接。 */
  E.reconnect = function (side) {
    if (this.state.phase === 'protecting' && this.state.protectedSide === side) {
      this.state.phase = 'running';
      this.state.protectedSide = null;
      this.state.protectReason = null;
      this.state.idle[side] = 0;
      this._log('reconnect', { side });
      return true;
    }
    return false;
  };

  E._enterProtection = function (side, reason) {
    const s = this.state;
    s.phase = 'protecting';
    s.protectedSide = side;
    s.protectReason = reason;
    s.ballastDir = 0;
    s.cableDir = 0;
    s.valveDir = 0;
    s.sample = null;
    this._log('protection', { side, reason });
  };

  /**
   * 玩家动作入口。
   * 越权动作（p1 调供气/缆绳，或 p2 调压载）会被拒绝并记录，
   * 从机制上保证任何一侧都无法代替另一侧完成全部操作。
   */
  E.applyAction = function (side, action) {
    const s = this.state;
    const allowed = C.PLAYER_ACTIONS[side];
    if (!allowed) {
      s.rejected.push({ tick: s.tick, side, action, reason: 'unknown_side' });
      return false;
    }
    if (allowed.indexOf(action) === -1) {
      s.rejected.push({ tick: s.tick, side, action, reason: 'not_authorized' });
      this._log('reject', { side, action });
      return false;
    }
    if (s.phase === 'paused' || s.phase === 'protecting' ||
        s.phase === 'failed' || s.phase === 'success') {
      s.rejected.push({ tick: s.tick, side, action, reason: 'phase_' + s.phase });
      return false;
    }

    s.idle[side] = 0;
    s.lastInputs[side] = action;
    s.inputs.push({ tick: s.tick, side, action });

    switch (action) {
      case 'ballast_up': s.ballastDir = -1; break;   // 排水 → 上浮
      case 'ballast_down': s.ballastDir = 1; break;  // 注水 → 下潜
      case 'ballast_off': s.ballastDir = 0; break;
      case 'air_up': s.valveDir = 1; break;
      case 'air_down': s.valveDir = -1; break;
      case 'air_off': s.valveDir = 0; break;
      case 'cable_pay': s.cableDir = 1; break;
      case 'cable_reel': s.cableDir = -1; break;
      case 'cable_off': s.cableDir = 0; break;
      case 'sample': this._requestSample(side); break;
      default: return false;
    }
    this._log('input', { side, action });
    return true;
  };

  E._requestSample = function (side) {
    const s = this.state;
    const station = C.STATIONS.find(function (st) { return st.id === s.activeStation; });
    if (!station) return;
    if (s.sample) {
      this._log('sample_reject', { reason: 'already_sampling' });
      return;
    }
    const inDepth = Math.abs(s.depth - station.depth) <= station.depthTol;
    const inDrift = Math.abs(s.drift) <= C.STATION_DRIFT_TOL;
    const cableOk = s.tensionState !== 'tight';
    if (inDepth && inDrift && cableOk) {
      s.sample = { stationId: station.id, progress: 0, interrupted: false };
      this._log('sample_start', { stationId: station.id });
    } else {
      const reasons = [];
      if (!inDepth) reasons.push('depth');
      if (!inDrift) reasons.push('drift');
      if (!cableOk) reasons.push('cable');
      s.conflicts.push({
        tick: s.tick, time: Number(s.time.toFixed(3)),
        kind: 'sample_blocked', side, reasons
      });
      this._log('sample_blocked', { reasons });
    }
  };

  /** 推进一个固定步长。暂停/保护/终局时物理冻结，仅保留可查询状态。 */
  E.step = function () {
    const s = this.state;
    if (s.phase !== 'running') return this.getSnapshot();
    const dt = C.DT;
    s.tick += 1;
    s.time = Number((s.time + dt).toFixed(4));

    this._stepIdle(dt);
    if (s.phase !== 'running') return this.getSnapshot();

    this._stepBallast(dt);
    this._stepCable(dt);
    this._stepCurrent(dt);
    this._stepAir(dt);
    this._stepTemp();
    this._stepSample(dt);
    this._stepMission();
    return this.getSnapshot();
  };

  E._stepIdle = function (dt) {
    const s = this.state;
    // 空闲计时只由新的按键动作（applyAction）重置；
    // 持续按住不等于持续参与，超时保护必须能触发。
    ['p1', 'p2'].forEach(function (side) {
      s.idle[side] += dt;
      if (s.idle[side] >= C.IDLE_TIMEOUT) {
        this._enterProtection(side, 'idle');
      }
    }, this);
  };

  E._stepBallast = function (dt) {
    const s = this.state;
    s.ballast = clamp(s.ballast + s.ballastDir * C.BALLAST_RATE * dt, 0, C.BALLAST_MAX);
    const accel = (s.ballast - 50) * C.BUOYANCY_PER_UNIT; // 正=下沉
    s.vSpeed += accel * dt;
    s.vSpeed -= C.DRAG * s.vSpeed * dt;

    // 缆绳过紧时产生向上拉力
    if (s.tensionState === 'tight') {
      s.vSpeed -= s.tension * 0.04 * dt;
    }
    s.vSpeed = clamp(s.vSpeed, -C.MAX_VSPEED, C.MAX_VSPEED);
    s.depth += s.vSpeed * dt;

    if (s.depth <= 0) {
      if (s.vSpeed < -C.RISE_SAFE_SPEED && s.completed.length === C.STATIONS.length) {
        this._fail('rapid_ascent', { vSpeed: Number(s.vSpeed.toFixed(2)) });
      }
      s.depth = 0;
      s.vSpeed = Math.max(0, s.vSpeed);
    }
    if (s.depth > C.MAX_DEPTH) {
      this._fail('over_depth', { depth: Number(s.depth.toFixed(1)) });
    }
  };

  E._stepCable = function (dt) {
    const s = this.state;
    // 缆绳放出量不能短于当前深度，避免出现物理上不可能的负松弛。
    s.cablePaid = Math.max(0.5, s.depth + 0.5, s.cablePaid + s.cableDir * C.CABLE_RATE * dt);
    const slack = s.cablePaid - s.depth;
    const prevState = s.tensionState;

    if (slack < C.CABLE_MIN_SLACK) {
      s.tensionState = 'tight';
      s.tension = clamp((C.CABLE_MIN_SLACK - slack) * 14, 0, 100);
      s.stress = clamp(s.stress + C.STRESS_PER_SEC * (s.tension / 100) * dt, 0, C.STRESS_MAX);
      // 绷紧的脐带把钟体拉回母船正下方
      s.drift -= s.drift * (0.25 + s.tension * 0.012) * dt;
    } else if (slack > C.CABLE_MAX_SLACK) {
      s.tensionState = 'slack';
      s.tension = 0;
      s.stress = Math.max(0, s.stress - C.STRESS_RELAX * 0.5 * dt);
    } else {
      s.tensionState = 'normal';
      s.tension = 0;
      s.stress = Math.max(0, s.stress - C.STRESS_RELAX * dt);
    }

    if (s.tensionState === 'tight' && prevState !== 'tight') {
      s.conflicts.push({
        tick: s.tick, time: Number(s.time.toFixed(3)),
        kind: 'cable_tight', side: 'sync',
        slack: Number(slack.toFixed(2)), tension: Number(s.tension.toFixed(1))
      });
      this._log('conflict', { kind: 'cable_tight', slack: Number(slack.toFixed(2)) });
    }
    if (s.stress >= C.STRESS_FAIL) {
      this._fail('cable_stress', { stress: C.STRESS_FAIL });
    }
  };

  E._stepCurrent = function (dt) {
    const s = this.state;
    s.current = C.CURRENT_BASE +
      C.CURRENT_SWAY * Math.sin((2 * Math.PI * s.time) / C.CURRENT_PERIOD);
    s.drift += (s.current - C.DRAG_H * s.drift) * dt;
    if (s.tensionState === 'tight') {
      s.drift -= s.drift * 0.3 * dt; // 绷紧缆绳额外回正
    }
    s.drift = clamp(s.drift, -C.MAX_DRIFT, C.MAX_DRIFT);
  };

  E._stepAir = function (dt) {
    const s = this.state;
    s.cableValve = clamp(s.cableValve + s.valveDir * C.AIR_RATE * dt, 0, 100);
    const effectiveValve = s.reserve <= 0 ? 0 : s.cableValve;
    const net = -C.O2_CONSUME + C.O2_GAIN_PER_VALVE * effectiveValve;
    s.o2 = clamp(s.o2 + net * dt, 0, C.O2_MAX);
    s.reserve = Math.max(0, s.reserve -
      C.RESERVE_DRAIN * (0.25 + s.cableValve / 100) * dt);

    if (s.o2 < C.O2_MIN) {
      s.hypoxiaTimer += dt;
      if (s.hypoxiaTimer >= C.HYPOXIA_LIMIT) {
        this._fail('hypoxia', { o2: Number(s.o2.toFixed(2)) });
      }
    } else {
      s.hypoxiaTimer = Math.max(0, s.hypoxiaTimer - dt * 2);
    }
  };

  E._stepTemp = function () {
    const s = this.state;
    s.temp = Number((C.TEMP_SURFACE - C.TEMP_GRADIENT * s.depth).toFixed(1));
  };

  E._stepSample = function (dt) {
    const s = this.state;
    if (!s.sample) return;
    const station = C.STATIONS.find(function (st) { return st.id === s.sample.stationId; });
    const inDepth = Math.abs(s.depth - station.depth) <= station.depthTol;
    const inDrift = Math.abs(s.drift) <= C.STATION_DRIFT_TOL;
    const cableOk = s.tensionState !== 'tight';

    if (inDepth && inDrift && cableOk) {
      s.sample.progress = Number((s.sample.progress + dt).toFixed(3));
      if (s.sample.progress >= C.SAMPLE_TIME) {
        s.completed.push(station.id);
        this._log('sample_complete', { stationId: station.id });
        const next = C.STATIONS.find(function (st) { return s.completed.indexOf(st.id) === -1; });
        s.activeStation = next ? next.id : null;
        s.sample = null;
      }
    } else {
      const reasons = [];
      if (!inDepth) reasons.push('depth');
      if (!inDrift) reasons.push('drift');
      if (!cableOk) reasons.push('cable');
      s.conflicts.push({
        tick: s.tick, time: Number(s.time.toFixed(3)),
        kind: 'sample_interrupted', side: 'sync', reasons
      });
      this._log('sample_interrupt', { reasons });
      s.sample = null;
    }
  };

  E._stepMission = function () {
    const s = this.state;
    if (s.phase !== 'running') return;
    if (s.completed.length === C.STATIONS.length && s.depth <= 0.5 && s.sample === null) {
      s.phase = 'success';
      this._log('success', { time: s.time });
    }
  };

  E._fail = function (reason, detail) {
    const s = this.state;
    if (s.phase !== 'running') return;
    s.phase = 'failed';
    s.failReason = reason;
    s.ballastDir = 0;
    s.cableDir = 0;
    s.valveDir = 0;
    s.sample = null;
    this._log('fail', { reason, detail: detail || {} });
  };

  /**
   * 共享快照：两名玩家的仪表读取同一份状态，
   * UI 层据此保证两侧仪表、资源、倒计时、任务记录完全一致。
   */
  E.getSnapshot = function () {
    const s = this.state;
    const station = s.activeStation
      ? C.STATIONS.find(function (st) { return st.id === s.activeStation; })
      : null;
    return {
      phase: s.phase,
      mode: s.mode,
      tick: s.tick,
      time: s.time,
      gauges: {
        depth: Number(s.depth.toFixed(2)),
        vSpeed: Number(s.vSpeed.toFixed(2)),
        drift: Number(s.drift.toFixed(2)),
        ballast: Number(s.ballast.toFixed(1)),
        cablePaid: Number(s.cablePaid.toFixed(2)),
        slack: Number((s.cablePaid - s.depth).toFixed(2)),
        valve: Number(s.cableValve.toFixed(1)),
        o2: Number(s.o2.toFixed(2)),
        reserve: Number(s.reserve.toFixed(1)),
        temp: s.temp,
        stress: Number(s.stress.toFixed(1)),
        current: Number(s.current.toFixed(2)),
        tension: Number(s.tension.toFixed(1)),
        tensionState: s.tensionState,
        hypoxiaLeft: Number(Math.max(0, C.HYPOXIA_LIMIT - s.hypoxiaTimer).toFixed(1))
      },
      directions: {
        ballast: s.ballastDir,
        cable: s.cableDir,
        valve: s.valveDir
      },
      mission: {
        activeStation: s.activeStation,
        stationDepth: station ? station.depth : null,
        depthTol: station ? station.depthTol : null,
        driftTol: C.STATION_DRIFT_TOL,
        completed: s.completed.slice(),
        sample: s.sample ? {
          stationId: s.sample.stationId,
          progress: s.sample.progress,
          ratio: Number((s.sample.progress / C.SAMPLE_TIME).toFixed(3))
        } : null,
        sampleTotal: C.SAMPLE_TIME
      },
      protection: {
        side: s.protectedSide,
        reason: s.protectReason,
        idleLeft: {
          p1: Number(Math.max(0, C.IDLE_TIMEOUT - s.idle.p1).toFixed(1)),
          p2: Number(Math.max(0, C.IDLE_TIMEOUT - s.idle.p2).toFixed(1))
        }
      },
      failReason: s.failReason,
      lastInputs: { p1: s.lastInputs.p1, p2: s.lastInputs.p2 },
      events: s.events.slice(),
      conflicts: s.conflicts.slice(),
      rejected: s.rejected.slice()
    };
  };

  /** 导出回放：双方输入、共享资源快照、冲突与系统事件。 */
  E.exportReplay = function () {
    const s = this.state;
    return {
      version: 1,
      config: { tickHz: C.TICK_HZ, stations: C.STATIONS, sampleTime: C.SAMPLE_TIME },
      finalTick: s.tick,
      finalPhase: s.phase,
      failReason: s.failReason,
      inputs: s.inputs.map(function (i) {
        return { tick: i.tick, side: i.side, action: i.action };
      }),
      events: s.events.slice(),
      conflicts: s.conflicts.slice(),
      rejected: s.rejected.slice()
    };
  };

  /**
   * 按回放确定性重放：在对应 tick 注入输入，逐 tick 推进。
   * 返回重放引擎（可逐帧取快照做时间轴回放）与终态校验信息。
   */
  Engine.replay = function (replay, mode) {
    const engine = new Engine();
    if (mode) engine.state.mode = mode;
    const byTick = {};
    replay.inputs.forEach(function (i) {
      (byTick[i.tick] = byTick[i.tick] || []).push(i);
    });
    const timeline = [];
    for (let tick = 0; tick < replay.finalTick; tick++) {
      if (byTick[tick]) {
        byTick[tick].forEach(function (i) {
          engine.applyAction(i.side, i.action);
        });
      }
      engine.step();
      timeline.push(engine.getSnapshot());
    }
    const end = engine.getSnapshot();
    return {
      engine,
      timeline,
      consistent: end.phase === replay.finalPhase &&
        end.tick === replay.finalTick &&
        end.failReason === replay.failReason
    };
  };

  Engine.config = C;
  return Engine;
});
