/* audio.js - WebAudio 程序化音效：风噪随风速，电机随高度，张力随载重/制动 */
(function () {
  'use strict';

  function WindAudio() {
    this.ctx = null;
    this.enabled = true;
    this.nodes = null;
  }

  WindAudio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    var ctx = this.ctx;

    var master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    var windBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    var data = windBuffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    var noise = ctx.createBufferSource();
    noise.buffer = windBuffer;
    noise.loop = true;
    var windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.7;
    var windGain = ctx.createGain();
    windGain.gain.value = 0.0;
    noise.connect(windFilter).connect(windGain).connect(master);
    noise.start();

    var motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.value = 70;
    var motorGain = ctx.createGain();
    motorGain.gain.value = 0.0;
    motor.connect(motorGain).connect(master);
    motor.start();

    var tension = ctx.createOscillator();
    tension.type = 'triangle';
    tension.frequency.value = 220;
    var tensionGain = ctx.createGain();
    tensionGain.gain.value = 0.0;
    tension.connect(tensionGain).connect(master);
    tension.start();

    this.nodes = {
      master: master,
      windFilter: windFilter,
      windGain: windGain,
      motor: motor,
      motorGain: motorGain,
      tension: tension,
      tensionGain: tensionGain
    };
  };

  WindAudio.prototype.setEnabled = function (on) {
    this.enabled = on;
    if (this.nodes) {
      this.nodes.master.gain.setTargetAtTime(on ? 0.5 : 0.0,
        this.ctx.currentTime, 0.05);
    }
  };

  WindAudio.prototype.blip = function (freq) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    var osc = this.ctx.createOscillator();
    var gain = this.ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,
      this.ctx.currentTime + 0.25);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.26);
  };

  WindAudio.prototype.update = function (s, engine, input) {
    if (!this.enabled || !this.ctx || !this.nodes) return;
    var ctx = this.ctx;
    var n = this.nodes;
    var wind = engine.windAt(s.map, s.t, s.y);
    var windSpeed = Math.abs(wind);
    var heightRatio = s.y / engine.TOWER_H;
    var load = engine.loadFactor(s);
    var now = ctx.currentTime;

    n.windGain.gain.setTargetAtTime(
      Math.min(0.22, 0.02 + windSpeed * 0.022), now, 0.1);
    n.windFilter.frequency.setTargetAtTime(
      350 + windSpeed * 110 + heightRatio * 180, now, 0.1);

    var motorOn = input && input.throttle && s.status === 'running' && !s.paused;
    n.motorGain.gain.setTargetAtTime(motorOn ? 0.1 : 0.0, now, 0.08);
    n.motor.frequency.setTargetAtTime(
      60 + heightRatio * 90 + (motorOn ? Math.abs(input.throttle) * 35 : 0),
      now, 0.08);

    var tensionLevel = (load - 1) * 0.06 +
      (input && input.brake ? 0.08 : 0) +
      (s.iceLocked ? 0.1 : 0);
    n.tensionGain.gain.setTargetAtTime(
      Math.min(0.14, tensionLevel), now, 0.1);
    n.tension.frequency.setTargetAtTime(
      200 + (load - 1) * 120 + heightRatio * 60 +
      (s.iceLocked ? 90 : 0), now, 0.15);
  };

  window.WindAudio = WindAudio;
})();
