/* 液压泵 WebAudio 合成：频率与滤波随泵功率（压力）变化，停机立即静音 */
(function (global) {
  'use strict';

  function PumpAudio() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.filter = null;
    this.muted = false;
    this.running = false;
  }

  PumpAudio.prototype._ensure = function () {
    if (this.ctx) {
      return;
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) {
      return;
    }
    this.ctx = new AC();
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.osc.start();
  };

  PumpAudio.prototype.setMuted = function (muted) {
    this.muted = muted;
    if (muted) {
      this.stop();
    }
  };

  PumpAudio.prototype.start = function () {
    if (this.muted) {
      return;
    }
    this._ensure();
    if (!this.ctx || this.running) {
      return;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.running = true;
  };

  PumpAudio.prototype.stop = function () {
    if (!this.ctx) {
      this.running = false;
      return;
    }
    this.running = false;
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  };

  // pumpPowerKW 为 0（停机）时声音淡出；功率越大音调越高、滤波越开
  PumpAudio.prototype.update = function (pumpPowerKW, pressure) {
    if (!this.ctx || !this.running || this.muted) {
      return;
    }
    var t = this.ctx.currentTime;
    if (pumpPowerKW <= 0) {
      this.gain.gain.setTargetAtTime(0, t, 0.08);
      return;
    }
    var baseFreq = 46 + pumpPowerKW * 2.2;
    this.osc.frequency.setTargetAtTime(baseFreq, t, 0.1);
    this.filter.frequency.setTargetAtTime(300 + pressure * 220, t, 0.1);
    this.gain.gain.setTargetAtTime(0.05 + Math.min(pumpPowerKW / 40, 1) * 0.08, t, 0.1);
  };

  global.PumpAudio = PumpAudio;
})(window);
