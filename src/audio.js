/* WebAudio soundscape: engine hum + water noise that follow flow and thrust. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BuoyAudio = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class SoundBoard {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.ready = false;
    }

    ensure() {
      if (this.ready) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const master = this.ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.8;
      master.connect(this.ctx.destination);
      this.master = master;

      const engineOsc = this.ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 70;
      const engineGain = this.ctx.createGain();
      engineGain.gain.value = 0.0001;
      engineOsc.connect(engineGain).connect(master);
      engineOsc.start();
      this.engineOsc = engineOsc;
      this.engineGain = engineGain;

      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2,
        this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.value = 0.02;
      noise.connect(filter).connect(noiseGain).connect(master);
      noise.start();
      this.noise = noise;
      this.filter = filter;
      this.noiseGain = noiseGain;
      this.ready = true;
    }

    resume() {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    update(thrust, flowSpeed, inShallow) {
      if (!this.ready || this.muted) return;
      const t = this.ctx.currentTime;
      this.engineOsc.frequency.setTargetAtTime(60 + thrust * 130, t, 0.08);
      this.engineGain.gain.setTargetAtTime(0.02 + thrust * 0.07, t, 0.1);
      this.filter.frequency.setTargetAtTime(
        260 + flowSpeed * 14 + (inShallow ? 180 : 0), t, 0.12);
      this.noiseGain.gain.setTargetAtTime(
        0.015 + Math.min(flowSpeed, 40) * 0.0022 + (inShallow ? 0.03 : 0), t, 0.12);
    }

    blip(freq, dur, type, gainValue) {
      if (!this.ready || this.muted) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(gainValue || 0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + dur);
    }

    markerOk() {
      this.blip(660, 0.16, 'triangle', 0.14);
      setTimeout(() => this.blip(990, 0.22, 'triangle', 0.12), 120);
    }

    markerBad() {
      this.blip(180, 0.3, 'square', 0.1);
    }

    crash() {
      this.blip(70, 0.6, 'sawtooth', 0.22);
    }

    checkpoint() {
      this.blip(520, 0.1, 'sine', 0.08);
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.ready) {
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8,
          this.ctx.currentTime, 0.03);
      }
      return this.muted;
    }
  }

  return { SoundBoard };
});
