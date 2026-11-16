(function (global) {
  "use strict";

  const Canyon = global.Canyon;
  const $ = (id) => document.getElementById(id);
  const game = new Canyon.Game();
  const renderer = new Canyon.Renderer($("gameCanvas"));

  const dom = {
    seedInput: $("seedInput"),
    applySeedBtn: $("applySeedBtn"),
    soundBtn: $("soundBtn"),
    pauseBtn: $("pauseBtn"),
    saveBtn: $("saveBtn"),
    loadBtn: $("loadBtn"),
    restartBtn: $("restartBtn"),
    liveLabel: $("liveLabel"),
    stampSeed: $("stampSeed"),
    stampFingerprint: $("stampFingerprint"),
    briefSeed: $("briefSeed"),
    briefFingerprint: $("briefFingerprint"),
    startOverlay: $("startOverlay"),
    pauseOverlay: $("pauseOverlay"),
    failOverlay: $("failOverlay"),
    winOverlay: $("winOverlay"),
    startBtn: $("startBtn"),
    briefDebugBtn: $("briefDebugBtn"),
    resumeBtn: $("resumeBtn"),
    pauseRestartBtn: $("pauseRestartBtn"),
    continueBtn: $("continueBtn"),
    recoverOverlayBtn: $("recoverOverlayBtn"),
    failRestartBtn: $("failRestartBtn"),
    winRestartBtn: $("winRestartBtn"),
    winDebugBtn: $("winDebugBtn"),
    failTitle: $("failTitle"),
    failSummary: $("failSummary"),
    failDetails: $("failDetails"),
    progressValue: $("progressValue"),
    targetCards: $("targetCards"),
    targetHint: $("targetHint"),
    batteryValue: $("batteryValue"),
    batteryBar: $("batteryBar"),
    spareValue: $("spareValue"),
    ropeValue: $("ropeValue"),
    loadValue: $("loadValue"),
    speedValue: $("speedValue"),
    angleValue: $("angleValue"),
    tensionValue: $("tensionValue"),
    pitchValue: $("pitchValue"),
    windValue: $("windValue"),
    gustValue: $("gustValue"),
    windArrow: $("windArrow"),
    windCanvasValue: $("windCanvasValue"),
    tensionBar: $("tensionBar"),
    routeDone: $("routeDone"),
    routeStations: $("routeStations"),
    routeCar: $("routeCar"),
    routePosition: $("routePosition"),
    routeScenario: $("routeScenario"),
    debugPath: $("debugPath"),
    debugLoad: $("debugLoad"),
    debugWind: $("debugWind"),
    debugObstacles: $("debugObstacles"),
    failurePanel: $("failurePanel"),
    recentFailTitle: $("recentFailTitle"),
    recentFailReason: $("recentFailReason"),
    recentFailTime: $("recentFailTime"),
    repairBtn: $("repairBtn"),
    brakeBtn: $("brakeBtn"),
    recoverBtn: $("recoverBtn"),
    toast: $("toast"),
    canvasHelp: $("canvasHelp"),
    statusClock: $("statusClock"),
    statusSave: $("statusSave"),
    winSummary: $("winSummary")
  };

  let staticFingerprint = "";
  let dirty = false;
  let lastNotedTick = -1;
  let toastTimer = 0;

  function setOverlay(element, visible) {
    element.classList.toggle("visible", visible);
  }

  function showToast(text, tone) {
    if (!text) {
      return;
    }
    dom.toast.textContent = text;
    dom.toast.classList.toggle("danger", tone === "danger");
    dom.toast.classList.add("show");
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(() => {
      dom.toast.classList.remove("show");
    }, 3200);
  }

  function markDirty() {
    dirty = true;
    dom.statusSave.textContent = "UNSAVED CHANGES";
    dom.statusSave.classList.add("dirty");
  }

  function markClean() {
    dirty = false;
    const stamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    dom.statusSave.textContent = `LOCAL SAVE · ${stamp}`;
    dom.statusSave.classList.remove("dirty");
  }

  function stationSvgPoint(station) {
    const t = Canyon.seed.clamp((station.x - 0.04) / 0.88, 0, 1);
    return {
      x: 20 + t * 320,
      y: 38 + 4 * t * (1 - t) * 25
    };
  }

  function rebuildStaticUI() {
    const level = game.level;
    staticFingerprint = level.fingerprint;
    dom.seedInput.value = level.seedText;
    dom.stampSeed.textContent = `SEED · ${level.seedText}`;
    dom.stampFingerprint.textContent = `FP · ${level.fingerprint}`;
    dom.briefSeed.textContent = level.seedText;
    dom.briefFingerprint.textContent = level.fingerprint;
    dom.routeStations.innerHTML = "";

    const obstacles = level.obstacleOrder;
    dom.targetCards.innerHTML = level.stations.slice(1).map((station, index) => `
      <article class="target-card" data-target="${index}">
        <span class="target-code">${station.id} · ${obstacles[index].code}</span>
        <strong>${station.task}</strong>
        <small>摆角 ≤ ${station.tolerance.toFixed(1)}°</small>
      </article>
    `).join("");

    const svgNamespace = "http://www.w3.org/2000/svg";
    level.stations.forEach((station, index) => {
      const point = stationSvgPoint(station);
      const group = document.createElementNS(svgNamespace, "g");
      group.setAttribute("data-station", String(index));
      const circle = document.createElementNS(svgNamespace, "circle");
      circle.setAttribute("class", "route-node");
      circle.setAttribute("cx", point.x.toFixed(1));
      circle.setAttribute("cy", point.y.toFixed(1));
      circle.setAttribute("r", index === 0 ? "4.5" : "5.5");
      const label = document.createElementNS(svgNamespace, "text");
      label.setAttribute("class", "route-label");
      label.setAttribute("x", point.x.toFixed(1));
      label.setAttribute("y", (point.y + 17).toFixed(1));
      label.setAttribute("text-anchor", "middle");
      label.textContent = station.id;
      group.append(circle, label);
      dom.routeStations.appendChild(group);
    });

    dom.debugPath.textContent = level.pathLabel;
    dom.debugObstacles.textContent = obstacles.map((item) => `${item.station} ${item.name}`).join(" → ");
    dom.scenarioButtons = Array.from(document.querySelectorAll(".scenario-button"));
  }

  function updateTargets(state) {
    const cards = dom.targetCards.querySelectorAll(".target-card");
    cards.forEach((card, index) => {
      const completed = state.completed[index];
      const current = !completed && state.targetIndex === index;
      const failed = state.failure && state.failure.targetId === `P${index + 1}`;
      card.classList.toggle("done", completed);
      card.classList.toggle("current", current);
      card.classList.toggle("failed", failed);
      const small = card.querySelector("small");
      if (completed) {
        small.textContent = "检查点已记录";
      } else if (current) {
        small.textContent = `摆角 ≤ ${game.level.stations[index + 1].tolerance.toFixed(1)}°`;
      } else {
        small.textContent = "等待前序目标";
      }
    });
    dom.progressValue.textContent = `${state.completed.filter(Boolean).length} / 3`;
  }

  function routeState(state) {
    const nodes = dom.routeStations.querySelectorAll(".route-node");
    nodes.forEach((node, index) => {
      node.classList.toggle("done", index > 0 && state.completed[index - 1]);
      node.classList.toggle(
        "current",
        index === 0 ? state.targetIndex >= 3 : state.targetIndex === index - 1
      );
    });
    const point = stationSvgPoint({ x: state.position });
    dom.routeCar.setAttribute("cx", point.x.toFixed(1));
    dom.routeCar.setAttribute("cy", point.y.toFixed(1));
    const t = Canyon.seed.clamp((state.position - 0.04) / 0.88, 0, 1);
    dom.routeDone.style.strokeDasharray = "100";
    dom.routeDone.style.strokeDashoffset = String(100 - t * 100);
    dom.routePosition.textContent = `位置 ${state.position.toFixed(3)}`;
    dom.routeScenario.textContent = game.scenarioLabel(state.scenario);
  }

  function updateClock(state) {
    const total = Math.floor(state.elapsed);
    const hours = 7 + Math.floor((20 * 60 + total) / 3600);
    const minutes = Math.floor(((20 * 60 + total) % 3600) / 60);
    const seconds = (20 * 60 + total) % 60;
    dom.statusClock.textContent =
      `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} · 第 01 日`;
  }

  function updateOverlays(state) {
    setOverlay(dom.startOverlay, state.mode === "brief");
    setOverlay(dom.pauseOverlay, state.mode === "paused");
    setOverlay(dom.failOverlay, state.mode === "failed");
    setOverlay(dom.winOverlay, state.mode === "won");

    if (state.failure) {
      dom.failTitle.textContent = state.failure.title;
      dom.failSummary.textContent = state.failure.reason;
      dom.failDetails.textContent = state.failure.details;
    }

    const recoverVisible = Boolean(
      state.mode === "failed" &&
      state.failure &&
      state.failure.code === "stranded"
    );
    dom.recoverOverlayBtn.hidden = !recoverVisible;
    dom.recoverBtn.hidden = !recoverVisible;
    dom.recoverBtn.disabled = state.rope <= 0;
    dom.recoverOverlayBtn.disabled = state.rope <= 0;
    dom.continueBtn.textContent = recoverVisible
      ? "直接回到检查点"
      : "从最近检查点继续";

    if (state.recentFailure) {
      dom.failurePanel.hidden = false;
      dom.recentFailTitle.textContent = state.recentFailure.title;
      dom.recentFailReason.textContent = state.recentFailure.reason;
      dom.recentFailTime.textContent =
        `T+${state.recentFailure.time.toFixed(1)}s · ${state.recentFailure.targetId}`;
    } else {
      dom.failurePanel.hidden = true;
    }

    if (state.mode === "won" && state.winStats) {
      const minutes = Math.floor(state.winStats.elapsed / 60);
      const seconds = Math.floor(state.winStats.elapsed % 60);
      dom.winSummary.innerHTML = `
        <div><span>用时</span><strong>${minutes}:${String(seconds).padStart(2, "0")}</strong></div>
        <div><span>剩余电量</span><strong>${state.winStats.battery.toFixed(1)}%</strong></div>
        <div><span>剩余回收索</span><strong>${state.winStats.rope} 根</strong></div>
      `;
    }
  }

  function updateUI() {
    if (game.level.fingerprint !== staticFingerprint) {
      rebuildStaticUI();
    }
    const state = game.state;
    const level = game.level;
    const wind = game.getWind();
    const nextGust = game.getNextGust();
    const completedCount = state.completed.filter(Boolean).length;
    const direction = wind.value >= 0 ? "→" : "←";
    const windText = `${direction} ${Math.abs(wind.value).toFixed(1)} m/s`;
    const allowed = game.canRepair();

    updateTargets(state);
    routeState(state);
    updateClock(state);
    updateOverlays(state);

    dom.liveLabel.textContent = {
      brief: "待命 / STANDBY",
      running: "作业中 / LIVE",
      paused: "已暂停 / HOLD",
      failed: "事故 / INCIDENT",
      recovering: "回收中 / RECOVERY",
      won: "已完成 / COMPLETE"
    }[state.mode] || "待命 / STANDBY";
    dom.targetHint.textContent = state.hint;

    dom.batteryValue.textContent = `${state.battery.toFixed(0)}%`;
    dom.batteryBar.style.width = `${Canyon.seed.clamp(state.battery, 0, 100)}%`;
    dom.batteryBar.style.background = state.battery < 24
      ? "linear-gradient(90deg, #a84938, #e0735d)"
      : "linear-gradient(90deg, #479f90, #79cbbb)";
    dom.spareValue.textContent = String(state.spare);
    dom.ropeValue.textContent = String(state.rope);
    dom.loadValue.textContent = `${state.load.toFixed(1)} kg`;

    dom.speedValue.textContent = Math.abs(state.speed * 10).toFixed(2);
    dom.angleValue.textContent = Math.abs(state.angle).toFixed(1);
    dom.tensionValue.textContent = state.tension.toFixed(2);
    dom.pitchValue.textContent = String(Math.round(82 + state.tension * 80));
    dom.windValue.textContent = windText;
    dom.windCanvasValue.textContent = `${windText}`;
    dom.windArrow.textContent = direction;
    dom.windArrow.style.transform = `rotate(${direction === "→" ? 0 : 180}deg)`;
    dom.gustValue.textContent = `${nextGust.in.toFixed(1)}s · ${nextGust.strength.toFixed(1)}`;
    dom.tensionBar.style.width = `${Canyon.seed.clamp((state.tension - 0.65) / 0.72, 0.05, 1) * 100}%`;

    dom.debugLoad.textContent = `${state.load.toFixed(1)} kg · ${completedCount}/3 完成`;
    dom.debugWind.textContent = `${windText}${wind.activeSource ? ` · ${wind.activeSource}` : ""}`;
    dom.repairBtn.disabled = state.mode !== "running" || state.targetIndex >= 3;
    dom.repairBtn.title = allowed.reason;
    dom.pauseBtn.textContent = state.mode === "paused" ? "继续" : "暂停";
    dom.soundBtn.setAttribute("aria-pressed", String(!Canyon.audio.muted));

    if (dom.scenarioButtons) {
      dom.scenarioButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.scenario === state.scenario);
      });
    }

    if (Canyon.audio.context) {
      Canyon.audio.setTelemetry(
        state.tension,
        state.wind,
        state.mode === "running" || state.mode === "recovering"
      );
    }
    if ((state.mode === "running" || state.mode === "recovering") &&
        state.tick !== lastNotedTick) {
      lastNotedTick = state.tick;
      markDirty();
    }
  }

  function ensureAudio() {
    Canyon.audio.ensure();
    dom.soundBtn.setAttribute("aria-pressed", String(!Canyon.audio.muted));
  }

  function startGame() {
    ensureAudio();
    game.start();
    lastNotedTick = game.state.tick;
  }

  function toggleSound() {
    Canyon.audio.ensure();
    const muted = Canyon.audio.toggle();
    dom.soundBtn.setAttribute("aria-pressed", String(!muted));
    showToast(muted ? "声音已关闭" : "声音已开启 · 音高随钢索张力变化", "normal");
  }

  function applySeed() {
    const seed = dom.seedInput.value.trim().toUpperCase();
    ensureAudio();
    game.setSeed(seed || "CANYON-805", { mode: "running" });
    dom.seedInput.blur();
    lastNotedTick = -1;
    markDirty();
  }

  function bindEvents() {
    game.on("toast", (payload) => showToast(payload.text, payload.tone));
    game.on("saved", () => {
      lastNotedTick = game.state.tick;
      markClean();
    });
    game.on("loaded", () => {
      rebuildStaticUI();
      lastNotedTick = game.state.tick;
      markClean();
    });
    game.on("repair", () => {
      lastNotedTick = -1;
      markDirty();
    });
    game.on("failure", () => {
      lastNotedTick = -1;
      markDirty();
    });
    game.on("win", () => {
      lastNotedTick = -1;
      markDirty();
    });
    game.on("reset", () => {
      lastNotedTick = -1;
      markDirty();
    });
    game.on("recovered", () => {
      lastNotedTick = -1;
      markDirty();
    });

    dom.startBtn.addEventListener("click", startGame);
    dom.briefDebugBtn.addEventListener("click", () => {
      ensureAudio();
      game.applyScenario("standard");
      document.querySelector(".debug-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    dom.soundBtn.addEventListener("click", toggleSound);
    dom.pauseBtn.addEventListener("click", () => {
      const paused = game.togglePause();
      if (!paused) {
        showToast("当前状态不能暂停。", "danger");
      }
      dom.pauseBtn.blur();
    });
    dom.resumeBtn.addEventListener("click", () => game.resume());
    dom.saveBtn.addEventListener("click", () => game.save());
    dom.loadBtn.addEventListener("click", () => {
      if (game.load()) {
        lastNotedTick = game.state.tick;
      }
    });
    dom.restartBtn.addEventListener("click", () => game.restart());
    dom.pauseRestartBtn.addEventListener("click", () => game.restart());
    dom.failRestartBtn.addEventListener("click", () => game.restart());
    dom.winRestartBtn.addEventListener("click", () => {
      game.restart();
      lastNotedTick = -1;
    });
    dom.winDebugBtn.addEventListener("click", () => {
      game.applyScenario("standard");
      document.querySelector(".debug-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    dom.continueBtn.addEventListener("click", () => game.continueFromCheckpoint());
    dom.recoverBtn.addEventListener("click", () => {
      ensureAudio();
      game.recover();
    });
    dom.recoverOverlayBtn.addEventListener("click", () => {
      ensureAudio();
      game.recover();
    });
    dom.repairBtn.addEventListener("click", () => {
      ensureAudio();
      game.repair();
      dom.repairBtn.blur();
    });

    dom.brakeBtn.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      game.state.inputs.brake = true;
      dom.brakeBtn.setPointerCapture(event.pointerId);
    });
    const releaseBrake = () => {
      game.state.inputs.brake = false;
    };
    dom.brakeBtn.addEventListener("pointerup", releaseBrake);
    dom.brakeBtn.addEventListener("pointercancel", releaseBrake);
    dom.brakeBtn.addEventListener("lostpointercapture", releaseBrake);

    dom.applySeedBtn.addEventListener("click", applySeed);
    dom.seedInput.addEventListener("keydown", (event) => {
      if (event.code === "Enter") {
        event.preventDefault();
        applySeed();
      }
    });

    document.querySelector(".scenario-list").addEventListener("click", (event) => {
      const button = event.target.closest(".scenario-button");
      if (!button) {
        return;
      }
      ensureAudio();
      game.applyScenario(button.dataset.scenario);
      lastNotedTick = -1;
    });
  }

  const keyInputMap = {
    ArrowRight: "right",
    KeyD: "right",
    ArrowLeft: "left",
    KeyA: "left",
    Space: "brake",
    KeyQ: "trimLeft",
    KeyE: "trimRight"
  };

  function bindKeyboard() {
    global.addEventListener("keydown", (event) => {
      const tagName = event.target && event.target.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA") {
        return;
      }
      const inputName = keyInputMap[event.code];
      if (inputName) {
        game.state.inputs[inputName] = true;
        event.preventDefault();
      }
      if (event.repeat) {
        return;
      }
      if (event.code === "KeyF") {
        ensureAudio();
        game.repair();
        event.preventDefault();
      } else if (event.code === "KeyP" || event.code === "Escape") {
        if (game.state.mode === "brief") {
          startGame();
        } else {
          game.togglePause();
        }
        event.preventDefault();
      } else if (event.code === "KeyR") {
        game.restart();
        event.preventDefault();
      } else if (event.code === "KeyM") {
        toggleSound();
        event.preventDefault();
      } else if (event.code === "Enter" && game.state.mode === "brief") {
        startGame();
        event.preventDefault();
      }
    });

    global.addEventListener("keyup", (event) => {
      const inputName = keyInputMap[event.code];
      if (inputName) {
        game.state.inputs[inputName] = false;
        event.preventDefault();
      }
    });

    global.addEventListener("blur", () => {
      Object.keys(game.state.inputs).forEach((key) => {
        game.state.inputs[key] = false;
      });
    });
  }

  function frame(timestamp) {
    const delta = renderer.lastFrame
      ? (timestamp - renderer.lastFrame * 1000) / 1000
      : 1 / 60;
    game.advance(delta);
    renderer.draw(game, timestamp);
    updateUI();
    global.requestAnimationFrame(frame);
  }

  function boot() {
    bindEvents();
    bindKeyboard();
    rebuildStaticUI();
    const restored = game.autoLoad();
    if (restored) {
      lastNotedTick = game.state.tick;
      markClean();
    } else if (!game.hasSave()) {
      dom.statusSave.textContent = "LOCAL SAVE READY";
    }
    updateUI();
    global.requestAnimationFrame(frame);
  }

  const api = {
    version: 2,
    game,
    renderer,
    start: startGame,
    pause: () => game.pause(),
    resume: () => game.resume(),
    restart: () => game.restart(),
    save: () => game.save(),
    load: () => game.load(),
    applyScenario: (name) => game.applyScenario(name),
    repair: () => game.repair(),
    recover: () => game.recover(),
    continueFromCheckpoint: () => game.continueFromCheckpoint(),
    setSeed: (seed) => game.setSeed(seed, { mode: "running" }),
    getState: () => game.getState(),
    getSnapshot: () => game.getSnapshot(),
    getLevel: () => Canyon.seed.deepClone({
      seed: game.level.seedText,
      fingerprint: game.level.fingerprint,
      stations: game.level.stations,
      obstacleOrder: game.level.obstacleOrder,
      path: game.level.pathLabel,
      signature: game.level.signature
    }),
    setInput: (partial) => {
      Object.assign(game.state.inputs, partial || {});
      return game.getState();
    },
    advanceSimulation: (seconds, inputs) => game.advanceSimulation(seconds, inputs)
  };

  global.CanyonGame = api;
  global.Canyon.game = game;
  boot();
})(window);
