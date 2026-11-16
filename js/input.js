/* 键盘输入：两套完全不相交的键位，浏览器原生多键同按（n-key rollover）。
   P1 永远只能产出加速席输入，P2 永远只能产出制动席输入，任何单席都无法完成全部动作。 */
(function (global) {
  "use strict";
  var MC = global.MC || (global.MC = {});

  var KEYMAP = {
    p1: {
      KeyW: "accelHeld",
      KeyS: "decelHeld",
      KeyQ: "toggleP1Link"          // 模拟 P1 断链/恢复（仅本席）
    },
    p2: {
      ArrowUp: "brakeUp",
      ArrowDown: "brakeDown",
      ArrowLeft: "switchInner",
      ArrowRight: "switchOuter",
      Space: "emergency",
      KeyL: "toggleP2Link"          // 模拟 P2 断链/恢复（仅本席）
    },
    global: {
      KeyP: "pause", KeyR: "restart", KeyV: "replay",
      F2: "debug", F3: "selftest", Escape: "exitReplay", Enter: "arm"
    }
  };

  function InputManager(engine, hooks) {
    this.engine = engine;
    this.hooks = hooks || {};
    this.debug = false;
    this.pressed = new Set();
    this.edge = new Set();
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
  }

  InputManager.prototype.attach = function () {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  };
  InputManager.prototype.detach = function () {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  };

  InputManager.prototype.onKeyDown = function (ev) {
    var code = ev.code;
    if (/^Arrow|Space$/.test(code)) ev.preventDefault();

    var g = KEYMAP.global[code];
    if (g && !ev.repeat) {
      if (this.hooks[g]) this.hooks[g]();
      return;
    }
    var p1Action = KEYMAP.p1[code];
    var p2Action = KEYMAP.p2[code];
    if (!p1Action && !p2Action) return;
    if (!ev.repeat) this.edge.add(code);
    this.pressed.add(code);
  };

  InputManager.prototype.onKeyUp = function (ev) {
    this.pressed.delete(ev.code);
  };

  InputManager.prototype.setDebug = function (on) { this.debug = on; };

  // 每帧产出引擎输入；断联席位输入被强制清空（引擎侧也会再过滤一次）
  InputManager.prototype.sample = function () {
    var held = this.pressed, edge = this.edge;
    var p1 = { accelHeld: false, decelHeld: false };
    var p2 = { brakeUp: false, brakeDown: false, switchInner: false, switchOuter: false, emergency: false };

    held.forEach(function (code) {
      var a1 = KEYMAP.p1[code];
      if (a1 === "accelHeld") p1.accelHeld = true;
      if (a1 === "decelHeld") p1.decelHeld = true;
      var a2 = KEYMAP.p2[code];
      if (a2 === "brakeUp") p2.brakeUp = true;
      if (a2 === "brakeDown") p2.brakeDown = true;
      if (a2 === "emergency") p2.emergency = true;
    });

    // 边沿动作（道岔、紧急制动）即使只点按一帧也必须送达引擎
    edge.forEach(function (code) {
      var a2 = KEYMAP.p2[code];
      if (a2 === "switchInner") p2.switchInner = true;
      if (a2 === "switchOuter") p2.switchOuter = true;
      if (a2 === "emergency") p2.emergency = true;
    });

    var events = [];
    edge.forEach((function (code) {
      var a1 = KEYMAP.p1[code], a2 = KEYMAP.p2[code];
      if (a1 === "toggleP1Link") events.push({ side: "p1", kind: "toggleLink" });
      if (a2 === "toggleP2Link") events.push({ side: "p2", kind: "toggleLink" });
      if (a1 === "accelHeld" || a1 === "decelHeld") {
        events.push({ side: "p1", kind: a1, code: code });
      }
      if (a2 && a2.indexOf("switch") === 0) events.push({ side: "p2", kind: a2, code: code });
      if (a2 === "brakeUp" || a2 === "emergency") events.push({ side: "p2", kind: a2, code: code });
    }).bind(this));
    edge.clear();

    var f = this.engine.flags;
    if (!f.p1Linked) p1 = { accelHeld: false, decelHeld: false };
    if (!f.p2Linked) p2 = { brakeUp: false, brakeDown: false, switchInner: false, switchOuter: false, emergency: false };

    return { p1: p1, p2: p2, events: events };
  };

  MC.InputManager = InputManager;
  MC.KEYMAP = KEYMAP;
  if (typeof module !== "undefined" && module.exports) module.exports = { InputManager: InputManager, KEYMAP: KEYMAP };
})(typeof window !== "undefined" ? window : globalThis);
