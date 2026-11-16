/* 回放系统:记录双方输入、共享资源采样与冲突/保护事件,可确定性重放。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sim.js'));
  } else {
    root.GreenhouseReplay = factory(root.GreenhouseSim);
  }
})(typeof self !== 'undefined' ? self : this, function (Sim) {
  'use strict';

  function createRecorder() {
    return {
      version: 1,
      startedAt: new Date().toISOString(),
      config: JSON.parse(JSON.stringify(Sim.CONFIG)), // 录制时配置,保证可重放
      inputs: [],     // {t, player, control, delta} 双方原始输入
      events: [],     // 冲突/保护/恢复/结果(来自仿真)
      samples: [],    // 每秒共享资源与仪表快照
      _lastSample: -1,
      _eventCursor: 0
    };
  }

  function recordInput(rec, state, player, control, delta) {
    rec.inputs.push({
      t: Math.round(state.t * 100) / 100,
      player: player, control: control, delta: delta
    });
  }

  // 每帧调用:采集新事件并按秒采样共享状态
  function collect(rec, state) {
    while (rec._eventCursor < state.events.length) {
      rec.events.push(state.events[rec._eventCursor++]);
    }
    var sec = Math.floor(state.t);
    if (sec > rec._lastSample) {
      rec._lastSample = sec;
      rec.samples.push(Sim.snapshot(state));
    }
  }

  function finalize(rec, state) {
    collect(rec, state);
    rec.final = Sim.snapshot(state);
    rec.failReason = state.failReason || '';
    return rec;
  }

  // 用记录的输入时间线重放一局,返回逐帧快照序列(供 UI 播放)
  function play(rec, onFrame) {
    var saved = JSON.parse(JSON.stringify(Sim.CONFIG));
    if (rec.config) {
      for (var k in rec.config) Sim.CONFIG[k] = rec.config[k];
    }
    var state = Sim.createState();
    var cursor = 0, frames = 0;
    try {
      var maxSteps = Math.ceil((Sim.CONFIG.duration + 30) / Sim.CONFIG.dt);
      while (state.status === 'running' && frames < maxSteps) {
        while (cursor < rec.inputs.length &&
               rec.inputs[cursor].t <= state.t + 1e-9) {
          var inp = rec.inputs[cursor++];
          Sim.applyControl(state, inp.player, inp.control, inp.delta);
        }
        Sim.step(state);
        frames++;
        if (onFrame) onFrame(state, frames);
      }
    } finally {
      for (var k2 in saved) Sim.CONFIG[k2] = saved[k2];
    }
    return state;
  }

  // 校验回放终态与实录终态是否一致(确定性验证)
  function verify(rec) {
    var end = play(rec, null);
    var a = Sim.snapshot(end), b = rec.final;
    var keys = ['countdown', 'energy', 'status'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (Math.abs((a[k] || 0) - (b[k] || 0)) > 0.2 && a[k] !== b[k]) {
        return { ok: false, mismatch: k, replay: a[k], recorded: b[k] };
      }
    }
    for (var z = 0; z < 3; z++) {
      if (Math.abs(a.temps[z] - b.temps[z]) > 0.3) {
        return { ok: false, mismatch: 'temp' + z, replay: a.temps[z], recorded: b.temps[z] };
      }
    }
    return { ok: true };
  }

  return {
    createRecorder: createRecorder,
    recordInput: recordInput,
    collect: collect,
    finalize: finalize,
    play: play,
    verify: verify
  };
});
