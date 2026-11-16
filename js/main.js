/* 主控：固定步长模拟循环 + 单一引擎广播到双端仪表 + 全局模式编排。 */
(function () {
  "use strict";
  var MC = window.MC, T = MC.Track, Render = MC.Render;
  var engine = new MC.Engine();
  var canvas = document.getElementById("trackCanvas");
  var ctx = canvas.getContext("2d");
  var seats = { p1: MC.UI.buildSeat("p1"), p2: MC.UI.buildSeat("p2") };
  var mode = "live";                 // live / replay
  var paused = false;
  var replayPlayer = null;
  var replaySession = null;

  var input = new MC.InputManager(engine, {
    pause: togglePause,
    restart: restart,
    replay: openReplay,
    debug: toggleDebug,
    selftest: runSelftest,
    exitReplay: closeReplay,
    arm: function () { engine.arm(); }
  });
  input.attach();

  document.getElementById("btnPause").addEventListener("click", togglePause);
  document.getElementById("btnRestart").addEventListener("click", restart);
  document.getElementById("btnReplay").addEventListener("click", openReplay);
  document.getElementById("btnDebug").addEventListener("click", toggleDebug);
  document.getElementById("btnArm").addEventListener("click", function () { engine.arm(); });
  document.getElementById("btnResultRestart").addEventListener("click", function () { restart(); });
  seats.p1.querySelector("[data-link-btn]").addEventListener("click", function () {
    engine.flags.p1Linked ? engine.disconnect("p1") : engine.reconnect("p1");
  });
  seats.p2.querySelector("[data-link-btn]").addEventListener("click", function () {
    engine.flags.p2Linked ? engine.disconnect("p2") : engine.reconnect("p2");
  });

  function togglePause() {
    if (mode === "replay") return;
    if (engine.phase !== "RUN" && engine.phase !== "PROTECT") return;
    paused = !paused;
    document.getElementById("btnPause").classList.toggle("active", paused);
  }
  function toggleDebug() {
    input.setDebug(!input.debug);
    document.getElementById("btnDebug").classList.toggle("active", input.debug);
    document.getElementById("ssMode").textContent = input.debug ? "单控调试" : "双人协同";
    document.getElementById("ssModeSub").textContent = input.debug ? "DEBUG · 双席键位均可用" : "2 / 2 LINK";
    document.body.style.outline = input.debug ? "3px solid #f2c14e" : "";
    document.body.style.outlineOffset = "-6px";
  }
  function restart() {
    var wasDebug = input.debug;
    engine.reset();
    input.setDebug(wasDebug);
    paused = false;
    mode = "live";
    replayPlayer = null;
    document.getElementById("btnPause").classList.remove("active");
    document.getElementById("replayBar").classList.add("hidden");
    document.getElementById("overlayArm").classList.remove("hidden");
    document.getElementById("overlayProtect").classList.add("hidden");
    document.getElementById("overlayResult").classList.add("hidden");
    document.getElementById("missionLog").innerHTML = "";
    document.getElementById("missionLog").dataset.fingerprint = "";
  }

  // 把输入边沿写入回放与输入缓冲
  function recordInputEvents(events) {
    events.forEach(function (ev) {
      if (ev.kind === "toggleLink") {
        var f = engine.flags;
        var linked = ev.side === "p1" ? f.p1Linked : f.p2Linked;
        if (linked) engine.disconnect(ev.side);
        else engine.reconnect(ev.side);
        return;
      }
      engine.recordEvent("input", { side: ev.side, kind: ev.kind, code: ev.code });
    });
  }

  var last = performance.now();
  function loop(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (mode === "live") {
      var sampled = input.sample();
      recordInputEvents(sampled.events);
      if (!paused) engine.step({ p1: sampled.p1, p2: sampled.p2 });
      Render.drawTrack(ctx, engine);
      refresh(engine, null);
      handleOverlays();
    } else if (replayPlayer) {
      var frame = replayPlayer.frame(dt);
      if (frame) renderReplayFrame(frame);
    }
    requestAnimationFrame(loop);
  }

  function handleOverlays() {
    document.getElementById("overlayArm").classList.toggle("hidden", engine.phase !== "ARM" || mode === "replay");
    var protect = document.getElementById("overlayProtect");
    if (engine.phase === "PROTECT" && mode === "live") {
      protect.classList.remove("hidden");
      var side = engine.flags.protectedSide;
      var isP1 = side === "p1";
      document.getElementById("protectTitle").textContent =
        (isP1 ? "P1 加速席" : "P2 制动席") + " 链路保护";
      document.getElementById("protectKey").textContent = isP1 ? "Q" : "L";
      document.getElementById("protectKeySub").textContent = isP1 ? "仅 P1 本席" : "仅 P2 本席";
      document.getElementById("protectWatch").textContent =
        (MC.EngineConst.WATCHDOG_SECONDS - engine.flags.watchdog).toFixed(1) + " s watchdog";
    } else {
      protect.classList.add("hidden");
    }
    var result = document.getElementById("overlayResult");
    if ((engine.phase === "SUCCESS" || engine.phase === "FAILED") && mode === "live") {
      result.classList.remove("hidden");
      var ok = engine.phase === "SUCCESS";
      document.getElementById("resultTitle").textContent =
        ok ? "三圈协同试车成功" : "任务失败";
      document.getElementById("resultTitle").style.color = ok ? "#9be8c0" : "#ff8f8f";
      document.getElementById("resultDesc").textContent = ok
        ? "三圈完成并在终点前把速度降到 " + MC.Track.stopSpeed + " m/s 以内，双席协作达标。"
        : engine.failReason;
      document.getElementById("resultCard").style.borderColor = ok ? "#2f6e4a" : "#6e2f2f";
    } else {
      result.classList.add("hidden");
    }
  }

  requestAnimationFrame(loop);

  // ---- 回放模式 ----
  function openReplay() {
    var liveSession = MC.Replay.sessionOf(engine);
    var session = liveSession.events.length || liveSession.snapshots.length > 1
      ? liveSession : MC.Replay.load();
    if (!session) return;
    replaySession = session;
    replayPlayer = new MC.Replay.Player(session);
    mode = "replay";
    paused = false;
    var bar = document.getElementById("replayBar");
    bar.classList.remove("hidden");
    document.getElementById("overlayArm").classList.add("hidden");
    document.getElementById("overlayProtect").classList.add("hidden");
    document.getElementById("rbMeta").textContent =
      session.snapshots.length + " 帧 · " +
      (session.inputCounts.p1 + session.inputCounts.p2) + " 输入 · " + session.conflicts + " 冲突";
    var scrub = document.getElementById("rbScrub");
    scrub.max = session.snapshots.length - 1;
    scrub.oninput = function () { replayPlayer.seek(scrub.value / scrub.max); };
    document.getElementById("rbSpeed").onchange = function (e) {
      replayPlayer.speed = parseFloat(e.target.value);
    };
    document.getElementById("rbPlay").onclick = function () {
      replayPlayer.playing = !replayPlayer.playing;
      this.textContent = replayPlayer.playing ? "⏸" : "▶";
    };
    document.getElementById("rbPlay").textContent = "⏸";
  }
  function closeReplay() {
    if (mode !== "replay") return;
    mode = "live";
    replayPlayer = null;
    document.getElementById("replayBar").classList.add("hidden");
  }

  function renderReplayFrame(frame) {
    var snap = frame.snap;
    var replayLogs = replaySession.logs.filter(function (l) { return l.t <= snap.t; }).reverse();
    var fake = {
      phase: snap.phase, speed: snap.speed, distance: snap.distance, lap: snap.lap,
      switchPos: snap.switchPos, switchAligned: snap.switchAligned, flags: snap.flags,
      throttle: snap.throttle, brakePct: snap.brakePct, traction: snap.traction,
      airTank: snap.airTank, missionTime: snap.missionTime, conflictCount: snap.conflict,
      simTime: snap.t, routeChoice: function () { return snap.route; },
      preview: function () {
        var saved = { d: engine.distance, l: engine.lap, s: engine.switchPos };
        engine.distance = snap.distance; engine.lap = snap.lap; engine.switchPos = snap.switchPos;
        var pv = engine.preview();
        engine.distance = saved.d; engine.lap = saved.l; engine.switchPos = saved.s;
        return pv;
      },
      logs: replayLogs,
      events: replaySession.events
    };
    Render.drawTrack(ctx, fake);
    refresh(fake, snap);
    document.getElementById("rbScrub").value = replayPlayer.idx;
    document.getElementById("rbTime").textContent = fmtClock(snap.t);
    document.getElementById("rbEvent").textContent = frame.events.length
      ? frame.events.map(MC.Replay.describeEvent).join(" ｜ ")
      : "（本帧无输入事件）";
  }

  function refresh(e, snap) {
    // 顶部共享状态条（单一核心 → 同一组数字）
    setText("ssSpeed", e.speed.toFixed(1) + " ");
    document.getElementById("ssSpeed").innerHTML = e.speed.toFixed(1) + " <small>m/s</small>";
    setText("ssTraction", Math.round(e.traction) + "%");
    setText("ssBrake", Math.round(e.airTank) + "%");
    document.getElementById("barTraction").style.width = e.traction + "%";
    document.getElementById("barBrake").style.width = e.airTank + "%";
    setText("ssLap", "LAP " + Math.min(3, e.lap) + " / 3");
    setText("ssLapSub", Math.round(e.distance) + " m / LAP");
    setText("ssConflict", String(e.conflictCount || 0));
    var syncEl = document.getElementById("ssSync");
    if (e.phase === "PROTECT") syncEl.textContent = "保护锁定";
    else if (mode === "replay") syncEl.textContent = "回放同步";
    else syncEl.textContent = (e.flags && e.flags.p1Linked && e.flags.p2Linked)
      ? "同步" : (e.flags ? "保护锁定" : "同步");

    // 倒计时：ARM 冻结 180；PROTECT 冻结；其余逐秒
    document.getElementById("timerValue").textContent = fmtClock(Math.max(0, e.missionTime));
    document.getElementById("timerState").textContent = timerState(e);

    refreshSeat(seats.p1, "p1", e);
    refreshSeat(seats.p2, "p2", e);
    refreshLogs(e);
    refreshBuffer(e);
    document.getElementById("phaseTitle").textContent = phaseTitle(e);
    document.getElementById("phaseSub").textContent = phaseSub(e);
  }

  function refreshSeat(root, side, e) {
    var isP1 = side === "p1";
    var linked = e.flags ? (isP1 ? e.flags.p1Linked : e.flags.p2Linked) : true;
    var link = root.querySelector("[data-link]");
    link.classList.toggle("offline", !linked);
    link.querySelector("span").textContent = linked ? (mode === "replay" ? "REPLAY" : "LINK") : "OFFLINE";

    root.querySelector("[data-speed]").textContent = e.speed.toFixed(1);
    Render.drawGauge(root.querySelector("[data-gauge]"), e.speed, T.curveLimit,
      isP1 ? "#e8763c" : "#37d8cf");
    root.querySelector("[data-foot-timer]").textContent = "T- " + fmtClock(Math.max(0, e.missionTime));
    var watchEl = root.querySelector("[data-foot-watch]");
    if (watchEl) {
      var sideLinked = isP1 ? e.flags.p1Linked : e.flags.p2Linked;
      if (!sideLinked && e.phase === "PROTECT") {
        watchEl.textContent = "链路 " +
          (MC.EngineConst.WATCHDOG_SECONDS - e.flags.watchdog).toFixed(1) + "s · LOG";
        watchEl.style.color = "var(--danger)";
      } else {
        watchEl.textContent = "链路 30.0s · LOG";
        watchEl.style.color = "";
      }
    }

    if (isP1) {
      root.querySelector("[data-throttle]").textContent = e.throttle.toFixed(2);
      root.querySelector("[data-throttle-bar]").style.width = (e.throttle / 4.2 * 100) + "%";
      root.querySelector("[data-traction]").textContent = Math.round(e.traction) + "%";
      Render.drawRing(root.querySelector("[data-traction-ring]"), e.traction, "#e8763c");
      root.querySelector("[data-remote-brake]").textContent = Math.round(e.brakePct) + "%";
      root.querySelector("[data-remote-switch]").textContent = e.switchPos === "inner" ? "内环" : "外环";
      markKeys(root, ["KeyW", "KeyS"]);
    } else {
      root.querySelector("[data-brake]").textContent = Math.round(e.brakePct);
      root.querySelector("[data-brake-bar]").style.width = e.brakePct + "%";
      root.querySelector("[data-air]").textContent = Math.round(e.airTank) + "%";
      Render.drawRing(root.querySelector("[data-air-ring]"), e.airTank, "#37d8cf");
      var required = T.requiredRoutes[(e.lap - 1) % 3];
      root.querySelector("[data-required]").textContent = required === "inner" ? "内环" : "外环";
      root.querySelector("[data-j1]").textContent =
        "J1 · " + (e.distance < T.branchM ? Math.round(T.branchM - e.distance) + "m" : "已通过");
      root.querySelector("[data-aligned]").textContent =
        e.switchPos === required ? "已对齐" : "未对齐";
      root.querySelector("[data-aligned]").style.color =
        e.switchPos === required ? "var(--ok)" : "var(--warn)";
      root.querySelector("[data-remote-throttle]").textContent = e.throttle.toFixed(1);
      root.querySelector("[data-remote-traction]").textContent = Math.round(e.traction) + "%";
      markKeys(root, ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
    }
  }

  function markKeys(root, codes) {
    codes.forEach(function (code) {
      var card = root.querySelector('[data-key="' + code + '"]');
      if (card) card.classList.toggle("pressed", input.pressed.has(code) && mode === "live");
    });
  }

  function refreshLogs(e) {
    var ul = document.getElementById("missionLog");
    var fp = String(e.logs && e.logs[0] && e.logs[0].t) + "|" + (e.logs ? e.logs.length : 0) + "|" + (mode);
    if (!e.logs || ul.dataset.fingerprint === fp) return;
    ul.dataset.fingerprint = fp;
    ul.innerHTML = "";
    e.logs.slice(0, 30).forEach(function (l) {
      var li = document.createElement("li");
      var danger = l.tag === "WARN";
      li.className = (danger ? "danger" : l.tag.toLowerCase()) + (l.msg.indexOf("冲突") >= 0 ? " warn" : "");
      li.innerHTML = '<span class="t">' + fmtClock(l.t) + '</span><span class="tag">' +
        l.tag + '</span><span>' + l.msg + '</span>';
      ul.appendChild(li);
    });
  }

  function refreshBuffer(e) {
    var n = { p1: 0, p2: 0 };
    e.events && e.events.forEach(function (ev) {
      if (ev.type === "input") n[ev.data.side]++;
    });
    document.getElementById("bufP1Count").textContent = n.p1;
    document.getElementById("bufP2Count").textContent = n.p2;
    document.getElementById("bufP1").style.setProperty("--w", Math.min(100, n.p1 * 8) + "%");
    document.getElementById("bufP2").style.setProperty("--w", Math.min(100, n.p2 * 8) + "%");
    document.getElementById("bufferCount").textContent =
      (n.p1 + n.p2) + " EVENTS";
    var lastConflict = e.events && e.events.filter(function (ev) { return ev.type === "conflict"; }).pop();
    document.getElementById("bufferDetail").textContent = lastConflict
      ? MC.Replay.describeEvent(lastConflict)
      : "冲突检测：牵引与制动同时作用将写入回放。";
  }

  function timerState(e) {
    if (mode === "replay") return "回放时钟";
    if (e.phase === "ARM") return "等待授权";
    if (e.phase === "PROTECT") return "保护 · 时钟冻结";
    if (paused) return "暂停 · 时钟冻结";
    if (e.phase === "SUCCESS") return "任务完成";
    if (e.phase === "FAILED") return "任务失败";
    return "共享时钟运行中";
  }
  function phaseTitle(e) {
    if (mode === "replay") return "回放信号";
    if (e.phase === "PROTECT") return "单侧链路保护";
    if (e.phase === "SUCCESS") return "任务成功";
    if (e.phase === "FAILED") return "任务失败";
    if (e.phase === "ARM") return "双端链路待命";
    return "双席协同驾驶中";
  }
  function phaseSub(e) {
    if (e.phase === "ARM") return "等待发车授权 · 3 LAPS";
    if (e.phase === "SUCCESS") return e.failReason || "三圈停车达标";
    if (e.phase === "FAILED") return e.failReason;
    if (e.phase === "PROTECT") {
      return (e.flags.protectedSide === "p1" ? "P1 加速席" : "P2 制动席") + "失联 · 断链";
    }
    var pv = e.preview ? e.preview() : null;
    return pv ? pv.id + (pv.kind === "switch" ? " 道岔 · " : " 弯 · ") + Math.round(pv.dist) + "m" : "";
  }
  function setText(id, v) { var n = document.getElementById(id); if (n) n.textContent = v; }

  window.MC_APP = {
    engine: engine, restart: restart, getMode: function () { return mode; },
    refresh: refresh, fmtClock: fmtClock
  };
  function fmtClock(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  // 任务结束时把整场任务（双方输入/共享资源/冲突）落盘为回放
  var savedFlag = false;
  function autosave() {
    if (savedFlag) return;
    if (engine.phase === "SUCCESS" || engine.phase === "FAILED") {
      MC.Replay.save(MC.Replay.sessionOf(engine));
      savedFlag = true;
    }
  }
  setInterval(autosave, 500);
  var _origRestart = restart;
  restart = function () {
    savedFlag = false;
    _origRestart();
  };
  document.getElementById("btnRestart").onclick = null;
  document.getElementById("btnRestart").addEventListener("click", restart);

  // ---- 内置自检：成功 / 单侧失误 / 恢复 三个脚本化场景 ----
  function runSelftest() {
    var box = document.getElementById("selftest");
    box.classList.remove("hidden");
    box.innerHTML = "<h2>BUILT-IN SELFTEST / 内置自检</h2><div class='summary'>运行中…</div>";
    setTimeout(function () {
      var report = MC.Selftest.run();
      var html = "<h2>BUILT-IN SELFTEST / 内置自检</h2>" +
        "<div class='summary'>" + report.pass + "/" + report.total +
        (report.pass === report.total ? " 全部通过" : " 存在失败项") + "</div>";
      report.cases.forEach(function (c) {
        html += "<div class='case " + (c.ok ? "pass" : "fail") + "'><h3>" + c.name +
          "</h3><pre>" + c.detail + "</pre></div>";
      });
      html += "<button class='gbtn close' onclick='document.getElementById(\"selftest\").classList.add(\"hidden\")'>关闭 (F3)</button>";
      box.innerHTML = html;
    }, 30);
  }
})();
