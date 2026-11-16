/* 统一时间基准（single source of truth）。
   节目时间线、画面播放头、音频事件全部读取 state.timeline.time。 */
(function (root, factory) {
  var api = factory(
    (typeof module === "object" && module.exports) ? require("./util.js") : root.TC.util
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TC = root.TC || {};
  root.TC.transport = api;
})(typeof self !== "undefined" ? self : this, function (util) {
  "use strict";

  function Transport(project, engine) {
    this.project = project;
    this.engine = engine || null;
    this.state = "stopped";
    this.time = 0;
    this.rafId = 0;
    this.lastWallMs = 0;
    this.tickListeners = [];
    this.loopListeners = [];
    this.loopCount = 0;
    this.boundFrame = this.frame.bind(this);
    this.now = function () {
      return (typeof performance !== "undefined" && performance.now)
        ? performance.now()
        : Date.now();
    };
  }

  Transport.prototype.attachEngine = function (engine) {
    this.engine = engine;
  };

  Transport.prototype.updateProject = function (project) {
    this.project = project;
    this.time = util.clamp(this.time, 0, project.duration);
  };

  Transport.prototype.onTick = function (fn) {
    this.tickListeners.push(fn);
  };

  Transport.prototype.onLoop = function (fn) {
    this.loopListeners.push(fn);
  };

  Transport.prototype.snapshot = function () {
    return {
      state: this.state,
      time: Number(this.time.toFixed(6)),
      duration: this.project.duration,
      loop: util.deepClone(this.project.loop),
      loopCount: this.loopCount
    };
  };

  Transport.prototype.play = function () {
    if (this.state === "playing") return;
    if (this.time >= this.project.duration - util.EPS) this.time = 0;
    this.state = "playing";
    this.lastWallMs = this.now();
    if (this.engine) this.engine.start(this.time, this.project.beats);
    this.startRaf();
    this.emit();
  };

  Transport.prototype.pause = function () {
    if (this.state !== "playing") return;
    this.state = "paused";
    if (this.engine) this.engine.stop();
    this.cancelRaf();
    this.emit();
  };

  Transport.prototype.stop = function () {
    this.state = "stopped";
    this.time = 0;
    this.loopCount = 0;
    if (this.engine) this.engine.stop();
    this.cancelRaf();
    this.emit();
  };

  Transport.prototype.seek = function (time) {
    var target = util.clamp(time, 0, this.project.duration);
    this.time = target;
    if (this.state === "playing") {
      if (this.engine) this.engine.start(target, this.project.beats);
      this.lastWallMs = this.now();
    }
    this.emit();
  };

  Transport.prototype.startRaf = function () {
    this.cancelRaf();
    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(this.boundFrame);
    } else {
      this.rafId = setInterval(this.boundFrame, 16);
    }
  };

  Transport.prototype.cancelRaf = function () {
    if (!this.rafId) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.rafId);
    else clearInterval(this.rafId);
    this.rafId = 0;
  };

  /* 每帧：唯一的时间推进点。处理循环与自然停止。 */
  Transport.prototype.frame = function () {
    if (this.state !== "playing") return;
    var wall = this.now();
    var delta = (wall - this.lastWallMs) / 1000;
    this.lastWallMs = wall;
    this.time += delta;

    var loop = this.project.loop;
    if (loop.enabled && this.time >= loop.end) {
      this.loopCount += 1;
      this.time = loop.start;
      if (this.engine) this.engine.start(loop.start, this.project.beats);
      this.loopListeners.forEach(function (fn) { fn(loop.start, loop.end); });
    } else if (!loop.enabled && this.time >= this.project.duration) {
      this.time = this.project.duration;
      this.state = "stopped";
      if (this.engine) this.engine.stop();
      this.cancelRaf();
    }
    this.emit();
    if (this.state === "playing") this.startRaf();
  };

  Transport.prototype.emit = function () {
    var snap = this.snapshot();
    this.tickListeners.forEach(function (fn) { fn(snap); });
  };

  /* 测试辅助：手动推进虚拟时间（无 RAF 环境）。 */
  Transport.prototype.advanceForTest = function (deltaSec) {
    if (this.state !== "playing") return;
    this.time += deltaSec;
    if (this.project.loop.enabled && this.time >= this.project.loop.end) {
      this.time = this.project.loop.start;
      this.loopCount += 1;
    } else if (this.time >= this.project.duration) {
      this.time = this.project.duration;
      this.state = "stopped";
    }
    this.emit();
  };

  Transport.prototype.dispose = function () {
    this.cancelRaf();
    if (this.engine) this.engine.stop();
    this.state = "stopped";
    this.tickListeners = [];
    this.loopListeners = [];
  };

  return { Transport: Transport };
});
