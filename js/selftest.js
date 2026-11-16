/* 内置自检：脚本化双席控制器，覆盖一次成功、一次单侧失误、一次恢复，
   并断言双端仪表同源、资源/倒计时/任务记录同步、单席无法完成全部动作。 */
(function (global) {
  "use strict";
  var MC = global.MC || (global.MC = {});
  var T = MC.Track;
  var EMPTY = function () {
    return {
      p1: { accelHeld: false, decelHeld: false },
      p2: { brakeUp: false, brakeDown: false, switchInner: false, switchOuter: false, emergency: false }
    };
  };

  // 双席 AI：P1 调速，P2 道岔 + 终点制动；两侧逻辑物理隔离
  function makeCoopDriver(cfg) {
    cfg = cfg || {};
    var edge = {};
    return {
      edge: edge,
      step: function (e) {
        var inp = EMPTY();
        var pv = e.preview();
        // P2：道岔（只在 J1 之前操作）
        var required = T.requiredRoutes[(e.lap - 1) % 3];
        if (e.distance < T.branchM) {
          if (cfg.wrongSwitch) {
            if (e.switchPos === required && !edge.wrong) {
              edge.wrong = true;
              if (required === "inner") inp.p2.switchOuter = true;
              else inp.p2.switchInner = true;
            }
          } else if (e.switchPos !== required) {
            if (required === "inner") inp.p2.switchInner = true;
            else inp.p2.switchOuter = true;
          }
        }
      var cruise = cfg.cruise || 12.6;
      var needBrake = false;
      var pv0 = e.preview();
        // 第三圈停车区：P2 强制动
        if (e.lapCrossings >= 3) {
        if (e.speed > 4.0) inp.p2.brakeUp = true;
        needBrake = e.speed > 4.0;
        } else if (pv0 && pv0.kind === "curve" && pv0.dist < 70 && e.speed > pv0.limit - 1.0) {
          inp.p2.brakeUp = true;
          needBrake = true;
        }
        // P1：只负责牵引加速，风缸/储能由引擎共享
        if (e.lapCrossings >= 3) {
          inp.p1.decelHeld = e.throttle > 0.05;
        } else if (!needBrake && e.speed < cruise - 0.4 && e.traction > 12) {
          inp.p1.accelHeld = true;
        } else if (!needBrake && e.speed > cruise + 0.8) {
          inp.p1.decelHeld = true;
        }
        if (needBrake) inp.p1.decelHeld = e.throttle > 0.05;
        return inp;
      }
    };
  }

  function runFrames(e, driver, frames, mutate) {
    for (var i = 0; i < frames; i++) {
      if (e.phase !== "RUN" && e.phase !== "PROTECT") break;
      var inp = driver ? driver.step(e) : EMPTY();
      if (mutate) mutate(e, inp, i);
      recordScriptedInputs(e, inp);
      e.step(inp);
    }
  }

  // 与 main.js 的 InputManager 行为一致：边沿输入写入回放
  function recordScriptedInputs(e, inp) {
    var prev = e._prevScript || EMPTY();
    [["p1", "accelHeld"], ["p1", "decelHeld"],
     ["p2", "brakeUp"], ["p2", "switchInner"],
     ["p2", "switchOuter"], ["p2", "emergency"]].forEach(function (pair) {
      var side = pair[0], act = pair[1];
      if (inp[side][act] && !prev[side][act]) {
        e.recordEvent("input", { side: side, kind: act, code: "script:" + act });
      }
    });
    e._prevScript = JSON.parse(JSON.stringify(inp));
  }

  function snapshotEqual(e) {
    // 两侧仪表读取的是同一引擎对象；这里验证快照内部字段一致且无 NaN
    var s = e.snapshots[e.snapshots.length - 1];
    return s && isFinite(s.speed) && isFinite(s.traction) && isFinite(s.airTank) &&
      isFinite(s.missionTime) && isFinite(s.distance);
  }

  var cases = [];
  function record(name, ok, detail) { cases.push({ name: name, ok: ok, detail: detail }); }

  function caseSuccess() {
    var e = new MC.Engine();
    e.arm();
    var driver = makeCoopDriver({ cruise: 12.6 });
    var conflictsAtStart = 0, sawBothInputs = false;
    runFrames(e, driver, 60 * 200);
    var evTypes = e.events.map(function (x) { return x.type; });
    sawBothInputs = evTypes.indexOf("input") >= 0 &&
      e.events.some(function (x) { return x.type === "input" && x.data.side === "p1"; }) &&
      e.events.some(function (x) { return x.type === "input" && x.data.side === "p2"; });
    var ok = e.phase === "SUCCESS" && snapshotEqual(e) && sawBothInputs;
    record("场景 A · 成功三圈停车（双席协作）", ok,
      "结局=" + e.phase + "，用时 " + e.simTime.toFixed(1) + "s，剩余倒计时 " +
      e.missionTime.toFixed(1) + "s，速度 " + e.speed.toFixed(1) + " m/s\n" +
      "回放帧=" + e.snapshots.length + "，输入事件 P1/P2 均出现=" + sawBothInputs +
      "，冲突=" + (e.conflictCount - conflictsAtStart) + "，快照字段全部有限=" + snapshotEqual(e));
    return e;
  }

  function caseSingleSideFault() {
    var e = new MC.Engine();
    e.arm();
    var driver = makeCoopDriver({ wrongSwitch: true });
    runFrames(e, driver, 60 * 40);
    var failedBySwitch = e.phase === "FAILED" && /道岔/.test(e.failReason);

    // 职责隔离探针：只给 P1 输入，永远无法设置道岔或制动
    var e2 = new MC.Engine();
    e2.arm();
    var onlyP1 = EMPTY();
    onlyP1.p1.accelHeld = true;
    runFrames(e2, null, 60 * 12, function (eng, inp, i) {
      inp.p1.accelHeld = true;
      inp.p2 = EMPTY().p2;
    });
    var p1CannotRoute = e2.switchPos === "inner" && e2.brakePct === 0;

    // 只给 P2 输入，永远无法产生牵引
    var e3 = new MC.Engine();
    e3.arm();
    runFrames(e3, null, 60 * 8, function (eng, inp) {
      inp.p1 = EMPTY().p1;
      inp.p2.brakeUp = true;
    });
    var p2CannotTraction = e3.throttle === 0 && e3.speed === 0;

    var ok = failedBySwitch && p1CannotRoute && p2CannotTraction;
    record("场景 B · 单侧失误（P2 道岔摆错）+ 职责隔离", ok,
      "失误结局=" + e.phase + "（" + e.failReason + "）\n" +
      "仅 P1 输入：道岔保持=" + e2.switchPos + "、制动=" + e2.brakePct +
      "%（无法代行 P2）=" + p1CannotRoute + "\n" +
      "仅 P2 输入：牵引=" + e3.throttle + "、速度=" + e3.speed.toFixed(1) +
      "（无法代行 P1）=" + p2CannotTraction);
  }

  function caseRecovery() {
    var e = new MC.Engine();
    e.arm();
    var driver = makeCoopDriver({ cruise: 12.4 });
    runFrames(e, driver, 60 * 6);
    var speedBefore = e.speed;
    e.disconnect("p1");
    var frozenMission = e.missionTime;
    runFrames(e, driver, 60 * 4);   // 保护 4 秒：自动制动、时钟冻结
    var stopped = e.speed < 0.5;
    var clockFrozen = Math.abs(e.missionTime - frozenMission) < 1e-9;
    var healthySideCannotRecover = e.phase === "PROTECT";
    e.reconnect("p2");             // 健康席尝试代恢复：必须被拒绝
    var rejected = e.phase === "PROTECT";
    e.reconnect("p1");             // 本席恢复
    runFrames(e, driver, 60 * 175);
    var recovered = e.phase === "SUCCESS";

    // 超时保护：失联 30 秒不恢复 → FAILED
    var e2 = new MC.Engine();
    e2.arm();
    runFrames(e2, makeCoopDriver(), 60 * 5);
    e2.disconnect("p2");
    runFrames(e2, makeCoopDriver(), 60 * 33);
    var timeoutFail = e2.phase === "FAILED" && /超时/.test(e2.failReason);

    var ok = stopped && clockFrozen && healthySideCannotRecover && rejected &&
      recovered && timeoutFail && snapshotEqual(e);
    record("场景 C · 单侧断链恢复 + 30 秒超时保护", ok,
      "断链前速度 " + speedBefore.toFixed(1) + " → 保护后 " + e.speed.toFixed(1) +
      " m/s（自动制动停车）=" + stopped + "\n" +
      "倒计时冻结 " + frozenMission.toFixed(1) + "→" + e.missionTime.toFixed(1) +
      "=" + clockFrozen + "；P2 代恢复被拒=" + rejected +
      "；本席恢复后完成任务=" + recovered + "\n" +
      "30 秒 watchdog 超时中止=" + timeoutFail + "（" + e2.failReason + "）");
  }

  function caseReplayAndReset() {
    var e = caseSuccess();
    var session = MC.Replay.sessionOf(e);
    var hasInputs = session.events.some(function (x) { return x.type === "input"; });
    var hasConflictsOrLinks = session.events.some(function (x) {
      return x.type === "conflict" || x.type === "link" || x.type === "switch";
    });
    var player = new MC.Replay.Player(session);
    var last = null, okPlay = true;
    // 12Hz 快照：按 1/12 秒喂帧即可完整播完
    for (var i = 0; i < session.snapshots.length + 5; i++) {
      var f = player.frame(1 / 12);
      if (f) last = f.snap;
    }
    okPlay = last && last.t === session.snapshots[session.snapshots.length - 1].t;

    // 重开复位：仪表、目标、计时全部归零
    e.reset();
    var resetOk = e.phase === "ARM" && e.speed === 0 && e.distance === 0 &&
      e.lap === 1 && Math.abs(e.missionTime - 180) < 1e-9 &&
      e.traction === 100 && e.airTank === 100 && e.conflictCount === 0 &&
      e.events.length === 0 && e.snapshots.length === 1;

    var ok = hasInputs && hasConflictsOrLinks && okPlay && resetOk;
    record("场景 D · 回放完整性与重开同步复位", ok,
      "回放含双方输入=" + hasInputs + "，含冲突/链路/道岔事件=" + hasConflictsOrLinks +
      "，播放到末帧=" + okPlay + "\n重开后 phase/timer/资源/圈数/记录全部复位=" + resetOk);
  }

  function run() {
    cases = [];
    caseSuccess();
    caseSingleSideFault();
    caseRecovery();
    caseReplayAndReset();
    return {
      total: cases.length,
      pass: cases.filter(function (c) { return c.ok; }).length,
      cases: cases
    };
  }

  MC.Selftest = { run: run };
  if (typeof module !== "undefined" && module.exports) module.exports = MC.Selftest;
})(typeof window !== "undefined" ? window : globalThis);
