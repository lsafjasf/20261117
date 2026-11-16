(() => {
  "use strict";

  const DT = 1 / 60;
  const TAU = Math.PI * 2;
  const MAX_CYCLES = 2;
  const STROKE_TOLERANCE = 0.75;
  const TARGET_RPM = 60;
  const TARGET_PERIOD = 60 / TARGET_RPM;
  const DEG = 180 / Math.PI;

  const LIMITS = Object.freeze({
    load: 2600,
    speed: 150,
    temp: 90,
    pressure: 4,
    transmission: 20,
  });

  const MACHINE = Object.freeze({
    equivalentMass: 180,
    bearingArea: 1150,
    ambientTemp: 26,
    thermalTau: 0.12,
  });

  const COLORS = Object.freeze({
    bg: "#0b100e",
    grid: "rgba(158, 185, 169, 0.07)",
    gridStrong: "rgba(158, 185, 169, 0.12)",
    text: "#dfe8e1",
    muted: "#6f7d74",
    dim: "#4c5a51",
    lime: "#c8f46c",
    cyan: "#68ddd7",
    amber: "#ffb35c",
    red: "#ff6f67",
    steel: "#9eaca3",
    steelDark: "#344139",
  });

  const FAULT_META = Object.freeze({
    load: {
      short: "负载越限",
      component: "滑块 / 负载端",
      unit: "N",
      advice: "降低外加载荷后重置，再重新验证完整行程。",
    },
    speed: {
      short: "转速越限",
      component: "主轴 / 驱动电机",
      unit: "rpm",
      advice: "降低驱动转速；峰值惯性力随转速平方增长。",
    },
    temp: {
      short: "温度越限",
      component: "曲柄主轴轴承",
      unit: "°C",
      advice: "降低转速或载荷，等待热模型回落并重置。",
    },
    pressure: {
      short: "轴压越限",
      component: "连杆小头轴瓦",
      unit: "MPa",
      advice: "降低载荷或转速，避免轴瓦在峰值加速度处过载。",
    },
    geometry: {
      short: "死点干涉",
      component: "连杆 / 滑块导轨",
      unit: "°",
      advice: "增加连杆长度或减小曲柄半径，使 L > r 且传动角不小于 20°。",
    },
  });

  const PHASE_META = {
    ready: { text: "就绪", code: "READY", pill: "ready" },
    running: { text: "安全计算中", code: "RUN", pill: "" },
    paused: { text: "已暂停", code: "PAUSED", pill: "paused" },
    fault: { text: "安全停机", code: "FAULT", pill: "fault" },
    success: { text: "目标达成", code: "SUCCESS", pill: "success" },
    complete: { text: "记录完成", code: "COMPLETE", pill: "success" },
    replay: { text: "样本回放", code: "REPLAY", pill: "replay" },
    replayPaused: { text: "回放暂停", code: "R-PAUSE", pill: "paused" },
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const elements = {
    radiusInput: $("#radiusInput"),
    rodInput: $("#rodInput"),
    strokeInput: $("#strokeInput"),
    speedInput: $("#speedInput"),
    loadInput: $("#loadInput"),
    radiusValue: $("#radiusValue"),
    rodValue: $("#rodValue"),
    strokeValue: $("#strokeValue"),
    speedValue: $("#speedValue"),
    loadValue: $("#loadValue"),
    actualStroke: $("#actualStroke"),
    rodRatio: $("#rodRatio"),
    minTransmission: $("#minTransmission"),
    assemblyBadge: $("#assemblyBadge"),
    statePill: $("#statePill"),
    stateText: $("#stateText"),
    angleReadout: $("#angleReadout"),
    mechanismMode: $("#mechanismMode"),
    liveDisplacement: $("#liveDisplacement"),
    liveVelocity: $("#liveVelocity"),
    liveForce: $("#liveForce"),
    gaugeList: $("#gaugeList"),
    targetStrokeLabel: $("#targetStrokeLabel"),
    targetProgress: $("#targetProgress"),
    targetTarget: $("#targetTarget"),
    strokeDeviation: $("#strokeDeviation"),
    strokeMatch: $("#strokeMatch"),
    peakForce: $("#peakForce"),
    peakPressure: $("#peakPressure"),
    peakTemp: $("#peakTemp"),
    minAngleStat: $("#minAngleStat"),
    faultSummary: $("#faultSummary"),
    faultIcon: $("#faultIcon"),
    faultEyebrow: $("#faultEyebrow"),
    faultTitle: $("#faultTitle"),
    faultDetail: $("#faultDetail"),
    runFingerprint: $("#runFingerprint"),
    runTime: $("#runTime"),
    cycleCount: $("#cycleCount"),
    stateCode: $("#stateCode"),
    statusMessage: $("#statusMessage"),
    solverLabel: $("#solverLabel"),
    chartEmpty: $("#chartEmpty"),
    chartMeta: $("#chartMeta"),
    targetCadence: $("#targetCadence"),
    startButton: $("#startButton"),
    startButtonText: $("#startButtonText"),
    stepButton: $("#stepButton"),
    replayButton: $("#replayButton"),
    resetButton: $("#resetButton"),
    reportButton: $("#reportButton"),
    inlineReportButton: $("#inlineReportButton"),
    reportDialog: $("#reportDialog"),
    helpDialog: $("#helpDialog"),
    helpButton: $("#helpButton"),
    reportReplayButton: $("#reportReplayButton"),
    mechanismCanvas: $("#mechanismCanvas"),
    responseCanvas: $("#responseCanvas"),
  };

  const config = {
    radius: 48,
    rod: 160,
    targetStroke: 96,
    speed: 60,
    load: 1150,
  };

  const sim = {
    phase: "ready",
    time: 0,
    step: 0,
    history: [],
    replayIndex: 0,
    replayAtEnd: false,
    fault: null,
    stats: createEmptyStats(),
    fingerprint: "R-0000-0000",
    lastSample: null,
    accumulator: 0,
    replayAccumulator: 0,
    lastFrame: 0,
    targetPeriod: 1,
    targetMet: false,
  };

  const seriesVisible = {
    displacement: true,
    velocity: true,
    force: true,
  };

  function createEmptyStats() {
    return {
      peakForce: 0,
      peakPressure: 0,
      peakTemp: MACHINE.ambientTemp,
      minTransmission: Infinity,
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value, digits = 0) {
    const factor = 10 ** digits;
    const rounded = Math.round(Number(value) * factor) / factor;
    const normalized = rounded === 0 ? 0 : rounded;
    return normalized.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function signed(value, digits = 1) {
    const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
    return `${rounded >= 0 ? "+" : "−"}${formatNumber(Math.abs(rounded), digits)}`;
  }

  function mod(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function getActualStroke() {
    return config.radius * 2;
  }

  function getTransmissionAngle(radius = config.radius, rod = config.rod) {
    if (rod <= radius) return 0;
    return 90 - Math.asin(clamp(radius / rod, -1, 1)) * DEG;
  }

  function getCyclePeriod() {
    return 60 / config.speed;
  }

  function computeSample(time) {
    const radius = config.radius;
    const rod = config.rod;
    const omega = (config.speed * Math.PI) / 30;
    const theta = mod(omega * time, TAU);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const safeRod = Math.max(rod, radius + 0.001);
    const root = Math.sqrt(Math.max(0, safeRod * safeRod - radius * radius * sinTheta * sinTheta));
    const sliderX = radius * cosTheta + root;
    const displacement = sliderX - (safeRod - radius);
    const dxdTheta = -radius * sinTheta - (radius * radius * sinTheta * cosTheta) / root;
    const d2xdTheta2 =
      -radius * cosTheta -
      (radius * radius * (cosTheta * cosTheta - sinTheta * sinTheta)) / root -
      (radius ** 4 * sinTheta * sinTheta * cosTheta * cosTheta) / root ** 3;
    const velocity = omega * dxdTheta;
    const acceleration = ((omega * omega * d2xdTheta2) / 1000);
    const rodAngle = Math.asin(clamp((radius * sinTheta) / safeRod, -1, 1));
    const cosRodAngle = Math.cos(rodAngle);
    const transmission = 90 - Math.abs(rodAngle * DEG);
    const rodForce =
      (Math.abs(MACHINE.equivalentMass * acceleration) + config.load) /
      Math.max(cosRodAngle, 0.12);
    const pressure = rodForce / MACHINE.bearingArea;
    const steadyTemp =
      MACHINE.ambientTemp +
      62 * (config.speed / LIMITS.speed) ** 2.3 +
      16 * (config.load / LIMITS.load) ** 1.2;
    const temperature =
      MACHINE.ambientTemp +
      (steadyTemp - MACHINE.ambientTemp) *
        (1 - Math.exp(-Math.max(0, time) / MACHINE.thermalTau));

    return {
      t: time,
      angle: mod(theta * DEG, 360),
      displacement,
      velocity,
      acceleration,
      force: rodForce,
      pressure,
      temperature,
      transmission,
      load: config.load,
      speed: config.speed,
      rodAngle: rodAngle * DEG,
      stroke: getActualStroke(),
      omega,
    };
  }

  function makeFingerprint() {
    const payload = [
      config.radius,
      config.rod,
      config.targetStroke,
      config.speed,
      config.load,
      MACHINE.equivalentMass,
      MACHINE.bearingArea,
    ].join("|");
    let hash = 2166136261;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
    return `R-${hex.slice(0, 4)}-${hex.slice(4)}`;
  }

  function makeFault(key, value, time, sample = null) {
    const meta = FAULT_META[key];
    const limit =
      key === "geometry" ? LIMITS.transmission : LIMITS[key];
    return {
      key,
      value,
      limit,
      time,
      sample,
      ...meta,
    };
  }

  function detectFault(sample) {
    const candidates = [];
    const add = (key, value) => {
      if (value > LIMITS[key]) {
        candidates.push({ key, value, ratio: value / LIMITS[key] });
      }
    };

    add("load", sample.load);
    add("speed", sample.speed);
    add("pressure", sample.pressure);
    add("temp", sample.temperature);
    if (sample.transmission < LIMITS.transmission) {
      candidates.push({
        key: "geometry",
        value: LIMITS.transmission - sample.transmission,
        ratio: LIMITS.transmission / Math.max(sample.transmission, 0.1),
      });
    }

    if (config.rod <= config.radius) {
      candidates.push({ key: "geometry", value: 0, ratio: 999 });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.ratio - a.ratio);
    const fault = candidates[0];
    if (fault.key === "geometry") {
      return makeFault("geometry", sample.transmission, sample.t, sample);
    }
    return makeFault(fault.key, fault.value, sample.t, sample);
  }

  function updateStats(sample) {
    sim.stats.peakForce = Math.max(sim.stats.peakForce, sample.force);
    sim.stats.peakPressure = Math.max(sim.stats.peakPressure, sample.pressure);
    sim.stats.peakTemp = Math.max(sim.stats.peakTemp, sample.temperature);
    sim.stats.minTransmission = Math.min(sim.stats.minTransmission, sample.transmission);
  }

  function resetStats() {
    sim.stats = createEmptyStats();
    const initial = computeSample(0);
    sim.stats.peakForce = initial.force;
    sim.stats.peakPressure = initial.pressure;
    sim.stats.peakTemp = initial.temperature;
    sim.stats.minTransmission = initial.transmission;
  }

  function initializeGauges() {
    const gauges = [
      { key: "load", label: "外加载荷", unit: "N", limit: LIMITS.load, digits: 0, accent: "cyan" },
      { key: "speed", label: "驱动转速", unit: "rpm", limit: LIMITS.speed, digits: 0, accent: "amber" },
      { key: "temp", label: "轴承温度", unit: "°C", limit: LIMITS.temp, digits: 1, accent: "red" },
      { key: "pressure", label: "轴瓦压力", unit: "MPa", limit: LIMITS.pressure, digits: 2, accent: "lime" },
    ];

    elements.gaugeList.innerHTML = gauges
      .map(
        (gauge) => `
          <div class="gauge-item" data-gauge="${gauge.key}" style="--accent: var(--${gauge.accent})">
            <span class="gauge-name"><i></i>${gauge.label}</span>
            <span class="gauge-value">
              <span id="gauge-${gauge.key}-value">0</span>
              <small>${gauge.unit}</small>
              <span class="limit">/ ${gauge.limit}</span>
            </span>
            <div class="gauge-track"><span class="gauge-fill" id="gauge-${gauge.key}-fill"></span></div>
          </div>`,
      )
      .join("");
  }

  function syncConfigFromInputs() {
    config.radius = Number(elements.radiusInput.value);
    config.rod = Number(elements.rodInput.value);
    config.targetStroke = Number(elements.strokeInput.value);
    config.speed = Number(elements.speedInput.value);
    config.load = Number(elements.loadInput.value);
  }

  function setRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const percent = ((value - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${clamp(percent, 0, 100)}%`);
  }

  function updateControlLabels() {
    const actualStroke = getActualStroke();
    const ratio = config.rod / config.radius;
    const transmission = getTransmissionAngle();
    const targets = [
      [elements.radiusInput, elements.radiusValue],
      [elements.rodInput, elements.rodValue],
      [elements.strokeInput, elements.strokeValue],
      [elements.speedInput, elements.speedValue],
      [elements.loadInput, elements.loadValue],
    ];
    targets.forEach(([input, output]) => {
      setRangeFill(input);
      output.dataset.value = input.value;
    });

    elements.radiusValue.innerHTML = `${formatNumber(config.radius, 1)} <small>mm</small>`;
    elements.rodValue.innerHTML = `${formatNumber(config.rod, 1)} <small>mm</small>`;
    elements.strokeValue.innerHTML = `${formatNumber(config.targetStroke, 1)} <small>mm</small>`;
    elements.speedValue.innerHTML = `${formatNumber(config.speed, 0)} <small>rpm</small>`;
    elements.loadValue.innerHTML = `${formatNumber(config.load, 0)} <small>N</small>`;
    elements.actualStroke.textContent = formatNumber(actualStroke, 1);
    elements.rodRatio.textContent = ratio.toFixed(2);
    elements.rodRatio.classList.toggle("danger", ratio <= 1);
    elements.minTransmission.textContent = transmission.toFixed(1);
    elements.minTransmission.classList.toggle("danger", transmission < LIMITS.transmission);
    elements.targetStrokeLabel.textContent = formatNumber(config.targetStroke, 1);
    elements.targetCadence.textContent =
      `${TARGET_PERIOD.toFixed(3)} s 目标 · 当前 ${getCyclePeriod().toFixed(3)} s`;
    sim.targetPeriod = getCyclePeriod();
  }

  function resetToReady({ refreshFingerprint = true } = {}) {
    sim.phase = "ready";
    sim.time = 0;
    sim.step = 0;
    sim.history.length = 0;
    sim.replayIndex = 0;
    sim.replayAtEnd = false;
    sim.fault = null;
    sim.lastSample = computeSample(0);
    sim.accumulator = 0;
    sim.replayAccumulator = 0;
    sim.targetMet = false;
    sim.targetPeriod = getCyclePeriod();
    resetStats();
    if (refreshFingerprint) sim.fingerprint = makeFingerprint();
    elements.chartEmpty.classList.remove("hidden");
    updateUI();
    drawAll();
  }

  function prepareRun() {
    sim.history.length = 0;
    sim.time = 0;
    sim.step = 0;
    sim.replayIndex = 0;
    sim.replayAtEnd = false;
    sim.fault = null;
    sim.accumulator = 0;
    sim.replayAccumulator = 0;
    sim.targetMet = false;
    sim.targetPeriod = getCyclePeriod();
    sim.fingerprint = makeFingerprint();
    resetStats();
  }

  function pushSample(sample) {
    sim.history.push(sample);
    sim.lastSample = sample;
    updateStats(sample);
    elements.chartEmpty.classList.add("hidden");
  }

  function enterFault(fault, sample) {
    sim.fault = fault;
    sim.phase = "fault";
    sim.time = fault.time;
    sim.accumulator = 0;
    if (sample) sim.lastSample = sample;
  }

  function startSimulation() {
    prepareRun();
    const initial = computeSample(0);

    if (config.rod <= config.radius || getTransmissionAngle() < LIMITS.transmission) {
      const geometryFault = makeFault("geometry", getTransmissionAngle(), 0, initial);
      initial.transmission = getTransmissionAngle();
      pushSample(initial);
      enterFault(geometryFault, initial);
      updateUI();
      drawAll();
      return;
    }

    pushSample(initial);
    const initialFault = detectFault(initial);
    if (initialFault) {
      enterFault(initialFault, initial);
      updateUI();
      drawAll();
      return;
    }

    sim.phase = "running";
    updateUI();
    drawAll();
  }

  function advanceSimulation() {
    if (sim.phase !== "running") return false;

    const nextTime = sim.time + DT;
    const sample = computeSample(nextTime);
    pushSample(sample);
    sim.time = nextTime;
    sim.step += 1;

    const fault = detectFault(sample);
    if (fault) {
      enterFault(fault, sample);
      updateUI();
      return false;
    }

    const actualStroke = getActualStroke();
    const strokeMatches = Math.abs(actualStroke - config.targetStroke) <= STROKE_TOLERANCE;
    if (sim.time >= sim.targetPeriod && strokeMatches) {
      sim.phase = "success";
      sim.targetMet = true;
      sim.accumulator = 0;
      updateUI();
      return false;
    }

    if (sim.time >= sim.targetPeriod * MAX_CYCLES) {
      sim.phase = "complete";
      sim.targetMet = false;
      sim.accumulator = 0;
      updateUI();
      return false;
    }

    updateUI();
    return true;
  }

  function toggleRunState() {
    if (sim.phase === "ready") {
      startSimulation();
      return;
    }

    if (sim.phase === "running") {
      sim.phase = "paused";
      sim.accumulator = 0;
      updateUI();
      drawAll();
      return;
    }

    if (sim.phase === "paused") {
      sim.phase = "running";
      sim.accumulator = 0;
      updateUI();
      drawAll();
      return;
    }

    if (sim.phase === "replay") {
      sim.phase = "replayPaused";
      sim.replayAccumulator = 0;
      updateUI();
      drawAll();
      return;
    }

    if (sim.phase === "replayPaused") {
      if (sim.replayAtEnd) {
        beginReplay();
      } else {
        sim.phase = "replay";
        sim.replayAccumulator = 0;
        updateUI();
        drawAll();
      }
      return;
    }

    resetToReady();
  }

  function stepSimulation() {
    if (sim.phase === "replayPaused") {
      stepReplay();
      return;
    }

    if (sim.phase === "ready") {
      startSimulation();
      if (sim.phase !== "paused" && sim.phase !== "running") return;
      sim.phase = "paused";
    }

    if (sim.phase === "paused" && sim.step === 0) {
      sim.phase = "running";
      advanceSimulation();
      if (sim.phase === "running") sim.phase = "paused";
      updateUI();
      drawAll();
      return;
    }

    if (sim.phase === "paused") {
      sim.phase = "running";
      advanceSimulation();
      if (sim.phase === "running") sim.phase = "paused";
      updateUI();
      drawAll();
    }
  }

  function beginReplay() {
    if (sim.history.length < 2) return;
    sim.replayIndex = 0;
    sim.replayAtEnd = false;
    sim.phase = "replay";
    sim.replayAccumulator = 0;
    sim.lastSample = sim.history[0];
    updateUI();
    drawAll();
  }

  function stepReplay() {
    if (!sim.history.length) return;
    if (sim.replayIndex < sim.history.length - 1) {
      sim.replayIndex += 1;
      sim.lastSample = sim.history[sim.replayIndex];
    } else {
      sim.replayAtEnd = true;
      sim.phase = "replayPaused";
    }
    updateUI();
    drawAll();
  }

  function currentDisplaySample() {
    if (
      (sim.phase === "replay" || sim.phase === "replayPaused") &&
      sim.history.length > 0
    ) {
      return sim.history[clamp(sim.replayIndex, 0, sim.history.length - 1)];
    }
    if (sim.history.length > 0) return sim.history[sim.history.length - 1];
    return computeSample(0);
  }

  function isGeometryInvalid() {
    return config.rod <= config.radius || getTransmissionAngle() < LIMITS.transmission;
  }

  function updateGauges(sample) {
    const values = {
      load: sample.load,
      speed: sample.speed,
      temp: sample.temperature,
      pressure: sample.pressure,
    };
    const digits = { load: 0, speed: 0, temp: 1, pressure: 2 };

    Object.entries(values).forEach(([key, value]) => {
      const item = elements.gaugeList.querySelector(`[data-gauge="${key}"]`);
      const valueNode = $(`#gauge-${key}-value`);
      const fillNode = $(`#gauge-${key}-fill`);
      const ratio = value / LIMITS[key];
      const percent = clamp(ratio * 100, 0, 100);
      valueNode.textContent = formatNumber(value, digits[key]);
      fillNode.style.width = `${percent}%`;
      item.classList.toggle("warning", ratio >= 0.75 && ratio <= 1);
      item.classList.toggle("danger", ratio > 1);
    });
  }

  function updateFaultSummary(sample) {
    elements.faultSummary.className = "fault-summary safe";
    elements.faultIcon.textContent = "✓";
    elements.faultEyebrow.textContent = "边界状态";

    if (sim.phase === "fault" && sim.fault) {
      elements.faultSummary.className = "fault-summary danger";
      elements.faultIcon.textContent = "!";
      elements.faultEyebrow.textContent = "首次越限 · 已冻结";
      elements.faultTitle.textContent = `${sim.fault.short} · ${sim.fault.component}`;
      elements.faultDetail.textContent =
        `t ${sim.fault.time.toFixed(3)} s · ${formatNumber(sim.fault.value, sim.fault.key === "pressure" ? 2 : sim.fault.key === "temp" ? 1 : 0)} ${sim.fault.unit}`;
      return;
    }

    if (sim.phase === "success") {
      elements.faultSummary.className = "fault-summary info";
      elements.faultIcon.textContent = "✓";
      elements.faultEyebrow.textContent = "目标达成";
      elements.faultTitle.textContent = "完整往返且行程匹配";
      elements.faultDetail.textContent =
        `${sim.time.toFixed(3)} s · 实际 ${formatNumber(getActualStroke(), 1)} mm / 目标 ${formatNumber(config.targetStroke, 1)} mm`;
      return;
    }

    if (sim.phase === "complete") {
      elements.faultSummary.className = "fault-summary info";
      elements.faultIcon.textContent = "i";
      elements.faultEyebrow.textContent = "记录结束";
      elements.faultTitle.textContent = "安全完成采样，行程未匹配目标";
      elements.faultDetail.textContent =
        `偏差 ${signed(getActualStroke() - config.targetStroke, 1)} mm · 重置后可重新装配`;
      return;
    }

    if (sim.phase === "replay" || sim.phase === "replayPaused") {
      elements.faultSummary.className = "fault-summary info";
      elements.faultIcon.textContent = "↻";
      elements.faultEyebrow.textContent = "样本回放";
      elements.faultTitle.textContent = `显示第 ${sim.replayIndex + 1} / ${sim.history.length} 帧`;
      elements.faultDetail.textContent =
        `t ${sample.t.toFixed(3)} s · 数据来自原始求解序列`;
      return;
    }

    if (sim.phase === "paused") {
      elements.faultSummary.className = "fault-summary info";
      elements.faultIcon.textContent = "Ⅱ";
      elements.faultEyebrow.textContent = "暂停快照";
      elements.faultTitle.textContent = "物理时间已冻结";
      elements.faultDetail.textContent = `${sim.history.length} samples · 单步 16.67 ms`;
      return;
    }

    if (sim.phase === "running") {
      elements.faultTitle.textContent = "全部参数在安全包络内";
      elements.faultDetail.textContent =
        `已核验 ${sim.history.length} 帧 · 峰值轴力 ${formatNumber(sim.stats.peakForce, 0)} N`;
      return;
    }

    if (isGeometryInvalid()) {
      elements.faultSummary.className = "fault-summary danger";
      elements.faultIcon.textContent = "!";
      elements.faultEyebrow.textContent = "装配预检";
      elements.faultTitle.textContent = "连杆过短，存在死点干涉";
      elements.faultDetail.textContent = "启动后将立即锁定首次故障位置";
      return;
    }

    elements.faultTitle.textContent = "全部参数在安全包络内";
    elements.faultDetail.textContent = "等待启动采样";
  }

  function updateStatusMessage() {
    const messages = {
      ready: "调整装配参数后启动；暂停、单步与恢复共享同一固定步长状态。",
      running: "固定步长求解中；每次采样同步核验四项边界与传动角。",
      paused: "已暂停。物理状态保持不变，单步将精确推进 16.67 ms。",
      fault: "安全联锁已触发，积分已停止。可回放至首次越限点并查看报告。",
      success: "完成一个完整往返，行程达到目标且未越过安全边界。",
      complete: "完成两次周期采样；实际行程未达到目标，请重置后调整曲柄半径。",
      replay: "正在回放已记录样本，不重新积分；峰值与故障位置保持一致。",
      replayPaused: sim.replayAtEnd ? "回放已结束。再次回放将从头读取同一份记录。" : "回放已暂停，可单步检查逐帧受力。",
    };
    elements.statusMessage.classList.toggle("danger", sim.phase === "fault");
    elements.statusMessage.innerHTML = `<span class="status-pulse"></span>${messages[sim.phase]}`;
  }

  function updateUI() {
    const sample = currentDisplaySample();
    const actualStroke = getActualStroke();
    const deviation = actualStroke - config.targetStroke;
    const matches = Math.abs(deviation) <= STROKE_TOLERANCE;
    const meta = PHASE_META[sim.phase];
    const inputsLocked = sim.phase !== "ready";
    const isReplay = sim.phase === "replay" || sim.phase === "replayPaused";
    const displayTime = isReplay ? sample.t : sim.time;

    elements.statePill.className = `state-pill ${meta.pill}`.trim();
    elements.stateText.textContent = meta.text;
    elements.stateCode.textContent = meta.code;
    elements.angleReadout.textContent = `θ ${sample.angle.toFixed(1)}°`;
    elements.runTime.textContent = `${displayTime.toFixed(3)} s`;
    elements.runFingerprint.textContent = sim.fingerprint;
    elements.cycleCount.textContent = (displayTime / sim.targetPeriod).toFixed(2);
    elements.liveDisplacement.innerHTML = `${formatNumber(sample.displacement, 1)}<small> mm</small>`;
    elements.liveVelocity.innerHTML = `${formatNumber(sample.velocity, 0)}<small> mm/s</small>`;
    elements.liveForce.innerHTML = `${formatNumber(sample.force, 0)}<small> N</small>`;
    elements.peakForce.innerHTML = `${formatNumber(sim.stats.peakForce, 0)}<small> N</small>`;
    elements.peakPressure.innerHTML = `${formatNumber(sim.stats.peakPressure, 2)}<small> MPa</small>`;
    elements.peakTemp.innerHTML = `${formatNumber(sim.stats.peakTemp, 1)}<small> °C</small>`;
    elements.minAngleStat.innerHTML =
      `${formatNumber(Number.isFinite(sim.stats.minTransmission) ? sim.stats.minTransmission : 0, 1)}<small> °</small>`;
    elements.runFingerprint.title = `输入指纹 ${sim.fingerprint}`;

    const modeLabels = {
      ready: "静态检查",
      running: "实时求解",
      paused: "物理暂停",
      fault: "安全停机",
      success: "目标达成",
      complete: "记录完成",
      replay: "样本回放",
      replayPaused: "回放暂停",
    };
    elements.mechanismMode.textContent = modeLabels[sim.phase];
    elements.solverLabel.textContent =
      sim.phase === "replay" || sim.phase === "replayPaused" ? "回放读取" : "确定性求解";

    elements.assemblyBadge.className = "micro-badge";
    let assemblyLabel = "已装配";
    if (isGeometryInvalid()) {
      assemblyLabel = "死点风险";
      elements.assemblyBadge.classList.add("danger");
    } else if (config.load > LIMITS.load || config.speed > LIMITS.speed) {
      assemblyLabel = "超限预检";
      elements.assemblyBadge.classList.add("danger");
    } else if (sim.phase !== "ready") {
      assemblyLabel = "参数锁定";
    }
    elements.assemblyBadge.textContent = assemblyLabel;

    [elements.radiusInput, elements.rodInput, elements.strokeInput, elements.speedInput, elements.loadInput].forEach(
      (input) => {
        input.disabled = inputsLocked;
      },
    );

    elements.startButton.classList.toggle("running", sim.phase === "running" || sim.phase === "replay");
    const primaryLabels = {
      ready: "启动仿真",
      running: "暂停",
      paused: "恢复",
      fault: "重置待机",
      success: "重置待机",
      complete: "重置待机",
      replay: "暂停回放",
      replayPaused: sim.replayAtEnd ? "重新回放" : "恢复回放",
    };
    elements.startButtonText.textContent = primaryLabels[sim.phase];
    elements.stepButton.disabled = !(
      sim.phase === "ready" ||
      sim.phase === "paused" ||
      sim.phase === "replayPaused"
    );
    elements.replayButton.disabled =
      sim.history.length < 2 ||
      !["paused", "fault", "success", "complete", "replayPaused"].includes(sim.phase);

    elements.targetProgress.style.width = `${clamp((actualStroke / config.targetStroke) * 100, 0, 100)}%`;
    elements.strokeDeviation.textContent = `偏差 ${signed(deviation, 1)} mm`;
    elements.strokeMatch.textContent = matches ? "匹配" : "需调整";
    elements.strokeMatch.className = matches ? "ok" : "warn";
    elements.chartMeta.textContent =
      `窗口 ${sim.history.length ? displayTime.toFixed(2) : "0.00"} s · ${sim.history.length} samples`;
    elements.chartEmpty.classList.toggle("hidden", sim.history.length > 0);

    updateGauges(sample);
    updateFaultSummary(sample);
    updateStatusMessage();
    if (sim.phase === "success" || sim.phase === "complete") {
      elements.assemblyBadge.textContent = sim.phase === "success" ? "目标达成" : "记录完成";
    }
  }

  function getPeakVelocity() {
    let peak = 0;
    sim.history.forEach((sample) => {
      peak = Math.max(peak, Math.abs(sample.velocity));
    });
    return peak;
  }

  function renderReport() {
    const reportHero = $("#reportHero");
    const reportStats = $("#reportStats");
    const reportFault = $("#reportFault");
    const sample = currentDisplaySample();
    const isFault = sim.phase === "fault";
    const isSuccess = sim.phase === "success";
    const reportState = isFault ? "danger" : "info";
    let title = "运行快照";
    let subtitle = `${sim.time.toFixed(3)} s / ${sim.history.length} 个固定步长样本`;
    let icon = "i";

    if (isFault) {
      title = "安全停机 · 记录已冻结";
      subtitle = `首次越限：${sim.fault.component} @ ${sim.fault.time.toFixed(3)} s`;
      icon = "!";
    } else if (isSuccess) {
      title = "目标达成 · 安全完成";
      subtitle = `完整往返 ${sim.time.toFixed(3)} s，行程 ${formatNumber(getActualStroke(), 1)} mm`;
      icon = "✓";
    } else if (sim.phase === "complete") {
      title = "记录完成 · 行程未匹配";
      subtitle = `实际 ${formatNumber(getActualStroke(), 1)} mm / 目标 ${formatNumber(config.targetStroke, 1)} mm`;
      icon = "i";
    } else if (sim.phase === "ready") {
      title = "尚未生成运行记录";
      subtitle = "启动仿真后将在此记录边界峰值和首次故障。";
    }

    reportHero.className = `report-hero ${reportState}`.trim();
    reportHero.innerHTML = `
      <div class="report-hero-icon">${icon}</div>
      <div class="report-hero-copy">
        <span>${sim.fingerprint} / ${PHASE_META[sim.phase].code}</span>
        <strong>${title}</strong>
        <small>${subtitle}</small>
      </div>`;

    reportStats.innerHTML = `
      <div><span>峰值轴力</span><strong>${formatNumber(sim.stats.peakForce, 0)} <small>N</small></strong></div>
      <div><span>峰值轴压</span><strong>${formatNumber(sim.stats.peakPressure, 2)} <small>MPa</small></strong></div>
      <div><span>最高温度</span><strong>${formatNumber(sim.stats.peakTemp, 1)} <small>°C</small></strong></div>
      <div><span>最小传动角</span><strong>${formatNumber(Number.isFinite(sim.stats.minTransmission) ? sim.stats.minTransmission : 0, 1)} <small>°</small></strong></div>
      <div><span>峰值速度</span><strong>${formatNumber(getPeakVelocity(), 0)} <small>mm/s</small></strong></div>
      <div><span>记录时长</span><strong>${sim.time.toFixed(3)} <small>s</small></strong></div>`;

    reportFault.className = `report-fault ${isFault ? "danger" : ""}`.trim();
    if (isFault && sim.fault) {
      const boundaryLabel = sim.fault.key === "geometry" ? "下限" : "边界";
      const digits = sim.fault.key === "pressure" ? 2 : 1;
      reportFault.innerHTML = `
        <span>FIRST LIMIT / ${sim.fault.time.toFixed(4)} s</span>
        <strong>${sim.fault.short} · ${sim.fault.component}</strong>
        <small>实测 ${formatNumber(sim.fault.value, digits)} ${sim.fault.unit}，${boundaryLabel} ${formatNumber(sim.fault.limit, digits)} ${sim.fault.unit}。${sim.fault.advice}</small>`;
    } else {
      reportFault.innerHTML = `
        <span>SAFETY ENVELOPE</span>
        <strong>本次记录未触发安全联锁</strong>
        <small>所有样本均已核验载荷、转速、温度、轴瓦压力与传动角。</small>`;
    }

    $("#reportHash").textContent = sim.fingerprint;
    $("#reportSamples").textContent = String(sim.history.length);
    elements.reportReplayButton.disabled = sim.history.length < 2;
  }

  function openReport() {
    renderReport();
    if (!elements.reportDialog.open) elements.reportDialog.showModal();
  }

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(rect.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = true;
    return { context, width: rect.width, height: rect.height };
  }

  function roundRectPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function drawCanvasGrid(context, width, height) {
    context.save();
    context.fillStyle = "rgba(11, 16, 14, 0.76)";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = COLORS.grid;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 24; x < width; x += 32) {
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
    }
    for (let y = 22; y < height; y += 32) {
      context.moveTo(0, y + 0.5);
      context.lineTo(width, y + 0.5);
    }
    context.stroke();

    context.strokeStyle = "rgba(200, 244, 108, 0.13)";
    context.beginPath();
    const corner = 9;
    const inset = 13;
    [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [inset, height - inset, 1, -1],
      [width - inset, height - inset, -1, -1],
    ].forEach(([x, y, dx, dy]) => {
      context.moveTo(x, y + corner * dy);
      context.lineTo(x, y);
      context.lineTo(x + corner * dx, y);
    });
    context.stroke();
    context.restore();
  }

  function drawLink(context, from, to, width, colorStart, colorEnd) {
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = "rgba(0, 0, 0, 0.55)";
    context.lineWidth = width + 5;
    context.stroke();

    const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, colorStart);
    gradient.addColorStop(0.52, colorEnd);
    gradient.addColorStop(1, colorStart);
    context.strokeStyle = gradient;
    context.lineWidth = width;
    context.stroke();

    context.strokeStyle = "rgba(255, 255, 255, 0.14)";
    context.lineWidth = Math.max(1, width * 0.16);
    context.stroke();
    context.restore();
  }

  function drawJoint(context, point, radius, color, fill = "#111713") {
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, radius + 4, 0, TAU);
    context.fillStyle = "rgba(0, 0, 0, 0.34)";
    context.fill();

    context.beginPath();
    context.arc(point.x, point.y, radius, 0, TAU);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();

    context.beginPath();
    context.arc(point.x - radius * 0.18, point.y - radius * 0.18, radius * 0.28, 0, TAU);
    context.fillStyle = "rgba(255, 255, 255, 0.3)";
    context.fill();
    context.restore();
  }

  function drawArrow(context, from, to, color, lineWidth = 1.5, headSize = 7) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) return;
    const ux = dx / length;
    const uy = dy / length;
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x - ux * headSize * 0.7, to.y - uy * headSize * 0.7);
    context.stroke();
    context.beginPath();
    context.moveTo(to.x, to.y);
    context.lineTo(
      to.x - ux * headSize - uy * headSize * 0.48,
      to.y - uy * headSize + ux * headSize * 0.48,
    );
    context.lineTo(
      to.x - ux * headSize + uy * headSize * 0.48,
      to.y - uy * headSize - ux * headSize * 0.48,
    );
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawRail(context, xStart, xEnd, axisY) {
    context.save();
    context.strokeStyle = "rgba(154, 176, 163, 0.35)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(xStart, axisY - 22);
    context.lineTo(xEnd, axisY - 22);
    context.moveTo(xStart, axisY + 22);
    context.lineTo(xEnd, axisY + 22);
    context.stroke();

    context.strokeStyle = "rgba(154, 176, 163, 0.12)";
    for (let x = xStart; x <= xEnd; x += 14) {
      context.beginPath();
      context.moveTo(x + 0.5, axisY - 22);
      context.lineTo(x + 0.5, axisY - 16);
      context.moveTo(x + 0.5, axisY + 16);
      context.lineTo(x + 0.5, axisY + 22);
      context.stroke();
    }
    context.restore();
  }

  function drawBase(context, x, y) {
    context.save();
    context.fillStyle = "#1a221d";
    context.strokeStyle = "#3b4a40";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x - 35, y + 34);
    context.lineTo(x - 14, y + 4);
    context.lineTo(x + 14, y + 4);
    context.lineTo(x + 35, y + 34);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x - 43, y + 35);
    context.lineTo(x + 43, y + 35);
    context.strokeStyle = "#536359";
    context.stroke();
    context.strokeStyle = "rgba(200, 244, 108, 0.18)";
    for (let offset = -30; offset <= 26; offset += 10) {
      context.beginPath();
      context.moveTo(x + offset, y + 32);
      context.lineTo(x + offset + 12, y + 21);
      context.stroke();
    }
    context.restore();
  }

  function faultPointFor(key, points) {
    switch (key) {
      case "speed":
        return points.crank;
      case "temp":
        return points.crank;
      case "pressure":
      case "geometry":
        return points.slider;
      default:
        return points.slider;
    }
  }

  function drawFaultMarker(context, point, label) {
    context.save();
    context.translate(point.x, point.y);
    context.strokeStyle = COLORS.red;
    context.fillStyle = "rgba(255, 111, 103, 0.08)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(0, 0, 24, 0, TAU);
    context.fill();
    context.stroke();
    context.setLineDash([4, 4]);
    context.beginPath();
    context.arc(0, 0, 32, 0, TAU);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(-38, 0);
    context.lineTo(-17, 0);
    context.moveTo(17, 0);
    context.lineTo(38, 0);
    context.moveTo(0, -38);
    context.lineTo(0, -17);
    context.moveTo(0, 17);
    context.lineTo(0, 38);
    context.stroke();

    const textWidth = Math.max(78, context.measureText(label).width + 18);
    roundRectPath(context, -textWidth / 2, -54, textWidth, 20, 4);
    context.fillStyle = "rgba(43, 15, 14, 0.92)";
    context.fill();
    context.strokeStyle = "rgba(255, 111, 103, 0.65)";
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = COLORS.red;
    context.font = '500 8px "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 0, -44);
    context.restore();
  }

  function drawMechanism() {
    const fitted = fitCanvas(elements.mechanismCanvas);
    if (!fitted) return;
    const { context, width, height } = fitted;
    const sample = currentDisplaySample();
    drawCanvasGrid(context, width, height);

    const compact = width < 560;
    const radius = config.radius;
    const rod = Math.max(config.rod, radius + 0.001);
    const axisY = height * (compact ? 0.52 : 0.54);
    const crankX = compact ? width * 0.24 : Math.max(100, width * 0.18);
    const readoutReserve = compact ? 92 : 145;
    const verticalScale = (height - (compact ? 120 : 140)) / Math.max(radius * 2 + 24, 40);
    const horizontalScale = (width - crankX - readoutReserve) / Math.max(rod + radius, 80);
    const scale = Math.max(0.58, Math.min(verticalScale, horizontalScale, 3.1));

    const theta = (sample.angle / DEG);
    const crankPin = {
      x: crankX + radius * Math.cos(theta) * scale,
      y: axisY - radius * Math.sin(theta) * scale,
    };
    const sliderX = radius * Math.cos(theta) + Math.sqrt(Math.max(0, rod ** 2 - radius ** 2 * Math.sin(theta) ** 2));
    const sliderPin = { x: crankX + sliderX * scale, y: axisY };
    const innerX = crankX + (rod - radius) * scale;
    const outerX = crankX + (rod + radius) * scale;

    context.save();
    context.strokeStyle = "rgba(139, 160, 147, 0.18)";
    context.setLineDash([3, 5]);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(innerX, axisY - 58);
    context.lineTo(innerX, axisY + 58);
    context.moveTo(outerX, axisY - 58);
    context.lineTo(outerX, axisY + 58);
    context.stroke();
    context.setLineDash([]);
    context.restore();

    drawRail(context, innerX - 30, outerX + 36, axisY);
    drawBase(context, crankX, axisY);

    context.save();
    context.strokeStyle = "rgba(200, 244, 108, 0.3)";
    context.lineWidth = 1;
    context.setLineDash([3, 5]);
    context.beginPath();
    context.arc(crankX, axisY, radius * scale, 0, TAU);
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = "rgba(200, 244, 108, 0.16)";
    context.beginPath();
    context.moveTo(crankX - radius * scale - 8, axisY);
    context.lineTo(crankX + radius * scale + 8, axisY);
    context.moveTo(crankX, axisY - radius * scale - 8);
    context.lineTo(crankX, axisY + radius * scale + 8);
    context.stroke();
    context.restore();

    drawLink(context, { x: crankX, y: axisY }, crankPin, compact ? 5 : 6, "#4e5e54", "#b9c7bd");
    drawLink(context, crankPin, sliderPin, compact ? 7 : 8, "#46554c", "#aab9af");

    const directionX = sliderPin.x - crankPin.x;
    const directionY = sliderPin.y - crankPin.y;
    const rodLength = Math.hypot(directionX, directionY) || 1;
    const forceLength = clamp((sample.force / 2000) * (compact ? 48 : 78), 20, compact ? 65 : 105);
    const forceEnd = {
      x: sliderPin.x - (directionX / rodLength) * forceLength,
      y: sliderPin.y - (directionY / rodLength) * forceLength,
    };
    drawArrow(context, sliderPin, forceEnd, "rgba(255, 111, 103, 0.8)", 1.5, 6);

    const velocityLength = clamp(Math.abs(sample.velocity) * 0.14, 0, 65);
    if (velocityLength > 3) {
      const velocityDirection = Math.sign(sample.velocity);
      drawArrow(
        context,
        { x: sliderPin.x + velocityDirection * 35, y: axisY },
        { x: sliderPin.x + velocityDirection * (35 + velocityLength), y: axisY },
        "rgba(255, 179, 92, 0.9)",
        1.5,
        6,
      );
    }

    const sliderWidth = compact ? 41 : 52;
    const sliderHeight = compact ? 31 : 38;
    context.save();
    const blockGradient = context.createLinearGradient(
      sliderPin.x - sliderWidth / 2,
      axisY - sliderHeight / 2,
      sliderPin.x + sliderWidth / 2,
      axisY + sliderHeight / 2,
    );
    blockGradient.addColorStop(0, "#5a6a60");
    blockGradient.addColorStop(0.48, "#2f3a33");
    blockGradient.addColorStop(1, "#738279");
    roundRectPath(
      context,
      sliderPin.x - sliderWidth / 2,
      axisY - sliderHeight / 2,
      sliderWidth,
      sliderHeight,
      5,
    );
    context.fillStyle = blockGradient;
    context.fill();
    context.strokeStyle = "#91a196";
    context.lineWidth = 1;
    context.stroke();
    context.strokeStyle = "rgba(255, 255, 255, 0.11)";
    context.beginPath();
    context.moveTo(sliderPin.x - sliderWidth / 2 + 7, axisY - sliderHeight / 2 + 6);
    context.lineTo(sliderPin.x + sliderWidth / 2 - 7, axisY - sliderHeight / 2 + 6);
    context.stroke();
    context.restore();

    drawJoint(context, { x: crankX, y: axisY }, compact ? 5 : 6, COLORS.lime);
    drawJoint(context, crankPin, compact ? 4 : 5, COLORS.cyan);
    drawJoint(context, sliderPin, compact ? 4 : 5, COLORS.cyan);

    context.save();
    context.fillStyle = COLORS.dim;
    context.font = '8px "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
    context.textAlign = "center";
    context.fillText("O", crankX, axisY + 58);
    context.fillStyle = "rgba(200, 244, 108, 0.6)";
    context.fillText("A", crankPin.x, crankPin.y - 11);
    context.fillStyle = "rgba(104, 221, 215, 0.7)";
    context.fillText("B", sliderPin.x, sliderPin.y - sliderHeight / 2 - 7);
    context.textAlign = "left";
    context.fillStyle = COLORS.muted;
    context.fillText("IDC", innerX - 6, axisY + 50);
    context.fillText("ODC", outerX - 8, axisY + 50);
    context.textAlign = "center";
    context.fillStyle = "rgba(200, 244, 108, 0.7)";
    context.fillText("r", (crankX + crankPin.x) / 2 + 8, (axisY + crankPin.y) / 2 - 5);
    context.fillStyle = "rgba(170, 185, 175, 0.72)";
    context.fillText("L", (crankPin.x + sliderPin.x) / 2, (crankPin.y + sliderPin.y) / 2 - 9);
    context.restore();

    const dimensionY = Math.min(height - (compact ? 75 : 45), axisY + 77);
    context.save();
    context.strokeStyle = "rgba(104, 221, 215, 0.33)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(innerX, dimensionY);
    context.lineTo(outerX, dimensionY);
    context.stroke();
    drawArrow(context, { x: innerX, y: dimensionY }, { x: innerX + 12, y: dimensionY }, COLORS.cyan, 1, 4);
    drawArrow(context, { x: outerX, y: dimensionY }, { x: outerX - 12, y: dimensionY }, COLORS.cyan, 1, 4);
    context.fillStyle = "rgba(104, 221, 215, 0.72)";
    context.font = '8px "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
    context.textAlign = "center";
    context.fillText(`S = ${formatNumber(sample.displacement, 1)} mm`, (innerX + outerX) / 2, dimensionY - 7);
    context.restore();

    const statusY = 45;
    if (sim.phase === "fault" && sim.fault) {
      context.save();
      const label = `SAFETY STOP · ${sim.fault.short} @ ${sim.fault.time.toFixed(3)} s`;
      const boxWidth = compact ? 190 : context.measureText(label).width + 28;
      roundRectPath(context, width / 2 - boxWidth / 2, statusY - 14, boxWidth, 25, 5);
      context.fillStyle = "rgba(58, 19, 17, 0.9)";
      context.fill();
      context.strokeStyle = "rgba(255, 111, 103, 0.45)";
      context.stroke();
      context.fillStyle = COLORS.red;
      context.font = '500 8px "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, width / 2, statusY - 1);
      context.restore();
      const points = { crank: { x: crankX, y: axisY }, slider: sliderPin };
      drawFaultMarker(context, faultPointFor(sim.fault.key, points), sim.fault.component);
    } else if (sim.phase === "success") {
      context.save();
      context.fillStyle = "rgba(104, 221, 215, 0.85)";
      context.font = '500 8px "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
      context.textAlign = "center";
      context.fillText("TARGET STROKE REACHED / SAFE", width / 2, statusY);
      context.restore();
    } else if (sim.phase === "replay" || sim.phase === "replayPaused") {
      context.save();
      context.fillStyle = "rgba(168, 185, 255, 0.78)";
      context.font = '500 8px "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
      context.textAlign = "center";
      context.fillText(
        `REPLAY ${String(sim.replayIndex + 1).padStart(3, "0")} / ${String(sim.history.length).padStart(3, "0")}`,
        width / 2,
        statusY,
      );
      context.restore();
    }
  }

  function buildPreviewSamples() {
    const count = 120;
    const period = Math.max(getCyclePeriod(), 0.25);
    const samples = [];
    for (let index = 0; index <= count; index += 1) {
      samples.push(computeSample((index / count) * period));
    }
    return samples;
  }

  function linePath(context, data, endIndex, getX, getY) {
    context.beginPath();
    for (let index = 0; index <= endIndex; index += 1) {
      const sample = data[index];
      const x = getX(sample.t);
      const y = getY(sample);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }

  function drawChart() {
    const fitted = fitCanvas(elements.responseCanvas);
    if (!fitted) return;
    const { context, width, height } = fitted;
    drawCanvasGrid(context, width, height);

    const compact = width < 550;
    const padding = {
      left: compact ? 35 : 43,
      right: compact ? 39 : 48,
      top: compact ? 20 : 23,
      bottom: 20,
    };
    const ribbonHeight = compact ? 13 : 17;
    const ribbonGap = 5;
    const plotWidth = width - padding.left - padding.right;
    const totalPlotHeight = height - padding.top - padding.bottom;
    const mainHeight = Math.max(50, totalPlotHeight - ribbonHeight - ribbonGap);
    const forceTop = padding.top + mainHeight + ribbonGap;
    const forceBottom = forceTop + ribbonHeight;

    const isReplay = sim.phase === "replay" || sim.phase === "replayPaused";
    const hasHistory = sim.history.length > 0;
    const data = hasHistory ? sim.history : buildPreviewSamples();
    const cursorIndex =
      isReplay && hasHistory
        ? clamp(sim.replayIndex, 0, data.length - 1)
        : data.length - 1;
    const dataEnd = data[data.length - 1];
    const xMax = Math.max(
      0.25,
      hasHistory ? dataEnd.t : getCyclePeriod(),
    );
    const yMax = Math.max(getActualStroke(), config.targetStroke, 1) * 1.1;
    let velocityMax = 0;
    let forceMax = 0;
    data.forEach((sample) => {
      velocityMax = Math.max(velocityMax, Math.abs(sample.velocity));
      forceMax = Math.max(forceMax, sample.force);
    });
    velocityMax = Math.max(velocityMax * 1.12, 20);
    forceMax = Math.max(forceMax * 1.1, LIMITS.load * 0.25);

    const xMap = (time) => padding.left + (time / xMax) * plotWidth;
    const yDisplacement = (sample) =>
      padding.top + mainHeight - (clamp(sample.displacement, 0, yMax) / yMax) * mainHeight;
    const yVelocity = (sample) =>
      padding.top +
      mainHeight / 2 -
      (clamp(sample.velocity, -velocityMax, velocityMax) / velocityMax) * (mainHeight / 2) * 0.86;
    const yForce = (sample) =>
      forceBottom - (clamp(sample.force, 0, forceMax) / forceMax) * ribbonHeight;

    context.save();
    context.strokeStyle = COLORS.grid;
    context.lineWidth = 1;
    context.beginPath();
    for (let index = 0; index <= 4; index += 1) {
      const x = padding.left + (index / 4) * plotWidth;
      context.moveTo(x + 0.5, padding.top);
      context.lineTo(x + 0.5, forceBottom);
    }
    for (let index = 0; index <= 3; index += 1) {
      const y = padding.top + (index / 3) * mainHeight;
      context.moveTo(padding.left, y + 0.5);
      context.lineTo(padding.left + plotWidth, y + 0.5);
    }
    context.stroke();

    context.strokeStyle = "rgba(154, 176, 163, 0.25)";
    context.beginPath();
    context.moveTo(padding.left, padding.top);
    context.lineTo(padding.left, forceBottom);
    context.lineTo(padding.left + plotWidth, forceBottom);
    context.stroke();

    context.fillStyle = "rgba(255, 111, 103, 0.045)";
    context.fillRect(padding.left, forceTop, plotWidth, ribbonHeight);
    context.strokeStyle = "rgba(255, 111, 103, 0.16)";
    context.beginPath();
    context.moveTo(padding.left, forceTop + 0.5);
    context.lineTo(padding.left + plotWidth, forceTop + 0.5);
    context.stroke();
    context.restore();

    context.save();
    context.font = `${compact ? 7 : 8}px "SFMono-Regular", Consolas, "Noto Sans SC", monospace`;
    context.textBaseline = "middle";
    context.textAlign = "right";
    context.fillStyle = "rgba(104, 221, 215, 0.65)";
    [1, 0.5, 0].forEach((ratio) => {
      const y = padding.top + (1 - ratio) * mainHeight;
      context.fillText(formatNumber(yMax * ratio, 0), padding.left - 7, y);
    });
    context.fillStyle = "rgba(255, 179, 92, 0.6)";
    context.textAlign = "left";
    [1, 0, -1].forEach((ratio) => {
      const y = padding.top + mainHeight / 2 - ratio * (mainHeight / 2) * 0.86;
      context.fillText(`${signed(velocityMax * ratio, 0)}`, padding.left + plotWidth + 7, y);
    });
    context.fillStyle = "rgba(255, 111, 103, 0.72)";
    context.textAlign = "right";
    context.fillText("F", padding.left - 7, forceBottom - ribbonHeight / 2);
    context.textAlign = "left";
    context.fillText("轴力带", padding.left + 5, forceTop - 1);
    context.restore();

    const targetY = padding.top + mainHeight - (config.targetStroke / yMax) * mainHeight;
    context.save();
    context.strokeStyle = "rgba(200, 244, 108, 0.34)";
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(padding.left, targetY);
    context.lineTo(padding.left + plotWidth, targetY);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(200, 244, 108, 0.55)";
    context.font = '7px "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
    context.textAlign = "right";
    context.fillText("S目标", padding.left + plotWidth - 5, targetY - 6);
    context.restore();

    if (hasHistory && seriesVisible.displacement) {
      context.save();
      const fillEnd = cursorIndex;
      context.beginPath();
      context.moveTo(xMap(data[0].t), padding.top + mainHeight);
      for (let index = 0; index <= fillEnd; index += 1) {
        const sample = data[index];
        context.lineTo(xMap(sample.t), yDisplacement(sample));
      }
      context.lineTo(xMap(data[fillEnd].t), padding.top + mainHeight);
      context.closePath();
      const fillGradient = context.createLinearGradient(0, padding.top, 0, padding.top + mainHeight);
      fillGradient.addColorStop(0, "rgba(104, 221, 215, 0.13)");
      fillGradient.addColorStop(1, "rgba(104, 221, 215, 0)");
      context.fillStyle = fillGradient;
      context.fill();
      context.restore();
    }

    const drawCurve = (getY, color, widthValue, visible, indexLimit = cursorIndex, alpha = 1) => {
      if (!visible) return;
      context.save();
      context.globalAlpha = alpha;
      context.strokeStyle = color;
      context.lineWidth = widthValue;
      context.lineJoin = "round";
      context.lineCap = "round";
      linePath(context, data, Math.min(indexLimit, data.length - 1), xMap, getY);
      context.stroke();
      context.restore();
    };

    if (isReplay && hasHistory) {
      context.save();
      context.globalAlpha = 0.18;
      drawCurve(yDisplacement, COLORS.cyan, 1.2, seriesVisible.displacement, data.length - 1);
      drawCurve(yVelocity, COLORS.amber, 1, seriesVisible.velocity, data.length - 1);
      if (seriesVisible.force) {
        drawCurve(yForce, COLORS.red, 1, true, data.length - 1);
      }
      context.restore();
    }

    drawCurve(yDisplacement, COLORS.cyan, compact ? 1.4 : 1.7, seriesVisible.displacement);
    drawCurve(yVelocity, COLORS.amber, compact ? 1.2 : 1.35, seriesVisible.velocity);
    if (seriesVisible.force) {
      drawCurve(yForce, COLORS.red, compact ? 1 : 1.2, true);
    }

    if (hasHistory && sim.fault) {
      const faultX = xMap(clamp(sim.fault.time, 0, xMax));
      context.save();
      context.strokeStyle = "rgba(255, 111, 103, 0.65)";
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(faultX, padding.top);
      context.lineTo(faultX, forceBottom);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = COLORS.red;
      context.beginPath();
      context.arc(faultX, yVelocity(sim.fault.sample || data[cursorIndex]), 3, 0, TAU);
      context.fill();
      context.font = '7px "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
      context.textAlign = "left";
      context.fillText("首次越限", faultX + 5, padding.top + 8);
      context.restore();
    }

    const cursorSample = data[cursorIndex];
    const cursorX = xMap(cursorSample.t);
    context.save();
    context.strokeStyle = "rgba(221, 234, 224, 0.15)";
    context.beginPath();
    context.moveTo(cursorX, padding.top);
    context.lineTo(cursorX, forceBottom);
    context.stroke();
    if (seriesVisible.displacement) {
      context.fillStyle = COLORS.cyan;
      context.shadowColor = COLORS.cyan;
      context.shadowBlur = 7;
      context.beginPath();
      context.arc(cursorX, yDisplacement(cursorSample), 2.6, 0, TAU);
      context.fill();
    }
    if (seriesVisible.velocity) {
      context.fillStyle = COLORS.amber;
      context.shadowColor = COLORS.amber;
      context.beginPath();
      context.arc(cursorX, yVelocity(cursorSample), 2.2, 0, TAU);
      context.fill();
    }
    context.restore();

    context.save();
    context.font = '7px "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
    context.fillStyle = COLORS.dim;
    context.textAlign = "center";
    context.textBaseline = "top";
    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4;
      const x = padding.left + ratio * plotWidth;
      context.fillText(`${(xMax * ratio).toFixed(2)}s`, x, forceBottom + 5);
    }
    context.restore();

    if (!hasHistory) {
      context.save();
      context.globalAlpha = 0.35;
      context.strokeStyle = COLORS.cyan;
      context.lineWidth = 1;
      linePath(context, data, data.length - 1, xMap, yDisplacement);
      context.stroke();
      context.globalAlpha = 0.22;
      context.strokeStyle = COLORS.amber;
      linePath(context, data, data.length - 1, xMap, yVelocity);
      context.stroke();
      context.restore();
    }
  }

  function drawAll() {
    drawMechanism();
    drawChart();
  }

  function advanceReplayFrame() {
    if (sim.phase !== "replay") return;
    if (sim.replayIndex < sim.history.length - 1) {
      sim.replayIndex += 1;
      sim.lastSample = sim.history[sim.replayIndex];
      updateUI();
      return;
    }
    sim.phase = "replayPaused";
    sim.replayAtEnd = true;
    sim.replayAccumulator = 0;
    updateUI();
  }

  function animationFrame(timestamp) {
    if (!sim.lastFrame) sim.lastFrame = timestamp;
    const elapsed = clamp((timestamp - sim.lastFrame) / 1000, 0, 0.1);
    sim.lastFrame = timestamp;

    if (sim.phase === "running") {
      sim.accumulator += elapsed;
      let safety = 0;
      while (sim.accumulator >= DT && safety < 8) {
        sim.accumulator -= DT;
        safety += 1;
        if (!advanceSimulation()) {
          sim.accumulator = 0;
          break;
        }
      }
    } else if (sim.phase === "replay") {
      sim.replayAccumulator += elapsed;
      let safety = 0;
      while (sim.replayAccumulator >= DT && safety < 8) {
        sim.replayAccumulator -= DT;
        safety += 1;
        advanceReplayFrame();
        if (sim.phase !== "replay") break;
      }
    }

    drawAll();
    window.requestAnimationFrame(animationFrame);
  }

  function handleInputChange() {
    if (sim.phase !== "ready") return;
    syncConfigFromInputs();
    updateControlLabels();
    resetToReady();
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  function wireEvents() {
    [
      elements.radiusInput,
      elements.rodInput,
      elements.strokeInput,
      elements.speedInput,
      elements.loadInput,
    ].forEach((input) => input.addEventListener("input", handleInputChange));

    elements.startButton.addEventListener("click", () => {
      toggleRunState();
      drawAll();
    });
    elements.stepButton.addEventListener("click", () => {
      stepSimulation();
      drawAll();
    });
    elements.replayButton.addEventListener("click", () => {
      if (sim.phase === "replay" || sim.phase === "replayPaused") {
        beginReplay();
      } else {
        beginReplay();
      }
    });
    elements.resetButton.addEventListener("click", () => resetToReady());
    elements.reportButton.addEventListener("click", openReport);
    elements.inlineReportButton.addEventListener("click", openReport);
    elements.reportReplayButton.addEventListener("click", () => {
      closeDialog(elements.reportDialog);
      beginReplay();
    });
    elements.helpButton.addEventListener("click", () => {
      if (!elements.helpDialog.open) elements.helpDialog.showModal();
    });

    $$("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => closeDialog(button.closest("dialog")));
    });
    [elements.reportDialog, elements.helpDialog].forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
    });

    elements.gaugeList.addEventListener("click", (event) => {
      if (event.target.closest("[data-gauge]")) openReport();
    });

    $$(".series-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const key = chip.dataset.series;
        seriesVisible[key] = !seriesVisible[key];
        chip.classList.toggle("active", seriesVisible[key]);
        drawChart();
      });
    });

    document.addEventListener("keydown", (event) => {
      if (elements.reportDialog.open || elements.helpDialog.open) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.code === "Space") {
        event.preventDefault();
        toggleRunState();
        drawAll();
      } else if (event.key === ".") {
        event.preventDefault();
        stepSimulation();
        drawAll();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetToReady();
      }
    });

    const resizeObserver = new ResizeObserver(() => drawAll());
    resizeObserver.observe(elements.mechanismCanvas);
    resizeObserver.observe(elements.responseCanvas);
  }

  function init() {
    initializeGauges();
    syncConfigFromInputs();
    updateControlLabels();
    resetToReady();
    wireEvents();
    window.requestAnimationFrame(animationFrame);
  }

  init();
})();
