(function () {
  "use strict";

  const Sim = window.RigSim;
  const Renderer = window.RigRender;
  if (!Sim || !Renderer) throw new Error("RigSim / RigRender 未加载");

  const byId = (id) => document.getElementById(id);
  const scene = byId("scene");
  const context = scene.getContext("2d");
  const replayCanvas = byId("replayCanvas");
  const replayContext = replayCanvas.getContext("2d");

  let state = Sim.createState();
  let recording = newRecording();
  let archivedRecording = null;
  let lastTimestamp = performance.now();
  let accumulator = 0;
  let lastSnapshotAt = -1;
  let lastStatus = state.status;
  let lastLogSignature = "";
  let debugVisible = false;
  let viewport = { width: 1, height: 1, dpr: 1 };
  const keyOwner = { a: "left", d: "left", s: "left", j: "right", l: "right", k: "right" };
  const replay = {
    open: false,
    playing: false,
    time: 0,
    duration: 1,
    source: null,
    frames: [],
    filter: "all",
    rasterized: false,
  };

  const ui = {
    missionStatus: byId("missionStatus"),
    missionCode: byId("missionCode"),
    missionClock: byId("missionClock"),
    clockState: byId("clockState"),
    windValue: byId("windValue"),
    windLabel: byId("windLabel"),
    windArrow: byId("windArrow"),
    targets: [...document.querySelectorAll(".target")],
    installLabel: byId("installLabel"),
    installPct: byId("installPct"),
    installBar: byId("installBar"),
    syncHint: byId("syncHint"),
    leftLink: byId("leftLink"),
    rightLink: byId("rightLink"),
    leftSpeed: byId("leftSpeed"),
    leftSpeedBar: byId("leftSpeedBar"),
    leftPos: byId("leftPos"),
    leftPosBar: byId("leftPosBar"),
    rightAngle: byId("rightAngle"),
    rightAngleMarker: byId("rightAngleMarker"),
    rightError: byId("rightError"),
    rightErrorBar: byId("rightErrorBar"),
    leftTime: byId("leftTime"),
    leftWind: byId("leftWind"),
    leftSpares: byId("leftSpares"),
    leftTool: byId("leftTool"),
    rightTime: byId("rightTime"),
    rightWind: byId("rightWind"),
    rightSpares: byId("rightSpares"),
    rightTool: byId("rightTool"),
    taskLog: byId("taskLog"),
    logSync: byId("logSync"),
    swingReadout: byId("swingReadout"),
    targetReadout: byId("targetReadout"),
    inputReadout: byId("inputReadout"),
    toastLayer: byId("toastLayer"),
    protectionBanner: byId("protectionBanner"),
    protectionText: byId("protectionText"),
    pauseOverlay: byId("pauseOverlay"),
    endOverlay: byId("endOverlay"),
    endEyebrow: byId("endEyebrow"),
    endTitle: byId("endTitle"),
    endText: byId("endText"),
    endTime: byId("endTime"),
    endConflicts: byId("endConflicts"),
    endRecoveries: byId("endRecoveries"),
    debugPanel: byId("debugPanel"),
    debugX: byId("debugX"),
    debugVx: byId("debugVx"),
    debugTheta: byId("debugTheta"),
    debugError: byId("debugError"),
    debugFeed: byId("debugFeed"),
    replayOverlay: byId("replayOverlay"),
    replayInputCount: byId("replayInputCount"),
    replayConflictCount: byId("replayConflictCount"),
    replayEvents: byId("replayEvents"),
    replayTime: byId("replayTime"),
    replaySpares: byId("replaySpares"),
    replayTool: byId("replayTool"),
    replayTarget: byId("replayTarget"),
    replayWind: byId("replayWind"),
    replayClock: byId("replayClock"),
    replayScrubber: byId("replayScrubber"),
    replayToggle: byId("replayToggle"),
    pauseButton: document.querySelector('[data-action="pause"]'),
    replayButton: document.querySelector('[data-action="replay"]'),
    debugButton: document.querySelector('[data-action="debug"]'),
  };

  function newRecording() {
    return {
      startedAt: Date.now(),
      history: [],
      lastFeedId: 0,
      outcome: "running",
      title: "M-0717",
    };
  }

  function captureSnapshot(force) {
    if (!force && Math.abs(state.elapsed - lastSnapshotAt) < 0.2) return;
    lastSnapshotAt = state.elapsed;
    recording.history.push({
      t: +state.elapsed.toFixed(3),
      snap: Sim.snapshot(state),
    });
    if (recording.history.length > 2000) recording.history.splice(0, 300);
  }

  function currentRecording() {
    return {
      ...recording,
      feed: state.feed,
      taskLog: state.taskLog,
      outcome: state.status,
      stats: { ...state.stats },
      timeLeft: state.timeLeft,
      elapsed: state.elapsed,
    };
  }

  function resizeCanvas(canvas, ctx) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, dpr };
  }

  function updateViewport() {
    viewport = resizeCanvas(scene, context);
  }

  function toast(message, tone) {
    while (ui.toastLayer.children.length >= 2) {
      ui.toastLayer.firstElementChild.remove();
    }
    const node = document.createElement("div");
    node.className = `toast ${tone || ""}`;
    node.textContent = message;
    ui.toastLayer.appendChild(node);
    window.setTimeout(() => {
      node.classList.add("out");
      window.setTimeout(() => node.remove(), 280);
    }, 2800);
  }

  function syncDebugPanel() {
    ui.debugPanel.classList.toggle("is-hidden", !debugVisible);
    document.body.classList.toggle("debug-active", Boolean(state.debugSolo));
    ui.debugButton.classList.toggle("active", debugVisible);
  }

  function archiveCurrent() {
    const inputs = state.feed.filter((event) => event.type === "input").length;
    if (inputs === 0) return;
    archivedRecording = currentRecording();
    archivedRecording.history = recording.history.slice();
    archivedRecording.feed = state.feed.slice();
    archivedRecording.taskLog = state.taskLog.slice();
  }

  function restart() {
    archiveCurrent();
    ui.toastLayer.replaceChildren();
    const keepDebug = state.debugSolo;
    const keepFreeze = state.debugFreezeWind;
    state = Sim.createState();
    state.debugSolo = keepDebug;
    state.debugFreezeWind = keepFreeze;
    recording = newRecording();
    lastSnapshotAt = -1;
    lastStatus = state.status;
    lastLogSignature = "";
    accumulator = 0;
    captureSnapshot(true);
    closeReplay();
    ui.pauseOverlay.classList.add("is-hidden");
    ui.endOverlay.classList.add("is-hidden");
    ui.protectionBanner.classList.add("is-hidden");
    toast("仪表、目标与计时已同步复位", "success");
  }

  function togglePause() {
    if (replay.open) return;
    const paused = Sim.togglePause(state);
    ui.pauseOverlay.classList.toggle("is-hidden", !paused);
    if (paused) toast("共享计时冻结", "warn");
  }

  function toggleDebug() {
    debugVisible = !debugVisible;
    state.debugSolo = debugVisible;
    if (debugVisible) {
      toast("单人调试：两席键位均开放，自动链路超时关闭", "warn");
      Sim.pushLog(state, "system", "单人调试开启 · 双席键位可独立测试", "warn");
    } else {
      state.links.left.lastInput = state.elapsed;
      state.links.right.lastInput = state.elapsed;
      toast("单人调试关闭 · 双席链路保护恢复", "success");
    }
    syncDebugPanel();
  }

  function handleAction(action) {
    if (action === "pause") togglePause();
    else if (action === "restart") restart();
    else if (action === "debug") toggleDebug();
    else if (action === "replay") openReplay();
    else if (action === "restore") {
      if (Sim.restoreLink(state)) {
        ui.protectionBanner.classList.add("is-hidden");
        toast("链路已恢复 · 保持双方操作分工", "success");
      }
    } else if (action === "freeze-wind") {
      state.debugFreezeWind = !state.debugFreezeWind;
      toast(state.debugFreezeWind ? "调试风场已冻结" : "调试风场已恢复", "warn");
    } else if (action === "drop-left") {
      Sim.activateProtection(state, "left", "disconnect");
    } else if (action === "drop-right") {
      Sim.activateProtection(state, "right", "disconnect");
    } else if (action === "export") {
      exportReplay();
    } else if (action === "close-replay") {
      closeReplay();
    } else if (action === "replay-toggle") {
      toggleReplayPlayback();
    }
  }

  document.addEventListener("click", (event) => {
    const targetNode = event.target.closest("[data-action]");
    if (!targetNode) return;
    handleAction(targetNode.dataset.action);
  });

  const railTabs = [...document.querySelectorAll("[data-rail]")];
  railTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      replay.filter = tab.dataset.rail;
      railTabs.forEach((other) => other.classList.toggle("active", other === tab));
      renderReplayEvents();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "tab") {
      event.preventDefault();
      if (replay.open) closeReplay();
      else openReplay();
      return;
    }
    if (key === "escape" && replay.open) {
      event.preventDefault();
      closeReplay();
      return;
    }
    if (key === "f1") {
      event.preventDefault();
      toggleDebug();
      return;
    }
    if (key === "p" && !event.repeat) {
      event.preventDefault();
      togglePause();
      return;
    }
    if (key === "r" && !event.repeat) {
      event.preventDefault();
      restart();
      return;
    }
    if (key === "y" && !event.repeat) {
      event.preventDefault();
      if (state.protection) handleAction("restore");
      return;
    }
    if (replay.open || event.repeat || !keyOwner[key]) return;
    event.preventDefault();
    Sim.setKey(state, keyOwner[key], key, true, "keyboard");
  });

  document.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (!keyOwner[key]) return;
    event.preventDefault();
    Sim.setKey(state, keyOwner[key], key, false, "keyboard");
  });

  window.addEventListener("resize", updateViewport);
  window.addEventListener("blur", () => {
    if (state.status === "running" && !state.paused && !state.protection && !replay.open) {
      Sim.togglePause(state);
      ui.pauseOverlay.classList.remove("is-hidden");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.status === "running" && !state.paused && !replay.open) {
      Sim.togglePause(state);
      ui.pauseOverlay.classList.remove("is-hidden");
    }
  });

  function updateBindings() {
    const cards = [
      [byId("p1Card"), ["a", "d", "s"]],
      [byId("p2Card"), ["j", "l", "k"]],
    ];
    cards.forEach(([card, keys]) => {
      const bindings = [...card.querySelectorAll(".binding")];
      bindings.forEach((node, index) => {
        node.classList.toggle("active", Boolean(state.keys[keys[index]]));
      });
    });
  }

  function syncTaskLog() {
    const entries = state.taskLog.slice(0, 4);
    const signature = entries.map((entry) => `${entry.at.toFixed(2)}:${entry.text}`).join("|");
    if (signature === lastLogSignature) return;
    const isNew = lastLogSignature !== "" && state.elapsed > 0.1;
    lastLogSignature = signature;
    ui.taskLog.replaceChildren();
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = entry.tone || "";
      const time = document.createElement("span");
      time.className = "log-time";
      time.textContent = entry.clock;
      const channel = document.createElement("span");
      channel.className = "log-channel";
      channel.textContent = entry.channel;
      const text = document.createElement("span");
      text.className = "log-text";
      text.textContent = entry.text;
      item.append(time, channel, text);
      ui.taskLog.appendChild(item);
    });
    if (isNew && entries[0]) {
      const latest = entries[0];
      if (["warn", "danger", "success"].includes(latest.tone)) {
        toast(latest.text, latest.tone === "warn" ? "warn" : latest.tone);
      }
    }
  }

  function updateTargets(metrics) {
    ui.targets.forEach((node, index) => {
      const pulley = state.pulleys[index];
      const current = index === state.targetIndex && state.status === "running";
      node.classList.toggle("active", current);
      node.classList.toggle("done", pulley.status === "done");
      const sub = node.querySelector("small");
      if (pulley.status === "done") sub.textContent = "已更换";
      else if (current) sub.textContent = state.clampHeld ? "夹持作业" : "待更换";
      else sub.textContent = "待更换";
      const bar = node.querySelector(".target-bar b");
      const progress = pulley.status === "done" ? 1 : current ? state.installProgress : 0;
      bar.style.width = `${Math.round(progress * 100)}%`;
    });
    const current = state.pulleys[state.targetIndex];
    ui.targetReadout.textContent = current
      ? `P-${state.targetIndex + 1} / ${current.x}m`
      : "全部完成";

    const install = state.resources.tool === "lost"
      ? state.resources.recoveryProgress
      : state.installProgress;
    ui.installPct.textContent = `${Math.round(install * 100)}%`;
    ui.installBar.style.width = `${Math.round(install * 100)}%`;
    if (state.resources.tool === "lost") {
      ui.installLabel.textContent = state.clampHeld ? "工具回收中" : "锁扣遗失";
      ui.syncHint.textContent = state.clampHeld
        ? "左席对准红标并低速 · 右席保持 K 收绳"
        : "左席驶向坠落点 · 右席按住 K 收绳";
    } else if (state.status === "won") {
      ui.installLabel.textContent = "三组滑轮完成";
      ui.syncHint.textContent = "索道恢复 · 可重开或查看双通道回放";
    } else if (state.clampHeld) {
      ui.installLabel.textContent = metrics && metrics.aligned ? "双席对位保持" : "夹持偏位";
      ui.syncHint.textContent = metrics && metrics.aligned
        ? "保持左席低速与右席摆角，直至安装完成"
        : "调整吊篮位置或摆臂角，进度正在回退";
    } else if (metrics && metrics.aligned) {
      ui.installLabel.textContent = "可夹持 · 按住 K";
      ui.syncHint.textContent = "对位成功 · 右席按住 K 开始安装";
    } else if (metrics && metrics.distanceOk && metrics.angleOk && !metrics.speedOk) {
      ui.installLabel.textContent = "吊篮速度过高";
      ui.syncHint.textContent = "左席收油或短按 S 控速 · 右席保持摆角";
    } else {
      ui.installLabel.textContent = "等待双方对位";
      ui.syncHint.textContent = "左席定位 · 右席 J/L 摆臂 · 对准后按住 K";
    }
  }

  function updateUi() {
    const metrics = Sim.alignMetrics(state, Sim.target(state));
    const clock = Sim.formatClock(state.timeLeft);
    const spares = `${state.resources.spares}/3`;
    const tool = state.resources.tool === "secured" ? "在位" : state.resources.tool === "lost" ? "遗失" : "回收中";
    const statusText =
      state.protection ? "链路保护" :
      state.status === "won" ? "任务完成" :
      state.status === "lost" ? "时间耗尽" :
      state.paused ? "维修暂停" : "作业中";

    ui.missionStatus.textContent = statusText;
    ui.missionStatus.parentElement.classList.toggle(
      "alert",
      Boolean(state.protection) || state.status === "lost"
    );
    ui.missionClock.textContent = clock;
    ui.missionClock.parentElement.classList.toggle("warning", state.timeLeft <= 45 && state.timeLeft > 18);
    ui.missionClock.parentElement.classList.toggle("critical", state.timeLeft <= 18);
    ui.clockState.textContent =
      state.protection ? "链路保护 · 计时冻结" :
      state.paused ? "暂停 · 计时冻结" :
      state.status === "won" ? "维修窗口关闭" :
      state.status === "lost" ? "维修窗口已关闭" :
      state.timeLeft <= 18 ? "风窗临界 · 尽快收尾" : "倒计时进行中";
    ui.windValue.textContent = state.wind.value.toFixed(1);
    ui.windLabel.textContent = state.wind.gust > 4.7 ? "阵风 · 强扰动" : "侧风 · 稳定";
    ui.windArrow.style.transform = `rotate(${state.wind.dir > 0 ? 82 : -82}deg)`;

    const speed = Math.abs(state.trolley.vx);
    ui.leftSpeed.textContent = speed.toFixed(1);
    ui.leftSpeedBar.style.width = `${Math.min(100, (speed / 220) * 100)}%`;
    ui.leftSpeedBar.style.background = speed > 92 ? "var(--red)" : "var(--cyan)";
    ui.leftPos.textContent = Math.round(state.trolley.x);
    ui.leftPosBar.style.width = `${Math.min(
      100,
      ((state.trolley.x - Sim.CONFIG.world.minX) /
        (Sim.CONFIG.world.maxX - Sim.CONFIG.world.minX)) *
        100
    )}%`;

    const degrees = (state.arm.angle * 180) / Math.PI;
    ui.rightAngle.textContent = `${degrees >= 0 ? "+" : ""}${degrees.toFixed(0)}`;
    ui.rightAngleMarker.style.left = `${50 + (state.arm.angle / 1.03) * 50}%`;
    if (metrics.valid) {
      const errorPx = Math.round(metrics.xError);
      ui.rightError.textContent = `${errorPx > 0 ? "+" : ""}${errorPx}`;
      const width = Math.min(50, (Math.abs(metrics.xError) / Sim.CONFIG.physics.clampDistance) * 50);
      ui.rightErrorBar.style.left = metrics.xError < 0 ? `${50 - width}%` : "50%";
      ui.rightErrorBar.style.width = `${width}%`;
      ui.rightErrorBar.style.background = metrics.distanceOk
        ? metrics.aligned ? "var(--green)" : "var(--amber)"
        : "var(--red)";
    } else {
      ui.rightError.textContent = "--";
      ui.rightErrorBar.style.width = "0%";
    }

    [ui.leftTime, ui.rightTime].forEach((node) => (node.textContent = clock));
    [ui.leftWind, ui.rightWind].forEach((node) => (node.textContent = state.wind.value.toFixed(1)));
    [ui.leftSpares, ui.rightSpares].forEach((node) => (node.textContent = spares));
    [ui.leftTool, ui.rightTool].forEach((node) => {
      node.textContent = tool;
      node.style.color = tool === "遗失" ? "var(--red)" : tool === "回收中" ? "var(--amber)" : "";
    });

    const leftLinkState =
      state.protection && state.protection.side === "left" ? state.protection.reason :
      state.links.left.state;
    const rightLinkState =
      state.protection && state.protection.side === "right" ? state.protection.reason :
      state.links.right.state;
    ui.leftLink.classList.toggle("offline", leftLinkState !== "online");
    ui.rightLink.classList.toggle("offline", rightLinkState !== "online");
    ui.leftLink.innerHTML = `<i></i>${leftLinkState === "online" ? "链路" : leftLinkState === "timeout" ? "超时" : "断开"}`;
    ui.rightLink.innerHTML = `<i></i>${rightLinkState === "online" ? "链路" : rightLinkState === "timeout" ? "超时" : "断开"}`;

    updateBindings();
    updateTargets(metrics);
    syncTaskLog();

    ui.swingReadout.textContent = `${((state.swing.theta * 180) / Math.PI).toFixed(1)}°`;
    ui.inputReadout.textContent = `L ${state.stats.inputs.left} / R ${state.stats.inputs.right}`;
    ui.logSync.textContent = state.protection ? "保护锁定 · HOLD" : state.paused ? "冻结 · HOLD" : "双席同步 · LIVE";

    ui.protectionBanner.classList.toggle("is-hidden", !state.protection);
    if (state.protection) {
      ui.protectionText.textContent = state.protection.message;
    }
    ui.pauseOverlay.classList.toggle(
      "is-hidden",
      !state.paused || state.status !== "running" || Boolean(state.protection) || replay.open
    );

    ui.debugX.textContent = state.trolley.x.toFixed(1);
    ui.debugVx.textContent = state.trolley.vx.toFixed(1);
    ui.debugTheta.textContent = state.swing.theta.toFixed(3);
    ui.debugError.textContent = metrics.valid
      ? `${metrics.xError.toFixed(1)} / ${metrics.angleError.toFixed(3)}`
      : "--";
    ui.debugFeed.textContent = String(state.feed.length);

    if (state.status !== lastStatus) {
      if (state.status === "won") showEnd(true);
      else if (state.status === "lost") showEnd(false);
      lastStatus = state.status;
    }
  }

  function showEnd(success) {
    ui.endOverlay.classList.remove("is-hidden");
    ui.endEyebrow.textContent = success ? "MISSION COMPLETE" : "WINDOW CLOSED";
    ui.endTitle.textContent = success ? "索道恢复" : "维修窗口关闭";
    ui.endText.textContent = success
      ? "三组滑轮更换完成，双方共享记录与仪表保持同步。"
      : "倒计时归零。回放保留双方输入、资源与冲突时刻。";
    ui.endTime.textContent = Sim.formatClock(state.timeLeft);
    ui.endConflicts.textContent = String(state.stats.conflicts);
    ui.endRecoveries.textContent = String(state.stats.recoveries);
  }

  function buildReplayFrames(source) {
    const frames = [];
    (source.history || []).forEach((entry) => {
      if (entry && entry.snap) frames.push({ t: entry.t, snap: entry.snap });
    });
    (source.feed || []).forEach((event) => {
      if (event && event.snap) frames.push({ t: event.at, snap: event.snap });
    });
    if (!frames.length) {
      frames.push({ t: 0, snap: Sim.snapshot(state) });
    }
    frames.sort((a, b) => a.t - b.t);
    const unique = [];
    frames.forEach((frame) => {
      const previous = unique[unique.length - 1];
      if (previous && Math.abs(previous.t - frame.t) < 0.002) {
        unique[unique.length - 1] = frame;
      } else {
        unique.push(frame);
      }
    });
    return unique;
  }

  function interpolateSnapshot(a, b, k) {
    if (!a) return b;
    if (!b || k <= 0) return a;
    if (k >= 1) return b;
    const lerp = (left, right) => left + (right - left) * k;
    return {
      ...a,
      timeLeft: lerp(a.timeLeft, b.timeLeft),
      wind: lerp(a.wind, b.wind),
      x: lerp(a.x, b.x),
      vx: lerp(a.vx, b.vx),
      theta: lerp(a.theta, b.theta),
      omega: lerp(a.omega, b.omega),
      arm: lerp(a.arm, b.arm),
      progress: lerp(a.progress, b.progress),
      recovery: lerp(a.recovery, b.recovery),
      status: k > 0.55 ? b.status : a.status,
      target: k > 0.55 ? b.target : a.target,
      targetX: k > 0.55 ? b.targetX : a.targetX,
      done: k > 0.55 ? b.done : a.done,
      spares: k > 0.55 ? b.spares : a.spares,
      tool: k > 0.55 ? b.tool : a.tool,
      clamp: k > 0.55 ? b.clamp : a.clamp,
      dropX: k > 0.55 ? b.dropX : a.dropX,
      protection: k > 0.55 ? b.protection : a.protection,
    };
  }

  function frameAt(time) {
    const frames = replay.frames;
    if (!frames.length) return Sim.snapshot(state);
    let low = 0;
    let high = frames.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (frames[middle].t <= time) low = middle;
      else high = middle - 1;
    }
    const a = frames[low];
    const b = frames[Math.min(frames.length - 1, low + 1)];
    const span = Math.max(0.001, b.t - a.t);
    const k = Math.max(0, Math.min(1, (time - a.t) / span));
    return interpolateSnapshot(a.snap, b.snap, k);
  }

  function snapshotToState(snap) {
    const targetIndex = snap.target >= 0 ? snap.target : snap.done;
    return {
      elapsed: snap.at,
      status: snap.status,
      paused: false,
      protection: snap.protection ? { side: snap.protection } : null,
      timeLeft: snap.timeLeft,
      wind: { value: snap.wind, x: snap.wind * (snap.windDir || 1), dir: snap.windDir || 1, gust: 0 },
      trolley: { x: snap.x, vx: snap.vx, ax: 0 },
      swing: { theta: snap.theta, omega: snap.omega },
      arm: { angle: snap.arm },
      clampHeld: Boolean(snap.clamp),
      installProgress: snap.progress,
      targetIndex,
      pulleys: Sim.CONFIG.world.targets.map((x, index) => ({
        x,
        index,
        status: index < snap.done ? "done" : "pending",
      })),
      resources: {
        spares: snap.spares,
        tool: snap.tool,
        recoveryProgress: snap.recovery,
        dropX: snap.dropX,
        dropY: snap.dropX === null ? null : 0,
      },
      keys: { a: false, d: false, s: false, j: false, l: false, k: false },
      links: { left: { state: "online" }, right: { state: "online" } },
      feed: [],
      taskLog: [],
      stats: { inputs: { left: 0, right: 0 }, conflicts: 0, recoveries: 0 },
      debugSolo: false,
      debugFreezeWind: false,
    };
  }

  function openReplay() {
    if (replay.open) return;
    const liveInputs = state.feed.filter((event) => event.type === "input").length;
    let source = liveInputs > 0 ? currentRecording() : archivedRecording;
    if (!source) {
      toast("暂无回放数据 · 先进行一段双席作业", "warn");
      return;
    }
    const inputs = source.feed ? source.feed.filter((event) => event.type === "input") : [];
    if (!inputs.length && !source.history.length) {
      toast("暂无回放数据 · 先进行一段双席作业", "warn");
      return;
    }
    replay.source = source;
    replay.frames = buildReplayFrames(source);
    replay.duration = Math.max(
      0.1,
      source.elapsed || 0,
      replay.frames[replay.frames.length - 1].t,
      ...(source.feed || []).map((event) => event.at || 0)
    );
    replay.time = 0;
    replay.playing = true;
    replay.filter = "all";
    replay.open = true;
    railTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.rail === "all"));
    ui.replayOverlay.classList.remove("is-hidden");
    const conflictCount = source.feed
      ? source.feed.filter((event) => event.type === "conflict").length
      : 0;
    ui.replayInputCount.textContent = String(inputs.length);
    ui.replayConflictCount.textContent = String(conflictCount);
    renderReplayEvents();
    updateReplayControls();
    renderReplayFrame();
  }

  function closeReplay() {
    if (!replay.open) return;
    replay.open = false;
    replay.playing = false;
    ui.replayOverlay.classList.add("is-hidden");
  }

  function toggleReplayPlayback() {
    if (!replay.open) return;
    if (replay.time >= replay.duration - 0.01) replay.time = 0;
    replay.playing = !replay.playing;
    updateReplayControls();
  }

  function seekReplay(time) {
    replay.time = Math.max(0, Math.min(replay.duration, Number(time) || 0));
    replay.playing = false;
    updateReplayControls();
    renderReplayFrame();
  }

  function updateReplayControls() {
    ui.replayToggle.textContent = replay.playing ? "❚❚" : "▶";
    ui.replayClock.textContent = `${formatSeconds(replay.time)} / ${formatSeconds(replay.duration)}`;
    ui.replayScrubber.max = String(replay.duration);
    ui.replayScrubber.value = String(replay.time);
  }

  function formatSeconds(seconds) {
    const value = Math.max(0, seconds);
    const minutes = String(Math.floor(value / 60)).padStart(2, "0");
    const rest = String(Math.floor(value % 60)).padStart(2, "0");
    return `${minutes}:${rest}`;
  }

  function eventLabel(event) {
    if (event.type === "input") {
      const side = event.side === "left" ? "P1" : "P2";
      return `${side} ${event.short} · ${event.action}${event.down ? " ↓" : " ↑"}`;
    }
    if (event.type === "conflict") return event.text;
    if (event.type === "task") return event.text;
    if (event.type === "protection") return event.text;
    if (event.type === "protection-restore") return "链路恢复";
    if (event.type === "recovery-start") return "P2 开始收绳回收";
    if (event.type === "finish") return event.result === "success" ? "任务成功" : "任务超时";
    if (event.type === "log") return event.text;
    return event.text || event.type;
  }

  function renderReplayEvents() {
    if (!replay.source) return;
    const feed = replay.source.feed || [];
    const rows = feed.filter((event) => {
      if (event.type === "heartbeat" || event.type === "system" || event.type === "pause" || event.type === "resume") {
        return false;
      }
      if (replay.filter === "input") return event.type === "input";
      if (replay.filter === "conflict") return event.type === "conflict";
      if (event.type === "log") return ["warn", "danger", "success"].includes(event.tone);
      return [
        "input",
        "conflict",
        "task",
        "finish",
        "protection",
        "protection-restore",
        "recovery-start",
      ].includes(event.type);
    });
    ui.replayEvents.replaceChildren();
    rows.forEach((event) => {
      const row = document.createElement("li");
      row.className =
        event.type === "conflict" ? "conflict" :
        event.type === "task" ? "task" :
        event.side === "right" ? "p2" : "";
      row.dataset.time = String(event.at);
      const time = document.createElement("span");
      time.className = "ev-time";
      time.textContent = formatSeconds(event.at);
      const side = document.createElement("span");
      side.className = "ev-side";
      side.textContent =
        event.type === "conflict" ? "冲突" :
        event.type === "input" ? (event.side === "left" ? "P1" : "P2") :
        event.type === "task" ? "任务" : "状态";
      const text = document.createElement("span");
      text.textContent = eventLabel(event);
      row.append(time, side, text);
      row.addEventListener("click", () => {
        seekReplay(event.at);
        ui.replayEvents.querySelectorAll("li").forEach((node) => node.classList.remove("active"));
        row.classList.add("active");
      });
      ui.replayEvents.appendChild(row);
    });
  }

  function renderReplayFrame() {
    if (!replay.open) return;
    const snap = frameAt(replay.time);
    const derived = snapshotToState(snap);
    const size = resizeCanvas(replayCanvas, replayContext);
    Renderer.render(replayContext, size.width, size.height, derived, { replay: true });
    ui.replayTime.textContent = Sim.formatClock(snap.timeLeft);
    ui.replaySpares.textContent = `${snap.spares}/3`;
    ui.replayTool.textContent = snap.tool === "secured" ? "在位" : snap.tool === "lost" ? "遗失" : "回收中";
    ui.replayTarget.textContent = snap.target >= 0 ? `P-${snap.target + 1}` : "完成";
    ui.replayWind.textContent = `${Number(snap.wind).toFixed(1)} m/s`;
    updateReplayControls();
  }

  function buildExportPayload() {
    const source = replay.source || (state.feed.some((event) => event.type === "input")
      ? currentRecording()
      : archivedRecording || currentRecording());
    const inputEvents = (source.feed || []).filter((event) => event.type === "input");
    return {
      schema: "crosswind-rig/replay-v1",
      exportedAt: new Date().toISOString(),
      mission: source.title || "M-0717",
      outcome: source.outcome,
      elapsed: source.elapsed || state.elapsed,
      timeLeft: source.timeLeft !== undefined ? source.timeLeft : state.timeLeft,
      inputs: inputEvents.map((event) => ({
        at: event.at,
        side: event.side,
        key: event.key,
        action: event.action,
        down: event.down,
        source: event.source,
        snapshot: event.snap,
      })),
      conflicts: (source.feed || []).filter((event) => event.type === "conflict"),
      resources: (source.feed || []).filter((event) =>
        ["task", "resource", "recovery-start", "protection", "finish"].includes(event.type)
      ),
      taskLog: source.taskLog || [],
      sharedSnapshots: source.history || [],
      events: source.feed || [],
      summary: {
        inputs: {
          left: inputEvents.filter((event) => event.side === "left").length,
          right: inputEvents.filter((event) => event.side === "right").length,
        },
        conflicts: (source.feed || []).filter((event) => event.type === "conflict").length,
        recoveries: (source.stats && source.stats.recoveries) || 0,
      },
    };
  }

  function exportReplay() {
    const payload = buildExportPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `crosswind-rig-replay-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(`回放已导出 · ${payload.inputs.length} 条双席输入`, "success");
  }

  ui.replayScrubber.addEventListener("input", (event) => {
    seekReplay(event.target.value);
  });

  function simulate(dt) {
    if (state.status !== "running" || state.paused || state.protection || replay.open) return;
    accumulator += dt;
    const step = 1 / 120;
    let guard = 0;
    while (accumulator >= step && guard < 12) {
      Sim.tick(state, step);
      accumulator -= step;
      guard += 1;
      if (state.status !== "running" || state.protection) break;
    }
    captureSnapshot(false);
  }

  function frame(now) {
    const rawDt = (now - lastTimestamp) / 1000;
    const dt = Math.max(0, Math.min(0.05, rawDt || 0));
    lastTimestamp = now;

    if (replay.open) {
      if (replay.playing) {
        replay.time = Math.min(replay.duration, replay.time + dt);
        if (replay.time >= replay.duration) replay.playing = false;
      }
      renderReplayFrame();
    } else {
      simulate(dt);
      updateViewport();
      Renderer.render(context, viewport.width, viewport.height, state);
      updateUi();
    }
    window.requestAnimationFrame(frame);
  }

  function init() {
    updateViewport();
    syncDebugPanel();
    captureSnapshot(true);
    updateUi();
    window.requestAnimationFrame(frame);
  }

  window.__rig = {
    getState: () => state,
    getSnapshot: () => Sim.snapshot(state),
    getRecording: () => ({
      ...currentRecording(),
      history: recording.history.slice(),
    }),
    getArchivedRecording: () => archivedRecording,
    exportPayload: buildExportPayload,
    restart,
    togglePause,
    toggleDebug,
    openReplay,
    closeReplay,
    activateProtection: (side, reason) => Sim.activateProtection(state, side, reason || "disconnect"),
    restoreLink: () => Sim.restoreLink(state),
    setKey: (side, key, down) => Sim.setKey(state, side, key, down, "api"),
    step: (seconds) => {
      const steps = Math.max(1, Math.ceil(seconds * 120));
      for (let index = 0; index < steps; index += 1) {
        Sim.tick(state, 1 / 120);
      }
      captureSnapshot(true);
      updateUi();
    },
  };

  init();
})();
