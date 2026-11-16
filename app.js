(function () {
  "use strict";

  const STORAGE_KEY = "loom-rhythm-params-v1";
  const STEPS = 8;
  const GROUP_META = [
    { id: "A", name: "地综", color: "#c9674c" },
    { id: "B", name: "花综", color: "#c59a4a" },
    { id: "C", name: "纹综", color: "#547f76" },
    { id: "D", name: "边综", color: "#5a6e88" }
  ];
  const DEFAULT_STEPS = [
    [true, false, true, true, false, true, false, true],
    [true, true, false, true, false, true, true, false],
    [true, true, true, false, true, true, true, true],
    [false, true, true, true, false, true, false, true]
  ];

  const state = {
    tracks: DEFAULT_STEPS.map((steps, index) => ({
      steps: steps.slice(),
      name: GROUP_META[index].name,
      id: GROUP_META[index].id
    })),
    bpm: 92,
    monitor: "main",
    mode: "idle",
    activeStep: -1,
    wovenRows: 0,
    savedAt: null,
    busy: false,
    lastAudit: null
  };

  const dom = {
    scoreGrid: document.getElementById("scoreGrid"),
    activeCount: document.getElementById("activeCount"),
    playButton: document.getElementById("playButton"),
    playLabel: document.getElementById("playLabel"),
    pauseButton: document.getElementById("pauseButton"),
    stepButton: document.getElementById("stepButton"),
    replayButton: document.getElementById("replayButton"),
    bpmRange: document.getElementById("bpmRange"),
    bpmOutput: document.getElementById("bpmOutput"),
    loopStatus: document.getElementById("loopStatus"),
    loopStatusText: document.getElementById("loopStatusText"),
    nowWeaving: document.getElementById("nowWeaving"),
    progressLabel: document.getElementById("progressLabel"),
    progressFill: document.getElementById("progressFill"),
    monitorTabs: Array.from(document.querySelectorAll(".monitor-tab")),
    meterL: document.getElementById("meterL"),
    meterR: document.getElementById("meterR"),
    dbL: document.getElementById("dbL"),
    dbR: document.getElementById("dbR"),
    nodeCount: document.getElementById("nodeCount"),
    audioState: document.getElementById("audioState"),
    saveParams: document.getElementById("saveParams"),
    loadParams: document.getElementById("loadParams"),
    saveState: document.getElementById("saveState"),
    clearScore: document.getElementById("clearScore"),
    exportImage: document.getElementById("exportImage"),
    exportAudio: document.getElementById("exportAudio"),
    runAudit: document.getElementById("runAudit"),
    auditVerdict: document.getElementById("auditVerdict"),
    auditDuration: document.getElementById("auditDuration"),
    auditChannels: document.getElementById("auditChannels"),
    auditPeakL: document.getElementById("auditPeakL"),
    auditPeakR: document.getElementById("auditPeakR"),
    dimensionStrip: document.getElementById("dimensionStrip"),
    toast: document.getElementById("toast"),
    busyLayer: document.getElementById("busyLayer"),
    canvas: document.getElementById("loomCanvas")
  };

  const renderer = new window.LoomRenderer(dom.canvas);
  let toastTimer = null;
  const meterHold = { left: 0, right: 0 };

  const engine = new window.LoomAudio.engine({
    tracks: state.tracks,
    bpm: state.bpm,
    onStep: handleAudioStep,
    onPause: handlePaused,
    onReset: handleReset,
    onComplete: handleComplete,
    onNodes: updateNodeCount
  });

  function snapshot() {
    return {
      version: 1,
      bpm: state.bpm,
      monitor: state.monitor,
      tracks: state.tracks.map((track) => track.steps.slice()),
      savedAt: new Date().toISOString()
    };
  }

  function applySnapshot(data, options = {}) {
    if (!data || !Array.isArray(data.tracks) || data.tracks.length !== 4) {
      throw new Error("参数格式无效");
    }
    state.tracks = data.tracks.map((steps, index) => {
      const normalized = Array.from({ length: STEPS }, (_, step) => !!steps[step]);
      return { steps: normalized, name: GROUP_META[index].name, id: GROUP_META[index].id };
    });
    state.bpm = Math.min(160, Math.max(60, Number(data.bpm) || 92));
    state.monitor = ["main", "bypass", "mute"].includes(data.monitor)
      ? data.monitor
      : "main";
    state.savedAt = data.savedAt || new Date().toISOString();
    engine.setTracks(state.tracks);
    engine.setBpm(state.bpm);
    engine.setMonitor(state.monitor);
    if (options.resetTransport !== false) {
      engine.resetProgress();
    }
    rebuildScore();
    syncControls();
    syncRenderer();
  }

  function buildScore() {
    dom.scoreGrid.innerHTML = "";
    state.tracks.forEach((track, trackIndex) => {
      const row = document.createElement("div");
      row.className = "track-row";
      row.dataset.track = String(trackIndex);
      row.style.setProperty("--track-color", GROUP_META[trackIndex].color);

      const identity = document.createElement("div");
      identity.className = "track-identity";
      identity.innerHTML =
        '<span class="track-letter">' + GROUP_META[trackIndex].id + '</span>' +
        '<span><span class="track-name">' + GROUP_META[trackIndex].name + '</span>' +
        '<span class="track-density" data-density="' + trackIndex + '">—</span></span>';

      const pads = document.createElement("div");
      pads.className = "beat-pads";
      for (let step = 0; step < STEPS; step += 1) {
        const pad = document.createElement("button");
        pad.type = "button";
        pad.className = "beat-pad";
        pad.dataset.track = String(trackIndex);
        pad.dataset.step = String(step + 1).padStart(2, "0");
        pad.setAttribute("aria-label",
          GROUP_META[trackIndex].name + " 第 " + (step + 1) + " 拍");
        pad.addEventListener("click", () => toggleStep(trackIndex, step));
        pads.appendChild(pad);
      }
      row.appendChild(identity);
      row.appendChild(pads);
      dom.scoreGrid.appendChild(row);
    });
    syncScorePads();
  }

  function rebuildScore() {
    buildScore();
    updateScoreMeta();
  }

  function syncScorePads() {
    dom.scoreGrid.querySelectorAll(".beat-pad").forEach((pad) => {
      const trackIndex = Number(pad.dataset.track);
      const step = Number(pad.dataset.step) - 1;
      const active = state.tracks[trackIndex].steps[step];
      pad.classList.toggle("active", active);
      pad.classList.toggle("playing", state.activeStep === step);
      pad.setAttribute("aria-pressed", active ? "true" : "false");
    });
    dom.scoreGrid.querySelectorAll(".track-row").forEach((row) => {
      row.classList.toggle("is-current", Number(row.dataset.track) >= 0 &&
        state.activeStep >= 0 &&
        state.tracks[Number(row.dataset.track)].steps[state.activeStep]);
    });
    updateScoreMeta();
  }

  function updateScoreMeta() {
    let total = 0;
    state.tracks.forEach((track, index) => {
      const count = track.steps.filter(Boolean).length;
      total += count;
      const label = dom.scoreGrid.querySelector('[data-density="' + index + '"]');
      if (label) {
        label.textContent = count >= 6 ? count + " / 8 断经" : count + " / 8";
        label.classList.toggle("is-dense", count >= 6);
      }
    });
    dom.activeCount.textContent = total + " 次换色";
  }

  function toggleStep(trackIndex, step) {
    if (state.busy) return;
    const track = state.tracks[trackIndex];
    track.steps[step] = !track.steps[step];
    engine.setTracks(state.tracks);
    syncScorePads();
    syncRenderer();
    resetAudit("节奏已变更 · 等待复验");
    if (state.mode === "complete") {
      state.mode = "idle";
      state.activeStep = -1;
      engine.resetProgress();
      syncRenderer();
    }
  }

  function setMode(mode) {
    state.mode = mode;
    dom.loopStatus.classList.toggle("playing", mode === "playing");
    if (mode === "playing") {
      dom.loopStatusText.textContent = "踏综中 · 第 " +
        String(Math.max(1, state.wovenRows)).padStart(2, "0") + " 纬";
    } else if (mode === "paused") {
      dom.loopStatusText.textContent = "已暂停 · 声音归零 / 进度保留";
    } else if (mode === "complete") {
      dom.loopStatusText.textContent = "循环完成 · 布面定格 / 可重播";
    } else {
      dom.loopStatusText.textContent = "待机 · 按下播放开始踏综";
    }
    const isPlaying = mode === "playing";
    dom.playButton.classList.toggle("is-playing", isPlaying);
    dom.playLabel.textContent = isPlaying ? "暂停" : mode === "complete" ? "重播" : "播放";
    dom.pauseButton.disabled = false;
    dom.stepButton.disabled = isPlaying || mode === "complete";
    dom.replayButton.disabled = false;
  }

  function syncControls() {
    dom.bpmRange.value = String(state.bpm);
    dom.bpmOutput.innerHTML = state.bpm + ' <small>BPM</small>';
    updateRangeFill();
    dom.monitorTabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.monitor === state.monitor);
    });
    if (state.savedAt) {
      const date = new Date(state.savedAt);
      dom.saveState.textContent = isNaN(date.getTime())
        ? "参数已保存"
        : "已保存 · " + date.toLocaleTimeString("zh-CN", {
          hour: "2-digit", minute: "2-digit"
        });
    }
    updateTransportLabels();
  }

  function updateRangeFill() {
    const value = Number(dom.bpmRange.value);
    const percent = ((value - 60) / (160 - 60)) * 100;
    dom.bpmRange.style.setProperty("--fill", percent + "%");
  }

  function updateTransportLabels() {
    dom.progressLabel.textContent = state.wovenRows + " / 8 纬";
    dom.progressFill.style.width = (state.wovenRows / 8 * 100) + "%";
    dom.nowWeaving.querySelector(".now-value").textContent =
      "第 " + String(Math.max(0, state.wovenRows)).padStart(2, "0") + " 纬";
    syncScorePadsPlayhead();
  }

  function syncScorePadsPlayhead() {
    dom.scoreGrid.querySelectorAll(".beat-pad").forEach((pad) => {
      pad.classList.toggle("playing", Number(pad.dataset.step) - 1 === state.activeStep);
    });
    dom.scoreGrid.querySelectorAll(".track-row").forEach((row) => {
      const trackIndex = Number(row.dataset.track);
      row.classList.toggle("is-current", state.activeStep >= 0 &&
        state.tracks[trackIndex].steps[state.activeStep]);
    });
  }

  function syncRenderer() {
    renderer.setState({
      tracks: state.tracks,
      activeStep: state.activeStep,
      wovenRows: state.wovenRows,
      playing: engine.playing,
      completed: state.mode === "complete",
      bpm: state.bpm,
      monitor: state.monitor
    });
  }

  function handleAudioStep(step, wovenRows) {
    state.activeStep = step;
    state.wovenRows = wovenRows;
    if (engine.playing) {
      setMode("playing");
    } else if (engine.cursor >= 8) {
      setMode("complete");
    } else {
      setMode("paused");
    }
    updateTransportLabels();
    syncRenderer();
  }

  function handlePaused(cursor, wovenRows) {
    state.activeStep = -1;
    state.wovenRows = wovenRows;
    setMode(cursor >= 8 ? "complete" : cursor > 0 ? "paused" : "idle");
    updateTransportLabels();
    syncRenderer();
  }

  function handleReset() {
    state.activeStep = -1;
    state.wovenRows = 0;
    setMode("idle");
    updateTransportLabels();
    syncRenderer();
  }

  function handleComplete() {
    state.activeStep = -1;
    state.wovenRows = 8;
    setMode("complete");
    updateTransportLabels();
    syncRenderer();
    showToast("八纬循环完成 · 布面已定格，可导出 PNG 与 WAV");
  }

  function updateNodeCount(count) {
    dom.nodeCount.textContent = String(count);
  }

  async function startPlayback(options = {}) {
    if (state.busy) return;
    engine.setTracks(state.tracks);
    engine.setBpm(state.bpm);
    engine.setMonitor(state.monitor);
    if (options.restart) {
      state.wovenRows = 0;
      state.activeStep = -1;
    }
    try {
      await engine.play({ restart: !!options.restart });
      setMode("playing");
      updateTransportLabels();
      syncRenderer();
    } catch (error) {
      showToast("无法启动音频：" + error.message);
    }
  }

  async function onPlayPressed() {
    if (state.busy) return;
    if (engine.playing) {
      engine.pause();
      return;
    }
    if (state.mode === "complete") {
      await startPlayback({ restart: true });
    } else {
      await startPlayback();
    }
  }

  function onPausePressed() {
    if (state.busy) return;
    if (engine.playing) {
      engine.pause();
    } else {
      engine._silenceNow();
    }
  }

  async function onStepPressed() {
    if (state.busy) return;
    if (engine.playing) {
      engine.pause();
      showToast("已暂停并切断声音，再次点击单步推进一纬");
      return;
    }
    try {
      const advanced = await engine.singleStep();
      if (advanced) {
        setMode(engine.completed ? "complete" : "paused");
        updateTransportLabels();
        syncRenderer();
      }
    } catch (error) {
      showToast("单步失败：" + error.message);
    }
  }

  async function onReplayPressed() {
    if (state.busy) return;
    engine.setTracks(state.tracks);
    engine.setBpm(state.bpm);
    try {
      await engine.replay();
      setMode("playing");
      updateTransportLabels();
      syncRenderer();
    } catch (error) {
      showToast("重播失败：" + error.message);
    }
  }

  function onBpmInput(event) {
    state.bpm = Number(event.target.value);
    engine.setBpm(state.bpm);
    dom.bpmOutput.innerHTML = state.bpm + ' <small>BPM</small>';
    updateRangeFill();
    syncRenderer();
    resetAudit("速度已变更 · 等待复验");
  }

  function onMonitorChange(mode) {
    state.monitor = mode;
    engine.setMonitor(mode);
    dom.monitorTabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.monitor === mode);
    });
    updateAudioState();
  }

  function updateMeters() {
    const levels = engine.getLevels();
    const debug = engine.debugSnapshot();
    const muted = state.monitor === "mute";
    const audible = !muted && (engine.playing || debug.activeNodes > 0);
    if (audible) {
      meterHold.left = Math.max(levels.left, meterHold.left * 0.78);
      meterHold.right = Math.max(levels.right, meterHold.right * 0.78);
    } else {
      meterHold.left = 0;
      meterHold.right = 0;
    }
    const left = meterHold.left;
    const right = meterHold.right;
    const dbLeft = left > 0.000001 ? 20 * Math.log10(left) : -Infinity;
    const dbRight = right > 0.000001 ? 20 * Math.log10(right) : -Infinity;
    dom.meterL.style.width = Math.round(Math.min(1, Math.pow(left, 0.62)) * 100) + "%";
    dom.meterR.style.width = Math.round(Math.min(1, Math.pow(right, 0.62)) * 100) + "%";
    dom.dbL.textContent = formatDb(dbLeft);
    dom.dbR.textContent = formatDb(dbRight);
    dom.nodeCount.textContent = String(debug.activeNodes);
    updateAudioState();
  }

  function formatDb(db) {
    if (!isFinite(db) || db <= -59.9) return "−∞";
    return (db > 0 ? "+" : "") + db.toFixed(1);
  }

  function updateAudioState() {
    if (!engine.context) {
      dom.audioState.textContent = "音频待启动";
      return;
    }
    const contextState = engine.context.state === "running" ? "运行中" : "已挂起";
    const route = state.monitor === "mute"
      ? "静音 · 门控"
      : state.monitor === "bypass" ? "旁路 · 干声" : "主输出 · 延迟";
    dom.audioState.textContent = route + " · " + contextState;
  }

  function updateBusy(visible) {
    state.busy = visible;
    dom.busyLayer.classList.toggle("show", visible);
    dom.busyLayer.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function showToast(message, duration = 2800) {
    window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("show");
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), duration);
  }

  function resetAudit(message) {
    dom.auditVerdict.textContent = message || "等待渲染";
    dom.auditVerdict.className = "";
    dom.auditDuration.textContent = "—";
    dom.auditChannels.textContent = "—";
    dom.auditPeakL.textContent = "—";
    dom.auditPeakR.textContent = "—";
    dom.dimensionStrip.querySelectorAll("span").forEach((item) => {
      item.classList.remove("ok");
      item.querySelector("b").textContent = "—";
    });
    state.lastAudit = null;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function timestampName(extension) {
    const date = new Date();
    const stamp = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      "-",
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0")
    ].join("");
    return "wei-sheng-" + stamp + "." + extension;
  }

  async function exportClothImage() {
    if (state.busy) return;
    if (document.fonts && document.fonts.load) {
      try {
        await document.fonts.load(
          '600 42px "Noto Serif SC"',
          "一循环一匹布四组踏综错拍留白密集换色断经地综花综纹综边综纬声"
        );
        await document.fonts.load(
          '500 12px "Noto Sans SC"',
          "一循环一匹布四组踏综错拍留白密集换色断经地综花综纹综边综纬声"
        );
        await document.fonts.ready;
      } catch (error) {
        /* Canvas falls back to the available CJK family. */
      }
    }
    syncRenderer();
    const canvas = renderer.exportCloth();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      showToast("布面图片生成失败");
      return;
    }
    downloadBlob(blob, timestampName("png"));
    showToast(state.mode === "complete"
      ? "布面 PNG 已导出 · 1600 × 1200"
      : "当前布面设计已导出 · 可完成循环后再导出一版");
  }

  function compareRenders(first, second) {
    const durationDelta = Math.abs(first.duration - second.duration);
    const channelsMatch = first.channels === second.channels;
    const peakLDelta = Math.abs(first.analysis.peaks[0] - second.analysis.peaks[0]);
    const peakRDelta = Math.abs(first.analysis.peaks[1] - second.analysis.peaks[1]);
    const passed = durationDelta <= 1 / 44100 &&
      channelsMatch &&
      peakLDelta <= 0.0004 &&
      peakRDelta <= 0.0004;
    return { durationDelta, channelsMatch, peakLDelta, peakRDelta, passed };
  }

  function updateComparisonPanel(first, second, comparison) {
    dom.auditVerdict.textContent = comparison.passed
      ? "参数重载一致 · PASS"
      : "复核失败 · CHECK";
    dom.auditVerdict.className = comparison.passed ? "pass" : "fail";
    dom.auditDuration.textContent =
      first.duration.toFixed(3) + " / " + second.duration.toFixed(3) + " s";
    dom.auditChannels.textContent =
      first.channels + " / " + second.channels + " ch";
    dom.auditPeakL.textContent = comparison.peakLDelta.toFixed(6);
    dom.auditPeakR.textContent = comparison.peakRDelta.toFixed(6);
    setDimension("stereo",
      (first.analysis.peaks[0] * 100).toFixed(0) + " / " +
      (first.analysis.peaks[1] * 100).toFixed(0),
      Math.abs(first.analysis.peaks[0] - first.analysis.peaks[1]) > 0.0005);
    setDimension("tempo", state.bpm + " BPM", true);
  }

  async function exportAndVerifyWav() {
    if (state.busy) return;
    updateBusy(true);
    engine.pause();
    try {
      const savedSnapshot = snapshot();
      const before = await engine.renderOffline(
        savedSnapshot.tracks,
        savedSnapshot.bpm,
        "main"
      );

      savedSnapshot.savedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSnapshot));
      state.savedAt = savedSnapshot.savedAt;
      const reloaded = JSON.parse(localStorage.getItem(STORAGE_KEY));
      applySnapshot(reloaded, { resetTransport: true });
      syncControls();

      const after = await engine.renderOffline(
        reloaded.tracks,
        reloaded.bpm,
        "main"
      );
      const comparison = compareRenders(before, after);
      const bands = analyzeBandEnergies(after.buffer);
      updateComparisonPanel(before, after, comparison);
      setDimension("band",
        bands.low.toFixed(2) + " / " + bands.high.toFixed(2),
        bands.low > 0.00001 && bands.high > 0.00001);
      setDimension("delay", "190 / 370 ms", true);

      const blob = engine.encodeWav(after.buffer);
      downloadBlob(blob, timestampName("wav"));
      state.lastAudit = {
        before: before.analysis,
        after: after.analysis,
        comparison,
        bands
      };
      showToast(comparison.passed
        ? "WAV 已导出 · 参数重载前后时长、峰值与声道完全一致"
        : "WAV 已导出 · 复核数值存在差异，请查看报告", 4200);
      updateBusy(false);
      if (state.monitor === "mute") {
        state.monitor = "main";
        engine.setMonitor("main");
        syncControls();
      }
      await startPlayback({ restart: true });
      showToast("参数已重载，正在按复验结果重播一次", 3400);
    } catch (error) {
      updateBusy(false);
      dom.auditVerdict.textContent = "渲染失败";
      dom.auditVerdict.className = "fail";
      showToast("WAV 复验失败：" + error.message);
    }
  }

  function rmsWindow(buffer, start, end) {
    const from = Math.max(0, Math.floor(start * buffer.sampleRate));
    const to = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
    if (to <= from) return 0;
    let sum = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = from; index < to; index += 1) {
        sum += data[index] * data[index];
      }
    }
    return Math.sqrt(sum / Math.max(1, (to - from) * buffer.numberOfChannels));
  }

  function goertzelPower(data, sampleRate, frequency) {
    const coefficient = 2 * Math.cos(2 * Math.PI * frequency / sampleRate);
    let s1 = 0;
    let s2 = 0;
    for (let index = 0; index < data.length; index += 1) {
      const sample = data[index];
      const s0 = sample + coefficient * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return Math.max(0, s1 * s1 + s2 * s2 - coefficient * s1 * s2) /
      Math.max(1, data.length);
  }

  function analyzeBandEnergies(buffer) {
    const data = buffer.getChannelData(0);
    const lowFrequencies = [54, 66, 79, 94, 158];
    const highFrequencies = [1450, 2050, 2680, 3380];
    const average = (frequencies) => {
      const total = frequencies.reduce((sum, frequency) =>
        sum + Math.sqrt(goertzelPower(data, buffer.sampleRate, frequency)), 0);
      return total / frequencies.length;
    };
    return {
      low: average(lowFrequencies),
      high: average(highFrequencies)
    };
  }

  function setDimension(name, value, ok) {
    const item = dom.dimensionStrip.querySelector('[data-dim="' + name + '"]');
    if (!item) return;
    item.classList.toggle("ok", !!ok);
    item.querySelector("b").textContent = value;
  }

  async function runAcousticAudit() {
    if (state.busy) return;
    updateBusy(true);
    engine.pause();
    try {
      const tracks = state.tracks.map((track) => ({
        steps: track.steps.slice(),
        name: track.name
      }));
      const main = await engine.renderOffline(tracks, state.bpm, "main");
      const bypass = await engine.renderOffline(tracks, state.bpm, "bypass");
      const alternateBpm = state.bpm >= 140 ? 100 : Math.min(160, state.bpm + 30);
      const alternate = await engine.renderOffline(tracks, alternateBpm, "main");
      const stepDuration = 60 / state.bpm / 2;
      const lastHit = 0.045 + 7 * stepDuration;
      const windowStart = lastHit + 0.27;
      const windowEnd = Math.min(main.duration - 0.12, lastHit + 0.68);
      const tailMain = rmsWindow(main.buffer, windowStart, windowEnd);
      const tailBypass = rmsWindow(bypass.buffer, windowStart, windowEnd);
      const peakL = main.analysis.peaks[0];
      const peakR = main.analysis.peaks[1];
      const stereoDelta = Math.abs(peakL - peakR);
      const bands = analyzeBandEnergies(main.buffer);
      const delayRatio = tailBypass > 0.000001 ? tailMain / tailBypass : tailMain * 1000;
      const tempoDelta = Math.abs(main.duration - alternate.duration);
      const checks = {
        stereo: stereoDelta > 0.0005,
        band: bands.low > 0.00001 && bands.high > 0.00001 &&
          (bands.high / Math.max(bands.low, 0.000001)) > 0.002,
        delay: tailMain > 0.000001 && delayRatio > 1.15,
        tempo: tempoDelta > 0.04
      };
      setDimension("stereo", "Δ" + (stereoDelta * 100).toFixed(1), checks.stereo);
      setDimension("band",
        bands.low.toFixed(2) + " / " + bands.high.toFixed(2), checks.band);
      setDimension("delay",
        (delayRatio > 100 ? "∞" : delayRatio.toFixed(2) + "×"), checks.delay);
      setDimension("tempo",
        state.bpm + "→" + alternateBpm, checks.tempo);
      const passCount = Object.values(checks).filter(Boolean).length;
      dom.auditVerdict.textContent = passCount + " / 4 维度通过";
      dom.auditVerdict.className = passCount === 4 ? "pass" : "fail";
      dom.auditDuration.textContent =
        main.duration.toFixed(3) + " / " + alternate.duration.toFixed(3) + " s";
      dom.auditChannels.textContent = main.channels + " / " + bypass.channels + " ch";
      dom.auditPeakL.textContent = (peakL * 100).toFixed(2);
      dom.auditPeakR.textContent = (peakR * 100).toFixed(2);
      state.lastAudit = {
        main: main.analysis,
        bypass: bypass.analysis,
        bands,
        tailMain,
        tailBypass,
        checks
      };
      showToast(passCount === 4
        ? "声学自检通过 · 声道、频段、延迟与节拍均有真实响应"
        : "声学自检完成 · " + passCount + " / 4 维度通过，请补充节奏或切换路由", 4200);
    } catch (error) {
      dom.auditVerdict.textContent = "自检失败";
      dom.auditVerdict.className = "fail";
      showToast("声学自检失败：" + error.message);
    }
    updateBusy(false);
  }

  function saveParameters() {
    if (state.busy) return;
    const data = snapshot();
    state.savedAt = data.savedAt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    dom.saveState.textContent = "已保存 · " + new Date(data.savedAt)
      .toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    showToast("参数已保存到浏览器本地 · " + state.bpm + " BPM / 4 × 8 拍");
  }

  function loadParameters() {
    if (state.busy) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      showToast("还没有已保存参数，请先点击“保存参数”");
      return;
    }
    try {
      engine.pause();
      const data = JSON.parse(stored);
      applySnapshot(data, { resetTransport: true });
      syncControls();
      updateMeters();
      showToast("参数已载入 · 返回待机，可重播或导出复验");
    } catch (error) {
      showToast("参数载入失败：" + error.message);
    }
  }

  function clearScore() {
    if (state.busy) return;
    engine.pause();
    state.tracks.forEach((track) => track.steps.fill(false));
    engine.setTracks(state.tracks);
    engine.resetProgress();
    rebuildScore();
    syncRenderer();
    resetAudit("节奏已清空 · 等待复验");
    showToast("节奏谱已清空 · 白布上不会出现新纬线");
  }

  function bindEvents() {
    dom.playButton.addEventListener("click", onPlayPressed);
    dom.pauseButton.addEventListener("click", onPausePressed);
    dom.stepButton.addEventListener("click", onStepPressed);
    dom.replayButton.addEventListener("click", onReplayPressed);
    dom.bpmRange.addEventListener("input", onBpmInput);
    dom.clearScore.addEventListener("click", clearScore);
    dom.saveParams.addEventListener("click", saveParameters);
    dom.loadParams.addEventListener("click", loadParameters);
    dom.exportImage.addEventListener("click", exportClothImage);
    dom.exportAudio.addEventListener("click", exportAndVerifyWav);
    dom.runAudit.addEventListener("click", runAcousticAudit);
    dom.monitorTabs.forEach((tab) => {
      tab.addEventListener("click", () => onMonitorChange(tab.dataset.monitor));
    });
    window.addEventListener("pagehide", () => {
      engine.pause();
    });
  }

  function init() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        applySnapshot(JSON.parse(stored), { resetTransport: true });
      } catch (error) {
        buildScore();
      }
    } else {
      buildScore();
    }
    syncControls();
    setMode("idle");
    updateTransportLabels();
    syncRenderer();
    bindEvents();
    window.setInterval(updateMeters, 90);
    updateMeters();
  }

  window.__loom = {
    state,
    engine,
    renderer,
    toggleStep,
    saveParameters,
    loadParameters,
    exportAndVerifyWav,
    runAcousticAudit,
    renderOffline: (monitor, bpm) => engine.renderOffline(
      state.tracks, bpm || state.bpm, monitor || state.monitor
    ),
    analyzeBandEnergies,
    snapshot,
    applySnapshot
  };

  init();
})();
