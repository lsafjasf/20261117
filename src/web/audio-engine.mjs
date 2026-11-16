import { BEAT_INTERVAL } from "../core/timebase.mjs";
import { buildAudioEvents, cutTimes } from "../core/audio.mjs";

// Web Audio 调度器：所有事件时间都换算到同一节目时间基准，
// 切点 cue 与节拍鼓点使用同一张事件表，保证音画同步。
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.duration = 0;
    this.events = [];
    this.nextIndex = 0;
    this.startContextTime = 0;
    this.startProgramTime = 0;
    this.running = false;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setProgram(project, duration) {
    this.duration = duration;
    this.events = buildAudioEvents(duration, cutTimes(project), project.beatInterval ?? BEAT_INTERVAL);
  }

  // programTime: 当前节目时间；loopEpoch 每次循环递增。
  start(programTime) {
    this.ensureContext();
    this.startContextTime = this.ctx.currentTime + 0.05;
    this.startProgramTime = programTime;
    this.nextIndex = this.events.findIndex((e) => e.time >= programTime - 1e-6);
    if (this.nextIndex < 0) this.nextIndex = this.events.length;
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  // 每帧调用：提前 0.1s 调度，避免节拍抖动。
  update(programTime) {
    if (!this.running || !this.ctx) return;
    const horizon = this.ctx.currentTime + 0.12;
    while (this.nextIndex < this.events.length) {
      const event = this.events[this.nextIndex];
      const when =
        this.startContextTime + (event.time - this.startProgramTime);
      if (when > horizon) break;
      if (when >= this.ctx.currentTime - 0.02 && event.time >= programTime - 0.12) {
        this.trigger(event, Math.max(when, this.ctx.currentTime));
      }
      this.nextIndex += 1;
    }
  }

  trigger(event, when) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    if (event.kind === "kick") {
      osc.frequency.setValueAtTime(150, when);
      osc.frequency.exponentialRampToValueAtTime(48, when + 0.12);
      gain.gain.setValueAtTime(0.9, when);
    } else if (event.kind === "cue") {
      osc.type = "square";
      osc.frequency.setValueAtTime(880, when);
      gain.gain.setValueAtTime(0.5, when);
    } else {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(620, when);
      gain.gain.setValueAtTime(0.35, when);
    }
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.14);
    osc.connect(gain).connect(this.master);
    osc.start(when);
    osc.stop(when + 0.16);
  }

  loop(programTime) {
    this.start(programTime);
  }
}
