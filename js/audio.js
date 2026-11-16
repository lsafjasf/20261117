/* Web Audio 节拍合成与前瞻调度。
   调度时间全部换算回工程时间，与时间线/播放头共用同一时钟。 */
(function (root, factory) {
  var api = factory(
    (typeof module === "object" && module.exports) ? require("./util.js") : root.TC.util
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TC = root.TC || {};
  root.TC.audio = api;
})(typeof self !== "undefined" ? self : this, function (util) {
  "use strict";

  var SCHEDULE_AHEAD = 0.12;
  var LOOKAHEAD_MS = 25;

  /* 合成节拍包络峰值（纯数据，供波形轨道绘制与 Node 测试）。 */
  function synthesizeEnvelope(kind) {
    var samples = 64;
    var out = new Array(samples);
    for (var i = 0; i < samples; i++) {
      var x = i / samples;
      var amp;
      if (kind === "kick") {
        amp = Math.exp(-x * 9) * (1 - 0.3 * x);
      } else if (kind === "snare") {
        amp = Math.exp(-x * 12) * (0.7 + 0.3 * Math.sin(x * 40));
      } else {
        amp = Math.exp(-x * 22) * 0.7;
      }
      out[i] = Number(amp.toFixed(4));
    }
    return out;
  }

  /* 生成整条节拍轨的波形峰值序列：每 0.02s 一个点。 */
  function buildBeatPeaks(beats, duration, resolutionSec) {
    var step = resolutionSec || 0.02;
    var bins = Math.ceil(duration / step);
    var peaks = new Float32Array(bins);
    var envelopes = {
      kick: synthesizeEnvelope("kick"),
      snare: synthesizeEnvelope("snare"),
      hat: synthesizeEnvelope("hat")
    };
    beats.forEach(function (beat) {
      var env = envelopes[beat.kind] || envelopes.hat;
      var eventLen = beat.kind === "hat" ? 0.12 : 0.3;
      var startBin = Math.min(bins - 1, Math.floor(beat.time / step));
      var spanBins = Math.max(1, Math.round(eventLen / step));
      for (var k = 0; k < spanBins && startBin + k < bins; k++) {
        var envIndex = Math.min(env.length - 1, Math.floor((k / spanBins) * env.length));
        var value = env[envIndex] * beat.velocity;
        if (value > peaks[startBin + k]) peaks[startBin + k] = value;
      }
    });
    return peaks;
  }

  function BeatEngine(AudioContextCtor) {
    this.ctx = null;
    this.master = null;
    this.timer = null;
    this.AudioContextCtor = AudioContextCtor ||
      (typeof self !== "undefined" ? (self.AudioContext || self.webkitAudioContext) : null);
    this.nextBeatIndex = 0;
    this.scheduleOriginCtxTime = 0;
    this.scheduleOriginProjectTime = 0;
  }

  BeatEngine.prototype.ensureContext = function () {
    if (this.ctx) return this.ctx;
    if (!this.AudioContextCtor) throw new Error("当前环境不支持 Web Audio");
    this.ctx = new this.AudioContextCtor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  };

  BeatEngine.prototype.trigger = function (kind, when, velocity) {
    var ctx = this.ctx;
    var v = velocity || 0.9;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    gain.connect(this.master);
    if (kind === "kick") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, when);
      osc.frequency.exponentialRampToValueAtTime(48, when + 0.12);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(v, when + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
      osc.connect(gain);
      osc.start(when);
      osc.stop(when + 0.3);
    } else if (kind === "snare") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(220, when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(v * 0.7, when + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
      osc.connect(gain);
      osc.start(when);
      osc.stop(when + 0.2);
      var noise = ctx.createBufferSource();
      var buffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      noise.buffer = buffer;
      var noiseGain = ctx.createGain();
      noiseGain.gain.value = v * 0.35;
      noise.connect(noiseGain).connect(this.master);
      noise.start(when);
      noise.stop(when + 0.2);
    } else {
      osc.type = "square";
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(v * 0.35, when + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
      osc.connect(gain);
      osc.start(when);
      osc.stop(when + 0.08);
    }
  };

  /* 启动调度：传入工程起始时间（通常是当前播放头）与节拍列表。 */
  BeatEngine.prototype.start = function (projectTime, beats) {
    var ctx = this.ensureContext();
    if (ctx.state === "suspended") ctx.resume();
    this.beats = beats;
    this.scheduleOriginCtxTime = ctx.currentTime + 0.02;
    this.scheduleOriginProjectTime = projectTime;
    this.nextBeatIndex = beats.findIndex(function (b) { return b.time >= projectTime - util.EPS; });
    if (this.nextBeatIndex === -1) this.nextBeatIndex = beats.length;
    this.runScheduler();
  };

  /* 工程时间 -> AudioContext 时间（单一映射函数）。 */
  BeatEngine.prototype.projectTimeToCtxTime = function (projectTime) {
    return this.scheduleOriginCtxTime + (projectTime - this.scheduleOriginProjectTime);
  };

  BeatEngine.prototype.runScheduler = function () {
    var self = this;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(function () {
      if (!self.ctx) return;
      var horizonProject = self.scheduleOriginProjectTime +
        (self.ctx.currentTime + SCHEDULE_AHEAD - self.scheduleOriginCtxTime);
      while (self.nextBeatIndex < self.beats.length &&
             self.beats[self.nextBeatIndex].time <= horizonProject) {
        var beat = self.beats[self.nextBeatIndex];
        var when = self.projectTimeToCtxTime(beat.time);
        if (when >= self.ctx.currentTime - 0.001) {
          self.trigger(beat.kind, when, beat.velocity);
        }
        self.nextBeatIndex += 1;
      }
    }, LOOKAHEAD_MS);
  };

  BeatEngine.prototype.stop = function () {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.nextBeatIndex = 0;
  };

  BeatEngine.prototype.suspend = function () {
    this.stop();
    if (this.ctx && this.ctx.state === "running") this.ctx.suspend();
  };

  return {
    SCHEDULE_AHEAD: SCHEDULE_AHEAD,
    LOOKAHEAD_MS: LOOKAHEAD_MS,
    synthesizeEnvelope: synthesizeEnvelope,
    buildBeatPeaks: buildBeatPeaks,
    BeatEngine: BeatEngine
  };
});
