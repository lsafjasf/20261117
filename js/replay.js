/* 回放：完整保存 12Hz 共享状态快照、双方输入事件、冲突/链路事件与任务记录。
   回放只读录制数据驱动同一套仪表，回放中输入被忽略。 */
(function (global) {
  "use strict";
  var MC = global.MC || (global.MC = {});
  var STORE_KEY = "mc-replay-v1";

  function sessionOf(engine) {
    return {
      version: 1,
      startedAt: new Date().toISOString(),
      endPhase: engine.phase,
      failReason: engine.failReason,
      snapshots: engine.snapshots.map(function (s) { return s; }),
      events: engine.events.map(function (e) { return e; }),
      logs: engine.logs.slice().reverse().map(function (l) { return l; }),
      conflicts: engine.conflictCount,
      inputCounts: countInputs(engine.events)
    };
  }

  function countInputs(events) {
    var n = { p1: 0, p2: 0 };
    events.forEach(function (e) {
      if (e.type === "input") { if (e.data.side === "p1") n.p1++; else n.p2++; }
    });
    return n;
  }

  function save(session) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(session));
      return true;
    } catch (err) { return false; }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  function Player(session) {
    this.session = session;
    this.idx = 0;
    this.playing = true;
    this.speed = 1;
    this.accum = 0;
  }
  Player.prototype.frame = function (dt) {
    var snaps = this.session.snapshots;
    if (!snaps.length) return null;
    var frameStep = 1 / 12;
    if (this.playing) {
      this.accum += dt * this.speed;
      while (this.accum >= frameStep && this.idx < snaps.length - 1) {
        this.accum -= frameStep;
        this.idx++;
      }
      if (this.idx >= snaps.length - 1) this.playing = false;
    }
    var snap = snaps[this.idx];
    var nearEvents = this.session.events.filter(function (e) {
      return Math.abs(e.t - snap.t) < frameStep + 1e-6;
    });
    return { snap: snap, events: nearEvents };
  };
  Player.prototype.seek = function (ratio) {
    this.idx = Math.round(ratio * (this.session.snapshots.length - 1));
    this.accum = 0;
  };

  function describeEvent(ev) {
    var d = ev.data;
    if (ev.type === "input") {
      var who = d.side === "p1" ? "P1" : "P2";
      var names = {
        accelHeld: "增大加速度", decelHeld: "减小加速度",
        brakeUp: "增大制动", emergency: "紧急制动",
        switchInner: "道岔→内环", switchOuter: "道岔→外环"
      };
      return who + " " + (d.code || "") + " · " + (names[d.kind] || d.kind);
    }
    if (ev.type === "conflict") return "冲突：牵引 " + d.throttle + " 与制动 " + d.brake + "% 同时作用";
    if (ev.type === "link") return (d.side === "p1" ? "P1" : "P2") + " 链路" + (d.state === "offline" ? "断开" : "恢复");
    if (ev.type === "switch") return "道岔切至" + (d.pos === "inner" ? "内环" : "外环");
    if (ev.type === "result") return d.ok ? "任务成功" : "任务失败：" + d.reason;
    return ev.type;
  }

  MC.Replay = {
    sessionOf: sessionOf, save: save, load: load,
    Player: Player, describeEvent: describeEvent, STORE_KEY: STORE_KEY
  };
  if (typeof module !== "undefined" && module.exports) module.exports = MC.Replay;
})(typeof window !== "undefined" ? window : globalThis);
