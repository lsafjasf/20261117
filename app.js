(() => {
  "use strict";

  const DT = 0.025;
  const GOAL_HOLD = 1.5;
  const TARGET_TOLERANCE = 0.03;
  const AMBIENT = 26;
  const MODULE_MM = 2;
  const MAX_FRAMES = 6000;
  const GEAR_META = [
    { letter: "A", role: "主动轮", color: "#ffb454", rgb: "255, 180, 84" },
    { letter: "B", role: "惰轮", color: "#5ad8e8", rgb: "90, 216, 232" },
    { letter: "C", role: "输出轮", color: "#a69bfa", rgb: "166, 155, 250" },
  ];
  const LIMITS = {
    speed: { min: 80, max: 1200, unit: "rpm", label: "主动轮转速", component: "主动轮 A / 驱动轴" },
    load: { min: 0.5, max: 16, unit: "N·m", label: "负载扭矩", component: "输出轮 C / 负载端" },
    pressure: { min: 0.18, max: 0.65, unit: "MPa", label: "润滑压力", component: "润滑系统 / 供油管路" },
    temp: { min: -Infinity, max: 95, unit: "°C", label: "轮面温度", component: "齿轮 B / 齿面" },
    gap: { min: -0.6, max: 0.8, unit: "mm", label: "安装轴距间隙", component: "齿轮 B / 轴系" },
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    statusPill: $("statusPill"),
    statusText: $("statusText"),
    simClock: $("simClock"),
    targetOutput: $("targetOutput"),
    actualOutput: $("actualOutput"),
    goalReadout: $("goalReadout"),
    goalStatus: $("goalStatus"),
    faultOverlay: $("faultOverlay"),
    faultOverlayTitle: $("faultOverlayTitle"),
    faultOverlayMeta: $("faultOverlayMeta"),
    dirA: $("dirA"), dirB: $("dirB"), dirC: $("dirC"),
    rpmA: $("rpmA"), rpmB: $("rpmB"), rpmC: $("rpmC"),
    omegaA: $("omegaA"), omegaB: $("omegaB"), omegaC: $("omegaC"),
    teethReadA: $("teethReadA"), teethReadB: $("teethReadB"), teethReadC: $("teethReadC"),
    legendTemp: $("legendTemp"),
    legendForce: $("legendForce"),
    replayTime: $("replayTime"),
    replayEnd: $("replayEnd"),
    replayFill: $("replayFill"),
    replayCursor: $("replayCursor"),
    checksumBadge: $("checksumBadge"),
    editLock: $("editLock"),
    speedRange: $("speedRange"),
    loadRange: $("loadRange"),
    pressureRange: $("pressureRange"),
    gapRange: $("gapRange"),
    speedValue: $("speedValue"),
    loadValue: $("loadValue"),
    pressureValue: $("pressureValue"),
    gapValue: $("gapValue"),
    teethA: $("teethA"),
    teethB: $("teethB"),
    teethC: $("teethC"),
    targetRpm: $("targetRpm"),
    ratioReadout: $("ratioReadout"),
    directionReadout: $("directionReadout"),
    meshState: $("meshState"),
    boundaryTag: $("boundaryTag"),
    firstFault: $("firstFault"),
    firstFaultText: $("firstFaultText"),
    limitSpeedActual: $("limitSpeedActual"),
    limitLoadActual: $("limitLoadActual"),
    limitPressureActual: $("limitPressureActual"),
    limitTempActual: $("limitTempActual"),
    limitSpeedBar: $("limitSpeedBar"),
    limitLoadBar: $("limitLoadBar"),
    limitPressureBar: $("limitPressureBar"),
    limitTempBar: $("limitTempBar"),
    btnRun: $("btnRun"),
    btnPause: $("btnPause"),
    btnStep: $("btnStep"),
    btnReplay: $("btnReplay"),
    btnReset: $("btnReset"),
    btnReport: $("btnReport"),
    runNote: $("runNote"),
    trendEmpty: $("trendEmpty"),
    gearCanvas: $("gearCanvas"),
    trendCanvas: $("trendCanvas"),
    reportModal: $("reportModal"),
    reportBody: $("reportBody"),
    reportTitle: $("reportTitle"),
    btnCloseReport: $("btnCloseReport"),
    btnReportReplay: $("btnReportReplay"),
    btnReportReset: $("btnReportReset"),
  };

  const app = {
    mode: "idle",
    params: null,
    sim: null,
    display: null,
    frames: [],
    result: null,
    accumulator: 0,
    lastFrame: performance.now(),
    replayCursor: 0,
    replayClock: 0,
    replayReturnMode: "paused",
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readParams() {
    const target = clamp(Number(el.targetRpm.value) || 240, 20, 800);
    return {
      speed: Number(el.speedRange.value),
      load: Number(el.loadRange.value),
      pressure: Number(el.pressureRange.value),
      gap: Number(el.gapRange.value),
      teeth: [Number(el.teethA.value), Number(el.teethB.value), Number(el.teethC.value)],
      target,
    };
  }

  function cloneParams(params) {
    return { ...params, teeth: [...params.teeth] };
  }

  function getMeshIssue(params) {
    const [a, b, c] = params.teeth;
    const ratios = [Math.max(a, b) / Math.min(a, b), Math.max(b, c) / Math.min(b, c)];
    if (ratios[0] > 2) {
      return {
        pair: "A–B",
        component: "A–B 啮合区 / 惰轮 B",
        quantity: "相邻齿数比",
        value: ratios[0],
        limit: 2,
        message: `A–B 齿数跨度 ${ratios[0].toFixed(2)} > 2.00，轮齿无法同步进入啮合。`,
      };
    }
    if (ratios[1] > 2) {
      return {
        pair: "B–C",
        component: "B–C 啮合区 / 惰轮 B",
        quantity: "相邻齿数比",
        value: ratios[1],
        limit: 2,
        message: `B–C 齿数跨度 ${ratios[1].toFixed(2)} > 2.00，轮齿无法同步进入啮合。`,
      };
    }
    return null;
  }

  function makeFault(kind, component, quantity, value, limit, message, extra = {}) {
    return {
      kind,
      component,
      quantity,
      value,
      limit,
      message,
      time: extra.time ?? 0,
      gear: extra.gear ?? null,
      pair: extra.pair ?? null,
    };
  }

  function getPreflightFault(params) {
    if (params.gap < LIMITS.gap.min) {
      return makeFault(
        "jam",
        "A–B / B–C 轴系",
        "安装轴距间隙",
        params.gap,
        LIMITS.gap.min,
        `轴距过盈 ${Math.abs(params.gap).toFixed(2)} mm，轮齿干涉并锁死传动链。`
      );
    }
    const meshIssue = getMeshIssue(params);
    if (meshIssue) {
      return makeFault(
        "jam",
        meshIssue.component,
        meshIssue.quantity,
        meshIssue.value,
        meshIssue.limit,
        meshIssue.message,
        { pair: meshIssue.pair }
      );
    }
    if (params.speed < LIMITS.speed.min || params.speed > LIMITS.speed.max) {
      return makeFault(
        "limit",
        LIMITS.speed.component,
        LIMITS.speed.label,
        params.speed,
        params.speed > LIMITS.speed.max ? LIMITS.speed.max : LIMITS.speed.min,
        `主动轮设定 ${params.speed.toFixed(0)} rpm 超出安全转速包络。`
      );
    }
    if (params.load < LIMITS.load.min || params.load > LIMITS.load.max) {
      return makeFault(
        "limit",
        LIMITS.load.component,
        LIMITS.load.label,
        params.load,
        params.load > LIMITS.load.max ? LIMITS.load.max : LIMITS.load.min,
        `负载扭矩 ${params.load.toFixed(1)} N·m 超出安全负载包络。`
      );
    }
    if (params.pressure < LIMITS.pressure.min || params.pressure > LIMITS.pressure.max) {
      return makeFault(
        "limit",
        LIMITS.pressure.component,
        LIMITS.pressure.label,
        params.pressure,
        params.pressure > LIMITS.pressure.max ? LIMITS.pressure.max : LIMITS.pressure.min,
        `润滑压力 ${params.pressure.toFixed(2)} MPa 超出允许供油范围。`
      );
    }
    return null;
  }

  function rpmFor(params) {
    const speedA = params.speed;
    const speedB = -speedA * params.teeth[0] / params.teeth[1];
    const speedC = speedA * params.teeth[0] / params.teeth[2];
    return [speedA, speedB, speedC];
  }

  function contactForce(params) {
    const tight = clamp((0.2 - params.gap) / 1.0, 0, 1);
    const pitchRadius = MODULE_MM * params.teeth[2] / 2;
    return (2 * params.load / pitchRadius) * (1 + tight * 0.55);
  }

  function hashAdd(hash, text) {
    let next = hash >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      next ^= text.charCodeAt(i);
      next = Math.imul(next, 16777619);
    }
    return next >>> 0;
  }

  function createSimulation(params) {
    const clean = cloneParams(params);
    const rpm = rpmFor(clean);
    const initialB = Math.PI / clean.teeth[0] * 0.5 + Math.PI / clean.teeth[1];
    const initialC = Math.PI / clean.teeth[1] * 0.35 + Math.PI / clean.teeth[2];
    return {
      params: clean,
      step: 0,
      time: 0,
      angleA: 0,
      phaseB: initialB,
      phaseC: initialC,
      angleB: initialB,
      angleC: initialC,
      temps: [AMBIENT, AMBIENT, AMBIENT],
      peakTemps: [AMBIENT, AMBIENT, AMBIENT],
      peakOutput: 0,
      peakForce: 0,
      peakTemp: AMBIENT,
      peakTempTime: 0,
      peakTempGear: 0,
      goalHold: 0,
      status: "ready",
      firstFault: null,
      hash: 2166136261,
    };
  }

  function isMechanicallyLocked(params) {
    return Boolean(getMeshIssue(params)) || params.gap < LIMITS.gap.min;
  }

  function makeSnapshot(sim) {
    const stopped = sim.status === "fault";
    const rpm = stopped ? [0, 0, 0] : rpmFor(sim.params);
    const maxTemp = Math.max(...sim.temps);
    return {
      step: sim.step,
      time: sim.time,
      angleA: sim.angleA,
      angleB: sim.angleB,
      angleC: sim.angleC,
      temps: [...sim.temps],
      maxTemp,
      rpm,
      force: stopped ? 0 : contactForce(sim.params),
      goalHold: sim.goalHold,
      status: sim.status,
      speed: sim.params.speed,
      load: sim.params.load,
      pressure: sim.params.pressure,
      gap: sim.params.gap,
    };
  }

  function previewSnapshot(params) {
    const locked = isMechanicallyLocked(params);
    const rpm = locked ? [0, 0, 0] : rpmFor(params);
    return {
      step: 0,
      time: 0,
      angleA: 0,
      angleB: Math.PI / params.teeth[0] * 0.5 + Math.PI / params.teeth[1],
      angleC: Math.PI / params.teeth[1] * 0.35 + Math.PI / params.teeth[2],
      temps: [AMBIENT, AMBIENT, AMBIENT],
      maxTemp: AMBIENT,
      rpm,
      force: locked ? 0 : contactForce(params),
      goalHold: 0,
      status: "ready",
      speed: params.speed,
      load: params.load,
      pressure: params.pressure,
      gap: params.gap,
    };
  }

  function recordFrame(sim) {
    const frame = makeSnapshot(sim);
    app.frames.push(frame);
    if (app.frames.length > MAX_FRAMES) {
      app.frames.splice(0, app.frames.length - MAX_FRAMES);
    }
    app.display = frame;
    return frame;
  }

  function updateThermalState(sim) {
    const params = sim.params;
    const tightness = clamp((0.2 - params.gap) / 1.0, 0, 1);
    const cooling = 0.65 + params.pressure * 1.7;
    const heat = 18 + params.load * 3.6 + params.speed * 0.028 + tightness * 190;
    const equilibrium = AMBIENT + heat / cooling;
    const offsets = [0.9, 1, 0.96];
    const timeConstants = [2.8, 2.15, 2.5];
    for (let i = 0; i < 3; i += 1) {
      const target = AMBIENT + (equilibrium - AMBIENT) * offsets[i];
      const alpha = 1 - Math.exp(-DT / timeConstants[i]);
      sim.temps[i] += (target - sim.temps[i]) * alpha;
      sim.peakTemps[i] = Math.max(sim.peakTemps[i], sim.temps[i]);
    }
    const maxTemp = Math.max(...sim.temps);
    if (maxTemp > sim.peakTemp) {
      sim.peakTemp = maxTemp;
      sim.peakTempTime = sim.time;
      sim.peakTempGear = sim.temps.indexOf(maxTemp);
    }
  }

  function triggerFault(sim, fault) {
    if (sim.firstFault) return sim.firstFault;
    fault.time = sim.time;
    sim.firstFault = fault;
    sim.status = "fault";
    app.mode = "fault";
    fsLockControls();
    return fault;
  }

  function stepPhysics() {
    const sim = app.sim;
    if (!sim || (sim.status !== "ready" && sim.status !== "running")) return false;
    sim.status = "running";
    sim.step += 1;
    sim.time = sim.step * DT;
    const params = sim.params;
    const rpm = rpmFor(params);
    const omegaA = rpm[0] * Math.PI / 30;
    sim.angleA += omegaA * DT;
    sim.angleB = sim.phaseB - sim.angleA * params.teeth[0] / params.teeth[1];
    sim.angleC = sim.phaseC + sim.angleA * params.teeth[0] / params.teeth[2];

    updateThermalState(sim);
    sim.peakOutput = Math.max(sim.peakOutput, Math.abs(rpm[2]));
    sim.peakForce = Math.max(sim.peakForce, contactForce(params));

    const maxTemp = Math.max(...sim.temps);
    if (maxTemp > LIMITS.temp.max) {
      const gearIndex = sim.temps.indexOf(maxTemp);
      const meta = GEAR_META[gearIndex];
      triggerFault(
        sim,
        makeFault(
          "thermal",
          `${meta.role} ${meta.letter} / 齿面`,
          LIMITS.temp.label,
          maxTemp,
          LIMITS.temp.max,
          `${meta.role} ${meta.letter} 轮温升至 ${maxTemp.toFixed(1)} °C，越过 ${LIMITS.temp.max.toFixed(1)} °C 安全上限。`,
          { gear: gearIndex }
        )
      );
    } else {
      const targetSpeed = params.target;
      const tolerance = Math.max(targetSpeed * TARGET_TOLERANCE, 0.001);
      if (Math.abs(Math.abs(rpm[2]) - targetSpeed) <= tolerance) {
        sim.goalHold += DT;
      } else {
        sim.goalHold = 0;
      }
      if (sim.goalHold >= GOAL_HOLD - 1e-9) {
        sim.status = "success";
      }
    }

    const signature = [
      sim.step,
      sim.angleA.toFixed(7),
      sim.temps[0].toFixed(7),
      sim.temps[1].toFixed(7),
      sim.temps[2].toFixed(7),
      sim.goalHold.toFixed(4),
      sim.status,
    ].join("|");
    sim.hash = hashAdd(sim.hash, signature);
    recordFrame(sim);

    if (sim.status === "fault") {
      finalizeFault(sim);
    } else if (sim.status === "success") {
      finalizeSuccess(sim);
    }
    return true;
  }

  function finalizeFault(sim) {
    app.mode = "fault";
    app.result = buildResult(sim);
    fsLockControls();
    updateAll();
    showReport("fault");
  }

  function finalizeSuccess(sim) {
    app.mode = "success";
    app.result = buildResult(sim);
    fsLockControls();
    updateAll();
  }

  function buildResult(sim) {
    const p = sim.params;
    const rpm = rpmFor(p);
    return {
      status: sim.status,
      duration: sim.time,
      steps: sim.step,
      checksum: (sim.hash >>> 0).toString(16).toUpperCase().padStart(8, "0"),
      target: p.target,
      finalOutput: sim.status === "fault" ? Math.abs(makeSnapshot(sim).rpm[2]) : Math.abs(rpm[2]),
      ratio: p.teeth[0] / p.teeth[2],
      speedA: p.speed,
      speedB: rpm[1],
      speedC: rpm[2],
      direction: "与主动轮 A 同向",
      peaks: {
        output: sim.peakOutput,
        force: sim.peakForce,
        load: p.load,
        temps: [...sim.peakTemps],
        maxTemp: sim.peakTemp,
        maxTempTime: sim.peakTempTime,
        maxTempGear: sim.peakTempGear,
      },
      fault: sim.firstFault ? { ...sim.firstFault } : null,
      params: cloneParams(p),
    };
  }

  function prepareSimulation() {
    app.params = readParams();
    app.sim = createSimulation(app.params);
    app.frames = [];
    app.result = null;
    app.replayCursor = 0;
    app.replayClock = 0;
    app.display = makeSnapshot(app.sim);
    const fault = getPreflightFault(app.params);
    if (fault) {
      app.sim.hash = hashAdd(app.sim.hash, `0|preflight|${fault.component}|${fault.value}`);
      triggerFault(app.sim, fault);
      recordFrame(app.sim);
      finalizeFault(app.sim);
      return false;
    }
    return true;
  }

  function startSimulation() {
    if (["running", "paused", "replaying", "replayPaused"].includes(app.mode)) return;
    app.mode = "running";
    if (!prepareSimulation()) return;
    app.mode = "running";
    app.accumulator = 0;
    app.lastFrame = performance.now();
    fsLockControls();
    updateAll();
  }

  function pauseOrResume() {
    if (app.mode === "running") {
      app.mode = "paused";
      app.accumulator = 0;
    } else if (app.mode === "paused") {
      app.mode = "running";
      app.accumulator = 0;
      app.lastFrame = performance.now();
    } else if (app.mode === "replaying") {
      app.mode = "replayPaused";
    } else if (app.mode === "replayPaused") {
      app.mode = "replaying";
      app.lastFrame = performance.now();
    }
    updateAll();
  }

  function stepOnce() {
    if (app.mode === "idle") {
      app.mode = "paused";
      if (!prepareSimulation()) return;
      app.mode = "paused";
      stepPhysics();
      updateAll();
      return;
    }
    if (app.mode === "paused") {
      stepPhysics();
      updateAll();
      return;
    }
    if (app.mode === "replayPaused") {
      if (app.replayCursor < app.frames.length - 1) {
        app.replayCursor += 1;
        app.display = app.frames[app.replayCursor];
        app.replayClock = app.replayCursor * DT;
        updateAll();
      }
    }
  }

  function resetSimulation() {
    closeReport();
    app.params = readParams();
    app.sim = createSimulation(app.params);
    app.frames = [];
    app.result = null;
    app.display = previewSnapshot(app.params);
    app.mode = "idle";
    app.accumulator = 0;
    app.replayCursor = 0;
    app.replayClock = 0;
    app.lastFrame = performance.now();
    fsUnlockControls();
    updateAll();
  }

  function refreshIdlePreview() {
    if (app.mode !== "idle") return;
    app.params = readParams();
    app.sim = null;
    app.result = null;
    app.frames = [];
    app.display = previewSnapshot(app.params);
    updateAll();
  }

  function setControlsLocked(locked) {
    const controls = [
      el.speedRange, el.loadRange, el.pressureRange, el.gapRange,
      el.teethA, el.teethB, el.teethC, el.targetRpm,
    ];
    controls.forEach((control) => {
      control.disabled = locked;
    });
    el.editLock.textContent = locked ? "参数锁定" : "可编辑";
    el.editLock.classList.toggle("locked", locked);
  }

  function fsLockControls() {
    setControlsLocked(true);
  }

  function fsUnlockControls() {
    setControlsLocked(false);
  }

  function formatSigned(value, digits = 1) {
    if (Math.abs(value) < 0.05) return (0).toFixed(digits);
    const sign = value > 0 ? "+" : "−";
    return `${sign}${Math.abs(value).toFixed(digits)}`;
  }

  function formatNumber(value, digits = 1) {
    return Number(value).toFixed(digits);
  }

  function updateFieldReadouts(params) {
    el.speedValue.innerHTML = `${params.speed.toFixed(0)} <small>rpm</small>`;
    el.loadValue.innerHTML = `${params.load.toFixed(1)} <small>N·m</small>`;
    el.pressureValue.innerHTML = `${params.pressure.toFixed(2)} <small>MPa</small>`;
    const gapText = `${params.gap >= 0 ? "+" : "−"}${Math.abs(params.gap).toFixed(2)}`;
    el.gapValue.innerHTML = `${gapText} <small>mm</small>`;
    el.speedValue.classList.toggle("out-of-bounds", params.speed < LIMITS.speed.min || params.speed > LIMITS.speed.max);
    el.loadValue.classList.toggle("out-of-bounds", params.load < LIMITS.load.min || params.load > LIMITS.load.max);
    el.pressureValue.classList.toggle("out-of-bounds", params.pressure < LIMITS.pressure.min || params.pressure > LIMITS.pressure.max);
    el.gapValue.classList.toggle("out-of-bounds", params.gap < LIMITS.gap.min);
  }

  function updateRatioAndMesh(params) {
    const ratio = params.teeth[0] / params.teeth[2];
    el.ratioReadout.textContent = `1 : ${ratio.toFixed(3)}`;
    el.directionReadout.textContent = "与 A 同向";
    const meshIssue = getMeshIssue(params);
    el.meshState.classList.remove("warn", "danger");
    if (params.gap < LIMITS.gap.min) {
      el.meshState.classList.add("danger");
      el.meshState.lastChild.textContent = "轴距过盈 · 将锁死";
    } else if (meshIssue) {
      el.meshState.classList.add("danger");
      el.meshState.lastChild.textContent = `${meshIssue.pair} 齿数跨度 ${meshIssue.value.toFixed(2)} · 卡死`;
    } else if (params.gap < 0) {
      el.meshState.classList.add("warn");
      el.meshState.lastChild.textContent = "轴距偏紧 · 摩擦升高";
    } else {
      el.meshState.lastChild.textContent = "齿数配合正常";
    }
  }

  function getLimitSeverity(quantity, value) {
    if (quantity === "temp") {
      if (value > LIMITS.temp.max) return "danger";
      if (value > LIMITS.temp.max - 10) return "warn";
      return "safe";
    }
    const limit = LIMITS[quantity];
    if (value < limit.min || value > limit.max) return "danger";
    const span = limit.max - limit.min;
    if (value < limit.min + span * 0.08 || value > limit.max - span * 0.08) return "warn";
    return "safe";
  }

  function domainPercent(quantity, value) {
    const domains = {
      speed: [40, 1500],
      load: [0, 24],
      pressure: [0.05, 0.8],
      temp: [20, 110],
    };
    const [min, max] = domains[quantity];
    return clamp((value - min) / (max - min) * 100, 2, 100);
  }

  function updateLimits(snap) {
    const values = {
      speed: snap.speed,
      load: snap.load,
      pressure: snap.pressure,
      temp: snap.maxTemp,
    };
    el.limitSpeedActual.textContent = values.speed.toFixed(0);
    el.limitLoadActual.textContent = values.load.toFixed(1);
    el.limitPressureActual.textContent = values.pressure.toFixed(2);
    el.limitTempActual.textContent = values.temp.toFixed(1);
    el.limitSpeedBar.style.width = `${domainPercent("speed", values.speed)}%`;
    el.limitLoadBar.style.width = `${domainPercent("load", values.load)}%`;
    el.limitPressureBar.style.width = `${domainPercent("pressure", values.pressure)}%`;
    el.limitTempBar.style.width = `${domainPercent("temp", values.temp)}%`;
    let overall = "safe";
    ["speed", "load", "pressure", "temp"].forEach((quantity) => {
      const severity = getLimitSeverity(quantity, values[quantity]);
      const card = document.querySelector(`.limit-item[data-limit="${quantity}"]`);
      card.classList.toggle("warn", severity === "warn");
      card.classList.toggle("danger", severity === "danger");
      if (severity === "danger") overall = "danger";
      else if (severity === "warn" && overall === "safe") overall = "warn";
    });
    el.boundaryTag.classList.toggle("warn", overall === "warn");
    el.boundaryTag.classList.toggle("danger", overall === "danger");
    el.boundaryTag.textContent = overall === "danger" ? "边界越界" : overall === "warn" ? "接近边界" : "全部正常";
  }

  function updateGoalReadout(snap, params) {
    const output = Math.abs(snap.rpm[2]);
    const tolerance = params.target * TARGET_TOLERANCE;
    const inWindow = Math.abs(output - params.target) <= tolerance;
    let label = "等待启动";
    let state = "idle";
    if (app.mode === "running" || app.mode === "paused") {
      if (inWindow) {
        label = `目标窗口 ${snap.goalHold.toFixed(2)} / ${GOAL_HOLD.toFixed(1)} s`;
        state = "active";
      } else {
        const error = ((output - params.target) / params.target) * 100;
        label = `偏离目标 ${error > 0 ? "+" : ""}${error.toFixed(1)}%`;
        state = "active";
      }
    } else if (app.mode === "replaying" || app.mode === "replayPaused") {
      label = inWindow ? "回放 · 目标窗口内" : `回放 · 偏离 ${(((output - params.target) / params.target) * 100).toFixed(1)}%`;
      state = inWindow ? "active" : "idle";
    } else if (app.mode === "success") {
      label = "目标输出已稳定达成";
      state = "success";
    } else if (app.mode === "fault") {
      label = "安全边界触发 · 已停止";
      state = "danger";
    } else if (getPreflightFault(params)) {
      label = "条件越界 · 等待中止判定";
      state = "danger";
    }
    el.goalStatus.textContent = label;
    el.goalReadout.dataset.goal = state;
  }

  function updateTelemetry(snap) {
    const params = app.sim ? app.sim.params : app.params;
    const omega = snap.rpm.map((value) => value * Math.PI / 30);
    el.rpmA.textContent = formatSigned(snap.rpm[0], 1);
    el.rpmB.textContent = formatSigned(snap.rpm[1], 1);
    el.rpmC.textContent = formatSigned(snap.rpm[2], 1);
    el.omegaA.textContent = `${formatSigned(omega[0], 2)} rad/s`;
    el.omegaB.textContent = `${formatSigned(omega[1], 2)} rad/s`;
    el.omegaC.textContent = `${formatSigned(omega[2], 2)} rad/s`;
    el.teethReadA.textContent = `z ${params.teeth[0]}`;
    el.teethReadB.textContent = `z ${params.teeth[1]}`;
    el.teethReadC.textContent = `z ${params.teeth[2]}`;
    const directionTags = [el.dirA, el.dirB, el.dirC];
    snap.rpm.forEach((value, index) => {
      directionTags[index].classList.toggle("reverse", value < -0.05);
      if (Math.abs(value) < 0.05) directionTags[index].textContent = "锁止";
      else directionTags[index].textContent = value > 0 ? "顺时针" : "逆时针";
    });
    el.actualOutput.textContent = Math.abs(snap.rpm[2]).toFixed(1);
    el.targetOutput.textContent = params.target.toFixed(0);
    el.simClock.textContent = `${snap.time.toFixed(3)} s`;
    el.legendTemp.textContent = `${snap.maxTemp.toFixed(1)}°C`;
    el.legendForce.textContent = `${snap.force.toFixed(2)} kN`;
    el.trendEmpty.hidden = app.frames.length > 0;
    updateLimits(snap);
    updateGoalReadout(snap, params);

    const fault = app.sim && app.sim.firstFault;
    const replaying = app.mode === "replaying" || app.mode === "replayPaused";
    const showFault = Boolean(fault && (!replaying || snap.status === "fault"));
    if (showFault) {
      el.firstFault.hidden = false;
      el.firstFaultText.textContent = `${fault.component} · t ${fault.time.toFixed(3)} s`;
      el.faultOverlay.hidden = false;
      el.faultOverlayTitle.textContent = fault.quantity === "相邻齿数比" ? "轮齿卡死" : "安全边界触发";
      const unit = fault.quantity === "相邻齿数比" ? "" : fault.quantity === "安装轴距间隙" ? "mm" : fault.quantity === "轮面温度" ? "°C" : "";
      el.faultOverlayMeta.textContent = `${fault.component} · ${fault.quantity} ${typeof fault.value === "number" ? fault.value.toFixed(2) : fault.value}${unit ? ` ${unit}` : ""} · t ${fault.time.toFixed(2)} s`;
    } else {
      el.firstFault.hidden = true;
      el.faultOverlay.hidden = true;
    }
  }

  function updateButtons() {
    const active = ["running", "paused", "replaying", "replayPaused"].includes(app.mode);
    el.btnRun.disabled = active;
    el.btnRun.querySelector("span").textContent = app.mode === "success" || app.mode === "fault" ? "重新运行" : "启动仿真";

    const canPause = ["running", "paused", "replaying", "replayPaused"].includes(app.mode);
    el.btnPause.disabled = !canPause;
    let pauseLabel = "暂停";
    if (app.mode === "paused" || app.mode === "replayPaused") pauseLabel = "继续";
    if (app.mode === "replaying") pauseLabel = "暂停回放";
    el.btnPause.querySelector("span").textContent = pauseLabel;

    el.btnStep.disabled = !["idle", "paused", "replayPaused"].includes(app.mode);
    el.btnReplay.disabled = app.frames.length < 2 || ["replaying", "replayPaused"].includes(app.mode);
    el.btnReplay.querySelector("span").textContent = app.mode === "paused" || app.mode === "success" || app.mode === "fault" ? "回放" : "回放";
    el.btnReport.disabled = !app.result;
    el.btnReport.hidden = !app.result;
  }

  function updateRunNote() {
    let text = "调整条件后启动；暂停与单步均由同一物理内核推进。";
    let state = "";
    if (app.mode === "running") {
      text = "运行中 · 25 ms 固定步长 · 配置已锁定，重置后可修改。";
    } else if (app.mode === "paused") {
      text = "已暂停 · 单步仅推进 25 ms，恢复后轨迹与连续运行一致。";
    } else if (app.mode === "replaying") {
      text = "回放中 · 使用已记录轨迹，不重新计算物理状态。";
    } else if (app.mode === "replayPaused") {
      text = "回放暂停 · 单步前进一帧记录。";
    } else if (app.mode === "success") {
      text = "目标输出已稳定达成 · 最终报告已生成。";
      state = "success";
    } else if (app.mode === "fault") {
      const fault = app.sim && app.sim.firstFault;
      text = fault ? `已停止不安全计算 · 首次越限：${fault.component} · t ${fault.time.toFixed(2)} s` : "已停止不安全计算。";
      state = "danger";
    } else {
      const fault = getPreflightFault(readParams());
      if (fault) {
        text = `启动前检查：${fault.message}`;
        state = "danger";
      }
    }
    el.runNote.textContent = text;
    el.runNote.classList.toggle("danger", state === "danger");
    el.runNote.classList.toggle("success", state === "success");
  }

  function updateStatus() {
    const labels = {
      idle: "系统就绪",
      running: "仿真运行",
      paused: "已暂停",
      replaying: "轨迹回放",
      replayPaused: "回放暂停",
      success: "目标达成",
      fault: "安全中止",
    };
    const state = app.mode === "replayPaused" ? "paused" : app.mode === "replaying" ? "running" : app.mode;
    el.statusPill.dataset.state = state;
    el.statusText.textContent = labels[app.mode] || "系统就绪";
  }

  function updateReplayRail() {
    const total = Math.max(0, app.frames.length - 1);
    const index = app.mode === "replaying" || app.mode === "replayPaused"
      ? app.replayCursor
      : Math.max(0, app.frames.length - 1);
    const progress = total > 0 ? index / total : 0;
    el.replayFill.style.width = `${progress * 100}%`;
    el.replayCursor.style.left = `${progress * 100}%`;
    const cursorTime = app.frames[index]?.time ?? app.sim?.time ?? 0;
    const endTime = app.frames[total]?.time ?? app.sim?.time ?? 0;
    el.replayTime.textContent = `t ${cursorTime.toFixed(3)} s`;
    el.replayEnd.textContent = `t ${endTime.toFixed(3)} s`;
    if (app.sim) {
      const hash = (app.sim.hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
      el.checksumBadge.textContent = app.sim.step > 0 || app.sim.firstFault ? `轨迹校验 ${hash}` : "轨迹校验 --";
    } else {
      el.checksumBadge.textContent = "轨迹校验 --";
    }
  }

  function updateAll() {
    const params = app.mode === "idle" || !app.sim ? app.params || readParams() : app.sim.params;
    if (!app.display) app.display = previewSnapshot(params);
    updateFieldReadouts(readParams());
    updateRatioAndMesh(params);
    updateTelemetry(app.display);
    updateReplayRail();
    updateButtons();
    updateRunNote();
    updateStatus();
    drawTrend();
    drawGears();
  }

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height, dpr };
  }

  function gearPath(ctx, cx, cy, pitchRadius, teeth, angle, outerRatio = 1.075, rootRatio = 0.9) {
    const outer = pitchRadius * outerRatio;
    const root = pitchRadius * rootRatio;
    const step = (Math.PI * 2) / teeth;
    ctx.beginPath();
    for (let i = 0; i < teeth; i += 1) {
      const center = angle + i * step;
      const points = [
        [center - step * 0.50, root],
        [center - step * 0.31, root],
        [center - step * 0.20, outer],
        [center + step * 0.20, outer],
        [center + step * 0.31, root],
        [center + step * 0.50, root],
      ];
      points.forEach(([a, r], index) => {
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0 && index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
    }
    ctx.closePath();
  }

  function gearTheme(index) {
    return [
      { light: "#624c2d", mid: "#342b1c", edge: "#d7984f", glow: "255, 180, 84" },
      { light: "#20505a", mid: "#142b31", edge: "#4fc5d5", glow: "90, 216, 232" },
      { light: "#3a3b60", mid: "#202338", edge: "#9a92e7", glow: "166, 155, 250" },
    ][index];
  }

  function drawGear(ctx, x, y, pitchRadius, teeth, angle, index, snap, jammed) {
    const theme = gearTheme(index);
    const outerRadius = pitchRadius * 1.075;
    const hot = snap.temps[index] > 82;
    const edgeColor = jammed ? "#ff6e78" : hot ? "#ff9a68" : theme.edge;

    ctx.save();
    ctx.shadowColor = jammed ? "rgba(255,110,120,0.38)" : `rgba(${theme.glow},0.24)`;
    ctx.shadowBlur = jammed ? 18 : 12;
    gearPath(ctx, x, y, pitchRadius, teeth, angle);
    const fill = ctx.createRadialGradient(
      x - pitchRadius * 0.35,
      y - pitchRadius * 0.42,
      pitchRadius * 0.08,
      x,
      y,
      pitchRadius * 1.13
    );
    fill.addColorStop(0, jammed ? "#4a2529" : theme.light);
    fill.addColorStop(0.62, jammed ? "#25171b" : theme.mid);
    fill.addColorStop(1, "#0b1116");
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = edgeColor;
    ctx.globalAlpha = 0.78;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const innerRadius = pitchRadius * 0.71;
    ctx.beginPath();
    ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(7,13,18,0.52)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${theme.glow},0.28)`;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
    ctx.clip();
    for (let spoke = 0; spoke < 6; spoke += 1) {
      const a = angle * 0.25 + spoke * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * pitchRadius * 0.23, y + Math.sin(a) * pitchRadius * 0.23);
      ctx.lineTo(x + Math.cos(a) * innerRadius, y + Math.sin(a) * innerRadius);
      ctx.lineWidth = Math.max(4, pitchRadius * 0.105);
      ctx.strokeStyle = "rgba(5,10,14,0.52)";
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${theme.glow},0.11)`;
      ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, pitchRadius * 0.245, 0, Math.PI * 2);
    ctx.fillStyle = "#0b1218";
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(${theme.glow},0.58)`;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = edgeColor;
    ctx.font = `700 ${Math.max(12, pitchRadius * 0.22)}px ${getComputedStyle(document.body).getPropertyValue("--mono")}`;
    ctx.fillText(GEAR_META[index].letter, x, y - pitchRadius * 0.055);
    ctx.fillStyle = "rgba(221,235,239,0.52)";
    ctx.font = `500 ${Math.max(7, pitchRadius * 0.095)}px ${getComputedStyle(document.body).getPropertyValue("--mono")}`;
    ctx.fillText(`z ${teeth}`, x, y + pitchRadius * 0.145);

    if (hot) {
      ctx.beginPath();
      ctx.arc(x, y, outerRadius + 2, -Math.PI * 0.72, Math.PI * 0.72);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,110,120,0.55)";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawArrowHead(ctx, x, y, angle, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * 0.46);
    ctx.lineTo(-size * 0.7, 0);
    ctx.lineTo(-size, size * 0.46);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawRotationArrow(ctx, x, y, radius, clockwise, color) {
    const start = clockwise ? Math.PI * 1.16 : Math.PI * 1.84;
    const end = clockwise ? Math.PI * 1.84 : Math.PI * 1.16;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, start, end, !clockwise);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.82;
    ctx.stroke();
    const tipX = x + Math.cos(end) * radius;
    const tipY = y + Math.sin(end) * radius;
    const tangent = end + (clockwise ? Math.PI / 2 : -Math.PI / 2);
    drawArrowHead(ctx, tipX, tipY, tangent, 5.5, color);
    ctx.restore();
  }

  function drawMeshPoint(ctx, x, y, force, broken) {
    const color = broken ? "#ff6e78" : "#ffb454";
    ctx.save();
    if (!broken) {
      ctx.shadowColor = "rgba(255,180,84,0.55)";
      ctx.shadowBlur = 10;
    }
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.fillRect(-3.2, -3.2, 6.4, 6.4);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 0.7;
    ctx.strokeRect(-3.2, -3.2, 6.4, 6.4);
    if (broken) {
      ctx.rotate(-Math.PI / 4);
      ctx.strokeStyle = "#ff9aa0";
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i += 1) {
        const angle = i * Math.PI * 2 / 3 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * 5, Math.sin(angle) * 5);
        ctx.lineTo(Math.cos(angle) * 10, Math.sin(angle) * 10);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawStageBackdrop(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = "rgba(145,183,199,0.055)";
    ctx.lineWidth = 1;
    for (let x = 20; x < width; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = 18; y < height; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash([3, 8]);
    ctx.strokeStyle = "rgba(90,216,232,0.08)";
    ctx.beginPath();
    ctx.moveTo(20, height * 0.45);
    ctx.lineTo(width - 20, height * 0.45);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(142,184,201,0.06)";
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.45, Math.min(width, height) * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.45, Math.min(width, height) * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawIOLabel(ctx, x, y, text, value, color, pointsRight) {
    ctx.save();
    ctx.textAlign = pointsRight ? "left" : "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.font = '700 8px "SFMono-Regular", Consolas, monospace';
    ctx.fillText(text, x, y - 8);
    ctx.fillStyle = "rgba(198,215,222,0.68)";
    ctx.font = '500 9px "SFMono-Regular", Consolas, monospace';
    ctx.fillText(value, x, y + 6);
    ctx.restore();
  }

  function drawGears() {
    const { ctx, width, height } = fitCanvas(el.gearCanvas);
    ctx.clearRect(0, 0, width, height);
    drawStageBackdrop(ctx, width, height);

    const params = app.sim ? app.sim.params : app.params || readParams();
    const snap = app.display || previewSnapshot(params);
    const z = params.teeth;
    const sumZ = z[0] + z[1] + z[2];
    const maxOuterUnit = Math.max(z[0], z[1], z[2]) + 2;
    const spanUnit = 2 * sumZ + 4 + params.gap * 2;
    const scale = Math.max(
      1.05,
      Math.min((width - 122) / spanUnit, (height - 96) / (2 * maxOuterUnit + 22), 3.65)
    );
    const pitch = z.map((teeth) => teeth * scale);
    const outer = z.map((teeth) => (teeth + 2) * scale);
    const gapPx = params.gap * scale;
    const d12 = (z[0] + z[1]) * scale + gapPx;
    const d23 = (z[1] + z[2]) * scale + gapPx;
    const usedSpan = d12 + d23 + outer[0] + outer[2];
    const xA = (width - usedSpan) / 2 + outer[0];
    const xB = xA + d12;
    const xC = xB + d23;
    const centerY = height * 0.45;
    const centers = [xA, xB, xC];
    const jamFault = app.sim && app.sim.firstFault && app.sim.firstFault.kind === "jam";
    const mechanicalLock = isMechanicallyLocked(params);
    const jammed = Boolean(jamFault || (app.mode === "fault" && mechanicalLock));

    ctx.save();
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = "rgba(154,187,199,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xA - outer[0] - 18, centerY);
    ctx.lineTo(xC + outer[2] + 18, centerY);
    ctx.stroke();
    ctx.restore();

    const rotations = [snap.angleA, snap.angleB, snap.angleC];
    for (let i = 0; i < 3; i += 1) {
      drawGear(ctx, centers[i], centerY, pitch[i], z[i], rotations[i], i, snap, jammed);
    }

    const mesh1Broken = jammed && (app.sim?.firstFault?.pair === "A–B" || !app.sim?.firstFault?.pair);
    const mesh2Broken = jammed && (app.sim?.firstFault?.pair === "B–C" || !app.sim?.firstFault?.pair);
    const mesh1X = (xA + xB) / 2;
    const mesh2X = (xB + xC) / 2;
    drawMeshPoint(ctx, mesh1X, centerY, snap.force, mesh1Broken);
    drawMeshPoint(ctx, mesh2X, centerY, snap.force, mesh2Broken);

    for (let i = 0; i < 3; i += 1) {
      const rpm = snap.rpm[i];
      if (Math.abs(rpm) < 0.01) continue;
      const radius = outer[i] + 11;
      drawRotationArrow(ctx, centers[i], centerY, radius, rpm > 0, GEAR_META[i].color);
    }

    const inputStart = Math.max(14, xA - outer[0] - 78);
    const inputEnd = xA - outer[0] - 13;
    ctx.save();
    ctx.strokeStyle = "rgba(255,180,84,0.6)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(inputStart, centerY);
    ctx.lineTo(inputEnd, centerY);
    ctx.stroke();
    drawArrowHead(ctx, inputEnd, centerY, 0, 6, "#ffb454");
    drawIOLabel(ctx, inputStart + 1, centerY, "INPUT", `${snap.rpm[0] >= 0 ? "+" : "−"}${Math.abs(snap.rpm[0]).toFixed(0)} rpm`, "#d49a55", true);
    ctx.restore();

    const outputStart = xC + outer[2] + 13;
    const outputEnd = Math.min(width - 14, xC + outer[2] + 78);
    ctx.save();
    const outputColor = app.mode === "success" ? "#68d99b" : "rgba(90,216,232,0.7)";
    ctx.strokeStyle = outputColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(outputStart, centerY);
    ctx.lineTo(outputEnd, centerY);
    ctx.stroke();
    drawArrowHead(ctx, outputEnd, centerY, 0, 6, app.mode === "success" ? "#68d99b" : "#5ad8e8");
    drawIOLabel(ctx, outputEnd - 1, centerY, "OUTPUT", `${Math.abs(snap.rpm[2]).toFixed(0)} rpm`, "#6bcbd7", false);
    ctx.restore();

    const dimY = Math.min(height - 23, centerY + Math.max(...outer) + 35);
    ctx.save();
    ctx.strokeStyle = "rgba(145,177,190,0.26)";
    ctx.fillStyle = "rgba(145,177,190,0.48)";
    ctx.lineWidth = 0.8;
    ctx.font = '500 8px "SFMono-Regular", Consolas, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const dimensionPairs = [
      { x1: xA, x2: xB, label: `A–B  ${(z[0] + z[1] + params.gap).toFixed(2)} mm` },
      { x1: xB, x2: xC, label: `B–C  ${(z[1] + z[2] + params.gap).toFixed(2)} mm` },
    ];
    dimensionPairs.forEach((pair) => {
      ctx.beginPath();
      ctx.moveTo(pair.x1, dimY);
      ctx.lineTo(pair.x2, dimY);
      ctx.moveTo(pair.x1, dimY - 4);
      ctx.lineTo(pair.x1, dimY + 4);
      ctx.moveTo(pair.x2, dimY - 4);
      ctx.lineTo(pair.x2, dimY + 4);
      ctx.stroke();
      ctx.fillText(pair.label, (pair.x1 + pair.x2) / 2, dimY - 4);
    });
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,180,84,0.62)";
    ctx.font = '700 8px "SFMono-Regular", Consolas, monospace';
    ctx.fillText(`Fₙ ${snap.force.toFixed(2)} kN`, (mesh1X + mesh2X) / 2, centerY + Math.max(...outer) + 16);
    ctx.restore();

    if (jamFault) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,110,120,0.86)";
      ctx.font = '700 9px "SFMono-Regular", Consolas, monospace';
      ctx.fillText("MESH LOCKED", (mesh1X + mesh2X) / 2, centerY - Math.max(...outer) - 18);
      ctx.restore();
    }
  }

  function drawTrend() {
    const { ctx, width, height } = fitCanvas(el.trendCanvas);
    ctx.clearRect(0, 0, width, height);
    const left = 29;
    const right = width - 30;
    const top = 8;
    const bottom = height - 17;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, bottom - top);

    ctx.save();
    ctx.strokeStyle = "rgba(144,179,194,0.11)";
    ctx.lineWidth = 0.7;
    ctx.font = '500 7px "SFMono-Regular", Consolas, monospace';
    ctx.fillStyle = "rgba(123,151,164,0.45)";
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    [110, 80, 50, 20].forEach((value, index) => {
      const y = top + (plotHeight / 4) * index;
      ctx.fillText(`${value}`, left - 5, y);
    });
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("°C", 6, top + 7);
    ctx.textAlign = "right";
    ctx.fillText("kN", width - 5, bottom + 13);
    ctx.restore();

    const allFrames = app.frames;
    if (allFrames.length === 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(90,216,232,0.28)";
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const replayMode = app.mode === "replaying" || app.mode === "replayPaused";
    const frames = replayMode ? allFrames.slice(0, app.replayCursor + 1) : allFrames;
    const endTime = Math.max(
      allFrames[allFrames.length - 1].time,
      replayMode ? app.frames[app.replayCursor]?.time || 0 : 0,
      DT
    );
    const maxForce = Math.max(1.2, ...allFrames.map((frame) => frame.force)) * 1.12;
    const xAt = (time) => left + (time / endTime) * plotWidth;
    const tempY = (value) => top + (1 - (clamp(value, 20, 110) - 20) / 90) * plotHeight;
    const forceY = (value) => bottom - (clamp(value, 0, maxForce) / maxForce) * plotHeight;

    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = "rgba(255,110,120,0.42)";
    ctx.lineWidth = 0.8;
    const limitY = tempY(LIMITS.temp.max);
    ctx.beginPath();
    ctx.moveTo(left, limitY);
    ctx.lineTo(right, limitY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,110,120,0.56)";
    ctx.font = '500 7px "SFMono-Regular", Consolas, monospace';
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("95°C LIMIT", left + 4, limitY - 2);
    ctx.restore();

    function plotLine(getValue, yMap, color, fillColor) {
      if (frames.length === 1) {
        const frame = frames[0];
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(xAt(frame.time), yMap(getValue(frame)), 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.beginPath();
      frames.forEach((frame, index) => {
        const x = xAt(frame.time);
        const y = yMap(getValue(frame));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (fillColor) {
        ctx.lineTo(xAt(frames[frames.length - 1].time), bottom);
        ctx.lineTo(xAt(frames[0].time), bottom);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, top, 0, bottom);
        gradient.addColorStop(0, fillColor);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.beginPath();
        frames.forEach((frame, index) => {
          const x = xAt(frame.time);
          const y = yMap(getValue(frame));
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    }

    plotLine((frame) => frame.maxTemp, tempY, "rgba(255,180,84,0.94)", "rgba(255,180,84,0.10)");
    plotLine((frame) => frame.force, forceY, "rgba(90,216,232,0.9)", "rgba(90,216,232,0.055)");

    const last = frames[frames.length - 1];
    ctx.save();
    [[xAt(last.time), tempY(last.maxTemp), "#ffb454"], [xAt(last.time), forceY(last.force), "#5ad8e8"]].forEach(([x, y, color]) => {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(124,151,163,0.43)";
    ctx.font = '500 7px "SFMono-Regular", Consolas, monospace';
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillText("0.00 s", left, height - 2);
    ctx.textAlign = "right";
    ctx.fillText(`${endTime.toFixed(2)} s`, right, height - 2);
    ctx.restore();
  }

  function startReplay() {
    if (app.frames.length < 2 || app.mode === "replaying" || app.mode === "replayPaused") return;
    if (app.mode === "running") app.mode = "paused";
    if (app.sim && app.sim.status === "success") app.replayReturnMode = "success";
    else if (app.sim && app.sim.status === "fault") app.replayReturnMode = "fault";
    else app.replayReturnMode = "paused";
    closeReport();
    app.mode = "replaying";
    app.replayCursor = 0;
    app.replayClock = 0;
    app.display = app.frames[0];
    app.lastFrame = performance.now();
    updateAll();
  }

  function advanceReplay(elapsed) {
    const lastIndex = app.frames.length - 1;
    app.replayClock += elapsed;
    const nextIndex = clamp(Math.floor(app.replayClock / DT), 0, lastIndex);
    if (nextIndex !== app.replayCursor) {
      app.replayCursor = nextIndex;
      app.display = app.frames[nextIndex];
    }
    if (app.replayCursor >= lastIndex) {
      app.mode = app.replayReturnMode;
      app.display = app.frames[lastIndex];
      app.replayClock = lastIndex * DT;
    }
    updateAll();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showReport(kind = "auto") {
    const result = app.result;
    if (!result) return;
    const success = result.status === "success";
    const fault = result.fault;
    el.reportTitle.textContent = success ? "最终运行报告" : "安全中止报告";
    const heroTitle = success ? "目标输出稳定达成" : "仿真已安全中止";
    const heroMessage = success
      ? `输出 ${Math.abs(result.finalOutput).toFixed(1)} rpm 在 ±${(TARGET_TOLERANCE * 100).toFixed(0)}% 目标窗口内保持 ${GOAL_HOLD.toFixed(1)} s。`
      : fault?.message || "安全边界触发，计算已停止。";
    const faultText = fault
      ? `首次越限：${fault.component} · ${fault.quantity} ${typeof fault.value === "number" ? fault.value.toFixed(2) : fault.value} / 限值 ${typeof fault.limit === "number" ? fault.limit.toFixed(2) : fault.limit} · t ${fault.time.toFixed(3)} s`
      : "本次运行未发生越限。";
    const gearRows = GEAR_META.map((meta, index) => `
      <tr>
        <td>${meta.role} ${meta.letter} · 峰值轮温</td>
        <td>${result.peaks.temps[index].toFixed(1)} °C</td>
        <td>z ${result.params.teeth[index]}</td>
      </tr>`).join("");
    const reportStatus = success ? "TARGET MET" : "UNSAFE STOP";
    el.reportBody.innerHTML = `
      <div class="report-hero${success ? "" : " fault"}">
        <div class="report-hero-icon">${success ? "✓" : "!"}</div>
        <div class="report-hero-copy">
          <small>${reportStatus}</small>
          <b>${escapeHtml(heroTitle)}</b>
          <p>${escapeHtml(heroMessage)}</p>
        </div>
      </div>
      <div class="report-metrics">
        <div class="report-metric"><span>仿真时长</span><b>${result.duration.toFixed(2)} s</b></div>
        <div class="report-metric"><span>目标 / 实际</span><b>${result.target.toFixed(0)} / ${Math.abs(result.finalOutput).toFixed(0)} rpm</b></div>
        <div class="report-metric"><span>理论速比</span><b>1 : ${result.ratio.toFixed(3)}</b></div>
        <div class="report-metric"><span>轨迹步数</span><b>${result.steps}</b></div>
      </div>
      <div class="report-section-title">PEAKS &amp; COMPONENTS</div>
      <table class="report-table">
        <thead><tr><th>对象 / 指标</th><th>峰值</th><th>配置</th></tr></thead>
        <tbody>
          ${gearRows}
          <tr><td>输出轮 C · 转速峰值</td><td>${result.peaks.output.toFixed(1)} rpm</td><td>z ${result.params.teeth[2]}</td></tr>
          <tr><td>啮合区 · 接触力峰值</td><td>${result.peaks.force.toFixed(2)} kN</td><td>模数 M2</td></tr>
          <tr><td>负载端 · 扭矩峰值</td><td>${result.peaks.load.toFixed(1)} N·m</td><td>安全 ≤ 16.0</td></tr>
        </tbody>
      </table>
      <div class="report-fault${success ? " ok" : ""}">
        <span>${success ? "FAULT LOCATION / 本次无故障" : "FIRST LIMIT EVENT / 故障位置"}</span>
        <b>${escapeHtml(faultText)}</b>
      </div>
      <div class="report-footer-note">
        输出方向 ${escapeHtml(result.direction)} · 峰值温度 ${result.peaks.maxTemp.toFixed(1)} °C @ t ${result.peaks.maxTempTime.toFixed(3)} s · ${GEAR_META[result.peaks.maxTempGear].letter} 轮<br>
        确定性轨迹校验 ${result.checksum} · 固定步长 25 ms · 相同输入重复运行将得到一致轨迹。
      </div>`;
    el.btnReportReplay.disabled = app.frames.length < 2;
    el.reportModal.hidden = false;
  }

  function closeReport() {
    el.reportModal.hidden = true;
  }

  function handleRun() {
    closeReport();
    startSimulation();
  }

  function handleRangeChange() {
    if (app.mode !== "idle") return;
    refreshIdlePreview();
  }

  function handleStructureChange() {
    if (app.mode !== "idle") return;
    refreshIdlePreview();
  }

  function initialize() {
    app.params = readParams();
    app.sim = createSimulation(app.params);
    app.display = previewSnapshot(app.params);
    app.mode = "idle";
    setControlsLocked(false);
    updateAll();
  }

  el.speedRange.addEventListener("input", handleRangeChange);
  el.loadRange.addEventListener("input", handleRangeChange);
  el.pressureRange.addEventListener("input", handleRangeChange);
  el.gapRange.addEventListener("input", handleRangeChange);
  el.teethA.addEventListener("change", handleStructureChange);
  el.teethB.addEventListener("change", handleStructureChange);
  el.teethC.addEventListener("change", handleStructureChange);
  el.targetRpm.addEventListener("input", handleStructureChange);
  el.targetRpm.addEventListener("change", () => {
    el.targetRpm.value = String(clamp(Number(el.targetRpm.value) || 240, 20, 800));
    handleStructureChange();
  });
  el.btnRun.addEventListener("click", handleRun);
  el.btnPause.addEventListener("click", pauseOrResume);
  el.btnStep.addEventListener("click", stepOnce);
  el.btnReplay.addEventListener("click", startReplay);
  el.btnReset.addEventListener("click", resetSimulation);
  el.btnReport.addEventListener("click", () => showReport("manual"));
  el.btnCloseReport.addEventListener("click", closeReport);
  el.btnReportReset.addEventListener("click", () => {
    closeReport();
    resetSimulation();
  });
  el.btnReportReplay.addEventListener("click", () => {
    closeReport();
    startReplay();
  });
  el.reportModal.addEventListener("click", (event) => {
    if (event.target === el.reportModal) closeReport();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.reportModal.hidden) closeReport();
  });

  window.addEventListener("resize", () => {
    drawGears();
    drawTrend();
  });

  function animationLoop(now) {
    const elapsed = Math.min(Math.max(0, (now - app.lastFrame) / 1000), 0.1);
    app.lastFrame = now;
    if (app.mode === "running") {
      app.accumulator += elapsed;
      let steps = 0;
      while (app.accumulator >= DT && steps < 8 && app.mode === "running") {
        app.accumulator -= DT;
        stepPhysics();
        steps += 1;
      }
      if (steps > 0) updateAll();
    } else if (app.mode === "replaying") {
      advanceReplay(elapsed);
    }
    requestAnimationFrame(animationLoop);
  }

  document.addEventListener("visibilitychange", () => {
    app.accumulator = 0;
    app.lastFrame = performance.now();
  });

  initialize();
  requestAnimationFrame(animationLoop);
})();
