(function () {
  "use strict";

  const P = window.FluidPhysics;
  if (!P) throw new Error("FluidPhysics 核心未加载");

  const $ = function (selector) {
    return document.querySelector(selector);
  };

  const elements = {
    runChip: $("#runChip"),
    runChipText: $("#runChipText"),
    missionClock: $("#missionClock"),
    timeRemaining: $("#timeRemaining"),
    tanksReady: $("#tanksReady"),
    riskLevel: $("#riskLevel"),
    networkCanvas: $("#networkCanvas"),
    trendCanvas: $("#trendCanvas"),
    trendEmpty: $("#trendEmpty"),
    headerPressure: $("#headerPressure"),
    totalFlow: $("#totalFlow"),
    faultCallout: $("#faultCallout"),
    faultCode: $("#faultCode"),
    faultTitle: $("#faultTitle"),
    faultDetail: $("#faultDetail"),
    replayBadge: $("#replayBadge"),
    loadInput: $("#loadInput"),
    loadOutput: $("#loadOutput"),
    valveAInput: $("#valveAInput"),
    valveBInput: $("#valveBInput"),
    valveAOutput: $("#valveAOutput"),
    valveBOutput: $("#valveBOutput"),
    valveAActual: $("#valveAActual"),
    valveBActual: $("#valveBActual"),
    valveAFlow: $("#valveAFlow"),
    valveBFlow: $("#valveBFlow"),
    valveTotal: $("#valveTotal"),
    toggleRun: $("#toggleRun"),
    toggleRunText: $("#toggleRunText"),
    stepButton: $("#stepButton"),
    resetButton: $("#resetButton"),
    replayButton: $("#replayButton"),
    replayHint: $("#replayHint"),
    modeTag: $("#modeTag"),
    timelineScrubber: $("#timelineScrubber"),
    timelineBack: $("#timelineBack"),
    timelineForward: $("#timelineForward"),
    timelineCurrent: $("#timelineCurrent"),
    timelineTotal: $("#timelineTotal"),
    frameLabel: $("#frameLabel"),
    metricLoad: $("#metricLoad"),
    metricSpeed: $("#metricSpeed"),
    metricPressure: $("#metricPressure"),
    metricTemp: $("#metricTemp"),
    metricHammer: $("#metricHammer"),
    barLoad: $("#barLoad"),
    barSpeed: $("#barSpeed"),
    barPressure: $("#barPressure"),
    barTemp: $("#barTemp"),
    barHammer: $("#barHammer"),
    reportEmpty: $("#reportEmpty"),
    reportContent: $("#reportContent"),
    reportState: $("#reportState"),
    reportTime: $("#reportTime"),
    reportPeaks: $("#reportPeaks"),
    reportFault: $("#reportFault"),
    exportReport: $("#exportReport"),
    toast: $("#toast")
  };

  const app = {
    controls: P.createInitialControls(),
    sim: P.createInitialState(),
    history: [],
    started: false,
    paused: true,
    replay: { active: false, playing: false, index: 0, accumulator: 0, speed: 2 },
    accumulator: 0,
    lastFrame: performance.now(),
    toastTimer: 0,
    lastBandState: [false, false, false]
  };

  app.history.push(P.snapshot(app.sim));

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isFinal(view) {
    return view && (view.status === "success" || view.status === "failed");
  }

  function getView() {
    if (app.replay.active) {
      return app.history[clamp(app.replay.index, 0, app.history.length - 1)] || app.history[0];
    }
    return P.snapshot(app.sim);
  }

  function getFault(view) {
    return view && view.fault ? view.fault : null;
  }

  function showToast(message) {
    window.clearTimeout(app.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    app.toastTimer = window.setTimeout(function () {
      elements.toast.classList.remove("visible");
    }, 2600);
  }

  function syncControlLabels() {
    elements.loadInput.value = String(app.controls.load);
    elements.valveAInput.value = String(app.controls.valveA);
    elements.valveBInput.value = String(app.controls.valveB);
    elements.loadOutput.textContent = app.controls.load + "%";
    elements.valveAOutput.textContent = app.controls.valveA + "%";
    elements.valveBOutput.textContent = app.controls.valveB + "%";
    elements.valveTotal.textContent = (app.controls.valveA + app.controls.valveB) + "%";
    paintRange(elements.loadInput, "#55e0c2", "#ff766f");
    paintRange(elements.valveAInput, "#5fb7d5");
    paintRange(elements.valveBInput, "#f2b75d");
  }

  function paintRange(input, color, dangerColor) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const percent = ((value - min) / (max - min)) * 100;
    if (dangerColor) {
      const safePercent = ((100 - min) / (max - min)) * 100;
      input.style.setProperty("--track",
        "linear-gradient(90deg," + color + " 0 " + percent + "%," +
        "rgba(108,145,147,.22) " + percent + "% " + safePercent + "%," +
        "rgba(255,118,111,.4) " + safePercent + "% 100%)");
    } else {
      input.style.setProperty("--track",
        "linear-gradient(90deg," + color + " 0 " + percent + "%," +
        "rgba(108,145,147,.22) " + percent + "% 100%)");
    }
  }

  function updateControlsFromInput() {
    app.controls.load = Number(elements.loadInput.value);
    app.controls.valveA = Number(elements.valveAInput.value);
    app.controls.valveB = Number(elements.valveBInput.value);
    syncControlLabels();

    if (!app.started) {
      app.sim.pump.demandLoad = app.controls.load;
      app.sim.valves[0].target = app.controls.valveA;
      app.sim.valves[0].opening = app.controls.valveA;
      app.sim.valves[1].target = app.controls.valveB;
      app.sim.valves[1].opening = app.controls.valveB;
      app.history[0] = P.snapshot(app.sim);
    }
    updateInterface();
  }

  function setLiveState(statusText, chipClass) {
    elements.runChip.className = "run-chip" + (chipClass ? " " + chipClass : "");
    elements.runChipText.textContent = statusText;
  }

  function currentRisk(view) {
    const limits = P.LIMITS;
    const ratios = [
      view.pump.load / limits.load.max,
      view.pump.speed / limits.speed.max,
      view.pump.pressure / limits.pressure.max,
      view.pump.temperature / limits.temperature.max,
      Math.max(view.valves[0].hammerForce, view.valves[1].hammerForce) / limits.hammer.max
    ];
    return Math.max.apply(null, ratios);
  }

  function updateStatus(view) {
    const fault = getFault(view);
    const historyAvailable = app.history.length > 1;
    const final = isFinal(view);
    const bandCount = view.tanks.filter(function (tank) { return tank.inBand; }).length;

    elements.missionClock.textContent = P.formatTime(view.time);
    elements.timeRemaining.textContent = Math.max(0, P.MISSION_TIME - view.time).toFixed(1);
    elements.tanksReady.textContent = String(bandCount);
    elements.headerPressure.textContent = view.pump.pressure.toFixed(3) + " MPa";
    elements.totalFlow.textContent = view.pump.flow.toFixed(1) + " L/s";

    if (app.replay.active) {
      setLiveState("历史回放 · " + (app.replay.playing ? "播放中" : "已暂停"), "replay");
      elements.modeTag.textContent = "REPLAY";
    } else if (app.sim.status === "failed") {
      setLiveState("安全停机 · 检测到越限", "danger");
      elements.modeTag.textContent = "SAFE STOP";
    } else if (app.sim.status === "success") {
      setLiveState("任务达成 · 设备安全", "running");
      elements.modeTag.textContent = "COMPLETE";
    } else if (app.started && app.paused) {
      setLiveState("已暂停 · " + (view.time).toFixed(1) + " s", "");
      elements.modeTag.textContent = "HOLD";
    } else if (app.started) {
      setLiveState("运行中 · 固定步长物理", "running");
      elements.modeTag.textContent = "MANUAL";
    } else {
      setLiveState("待机 · 参数可调", "");
      elements.modeTag.textContent = "MANUAL";
    }

    const risk = fault ? "危险" : currentRisk(view) > 0.9 ? "高" : currentRisk(view) > 0.78 ? "中" : "低";
    elements.riskLevel.textContent = risk;
    elements.riskLevel.style.color = fault ? "var(--coral)" : risk === "高" ? "var(--amber)" : "var(--cyan)";

    elements.replayBadge.hidden = !app.replay.active;
    elements.replayButton.disabled = !historyAvailable;
    elements.replayButton.classList.toggle("active", app.replay.active);
    elements.replayHint.textContent = historyAvailable ? (app.replay.active ? "退出回放" : app.history.length + " 帧") : "等待轨迹";
    elements.exportReport.disabled = !app.started;

    elements.toggleRun.classList.toggle("pause", app.replay.active ? app.replay.playing : (app.started && !app.paused && !final));
    if (app.replay.active) {
      elements.toggleRunText.textContent = app.replay.playing ? "暂停回放" : "继续回放";
      elements.toggleRun.querySelector(".button-icon").textContent = app.replay.playing ? "Ⅱ" : "▶";
    } else if (app.sim.status === "success") {
      elements.toggleRunText.textContent = "任务已达成";
      elements.toggleRun.querySelector(".button-icon").textContent = "✓";
    } else if (app.sim.status === "failed") {
      elements.toggleRunText.textContent = "已安全停机";
      elements.toggleRun.querySelector(".button-icon").textContent = "!";
    } else if (!app.started) {
      elements.toggleRunText.textContent = "开始运行";
      elements.toggleRun.querySelector(".button-icon").textContent = "▶";
    } else if (app.paused) {
      elements.toggleRunText.textContent = "恢复运行";
      elements.toggleRun.querySelector(".button-icon").textContent = "▶";
    } else {
      elements.toggleRunText.textContent = "暂停运行";
      elements.toggleRun.querySelector(".button-icon").textContent = "Ⅱ";
    }

    elements.toggleRun.disabled = !app.replay.active && final;
    elements.stepButton.disabled = !app.replay.active && final;
    elements.stepButton.title = app.replay.active ? "前进一个历史帧" : "固定推进 100 ms";
    elements.frameLabel.textContent = app.replay.active ? "回放帧 · 100 ms/步" : "固定步长 100 ms";
  }

  function updateTimeline(view) {
    const lastIndex = Math.max(0, app.history.length - 1);
    const index = app.replay.active ? clamp(app.replay.index, 0, lastIndex) : lastIndex;
    elements.timelineScrubber.max = String(lastIndex);
    elements.timelineScrubber.value = String(index);
    elements.timelineCurrent.textContent = P.formatTime(view.time);
    elements.timelineTotal.textContent = P.formatTime(app.history[lastIndex].time);
    elements.timelineBack.disabled = index <= 0;
    elements.timelineForward.disabled = index >= lastIndex;
  }

  function updateValveAndFlowLabels(view) {
    elements.valveAActual.textContent = view.valves[0].opening.toFixed(1) + "%";
    elements.valveBActual.textContent = view.valves[1].opening.toFixed(1) + "%";
    elements.valveAFlow.textContent = view.valves[0].flow.toFixed(1) + " L/s";
    elements.valveBFlow.textContent = view.valves[1].flow.toFixed(1) + " L/s";
  }

  function metricClass(card, value, limit) {
    card.classList.toggle("warning", value >= limit * 0.84 && value <= limit);
    card.classList.toggle("danger", value > limit);
  }

  function updateTelemetry(view) {
    const hammer = Math.max(view.valves[0].hammerForce, view.valves[1].hammerForce);
    elements.metricLoad.textContent = view.pump.load.toFixed(1) + "%";
    elements.metricSpeed.textContent = view.pump.speed.toFixed(0) + " rpm";
    elements.metricPressure.textContent = view.pump.pressure.toFixed(3) + " MPa";
    elements.metricTemp.textContent = view.pump.temperature.toFixed(1) + " °C";
    elements.metricHammer.textContent = hammer.toFixed(2) + " kN";

    elements.barLoad.style.width = clamp(view.pump.load, 0, 100) + "%";
    elements.barSpeed.style.width = clamp(view.pump.speed / 1650 * 100, 0, 100) + "%";
    elements.barPressure.style.width = clamp(view.pump.pressure / 1.16 * 100, 0, 100) + "%";
    elements.barTemp.style.width = clamp((view.pump.temperature - 5) / 85 * 100, 0, 100) + "%";
    elements.barHammer.style.width = clamp(hammer / 2.0 * 100, 0, 100) + "%";

    metricClass(document.querySelector('[data-metric="load"]'), view.pump.load, P.LIMITS.load.max);
    metricClass(document.querySelector('[data-metric="speed"]'), view.pump.speed, P.LIMITS.speed.max);
    metricClass(document.querySelector('[data-metric="pressure"]'), view.pump.pressure, P.LIMITS.pressure.max);
    metricClass(document.querySelector('[data-metric="temp"]'), view.pump.temperature, P.LIMITS.temperature.max);
    metricClass(document.querySelector('[data-metric="hammer"]'), hammer, P.LIMITS.hammer.max);
  }

  function updateFaultCallout(view) {
    const fault = getFault(view);
    if (!fault) {
      elements.faultCallout.hidden = true;
      return;
    }
    elements.faultCallout.hidden = false;
    elements.faultCode.textContent = fault.code;
    elements.faultTitle.textContent = fault.type === "deadline"
      ? "任务时限耗尽"
      : fault.component + " · " + fault.metric + "越限";
    const position = fault.location ? "管网定位已标记" : "未产生物理部件损伤";
    elements.faultDetail.textContent =
      "t=" + P.formatTime(fault.time) + " / " + fault.value.toFixed(2) + " " + fault.unit +
      " > " + fault.limit.toFixed(2) + " " + fault.unit + " / " + position;
  }

  function updateReport(view) {
    const fault = getFault(view);
    const started = app.started || app.history.length > 1;
    elements.reportEmpty.hidden = started;
    elements.reportContent.hidden = !started;
    if (!started) return;

    let stateLabel = "运行中";
    let stateClass = "";
    if (app.replay.active) {
      stateLabel = "历史帧";
      stateClass = "replay";
    } else if (view.status === "failed") {
      stateLabel = fault && fault.type === "deadline" ? "任务超时" : "安全停机";
      stateClass = "failed";
    } else if (view.status === "success") {
      stateLabel = "任务达成";
      stateClass = "success";
    } else if (app.paused) {
      stateLabel = "已暂停";
    }
    elements.reportState.textContent = stateLabel;
    elements.reportState.className = "report-state " + stateClass;
    elements.reportTime.textContent = P.formatTime(view.time) + " / " + P.formatTime(P.MISSION_TIME);

    const peaks = view.peaks;
    elements.reportPeaks.innerHTML = [
      ["负载峰值", peaks.load.toFixed(1) + "%"],
      ["转速峰值", peaks.speed.toFixed(0) + " rpm"],
      ["压力峰值", peaks.pressure.toFixed(3) + " MPa"],
      ["温度峰值", peaks.temperature.toFixed(1) + " °C"],
      ["流量峰值", peaks.flow.toFixed(1) + " L/s"],
      ["水锤峰值", peaks.hammer.toFixed(2) + " kN"]
    ].map(function (row) {
      return '<div class="peak-row"><span>' + row[0] + "</span><b>" + row[1] + "</b></div>";
    }).join("");

    if (fault) {
      elements.reportFault.className = "report-fault";
      elements.reportFault.innerHTML =
        "<strong>" + fault.code + " · " + fault.component + "</strong>" +
        "首次越限 " + P.formatTime(fault.time) + "；" + fault.metric + " " +
        fault.value.toFixed(2) + " " + fault.unit + " / 上限 " + fault.limit.toFixed(2) + " " + fault.unit +
        (fault.location ? "<br>故障点已标记在管网示意图。" : "<br>" + fault.message);
    } else if (view.status === "success") {
      elements.reportFault.className = "report-fault safe";
      elements.reportFault.innerHTML = "<strong>SAFE · 三罐达标</strong>所有设备峰值均在安全边界内。";
    } else {
      elements.reportFault.className = "report-fault safe";
      elements.reportFault.innerHTML = "<strong>NO FAULT</strong>峰值追踪中，当前未发现越限部件。";
    }
  }

  function updateInterface() {
    const view = getView();
    elements.trendEmpty.hidden = app.history.length > 1;
    updateStatus(view);
    updateTimeline(view);
    updateValveAndFlowLabels(view);
    updateTelemetry(view);
    updateFaultCallout(view);
    updateReport(view);
  }

  function processEvents(result) {
    result.events.forEach(function (event) {
      if (event.type === "fault") {
        showToast("检测到 " + event.fault.component + " 首次越限，安全计算已停止");
      } else if (event.type === "success") {
        showToast("三罐均已进入目标带，任务达成");
      } else if (event.type === "deadline") {
        showToast("任务时限耗尽，轨迹已冻结");
      }
    });
  }

  function captureBandChanges(view) {
    view.tanks.forEach(function (tank, index) {
      if (view.status !== "success" && view.status !== "failed" && tank.inBand && !app.lastBandState[index]) {
        showToast(tank.name + " 已进入目标液位带");
      }
      app.lastBandState[index] = tank.inBand;
    });
  }

  function advanceOneStep() {
    if (isFinal(P.snapshot(app.sim))) return false;
    if (!app.started) {
      app.started = true;
      app.paused = true;
      app.sim.status = "running";
    }
    const result = P.step(app.sim, app.controls);
    app.history.push(P.snapshot(app.sim));
    processEvents(result);
    captureBandChanges(app.history[app.history.length - 1]);
    if (app.history.length > 602) app.history.shift();
    updateInterface();
    return true;
  }

  function toggleRun() {
    if (app.replay.active) {
      if (!app.replay.playing && app.replay.index >= app.history.length - 1) {
        app.replay.index = 0;
      }
      app.replay.playing = !app.replay.playing;
      app.replay.accumulator = 0;
      updateInterface();
      return;
    }
    if (isFinal(P.snapshot(app.sim))) return;
    if (!app.started) {
      app.started = true;
      app.sim.status = "running";
      app.paused = false;
      app.accumulator = 0;
      app.lastFrame = performance.now();
      showToast("物理计算开始 · 固定步长 100 ms");
    } else {
      app.paused = !app.paused;
      app.accumulator = 0;
      app.lastFrame = performance.now();
    }
    updateInterface();
  }

  function enterReplay(index, play) {
    if (app.history.length < 2) return;
    app.replay.active = true;
    app.replay.index = clamp(index, 0, app.history.length - 1);
    app.replay.playing = Boolean(play);
    app.replay.accumulator = 0;
    app.paused = true;
    updateInterface();
  }

  function exitReplay() {
    app.replay.active = false;
    app.replay.playing = false;
    app.replay.accumulator = 0;
    updateInterface();
  }

  function resetSimulation(silent) {
    app.controls = P.createInitialControls();
    app.sim = P.createInitialState(app.controls);
    app.history = [P.snapshot(app.sim)];
    app.started = false;
    app.paused = true;
    app.replay = { active: false, playing: false, index: 0, accumulator: 0, speed: 2 };
    app.accumulator = 0;
    app.lastBandState = [false, false, false];
    syncControlLabels();
    updateInterface();
    if (!silent) showToast("初始液位、阀门开度与资源已恢复");
  }

  function stepUserAction() {
    if (app.replay.active) {
      app.replay.playing = false;
      app.replay.index = Math.min(app.replay.index + 1, app.history.length - 1);
      updateInterface();
      return;
    }
    app.paused = true;
    advanceOneStep();
    updateInterface();
  }

  function scrubTimeline(index) {
    if (app.history.length < 2) return;
    if (!app.replay.active) {
      app.replay.active = true;
      app.replay.playing = false;
    }
    app.replay.playing = false;
    app.replay.index = clamp(index, 0, app.history.length - 1);
    updateInterface();
  }

  function animate(now) {
    const realDelta = Math.min(0.2, (now - app.lastFrame) / 1000);
    app.lastFrame = now;

    if (app.replay.active && app.replay.playing) {
      app.replay.accumulator += realDelta * 10 * app.replay.speed;
      while (app.replay.accumulator >= 1) {
        app.replay.accumulator -= 1;
        if (app.replay.index < app.history.length - 1) {
          app.replay.index += 1;
        } else {
          app.replay.playing = false;
          app.replay.accumulator = 0;
          break;
        }
      }
      updateInterface();
    } else if (app.started && !app.paused && !isFinal(P.snapshot(app.sim))) {
      app.accumulator += realDelta;
      let advanced = 0;
      while (app.accumulator >= P.DT && advanced < 8) {
        app.accumulator -= P.DT;
        const before = app.sim.time;
        advanceOneStep();
        advanced += 1;
        if (app.sim.time === before || isFinal(P.snapshot(app.sim))) break;
      }
    }

    const view = getView();
    drawNetwork(view);
    drawTrend(view);
    requestAnimationFrame(animate);
  }

  function bindEvents() {
    [elements.loadInput, elements.valveAInput, elements.valveBInput].forEach(function (input) {
      input.addEventListener("input", updateControlsFromInput);
    });
    elements.toggleRun.addEventListener("click", toggleRun);
    elements.stepButton.addEventListener("click", stepUserAction);
    elements.resetButton.addEventListener("click", function () { resetSimulation(false); });
    elements.replayButton.addEventListener("click", function () {
      if (app.replay.active) {
        exitReplay();
      } else {
        enterReplay(0, true);
      }
    });
    elements.timelineScrubber.addEventListener("input", function () {
      scrubTimeline(Number(elements.timelineScrubber.value));
    });
    elements.timelineBack.addEventListener("click", function () {
      scrubTimeline((app.replay.active ? app.replay.index : app.history.length - 1) - 1);
    });
    elements.timelineForward.addEventListener("click", function () {
      scrubTimeline((app.replay.active ? app.replay.index : app.history.length - 1) + 1);
    });
    elements.exportReport.addEventListener("click", exportReport);

    window.addEventListener("resize", function () {
      resizeCanvas(elements.networkCanvas);
      resizeCanvas(elements.trendCanvas);
    });
    window.addEventListener("keydown", function (event) {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggleRun();
      } else if (event.key.toLowerCase() === "r") {
        resetSimulation(false);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepUserAction();
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && app.started && !app.paused) {
        app.paused = true;
        app.accumulator = 0;
        updateInterface();
      }
    });
  }

  function exportReport() {
    const view = P.snapshot(app.sim);
    const data = {
      generatedAt: new Date().toISOString(),
      deterministicPhysics: true,
      fixedStepSeconds: P.DT,
      missionSeconds: P.MISSION_TIME,
      initial: {
        levels: P.TANK_SPECS.map(function (tank) { return tank.initial; }),
        targets: P.TANK_SPECS.map(function (tank) { return tank.target; }),
        controls: P.createInitialControls(),
        toleranceMeters: P.TOLERANCE
      },
      finalControls: { ...app.controls },
      result: {
        status: view.status,
        success: view.status === "success",
        timeSeconds: view.time
      },
      tanks: view.tanks,
      peaks: view.peaks,
      fault: view.fault,
      equipment: {
        pumpLoadPercent: view.pump.load,
        pumpSpeedRpm: view.pump.speed,
        pressureMPa: view.pump.pressure,
        temperatureC: view.pump.temperature,
        valves: view.valves
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "flow-mission-report-" + Date.now() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    showToast("运行报告已导出");
  }

  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height, dpr: dpr };
  }

  // Drawing functions are defined below to keep the state machine independent.
  function drawNetwork(view) {
    if (typeof window.__drawNetwork === "function") window.__drawNetwork(view);
  }

  function drawTrend(view) {
    if (typeof window.__drawTrend === "function") window.__drawTrend(view);
  }

  elements.networkCanvas.__resize = resizeCanvas;
  elements.trendCanvas.__resize = resizeCanvas;
  window.__resizeCanvas = resizeCanvas;
  window.__renderContext = {
    getHistory: function () { return app.history; },
    getReplayIndex: function () { return app.replay.index; },
    isReplay: function () { return app.replay.active; }
  };

  bindEvents();
  syncControlLabels();
  resizeCanvas(elements.networkCanvas);
  resizeCanvas(elements.trendCanvas);
  updateInterface();
  requestAnimationFrame(animate);
})();
