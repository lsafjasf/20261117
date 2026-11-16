// Browser Web Audio renderer. It schedules the exact same audio trigger
// events stored in the project log, using look-ahead scheduling against the
// shared TransportClock rather than wall-clock callbacks, so audio stays
// sample-aligned to the canvas playhead and program timeline.

import { noteFrequency } from '../src/core/audio-model.js';

export class WebAudioEngine {
  constructor(clock) {
    this.clock = clock;
    this.context = null;
    this.master = null;
    this.lookaheadMs = 120;
    this.timer = null;
    this._firedUpTo = 0;
  }

  async ensureContext() {
    if (!this.context) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.context = new Ctx();
      this.master = this.context.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  // Build a one-shot oscillator matching the offline renderer's envelope.
  trigger(pulse, when) {
    const ctx = this.context;
    const frequency = noteFrequency(pulse.note);
    const durationSec = pulse.durationMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.4, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + durationSec);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(when);
    osc.stop(when + durationSec + 0.02);
  }

  start(pulses) {
    this.stop();
    this._pulses = pulses.slice().sort((a, b) => a.t - b.t);
    this._firedUpTo = this.clock.inPoint;
    const tick = () => {
      if (!this.clock.playing) return;
      const horizon = this.clock.time + this.lookaheadMs;
      const now = this.context.currentTime;
      for (const pulse of this._pulses) {
        if (pulse.t < this._firedUpTo || pulse.t < this.clock.inPoint) continue;
        if (pulse.t <= horizon && pulse.t >= this.clock.time - this.lookaheadMs) {
          const offsetSec = Math.max(0, (pulse.t - this.clock.time) / 1000);
          this.trigger(pulse, now + offsetSec);
          this._firedUpTo = pulse.t;
        }
      }
    };
    this.timer = window.setInterval(tick, 40);
    tick();
  }

  stop() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }
}
