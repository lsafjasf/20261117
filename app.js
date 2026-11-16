(function () {
  "use strict";

  const Physics = window.PendulumPhysics;
  if (!Physics) {
    document.body.innerHTML = "<p style='padding:2rem;color:#fff'>物理模块加载失败。</p>";
    return;
  }

  const { PendulumSim, LIMITS } = Physics;
  const $ = (selector) => document.querySelector(selector);
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const signed = (value, digits = 2) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
  const deg = (radians) => radians * 180 / Math.PI;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const COLORS = {
    mint: "#62e6cb",
    mintSoft: "rgba(98, 230, 203, 0.24)",
    amber: "#ffb44c",
    amberSoft: "rgba(255, 180, 76, 0.16)",
    red: "#ff6d68",
    blue: "#76a9ff",
    text: "#e9f2ed",
    muted: "#829891",
    faint: "rgba(155, 197, 183, 0.12)"
  };

  const ui = {
    canvas: $("#simCanvas"),
    canvasShell: $("#canvasShell"),
    trendCanvas: $("#trendCanvas"),
    missionState: $("#missionState"),
    clock: $("#clockText"),
    targetText: $("#targetText"),
    statusPill: $("#statusPill"),
    statusText: $("#statusText"),
    stageChip: $("#stageChipText"),
    gridLabel: $("#gridLabel"),
    failureCallout: $("#failureCallout"),
    failureTitle: $("#failureTitle"),
    failureMeta: $("#failureMeta"),
    successCallout: $("#successCallout"),
    successMeta: $("#successMeta"),
    forceReadout: $("#forceReadout"),
    forceDirection: $("#forceDirection"),
    payloadRange: $("#payloadRange"),
    payloadValue: $("#payloadValue"),
    targetRange: $("#targetRange"),
    targetValue: $("#targetValue"),
    assistToggle: $("#assistToggle"),
    configState: $("#configState"),
    angleValue: $("#angleValue"),
    speedValue: $("#speedValue"),
    positionValue: $("#positionValue"),
    thrustValue: $("#thrustValue"),
    tempValue: $("#tempValue"),
    errorValue: $("#errorValue"),
    angleBar: $("#angleBar"),
    speedBar: $("#speedBar"),
    positionBar: $("#positionBar"),
    thrustBar: $("#thrustBar"),
    tempBar: $("#tempBar"),
    errorBar: $("#errorBar"),
    safetyState: $("#safetyState"),
    limitTiltBar: $("#limitTiltBar"),
    limitSpeedBar: $("#limitSpeedBar"),
    limitRailBar: $("#limitRailBar"),
    limitTempBar: $("#limitTempBar"),
    limitLoadBar: $("#limitLoadBar"),
    peakAngle: $("#peakAngle"),
    peakSpeed: $("#peakSpeed"),
    peakForce: $("#peakForce"),
    peakTemp: $("#peakTemp"),
    peakError: $("#peakError"),
    dwellValue: $("#dwellValue"),
    faultBox: $("#faultBox"),
    faultPart: $("#faultPart"),
    faultDetail: $("#faultDetail"),
    eventLog: $("#eventLog"),
    commandRange: $("#commandRange"),
    commandValue: $("#commandValue"),
    btnLeft: $("#btnLeft"),
    btnRight: $("#btnRight"),
    btnStart: $("#btnStart"),
    startLabel: $("#startLabel"),
    startIcon: $("#startIcon"),
    btnStep: $("#btnStep"),
    btnReplay: $("#btnReplay"),
    btnReset: $("#btnReset"),
    btnExport: $("#btnExport"),
    replayControls: $("#replayControls"),
    btnReplayPlay: $("#btnReplayPlay"),
    replayRange: $("#replayRange"),
    replayTime: $("#replayTime"),
    replaySpeed: $("#replaySpeed"),
    toast: $("#toast"),
    helpDialog: $("#helpDialog"),
    seedText: $("#seedText")
  };

  const sim = new PendulumSim({ payload: 0.9, target: 1.8 });
  const app = {
    mode: "ready",
    command: 0,
    heldDirection: 0,
    accumulator: 0,
    lastFrame: performance.now(),
    lastDraw: 0,
    endedMode: null,
    replay: null,
    toastTimer: null,
    drawMetrics: null,
    lastEventCount: 0
  };

  function setRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const percent = max === min ? 0 : (value - min) / (max - min) * 100;
    input.style.setProperty("--fill", `${clamp(percent, 0, 100)}%`);
  }

  function showToast(message, kind = "") {
    clearTimeout(app.toastTimer);
    ui.toast.textContent = message;
    ui.toast.className = `toast show ${kind}`.trim();
    app.toastTimer = setTimeout(() => {
      ui.toast.className = "toast";
    }, 2400);
  }

  function effectiveCommand() {
    if (app.mode === "replay" || app.mode === "failure" || app.mode === "success") return 0;
    if (app.heldDirection) return app.heldDirection * 1.5;
    return app.command;
  }

  function applyCommandToSim() {
    sim.setCommand(effectiveCommand());
  }

  function setMode(mode) {
    app.mode = mode;
    ui.statusPill.dataset.status = mode === "paused" ? "paused" :
      mode === "replay" ? "replay" : mode;
    const labels = {
      ready: ["待命", "准备就绪"],
      running: ["运行中", "执行平衡任务"],
      paused: ["已暂停", "仿真已冻结"],
      failure: ["安全停机", "安全边界触发"],
      success: ["任务完成", "目标区稳定"],
      replay: ["回放中", "轨迹回放"]
    };
    const pair = labels[mode] || labels.ready;
    ui.statusText.textContent = pair[0];
    ui.missionState.textContent = pair[1];
    ui.btnStep.disabled = mode !== "paused";
    ui.btnReplay.disabled = !(mode === "replay" || sim.isLocked());
    ui.btnReplay.innerHTML = mode === "replay" ? "<span>■</span> 退出回放" : "<span>↺</span> 回放";
    ["payloadRange", "targetRange"].forEach((key) => {
      ui[key].disabled = mode !== "ready";
    });
    ui.btnLeft.disabled = !(mode === "running" || mode === "paused");
    ui.btnRight.disabled = !(mode === "running" || mode === "paused");
    ui.commandRange.disabled = !(mode === "running" || mode === "paused" || mode === "ready");
    ui.configState.textContent = mode === "ready" ? "已装载" : "运行中锁定";
    ui.configState.dataset.dirty = String(mode !== "ready");
    updateButtons();
  }

  function updateButtons() {
    if (app.mode === "running") {
      ui.startLabel.textContent = "暂停";
      ui.startIcon.textContent = "Ⅱ";
      ui.btnStart.disabled = false;
    } else if (app.mode === "paused") {
      ui.startLabel.textContent = "恢复运行";
      ui.startIcon.textContent = "▶";
      ui.btnStart.disabled = false;
    } else if (app.mode === "ready") {
      ui.startLabel.textContent = "开始运行";
      ui.startIcon.textContent = "▶";
      ui.btnStart.disabled = false;
    } else if (app.mode === "replay") {
      ui.startLabel.textContent = "回放模式";
      ui.startIcon.textContent = "↺";
      ui.btnStart.disabled = true;
    } else {
      ui.startLabel.textContent = "重新运行";
      ui.startIcon.textContent = "↻";
      ui.btnStart.disabled = false;
    }
  }

  function startRun() {
    if (app.mode === "failure" || app.mode === "success") resetSimulation(false);
    if (app.mode === "ready") {
      sim.reset({ payload: Number(ui.payloadRange.value), target: Number(ui.targetRange.value), assist: ui.assistToggle.checked });
    }
    app.mode = "running";
    app.accumulator = 0;
    app.lastFrame = performance.now();
    applyCommandToSim();
    setMode("running");
    showToast("仿真已启动 · 固定步长 1/120 s");
  }

  function pauseRun() {
    if (app.mode !== "running") return;
    app.accumulator = 0;
    setMode("paused");
    showToast("仿真已暂停，物理状态已冻结");
  }

  function resumeRun() {
    if (app.mode !== "paused") return;
    app.mode = "running";
    app.accumulator = 0;
    app.lastFrame = performance.now();
    applyCommandToSim();
    setMode("running");
    showToast("已从冻结状态恢复");
  }

  function singleStep() {
    if (app.mode !== "paused") return;
    app.accumulator = 0;
    applyCommandToSim();
    sim.advance(sim.config.dt);
    if (sim.isLocked()) finishRun(sim.status);
    else updateReadouts(sim.sample());
    showToast(`单步完成 · T+ ${sim.state.t.toFixed(3)} s`);
  }

  function resetSimulation(notify = true) {
    app.heldDirection = 0;
    app.accumulator = 0;
    app.replay = null;
    app.endedMode = null;
    app.command = 0;
    ui.commandRange.value = "0";
    setRangeFill(ui.commandRange);
    sim.reset({
      payload: Number(ui.payloadRange.value),
      target: Number(ui.targetRange.value),
      assist: ui.assistToggle.checked
    });
    setMode("ready");
    hideCallouts();
    ui.replayControls.hidden = true;
    ui.failureCallout.hidden = true;
    ui.successCallout.hidden = true;
    app.lastEventCount = 0;
    updateReport();
    updateReadouts(sim.sample());
    if (notify) showToast("已重置 · 位置、姿态、温度与资源均恢复");
  }

  function finishRun(status) {
    app.accumulator = 0;
    app.endedMode = status;
    setMode(status);
    app.heldDirection = 0;
    updatePushButtons();
    updateReadouts(sim.sample());
    showCallout(status);
    updateReport();
    const report = sim.getReport();
    if (status === "failure") {
      showToast(`${report.fault.part}首次越限 · 仿真已冻结`, "danger");
    } else {
      showToast("目标区稳定驻留完成 · 任务成功", "success");
    }
  }

  function hideCallouts() {
    ui.failureCallout.hidden = true;
    ui.successCallout.hidden = true;
  }

  function showCallout(status) {
    if (status === "failure" && sim.fault) {
      ui.failureTitle.textContent = `${sim.fault.part}越限`;
      ui.failureMeta.textContent = `T+ ${sim.fault.t.toFixed(3)} s · 首次触发点 x=${sim.fault.x.toFixed(2)} m`;
      ui.failureCallout.hidden = false;
      ui.successCallout.hidden = true;
    } else if (status === "success") {
      ui.successMeta.textContent = `T+ ${sim.successAt.toFixed(3)} s · 驻留 ${sim.dwell.toFixed(2)} s`;
      ui.successCallout.hidden = false;
      ui.failureCallout.hidden = true;
    }
  }

  function updatePushButtons() {
    ui.btnLeft.classList.toggle("active", app.heldDirection < 0);
    ui.btnRight.classList.toggle("active", app.heldDirection > 0);
  }

  function metricPercent(value, limit) {
    return clamp(Math.abs(value) / limit * 100, 0, 100);
  }

  function setMetricState(id, percent) {
    const metric = ui[id].closest(".metric");
    metric.classList.toggle("warning", percent >= 76 && percent < 94);
    metric.classList.toggle("danger", percent >= 94);
  }

  function updateReadouts(sample) {
    const angle = deg(sample.theta);
    const error = Math.abs(sample.target - sample.x);
    const formatted = {
      angleValue: `${signed(angle)}<small>°</small>`,
      speedValue: `${signed(sample.v)}<small>m/s</small>`,
      positionValue: `${signed(sample.x)}<small>m</small>`,
      thrustValue: `${signed(sample.force, 1)}<small>N</small>`,
      tempValue: `${sample.temperature.toFixed(1)}<small>°C</small>`,
      errorValue: `${error.toFixed(2)}<small>m</small>`
    };
    Object.keys(formatted).forEach((key) => { ui[key].innerHTML = formatted[key]; });

    const percentages = {
      angleBar: metricPercent(angle, LIMITS.tilt.max),
      speedBar: metricPercent(sample.v, LIMITS.speed.max),
      positionBar: metricPercent(sample.x, LIMITS.rail.max),
      thrustBar: metricPercent(sample.force, sim.config.forceLimit),
      tempBar: clamp((sample.temperature - LIMITS.temp.min) / (LIMITS.temp.max - LIMITS.temp.min) * 100, 0, 100),
      errorBar: clamp(error / 2.6 * 100, 0, 100)
    };
    Object.keys(percentages).forEach((key) => {
      ui[key].style.width = `${percentages[key]}%`;
      setMetricState(key, percentages[key]);
    });

    ui.forceReadout.textContent = signed(sample.force, 1);
    ui.forceDirection.textContent = Math.abs(sample.force) < 0.15 ? "保持" : sample.force > 0 ? "向右" : "向左";
    ui.forceReadout.style.color = Math.abs(sample.force) > sim.config.forceLimit * 0.94 ? COLORS.red :
      Math.abs(sample.force) > sim.config.forceLimit * 0.76 ? COLORS.amber : COLORS.amber;
    ui.clock.textContent = `T+ ${sample.t.toFixed(3).padStart(6, "0")} s`;
    ui.targetText.textContent = `${signed(sample.target, 2)} m`;
    ui.gridLabel.textContent = `RAIL ${signed(sample.x, 1)} m`;
    updateSafety(sample);
  }

  function updateSafety(sample) {
    const tiltPct = metricPercent(deg(sample.theta), LIMITS.tilt.max);
    const speedPct = metricPercent(sample.v, LIMITS.speed.max);
    const railPct = metricPercent(sample.x, LIMITS.rail.max);
    const tempPct = (sample.temperature - LIMITS.temp.min) / (LIMITS.temp.max - LIMITS.temp.min) * 100;
    const loadPct = (sim.payload - LIMITS.load.min) / (LIMITS.load.max - LIMITS.load.min) * 100;
    const values = [tiltPct, speedPct, railPct, tempPct, loadPct];
    [ui.limitTiltBar, ui.limitSpeedBar, ui.limitRailBar, ui.limitTempBar, ui.limitLoadBar].forEach((bar, index) => {
      bar.style.width = `${clamp(values[index], 0, 100)}%`;
      const row = bar.closest(".limit-row");
      row.classList.toggle("near", values[index] >= 78 && !(sim.fault && row.dataset.limit === sim.fault.key));
      row.classList.toggle("tripped", Boolean(sim.fault && row.dataset.limit === sim.fault.key));
    });

    if (sim.fault) {
      ui.safetyState.textContent = `触发 · ${sim.fault.part}`;
      ui.safetyState.dataset.level = "trip";
    } else if (Math.max(tiltPct, speedPct, railPct, tempPct) >= 78) {
      ui.safetyState.textContent = "接近边界";
      ui.safetyState.dataset.level = "warn";
    } else {
      ui.safetyState.textContent = "全部正常";
      ui.safetyState.dataset.level = "ok";
    }
  }

  function updateReport() {
    const report = sim.getReport();
    const peaks = report.peaks;
    ui.peakAngle.textContent = `${peaks.angle.toFixed(2)}°`;
    ui.peakSpeed.textContent = `${peaks.speed.toFixed(2)} m/s`;
    ui.peakForce.textContent = `${peaks.force.toFixed(1)} N`;
    ui.peakTemp.textContent = `${peaks.temp.toFixed(1)} °C`;
    ui.peakError.textContent = `${peaks.error.toFixed(2)} m`;
    ui.dwellValue.textContent = `${report.dwell.toFixed(2)} s`;
    ui.faultBox.classList.remove("failure", "success");

    if (report.fault) {
      ui.faultBox.classList.add("failure");
      ui.faultBox.querySelector(".fault-icon").textContent = "!";
      ui.faultPart.textContent = `${report.fault.part} · ${report.fault.key}`;
      ui.faultDetail.textContent =
        `首次越限 T+ ${report.fault.t.toFixed(3)} s；x=${report.fault.x.toFixed(3)} m，` +
        `θ=${signed(report.fault.theta, 2)}°；阈值 ${report.fault.limit.toFixed(2)}。`;
    } else if (sim.status === "success") {
      ui.faultBox.classList.add("success");
      ui.faultBox.querySelector(".fault-icon").textContent = "✓";
      ui.faultPart.textContent = "目标任务完成";
      ui.faultDetail.textContent =
        `稳定驻留 ${report.dwell.toFixed(2)} s；最终位置 x=${sim.state.x.toFixed(3)} m，` +
        `摆角 ${signed(deg(sim.state.theta), 2)}°。`;
    } else {
      ui.faultBox.querySelector(".fault-icon").textContent = "✓";
      ui.faultPart.textContent = "尚无故障";
      ui.faultDetail.textContent = "运行结束后将在此记录首次越限位置与时间。";
    }
    ui.btnExport.disabled = !sim.isLocked();
    ui.replayRange.max = String(Math.max(0, sim.trace.length - 1));

    ui.eventLog.innerHTML = "";
    sim.events.slice(-4).forEach((event) => {
      const row = document.createElement("div");
      const eventClass = event.kind === "danger" ? "event-danger" : event.kind === "success" ? "event-success" : "";
      row.innerHTML = `<time>T+${event.t.toFixed(2)}</time><span class="${eventClass}"></span>`;
      row.querySelector("span").textContent = event.text;
      ui.eventLog.appendChild(row);
    });
    app.lastEventCount = sim.events.length;
  }

  function replayIndexForTime(time) {
    const trace = sim.trace;
    if (time <= 0) return 0;
    let low = 0;
    let high = trace.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (trace[middle].t <= time) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  function startReplay() {
    if (!sim.isLocked()) return;
    app.endedMode = sim.status;
    app.replay = {
      index: 0,
      time: 0,
      playing: true,
      lastFrame: performance.now(),
      speed: Number(ui.replaySpeed.value)
    };
    app.heldDirection = 0;
    setMode("replay");
    ui.replayControls.hidden = false;
    ui.replayRange.value = "0";
    ui.replayRange.max = String(Math.max(0, sim.trace.length - 1));
    ui.btnReplayPlay.textContent = "暂停回放";
    hideCallouts();
    showToast("回放从初始状态开始 · 黄色箭头显示瞬时受力");
  }

  function stopReplay() {
    if (app.mode !== "replay") return;
    app.replay = null;
    ui.replayControls.hidden = true;
    app.mode = app.endedMode || sim.status;
    setMode(app.mode);
    showCallout(app.mode);
  }

  function toggleReplayPlayback() {
    if (!app.replay) return;
    app.replay.playing = !app.replay.playing;
    app.replay.lastFrame = performance.now();
    ui.btnReplayPlay.textContent = app.replay.playing ? "暂停回放" : "继续回放";
  }

  function scrubReplay(index) {
    if (!app.replay) return;
    const trace = sim.trace;
    app.replay.index = clamp(Number(index), 0, trace.length - 1);
    app.replay.time = trace[app.replay.index].t;
    app.replay.playing = false;
    ui.btnReplayPlay.textContent = "继续回放";
    ui.replayTime.textContent = `${app.replay.time.toFixed(3)} s`;
    hideCallouts();
    updateReadouts(trace[app.replay.index]);
    if (app.replay.index >= trace.length - 1) showCallout(sim.status);
  }

  function updateReplay(now) {
    if (!app.replay || !app.replay.playing) return;
    const wall = Math.min((now - app.replay.lastFrame) / 1000, 0.08);
    app.replay.lastFrame = now;
    app.replay.time += wall * app.replay.speed;
    const trace = sim.trace;
    const endTime = trace[trace.length - 1].t;
    if (app.replay.time >= endTime) {
      app.replay.time = endTime;
      app.replay.playing = false;
      app.replay.index = trace.length - 1;
      ui.btnReplayPlay.textContent = "重新回放";
      showCallout(sim.status);
    } else {
      app.replay.index = replayIndexForTime(app.replay.time);
    }
    ui.replayRange.value = String(app.replay.index);
    ui.replayTime.textContent = `${app.replay.time.toFixed(3)} s`;
    updateReadouts(trace[app.replay.index]);
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height, dpr };
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function currentSample() {
    if (app.mode === "replay" && app.replay) {
      return sim.trace[app.replay.index] || sim.trace[0];
    }
    return app.mode === "ready" ? sim.trace[0] : sim.sample();
  }

  function getStageGeometry(width, height) {
    const railY = Math.round(height * 0.76);
    const scale = Math.min((width - 78) / 8.0, Math.max(68, (railY - 45) / 1.48));
    const centerX = width / 2;
    return {
      railY,
      scale,
      centerX,
      cartWidth: Math.max(58, 0.82 * scale),
      cartHeight: Math.max(27, 0.34 * scale),
      poleLength: 1.04 * scale
    };
  }

  function drawRail(ctx, width, height, geometry, sample) {
    const { railY, scale, centerX } = geometry;
    const left = centerX - LIMITS.rail.max * scale;
    const right = centerX + LIMITS.rail.max * scale;

    ctx.save();
    const floor = ctx.createLinearGradient(0, railY, 0, height);
    floor.addColorStop(0, "rgba(21, 49, 40, 0.52)");
    floor.addColorStop(1, "rgba(5, 14, 11, 0)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, railY, width, height - railY);

    ctx.strokeStyle = "rgba(155, 197, 183, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, railY + 18.5);
    ctx.lineTo(width, railY + 18.5);
    ctx.stroke();

    ctx.strokeStyle = "rgba(189, 211, 202, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, railY);
    ctx.lineTo(right, railY);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, railY - 1.5);
    ctx.lineTo(right, railY - 1.5);
    ctx.stroke();

    for (let meter = -3.5; meter <= 3.5; meter += 0.5) {
      const x = centerX + meter * scale;
      const major = Math.abs(meter - Math.round(meter)) < 0.01;
      ctx.strokeStyle = major ? "rgba(155, 197, 183, 0.24)" : "rgba(155, 197, 183, 0.1)";
      ctx.beginPath();
      ctx.moveTo(x, railY + 4);
      ctx.lineTo(x, railY + (major ? 12 : 8));
      ctx.stroke();
      if (major && Math.abs(meter) <= 3) {
        ctx.fillStyle = "rgba(130, 152, 145, 0.48)";
        ctx.font = "8px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${meter > 0 ? "+" : ""}${meter.toFixed(0)}`, x, railY + 23);
      }
    }

    [LIMITS.rail.min, LIMITS.rail.max].forEach((limit) => {
      const x = centerX + limit * scale;
      ctx.strokeStyle = "rgba(255, 109, 104, 0.42)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, railY - 15);
      ctx.lineTo(x, railY + 11);
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 109, 104, 0.7)";
      ctx.font = "7px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
      ctx.textAlign = "center";
      ctx.fillText("STOP", x, railY + 34);
    });

    const targetX = centerX + sample.target * scale;
    const zoneWidth = sim.config.targetTolerance * 2 * scale;
    const zoneGradient = ctx.createLinearGradient(targetX - zoneWidth / 2, 0, targetX + zoneWidth / 2, 0);
    zoneGradient.addColorStop(0, "rgba(98, 230, 203, 0.015)");
    zoneGradient.addColorStop(0.5, "rgba(98, 230, 203, 0.09)");
    zoneGradient.addColorStop(1, "rgba(98, 230, 203, 0.015)");
    ctx.fillStyle = zoneGradient;
    ctx.fillRect(targetX - zoneWidth / 2, 40, zoneWidth, railY - 40);
    ctx.strokeStyle = "rgba(98, 230, 203, 0.3)";
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(targetX - zoneWidth / 2, railY - 25);
    ctx.lineTo(targetX - zoneWidth / 2, 42);
    ctx.moveTo(targetX + zoneWidth / 2, railY - 25);
    ctx.lineTo(targetX + zoneWidth / 2, 42);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(98, 230, 203, 0.85)";
    ctx.font = "600 8px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText("TARGET ZONE", targetX, 34);
    ctx.fillStyle = "rgba(98, 230, 203, 0.55)";
    ctx.fillText(`${signed(sample.target, 2)} m`, targetX, railY + 34);
    ctx.restore();
  }

  function drawTrajectory(ctx, geometry, sample, traceLimit) {
    const trace = sim.trace;
    const end = traceLimit == null ? trace.length : Math.min(traceLimit + 1, trace.length);
    if (end < 2) return;
    const start = Math.max(0, end - 900);
    const stride = Math.max(1, Math.floor((end - start) / 170));
    const { centerX, railY, scale, cartHeight, poleLength } = geometry;

    ctx.save();
    ctx.strokeStyle = "rgba(98, 230, 203, 0.33)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    for (let i = start; i < end; i += stride) {
      const item = trace[i];
      const x = centerX + (item.x + Math.sin(item.theta) * 1.04) * scale;
      const y = railY - cartHeight - 6 - Math.cos(item.theta) * poleLength;
      if (i === start) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const last = trace[Math.max(0, end - 1)];
    const tipX = centerX + (last.x + Math.sin(last.theta) * 1.04) * scale;
    const tipY = railY - cartHeight - 6 - Math.cos(last.theta) * poleLength;
    ctx.fillStyle = "rgba(98, 230, 203, 0.22)";
    ctx.beginPath();
    ctx.arc(tipX, tipY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPendulum(ctx, geometry, sample) {
    const { centerX, railY, scale, cartWidth, cartHeight, poleLength } = geometry;
    const cartX = centerX + sample.x * scale;
    const wheelRadius = Math.max(4, Math.min(8, scale * 0.065));
    const cartBottom = railY - wheelRadius * 1.25;
    const cartY = cartBottom - cartHeight;
    const pivotY = cartY + cartHeight * 0.2;
    const tempRatio = clamp((sample.temperature - 31) / 64, 0, 1);
    const motorColor = tempRatio > 0.72 ? COLORS.red : tempRatio > 0.35 ? COLORS.amber : COLORS.mint;

    ctx.save();
    ctx.translate(cartX, pivotY);
    ctx.rotate(sample.theta);

    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(0, -poleLength);
    ctx.stroke();

    const poleGradient = ctx.createLinearGradient(0, 0, 0, -poleLength);
    poleGradient.addColorStop(0, "#9cbbb1");
    poleGradient.addColorStop(0.55, "#d5e7e0");
    poleGradient.addColorStop(1, "#f3fbf7");
    ctx.strokeStyle = poleGradient;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -poleLength);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-1, 0);
    ctx.lineTo(-1, -poleLength);
    ctx.stroke();

    const payloadRatio = 0.67;
    const payloadY = -poleLength * payloadRatio;
    const payloadRadius = Math.max(7, Math.min(13, 7.5 + sim.payload * 1.7));
    ctx.shadowColor = "rgba(255, 180, 76, 0.4)";
    ctx.shadowBlur = 12;
    const payloadGradient = ctx.createRadialGradient(-3, payloadY - 3, 1, 0, payloadY, payloadRadius);
    payloadGradient.addColorStop(0, "#ffe0a6");
    payloadGradient.addColorStop(0.4, COLORS.amber);
    payloadGradient.addColorStop(1, "#97601d");
    ctx.fillStyle = payloadGradient;
    ctx.beginPath();
    ctx.arc(0, payloadY, payloadRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#f4fbf8";
    ctx.beginPath();
    ctx.arc(0, -poleLength, 4.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.mint;
    ctx.beginPath();
    ctx.arc(0, -poleLength, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(98, 230, 203, 0.18)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(cartX, pivotY);
    ctx.lineTo(cartX, pivotY - poleLength - 20);
    ctx.stroke();
    ctx.setLineDash([]);

    const arcRadius = Math.min(42, Math.max(25, cartWidth * 0.42));
    ctx.strokeStyle = "rgba(98, 230, 203, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cartX, pivotY, arcRadius, -Math.PI / 2, -Math.PI / 2 + sample.theta, sample.theta < 0);
    ctx.stroke();
    ctx.fillStyle = "rgba(98, 230, 203, 0.68)";
    ctx.font = "7px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
    ctx.textAlign = sample.theta >= 0 ? "left" : "right";
    ctx.fillText(
      `${signed(deg(sample.theta), 1)}°`,
      cartX + (sample.theta >= 0 ? arcRadius + 6 : -arcRadius - 6),
      pivotY - arcRadius * 0.58
    );

    const bodyGradient = ctx.createLinearGradient(0, cartY, 0, cartBottom);
    bodyGradient.addColorStop(0, "#36534a");
    bodyGradient.addColorStop(0.4, "#253c35");
    bodyGradient.addColorStop(1, "#13241f");
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    roundRect(ctx, cartX - cartWidth / 2 + 4, cartY + 5, cartWidth, cartHeight, 9);
    ctx.fill();
    ctx.fillStyle = bodyGradient;
    roundRect(ctx, cartX - cartWidth / 2, cartY, cartWidth, cartHeight, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(201, 230, 219, 0.28)";
    ctx.lineWidth = 1;
    roundRect(ctx, cartX - cartWidth / 2 + 0.5, cartY + 0.5, cartWidth - 1, cartHeight - 1, 8);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    roundRect(ctx, cartX - cartWidth / 2 + 7, cartY + 5, cartWidth - 14, 4, 2);
    ctx.fill();

    ctx.fillStyle = motorColor;
    ctx.globalAlpha = 0.7;
    roundRect(ctx, cartX - 11, cartBottom - 4, 22, 2, 1);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(220, 235, 229, 0.55)";
    ctx.font = "600 7px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText("CP-07", cartX, cartY + cartHeight * 0.52);
    ctx.fillStyle = motorColor;
    ctx.beginPath();
    ctx.arc(cartX + cartWidth * 0.3, cartY + cartHeight * 0.48, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#1a2d27";
    [-cartWidth * 0.28, cartWidth * 0.28].forEach((offset, index) => {
      const wheelX = cartX + offset;
      const wheelY = railY - wheelRadius;
      ctx.fillStyle = "#0a1512";
      ctx.beginPath();
      ctx.arc(wheelX, wheelY, wheelRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = index === 1 ? motorColor : "rgba(171, 199, 189, 0.42)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(wheelX, wheelY, wheelRadius - 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = motorColor;
      ctx.beginPath();
      ctx.arc(wheelX, wheelY, 1.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
    return { cartX, cartY, cartBottom, pivotY, wheelRadius };
  }

  function drawForce(ctx, geometry, sample, cart) {
    const { scale } = geometry;
    const force = sample.force;
    const cartX = cart.cartX;
    const y = cart.cartY + geometry.cartHeight * 0.46;
    const length = Math.max(0, Math.min(135, Math.abs(force) / sim.config.forceLimit * 145));
    const direction = Math.sign(force);
    ctx.save();
    ctx.strokeStyle = Math.abs(force) > sim.config.forceLimit * 0.9 ? COLORS.red : COLORS.amber;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    if (length > 7) {
      const startX = cartX + direction * (geometry.cartWidth * 0.52);
      const endX = startX + direction * length;
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(endX, y);
      ctx.lineTo(endX - direction * 7, y - 4);
      ctx.lineTo(endX - direction * 7, y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.font = "600 8px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
      ctx.textAlign = direction > 0 ? "left" : "right";
      ctx.fillText(`F ${signed(force, 1)} N`, endX + direction * 5, y - 7);
    } else {
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(cartX, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSafetyMarker(ctx, geometry, sample) {
    if (!sim.fault && sim.status !== "success") return;
    if (app.mode === "replay" && app.replay && app.replay.index < sim.trace.length - 1) return;
    const { centerX, railY, scale, poleLength, cartHeight } = geometry;
    let x;
    let y;
    let color = sim.fault ? COLORS.red : COLORS.mint;
    let label = sim.fault ? sim.fault.part : "目标区";
    let sub = sim.fault ? `T+ ${sim.fault.t.toFixed(3)} s` : `驻留 ${sim.dwell.toFixed(2)} s`;

    if (sim.fault && sim.fault.key === "tilt") {
      x = centerX + (sample.x + Math.sin(sample.theta) * 1.04) * scale;
      y = railY - cartHeight - 6 - Math.cos(sample.theta) * poleLength;
    } else if (sim.fault && sim.fault.key === "temp") {
      x = centerX + sample.x * scale + geometry.cartWidth * 0.28;
      y = railY - 7;
    } else if (sim.fault) {
      x = centerX + sample.x * scale;
      y = railY - cartHeight * 0.5 - 4;
    } else {
      x = centerX + sample.target * scale;
      y = railY - cartHeight - 26;
    }

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 280);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.28 + pulse * 0.32;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 13 + pulse * 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 13, y);
    ctx.lineTo(x - 22, y);
    ctx.moveTo(x + 13, y);
    ctx.lineTo(x + 22, y);
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x, y - 22);
    ctx.stroke();

    const labelWidth = Math.max(74, label.length * 11 + 19);
    const labelX = clamp(x + 20, 8, geometry.width - labelWidth - 8);
    const labelY = y < 80 ? y + 25 : y - 40;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(8, 20, 17, 0.92)";
    roundRect(ctx, labelX, labelY, labelWidth, 30, 5);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    roundRect(ctx, labelX + 0.5, labelY + 0.5, labelWidth - 1, 29, 5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = "600 8px 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, labelX + 8, labelY + 11);
    ctx.fillStyle = "rgba(190, 210, 203, 0.7)";
    ctx.font = "7px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
    ctx.fillText(sub, labelX + 8, labelY + 23);
    ctx.restore();
  }

  function drawMainCanvas() {
    const { ctx, width, height } = prepareCanvas(ui.canvas);
    if (width < 10 || height < 10) return;
    const sample = currentSample();
    const geometry = getStageGeometry(width, height);
    geometry.width = width;
    geometry.height = height;
    const traceLimit = app.mode === "replay" && app.replay ? app.replay.index : null;

    ctx.clearRect(0, 0, width, height);
    drawRail(ctx, width, height, geometry, sample);
    drawTrajectory(ctx, geometry, sample, traceLimit);
    const cart = drawPendulum(ctx, geometry, sample);
    drawForce(ctx, geometry, sample, cart);
    drawSafetyMarker(ctx, geometry, sample);

    ctx.save();
    ctx.font = "600 8px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
    ctx.textAlign = "right";
    const modeLabel = app.mode === "replay" ? `REPLAY ${sample.t.toFixed(2)} s` :
      app.mode === "paused" ? "PAUSED · STATE FROZEN" :
      app.mode === "failure" ? "SAFETY HALT" :
      app.mode === "success" ? "OBJECTIVE COMPLETE" : "LIVE TELEMETRY";
    ctx.fillStyle = app.mode === "failure" ? "rgba(255, 109, 104, 0.72)" :
      app.mode === "paused" ? "rgba(255, 180, 76, 0.72)" : "rgba(155, 197, 183, 0.42)";
    ctx.fillText(modeLabel, width - 15, height - 14);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(155, 197, 183, 0.42)";
    ctx.fillText(`x ${signed(sample.x, 2)} m`, 15, height - 14);
    ctx.restore();
  }

  function drawTrendCanvas() {
    const { ctx, width, height } = prepareCanvas(ui.trendCanvas);
    if (width < 10 || height < 10) return;
    const trace = sim.trace;
    const limited = app.mode === "replay" && app.replay ? app.replay.index + 1 : trace.length;
    const end = Math.max(1, Math.min(limited, trace.length));
    const endTime = Math.max(trace[end - 1].t, 1 / 120);
    const left = 44;
    const right = width - 43;
    const top = 14;
    const bottom = height - 21;
    const chartWidth = Math.max(1, right - left);
    const chartHeight = Math.max(1, bottom - top);
    const laneHeight = chartHeight / 3;
    const xFor = (time) => left + time / endTime * chartWidth;
    const yFor = (value, limit, lane) => {
      const center = top + laneHeight * lane + laneHeight / 2;
      return center - clamp(value / limit, -1, 1) * (laneHeight * 0.38);
    };

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#091411";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    for (let lane = 0; lane < 3; lane += 1) {
      const laneTop = top + lane * laneHeight;
      if (lane > 0) {
        ctx.strokeStyle = "rgba(155, 197, 183, 0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, laneTop);
        ctx.lineTo(right, laneTop);
        ctx.stroke();
      }
    }
    for (let step = 0; step <= 4; step += 1) {
      const x = left + chartWidth * step / 4;
      ctx.strokeStyle = "rgba(155, 197, 183, 0.055)";
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    const labels = [
      ["推力", "N", sim.config.forceLimit],
      ["摆角", "°", LIMITS.tilt.max],
      ["车速", "m/s", LIMITS.speed.max]
    ];
    labels.forEach((item, lane) => {
      const center = top + lane * laneHeight + laneHeight / 2;
      ctx.strokeStyle = "rgba(155, 197, 183, 0.13)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(left, center);
      ctx.lineTo(right, center);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(130, 152, 145, 0.74)";
      ctx.font = "7px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
      ctx.textAlign = "right";
      ctx.fillText(item[0], left - 7, center - 2);
      ctx.fillStyle = "rgba(130, 152, 145, 0.45)";
      ctx.fillText(`±${item[2]}${item[1]}`, right + 40, center - 2);
    });

    const stride = Math.max(1, Math.floor(end / Math.max(1, chartWidth * 0.85)));
    const drawSeries = (getter, limit, lane, color, fill) => {
      ctx.beginPath();
      for (let i = 0; i < end; i += stride) {
        const sample = trace[i];
        const x = xFor(sample.t);
        const y = yFor(getter(sample), limit, lane);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const last = trace[end - 1];
      ctx.lineTo(xFor(last.t), yFor(getter(last), limit, lane));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      if (fill) {
        const center = top + lane * laneHeight + laneHeight / 2;
        ctx.lineTo(xFor(last.t), center);
        ctx.lineTo(xFor(trace[0].t), center);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, center - laneHeight * 0.4, 0, center + laneHeight * 0.4);
        gradient.addColorStop(0, "rgba(255, 180, 76, 0.16)");
        gradient.addColorStop(1, "rgba(255, 180, 76, 0.01)");
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    };

    drawSeries((sample) => sample.force, sim.config.forceLimit, 0, COLORS.amber, true);
    drawSeries((sample) => deg(sample.theta), LIMITS.tilt.max, 1, COLORS.mint, false);
    drawSeries((sample) => sample.v, LIMITS.speed.max, 2, COLORS.blue, false);

    const playhead = xFor(trace[end - 1].t);
    ctx.strokeStyle = "rgba(232, 244, 239, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(playhead, top);
    ctx.lineTo(playhead, bottom);
    ctx.stroke();
    ctx.fillStyle = "rgba(232, 244, 239, 0.74)";
    ctx.beginPath();
    ctx.arc(playhead, top, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(130, 152, 145, 0.5)";
    ctx.font = "7px 'SFMono-Regular', Consolas, 'Noto Sans SC', monospace";
    ctx.textAlign = "left";
    ctx.fillText("0 s", left, height - 7);
    ctx.textAlign = "right";
    ctx.fillText(`${endTime.toFixed(2)} s`, right, height - 7);
    ctx.restore();
  }

  function updateStageChip() {
    let text;
    if (app.mode === "ready") text = "保持摆杆竖直，推动小车前往目标区";
    else if (app.mode === "paused") text = "物理状态已冻结 · 可按 N 单步推进 8.33 ms";
    else if (app.mode === "failure") text = `${sim.fault.part}首次越限 · 不安全计算已停止`;
    else if (app.mode === "success") text = "已稳定停靠目标区 · 可查看报告或回放";
    else if (app.mode === "replay") text = `正在回放 · 黄色箭头显示该时刻受力`;
    else {
      const error = sim.target - sim.state.x;
      const velocity = sim.state.v;
      if (Math.abs(error) <= sim.config.targetTolerance && Math.abs(velocity) < 0.35) {
        text = "已进入目标区 · 保持低速完成驻留";
      } else if (error > 0) {
        text = velocity > 0.9 ? "正在接近目标 · 提前反向制动" : "目标在右侧 · 按住 D 向右推进";
      } else {
        text = velocity < -0.9 ? "正在接近目标 · 提前反向制动" : "目标在左侧 · 按住 A 向左推进";
      }
    }
    if (ui.stageChip.textContent !== text) ui.stageChip.textContent = text;
  }

  function beginPush(direction, event) {
    if (!(app.mode === "running" || app.mode === "paused")) return;
    if (event) {
      event.preventDefault();
      if (event.currentTarget && event.pointerId != null) {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) { /* noop */ }
      }
    }
    app.heldDirection = direction;
    applyCommandToSim();
    updatePushButtons();
  }

  function endPush(event) {
    if (event) event.preventDefault();
    app.heldDirection = 0;
    applyCommandToSim();
    updatePushButtons();
  }

  function exportReport() {
    if (!sim.isLocked()) return;
    const report = sim.getReport();
    const stride = Math.max(1, Math.ceil(sim.trace.length / 2400));
    report.trajectory = sim.trace.filter((_, index) => index % stride === 0 || index === sim.trace.length - 1);
    report.events = sim.events.slice();
    report.faultPosition = report.fault ? {
      component: report.fault.part,
      x: report.fault.x,
      thetaDeg: report.fault.theta,
      firstExceededAt: report.fault.t,
      limit: report.fault.limit,
      value: report.fault.value
    } : null;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `pendulum-run-${report.status}-${report.duration.toFixed(2)}s.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast("运行报告已导出");
  }

  function bindEvents() {
    ui.btnStart.addEventListener("click", () => {
      if (app.mode === "running") pauseRun();
      else if (app.mode === "paused") resumeRun();
      else if (app.mode !== "replay") startRun();
    });
    ui.btnStep.addEventListener("click", singleStep);
    ui.btnReset.addEventListener("click", () => resetSimulation(true));
    ui.btnReplay.addEventListener("click", () => {
      if (app.mode === "replay") stopReplay();
      else startReplay();
    });
    ui.btnReplayPlay.addEventListener("click", () => {
      if (!app.replay) return;
      if (!app.replay.playing && app.replay.index >= sim.trace.length - 1) startReplay();
      else toggleReplayPlayback();
    });
    ui.replayRange.addEventListener("input", (event) => scrubReplay(event.target.value));
    ui.replaySpeed.addEventListener("change", () => {
      if (app.replay) app.replay.speed = Number(ui.replaySpeed.value);
    });
    ui.btnExport.addEventListener("click", exportReport);

    ui.payloadRange.addEventListener("input", () => {
      ui.payloadValue.textContent = `${Number(ui.payloadRange.value).toFixed(2)} kg`;
      setRangeFill(ui.payloadRange);
      if (app.mode === "ready") {
        sim.setPayload(Number(ui.payloadRange.value));
        updateReadouts(sim.sample());
        updateReport();
      }
    });
    ui.targetRange.addEventListener("input", () => {
      ui.targetValue.textContent = `${signed(Number(ui.targetRange.value), 2)} m`;
      setRangeFill(ui.targetRange);
      if (app.mode === "ready") {
        sim.setTarget(Number(ui.targetRange.value));
        updateReadouts(sim.sample());
        updateReport();
      }
    });
    ui.assistToggle.addEventListener("change", () => {
      sim.setAssist(ui.assistToggle.checked);
      showToast(ui.assistToggle.checked ? "平衡辅助已启用" : "平衡辅助已关闭 · 需要手动稳定摆杆");
    });

    ui.commandRange.addEventListener("input", () => {
      app.command = Number(ui.commandRange.value);
      ui.commandValue.textContent = `${signed(app.command, 2)} m/s²`;
      setRangeFill(ui.commandRange);
      if (!app.heldDirection) applyCommandToSim();
    });
    ui.btnLeft.addEventListener("pointerdown", (event) => beginPush(-1, event));
    ui.btnRight.addEventListener("pointerdown", (event) => beginPush(1, event));
    [ui.btnLeft, ui.btnRight].forEach((button) => {
      ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => {
        button.addEventListener(type, endPush);
      });
    });

    document.addEventListener("keydown", (event) => {
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const key = event.key.toLowerCase();
      if (key === "a" || key === "arrowleft") {
        event.preventDefault();
        if (!event.repeat) beginPush(-1);
      } else if (key === "d" || key === "arrowright") {
        event.preventDefault();
        if (!event.repeat) beginPush(1);
      } else if (key === " " && !event.repeat) {
        event.preventDefault();
        if (app.mode === "running") pauseRun();
        else if (app.mode === "paused") resumeRun();
        else if (app.mode === "ready" || app.mode === "failure" || app.mode === "success") startRun();
      } else if (key === "n" && !event.repeat) {
        event.preventDefault();
        singleStep();
      } else if (key === "r" && !event.repeat) {
        event.preventDefault();
        resetSimulation(true);
      }
    });
    document.addEventListener("keyup", (event) => {
      const key = event.key.toLowerCase();
      if (key === "a" || key === "arrowleft" || key === "d" || key === "arrowright") {
        endPush();
      }
    });

    $("#btnHelp").addEventListener("click", () => { ui.helpDialog.hidden = false; });
    $("#btnHelpClose").addEventListener("click", () => { ui.helpDialog.hidden = true; });
    $("#btnHelpConfirm").addEventListener("click", () => {
      ui.helpDialog.hidden = true;
      if (app.mode === "ready") startRun();
    });
    ui.helpDialog.addEventListener("click", (event) => {
      if (event.target === ui.helpDialog) ui.helpDialog.hidden = true;
    });
  }

  function frame(now) {
    const wall = Math.min(Math.max((now - app.lastFrame) / 1000, 0), 0.08);
    app.lastFrame = now;
    if (app.mode === "running") {
      app.accumulator += wall;
      let steps = 0;
      while (app.accumulator + 1e-9 >= sim.config.dt && steps < 10 && app.mode === "running") {
        applyCommandToSim();
        sim.advance(sim.config.dt);
        app.accumulator -= sim.config.dt;
        steps += 1;
        if (sim.isLocked()) {
          finishRun(sim.status);
          break;
        }
      }
      if (app.mode === "running") updateReadouts(sim.sample());
    } else if (app.mode === "replay") {
      updateReplay(now);
    }

    if (now - app.lastDraw >= 15) {
      drawMainCanvas();
      drawTrendCanvas();
      updateStageChip();
      app.lastDraw = now;
    }
    requestAnimationFrame(frame);
  }

  function init() {
    bindEvents();
    setRangeFill(ui.payloadRange);
    setRangeFill(ui.targetRange);
    setRangeFill(ui.commandRange);
    ui.payloadValue.textContent = "0.90 kg";
    ui.targetValue.textContent = "+1.80 m";
    ui.commandValue.textContent = "0.00 m/s²";
    setMode("ready");
    updateReadouts(sim.trace[0]);
    updateReport();
    app.lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  init();
})();





