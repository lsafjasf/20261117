/* WebAudio 环境音：连续渐变的风/水声 + 随机鸟鸣 + 临界告警，全部程序化合成 */
(function (root) {
  'use strict';

  function WetlandAudio() {
    this.ctx = null;
    this.enabled = false;
    this.master = null;
    this.windGain = null;
    this.waterGain = null;
    this._nextChirp = 0;
    this._lastAlarm = false;
  }

  WetlandAudio.prototype._ensureContext = function () {
    if (this.ctx) return;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // 风声：滤波白噪声
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const wind = this.ctx.createBufferSource();
    wind.buffer = noiseBuffer; wind.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 480;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.08;
    wind.connect(windFilter).connect(this.windGain).connect(this.master);
    wind.start();
    this.windFilter = windFilter;

    // 水声：低通噪声，音量随水位变化
    const water = this.ctx.createBufferSource();
    water.buffer = noiseBuffer; water.loop = true;
    const waterFilter = this.ctx.createBiquadFilter();
    waterFilter.type = 'lowpass'; waterFilter.frequency.value = 220;
    this.waterGain = this.ctx.createGain(); this.waterGain.gain.value = 0.05;
    water.connect(waterFilter).connect(this.waterGain).connect(this.master);
    water.start();
    this.waterFilter = waterFilter;
  };

  WetlandAudio.prototype.toggle = function () {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this._ensureContext();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } else if (this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
    return this.enabled;
  };

  WetlandAudio.prototype._chirp = function (freq) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.4, t + 0.09);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.2);
  };

  WetlandAudio.prototype._alarmBeep = function () {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 660;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.3);
  };

  // 每帧调用，根据环境状态平滑改变声音参数
  WetlandAudio.prototype.update = function (env) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (this.master.gain.value < 0.49) {
      this.master.gain.setTargetAtTime(0.5, t, 0.2);
    }
    this.windGain.gain.setTargetAtTime(0.04 + env.windMs * 0.018, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(350 + env.windMs * 90, t, 0.5);
    const waterLevel = Math.max(0, Math.min(1, (env.levelCm + 20) / 70));
    this.waterGain.gain.setTargetAtTime(0.02 + waterLevel * 0.09, t, 0.5);
    const rainBoost = env.rainy ? 0.06 : 0;
    this.waterFilter.frequency.setTargetAtTime(180 + rainBoost * 1200, t, 0.5);

    if (ctx.currentTime > this._nextChirp && env.birdDensity > 0.05) {
      this._chirp(1800 + Math.random() * 1600);
      this._nextChirp = ctx.currentTime + 0.4 + Math.random() *
        Math.max(0.3, 2.2 - env.birdDensity * 2);
    }
    const anyCrit = env.anyCritical;
    if (anyCrit && ctx.currentTime > (this._alarmAt || 0)) {
      this._alarmBeep();
      this._alarmAt = ctx.currentTime + 1.4;
    }
    this._lastAlarm = anyCrit;
  };

  root.WetlandAudio = WetlandAudio;
})(typeof self !== 'undefined' ? self : this);
