// 环境音:雨天噪声、干旱风声、晴日鸟鸣,告警提示音
(function (global) {
  'use strict';
  class RanchAudio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.rainGain = null;
      this.windGain = null;
      this.birdTimer = 0;
    }
    ensure() {
      if (this.ctx) return;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      // 雨声:高通噪声
      const rainSrc = this.ctx.createBufferSource();
      rainSrc.buffer = noiseBuf; rainSrc.loop = true;
      const rainFilter = this.ctx.createBiquadFilter();
      rainFilter.type = 'highpass'; rainFilter.frequency.value = 1200;
      this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
      rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.master);
      rainSrc.start();
      // 风声:低通噪声
      const windSrc = this.ctx.createBufferSource();
      windSrc.buffer = noiseBuf; windSrc.loop = true;
      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type = 'lowpass'; windFilter.frequency.value = 320;
      this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.04;
      windSrc.connect(windFilter).connect(this.windGain).connect(this.master);
      windSrc.start();
    }
    update(weather) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const rain = weather === 'rain' ? 0.16 : 0;
      const wind = weather === 'drought' ? 0.14 : 0.04;
      this.rainGain.gain.linearRampToValueAtTime(this.enabled ? rain : 0, t + 0.5);
      this.windGain.gain.linearRampToValueAtTime(this.enabled ? wind : 0, t + 0.5);
      if (weather === 'normal' && this.enabled && t > this.birdTimer) {
        this.birdTimer = t + 2 + Math.random() * 4;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.frequency.setValueAtTime(2200 + Math.random() * 800, t);
        osc.frequency.exponentialRampToValueAtTime(1400, t + 0.18);
        g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(g).connect(this.master);
        osc.start(t); osc.stop(t + 0.22);
      }
    }
    beep() {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square'; osc.frequency.value = 660;
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + 0.32);
    }
    toggle() {
      this.enabled = !this.enabled;
      if (this.master) this.master.gain.value = this.enabled ? 0.5 : 0;
      return this.enabled;
    }
  }
  global.RanchAudio = RanchAudio;
})(typeof window !== 'undefined' ? window : globalThis);
