// 仿真调度器：固定步长推进、运行/暂停/单步/恢复、回放帧录制、
// 峰值与首次故障记录。所有推进都走 Physics.step，保证三种操作结果一致。
(function () {
  const C = window.CONFIG;

  function initialTemplate() {
    return {
      time: 0, s: 0, v: 0, gap: C.car.gap0, temp: C.temp.ambient,
      lap: 0, x: 0, y: 0, tx: 1, ty: 0, nx: 0, ny: 1,
      curveId: 1, curvature: 0, Fm: 0, Fspring: 0, Fdamp: 0,
      accelZ: 0, pressure: 0, B: 0
    };
  }

  function Simulator(track) {
    this.track = track;
    this.inputs = null;
    this.state = null;
    this.mode = 'idle';       // idle | running | paused | fault | win
    this.acc = 0;             // 帧间累积时间
    this.frameAcc = 0;        // 回放录制累积
    this.replay = [];
    this.view = initialTemplate();
  }

  Simulator.prototype.reset = function (inputs) {
    this.inputs = { ...inputs };
    this.state = window.Physics.createInitial(inputs, this.track);
    this.mode = 'idle';
    this.acc = 0;
    this.frameAcc = 0;
    this.replay = [];
    this.record();
  };

  Simulator.prototype.start = function () {
    if (this.mode === 'idle' || this.mode === 'paused') this.mode = 'running';
  };
  Simulator.prototype.pause = function () {
    if (this.mode === 'running') this.mode = 'paused';
  };

  // 单步：推进固定物理时间（一帧 = replayEvery），与连续运行同一时刻等价
  Simulator.prototype.singleStep = function () {
    if (this.mode === 'fault' || this.mode === 'win') return;
    this.mode = 'paused';
    let done = 0;
    while (done < C.sim.replayEvery - 1e-12) {
      this.advance();
      done += C.sim.dt;
      if (this.mode === 'fault' || this.mode === 'win') break;
    }
    this.record();
  };

  // 由渲染帧真实间隔推进；内部按固定 dt 切片，超大间隔丢弃（切后台保护）
  Simulator.prototype.update = function (realDt) {
    if (this.mode !== 'running') return;
    const capped = Math.min(realDt, 0.1);
    this.acc += capped;
    while (this.acc >= C.sim.dt) {
      this.advance();
      this.acc -= C.sim.dt;
      if (this.mode === 'fault' || this.mode === 'win') break;
    }
    this.frameAcc += capped;
    if (this.frameAcc >= C.sim.replayEvery) {
      this.frameAcc = 0;
      this.record();
    }
  };

  Simulator.prototype.advance = function () {
    const st = this.state;
    const fault = window.Physics.step(st, this.track,
      this.inputs.current, this.inputs.damping);
    if (fault) {
      this.mode = 'fault';
      this.record();
      return;
    }
    if (st.lap >= C.sim.lapsToWin) {
      this.mode = 'win';
      this.record();
      return;
    }
    if (st.time >= C.sim.maxRunTime) {
      this.mode = 'fault';
      st.fault = {
        key: 'timeout', name: '超过最大运行时长', value: st.time,
        limit: C.sim.maxRunTime, unit: 's', time: st.time,
        s: st.s, lap: st.lap, segment: st.curveId,
        x: st.pos.x, y: st.pos.y
      };
      this.record();
    }
  };

  Simulator.prototype.record = function () {
    const st = this.state, g = this.track.at(st.s);
    this.view = {
      time: st.time, s: st.s, v: st.v, gap: st.gap, temp: st.temp,
      lap: st.lap, x: g.x, y: g.y, tx: g.tx, ty: g.ty,
      nx: g.nx, ny: g.ny, curveId: g.id, curvature: st.curvature,
      Fm: st.Fm, Fspring: st.Fspring, Fdamp: st.Fdamp,
      accelZ: st.accelZ, pressure: st.pressure, B: st.B
    };
    this.replay.push(this.view);
    if (this.replay.length > 9000) this.replay.shift();
  };

  window.Simulator = Simulator;
})();
