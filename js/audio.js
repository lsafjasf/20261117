/*
 * 程序化泵机声场：曝气=低频隆隆+噪声，引水=高频水流声
 * 全部由 WebAudio 振荡器/滤波噪声合成，无外部音频文件
 */
(function (global) {
  'use strict';

  function PumpAudio() {
    this.ctx = null;
    this.enabled = true;
    this.nodes = null;
  }

  PumpAudio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();

    var master = this.ctx.createGain();
    master.gain.value = 0.0;
    master.connect(this.ctx.destination);

    // 曝气泵：低频振荡
    var osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 48;
    var oscGain = this.ctx.createGain();
    oscGain.gain.value = 0.5;
    var lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    osc.connect(oscGain).connect(lp).connect(master);
    osc.start();

    // 水流噪声：缓冲噪声 + 带通
    var len = this.ctx.sampleRate * 2;
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var noise = this.ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    var bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    var noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.4;
    noise.connect(bp).connect(noiseGain).connect(master);
    noise.start();

    this.nodes = { master: master, osc: osc, lp: lp, noiseGain: noiseGain, bp: bp };
  };

  // aeration/diversion: 0..1，连续映射到音量、音高与滤波
  PumpAudio.prototype.update = function (aeration, diversion) {
    if (!this.enabled || !this.ctx || !this.nodes) return;
    var n = this.nodes;
    var t = this.ctx.currentTime;
    var volume = 0.04 + aeration * 0.16 + diversion * 0.05;
    n.master.gain.setTargetAtTime(volume, t, 0.15);
    n.osc.frequency.setTargetAtTime(42 + aeration * 46, t, 0.1); // 曝气越强音调越高
    n.lp.frequency.setTargetAtTime(160 + aeration * 320, t, 0.1);
    n.noiseGain.gain.setTargetAtTime(diversion * 0.5, t, 0.15);  // 引水越大水流声越明显
    n.bp.frequency.setTargetAtTime(600 + diversion * 900, t, 0.15);
  };

  PumpAudio.prototype.blip = function (freq) {
    if (!this.enabled || !this.ctx) return;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq || 660;
    g.gain.setValueAtTime(0.12, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + 0.26);
  };

  PumpAudio.prototype.toggle = function () {
    this.enabled = !this.enabled;
    if (this.enabled) this.ensure();
    if (this.nodes && !this.enabled) this.nodes.master.gain.value = 0;
    return this.enabled;
  };

  global.PumpAudio = PumpAudio;
})(typeof window !== 'undefined' ? window : globalThis);
