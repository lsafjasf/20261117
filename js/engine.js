// Web Audio 引擎：固定拓扑音频图 + 节点登记 + 三种试听状态。
import { buildGraph, applyGraphParams, applyMode } from "./graph.js";
import { REGISTERS, sanitizeParams } from "./params.js";

export class AudioEngine {
  constructor(ctx, params) {
    this.ctx = ctx;
    this.params = sanitizeParams(params);
    this.nodes = new Set();
    this.mode = "main";          // main | bypass | mute
    this.running = false;
    this.timer = null;
    this.stepIndex = 0;
    this.scheduled = [];         // 已调度音符 {time, step}
    this.onStep = null;
    this._buildGraph();
    this.applyParams();
    this.setMode("main");
  }

  _node(node) {
    this.nodes.add(node);
    return node;
  }

  activeNodeCount() {
    let n = 0;
    for (const node of this.nodes) {
      if (node.state === "closed" || node._closed) continue;
      if (node.state === undefined || node.state === "running" || node.state === "suspended" || node.state === "scheduled") n++;
    }
    return n;
  }

  _buildGraph() {
    // 与离线导出共用同一套图构建，保证实时/导出拓扑完全一致。
    const g = buildGraph(this.ctx, (n) => this._node(n));
    Object.assign(this, g);
  }

  setMode(mode) {
    if (!["main", "bypass", "mute"].includes(mode)) return;
    this.mode = mode;
    applyMode(this, mode, this.ctx.currentTime);
  }

  updateParams(params) {
    this.params = sanitizeParams(params);
    this.applyParams();
  }

  applyParams() {
    applyGraphParams(this, this.params, this.ctx.currentTime);
  }

  // 单个音符：osc -> ADSR 包络，自动登记并在结束后关闭（避免未关闭节点/尾音）。
  createVoice(step, startTime, duration) {
    const c = this.ctx;
    const p = this.params;
    const reg = REGISTERS[step % REGISTERS.length];
    const detuneCents = p[`detune${reg.id[0].toUpperCase()}${reg.id.slice(1)}`] ?? 0;
    const osc = this._node(c.createOscillator());
    osc.type = p.wave;
    osc.frequency.value = reg.target;
    osc.detune.value = detuneCents;
    const env = this._node(c.createGain());
    env.gain.setValueAtTime(0, startTime);
    const attack = 0.01;
    const release = Math.min(0.08, duration * 0.3);
    env.gain.linearRampToValueAtTime(0.9, startTime + attack);
    env.gain.setValueAtTime(0.9, startTime + Math.max(attack, duration - release));
    env.gain.linearRampToValueAtTime(0, startTime + duration);
    osc.connect(env);
    env.connect(this.voiceBus);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
    osc.onended = () => {
      try { env.disconnect(); osc.disconnect(); } catch { /* 已断开 */ }
      this.nodes.delete(osc);
      this.nodes.delete(env);
    };
    return { osc, env, reg, startTime, duration };
  }

  get stepDuration() {
    return 60 / this.params.bpm;
  }

  play() {
    if (this.running) return;
    this.running = true;
    this._startScheduler();
  }

  pause() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // 停掉所有尚未发声/正在发声的音符，确保暂停即无声、无尾音。
    const now = this.ctx.currentTime;
    for (const item of this.scheduled) {
      try {
        item.osc.onended = null;
        item.osc.stop(now);
        item.env.disconnect();
        item.osc.disconnect();
      } catch { /* 已停止 */ }
      this.nodes.delete(item.osc);
      this.nodes.delete(item.env);
    }
    this.scheduled = [];
    // 兜底：移除任何已结束但 onended 尚未触发的音符节点。
    for (const node of Array.from(this.nodes)) {
      if (node.state === "closed" || node._closed) this.nodes.delete(node);
    }
    // 节拍位置冻结在当前 step，恢复后从该 step 继续（不产生漂移累积）。
  }

  replay() {
    this.pause();
    this.stepIndex = 0;
    this.play();
  }

  // 单步：无论是否在播放，都精确调度下一个音符。
  step() {
    const wasRunning = this.running;
    if (wasRunning) this.pause();
    const duration = Math.min(this.params.holdSeconds, this.stepDuration * 0.95);
    const item = this.createVoice(this.stepIndex, this.ctx.currentTime + 0.02, duration);
    this.scheduled.push(item);
    this.stepIndex++;
    if (this.onStep) this.onStep(this.stepIndex - 1, item.reg);
  }

  _startScheduler() {
    const lookahead = 0.12;       // 调度窗口（秒）
    const tick = 40;              // 定时器周期（毫秒）
    let nextTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => {
      if (!this.running) return;
      const beat = this.stepDuration;
      const duration = Math.min(this.params.holdSeconds, beat * 0.95);
      while (nextTime < this.ctx.currentTime + lookahead) {
        const item = this.createVoice(this.stepIndex, nextTime, duration);
        this.scheduled.push(item);
        const firedStep = this.stepIndex;
        const fireAt = nextTime;
        const delayMs = Math.max(0, (fireAt - this.ctx.currentTime) * 1000);
        setTimeout(() => {
          if (this.onStep && this.running) this.onStep(firedStep, item.reg);
        }, delayMs);
        // 非累积式调度：每拍时长固定来自 BPM，杜绝节拍漂移。
        nextTime += beat;
        this.stepIndex++;
      }
      const alive = [];
      for (const it of this.scheduled) {
        if (it.osc.state === "scheduled" || it.osc.state === "running") {
          alive.push(it);
        } else {
          this.nodes.delete(it.osc);
          this.nodes.delete(it.env);
        }
      }
      this.scheduled = alive;
    }, tick);
  }

  readLevels() {
    const buf = new Float32Array(this.analyser.fftSize);
    if (this.analyser.getFloatTimeDomainData) {
      this.analyser.getFloatTimeDomainData(buf);
    } else {
      const u8 = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(u8);
      for (let i = 0; i < u8.length; i++) buf[i] = (u8[i] - 128) / 128;
    }
    return buf;
  }

  teardown() {
    this.pause();
    for (const node of Array.from(this.nodes)) {
      try {
        if (typeof node.stop === "function" && (node.state === "scheduled" || node.state === "running")) node.stop();
      } catch { /* ignore */ }
      try { node.disconnect(); } catch { /* ignore */ }
    }
    this.nodes.clear();
  }
}
