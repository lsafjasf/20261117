// 回放系统：记录双方输入、共享资源、冲突/保护时刻，并支持确定性重放

const SNAPSHOT_EVERY = 5; // 每 5 秒保存一次完整快照，便于拖动进度

export class Recorder {
  constructor(seed = 1, config = {}) {
    this.seed = seed;
    this.config = config;
    this.inputs = []; // { t, station, action, pressed }
    this.events = []; // 引擎事件（冲突、保护、资源、危险）
    this.snapshots = []; // { t, state }
    this.lifecycle = []; // { t, kind, payload }
  }

  recordInput(t, station, action, pressed) {
    this.inputs.push({ t: round(t), station, action, pressed });
  }

  recordEvent(ev) {
    this.events.push({ ...ev, t: round(ev.t) });
  }

  recordLifecycle(t, kind, payload = {}) {
    this.lifecycle.push({ t: round(t), kind, payload });
  }

  maybeSnapshot(t, state) {
    const slot = Math.floor(t / SNAPSHOT_EVERY);
    if (slot > (this._lastSlot ?? -1)) {
      this._lastSlot = slot;
      this.snapshots.push({ t: round(t), state });
    }
  }

  serialize() {
    return JSON.stringify({
      version: 1,
      seed: this.seed,
      config: this.config,
      inputs: this.inputs,
      events: this.events,
      snapshots: this.snapshots,
      lifecycle: this.lifecycle,
    });
  }

  static deserialize(text) {
    const data = JSON.parse(text);
    const r = new Recorder(data.seed, data.config || {});
    r.inputs = data.inputs || [];
    r.events = data.events || [];
    r.snapshots = data.snapshots || [];
    r.lifecycle = data.lifecycle || [];
    return r;
  }
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

// 可确定性复现的随机数（mulberry32）
export function seededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ReplayPlayer {
  constructor(recorder, GameClass, opts = {}) {
    this.rec = recorder;
    this.GameClass = GameClass;
    this.dt = opts.dt || 1 / 60;
    this.game = new GameClass({ rng: seededRng(recorder.seed), ...(recorder.config || {}) });
    this._cursor = 0;
    this._lifeCursor = 0;
    this.currentTime = 0;
    this.duration = recorder.inputs.length
      ? Math.max(
          ...recorder.inputs.map((i) => i.t),
          ...recorder.lifecycle.map((l) => l.t),
          ...recorder.snapshots.map((s) => s.t),
        ) + 1
      : 0;
  }

  // 前进到指定时刻，逐帧重放并注入当时的输入（保证与原局一致）
  seekTo(time) {
    if (time < this.currentTime - 1e-6) {
      this._restartFromBeginning();
    }
    let guard = 0;
    while (this.currentTime < time - 1e-6 && guard++ < 200000) {
      this._applyLifecycle();
      while (this._cursor < this.rec.inputs.length &&
        this.rec.inputs[this._cursor].t <= this.currentTime + 1e-6) {
        const inp = this.rec.inputs[this._cursor++];
        this.game.input(inp.station, inp.action, inp.pressed);
      }
      this.game.step(this.dt);
      this.currentTime += this.dt * this.game.timeScale;
    }
    return this.game.getState();
  }

  _restartFromBeginning() {
    this.game = new this.GameClass({
      rng: seededRng(this.rec.seed),
      ...(this.rec.config || {}),
    });
    this.currentTime = 0;
    this._cursor = 0;
    this._lifeCursor = 0;
  }

  _applyLifecycle() {
    while (this._lifeCursor < this.rec.lifecycle.length &&
      this.rec.lifecycle[this._lifeCursor].t <= this.currentTime + 1e-6) {
      const item = this.rec.lifecycle[this._lifeCursor++];
      const g = this.game;
      if (item.kind === 'pause') g.pause();
      else if (item.kind === 'resume') g.resume();
      else if (item.kind === 'restart') g.restart();
      else if (item.kind === 'debug') g.setDebug(item.payload.enabled, item.payload.station, item.payload.scale);
      else if (item.kind === 'connection') g.setConnected(item.payload.station, item.payload.connected);
    }
  }

  // 校验重放结果与原始事件流是否吻合（输入注入次数、冲突数、最终状态）
  verify(originalState) {
    const end = this.seekTo(Math.max(originalState.simTime, this.duration) + this.dt * 2);
    return {
      inputsApplied: this._cursor,
      inputsRecorded: this.rec.inputs.length,
      conflictsMatch: end.stats.conflicts === originalState.stats.conflicts,
      finalStatus: end.status,
      originalStatus: originalState.status,
      safeElapsed: end.safeElapsed,
      originalSafeElapsed: originalState.safeElapsed,
    };
  }
}
