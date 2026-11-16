/* 声音随轮速变化：WebAudio 引擎嗡鸣 + 事件提示音，无外部资源 */
(function (root) {
  'use strict';
  const LunarAudio = {
    ctx: null, osc: null, gain: null, enabled: true,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sawtooth';
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
    },
    update(speed, throttle, paused) {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const freq = 55 + speed * 1.15;
      this.osc.frequency.setTargetAtTime(freq, t, 0.05);
      const vol = paused ? 0 : Math.min(0.08, 0.012 + throttle * 0.03 + speed * 0.00018);
      this.gain.gain.setTargetAtTime(vol, t, 0.08);
    },
    blip(freq, dur, type) {
      if (!this.ctx || !this.enabled) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.value = 0.06;
      o.connect(g).connect(this.ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      o.stop(this.ctx.currentTime + dur);
    },
    delivery() { this.blip(660, 0.18, 'sine'); setTimeout(() => this.blip(880, 0.22, 'sine'), 120); },
    checkpoint() { this.blip(520, 0.12, 'triangle'); },
    fail() { this.blip(180, 0.4, 'sawtooth'); },
    win() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'sine'), i * 160)); },
    toggle() {
      this.enabled = !this.enabled;
      if (!this.enabled && this.gain) this.gain.gain.value = 0;
      return this.enabled;
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = LunarAudio;
  else root.LunarAudio = LunarAudio;
})(typeof self !== 'undefined' ? self : this);
