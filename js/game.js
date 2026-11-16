(function (global) {
  "use strict";

  const Canyon = global.Canyon;
  const S = Canyon.seed;

  const STEP = 1 / 60;
  const STORAGE_KEY = "canyon-maintenance-save-v2";
  const SAVE_VERSION = 2;
  const SAFE_DOCK_SPEED = 0.065;
  const STATION_RADIUS = 0.017;
  const MAX_RIGHT = 0.91;
  const SCENARIO_OFFSETS = {
    standard: 0,
    overspeed: 1.9,
    stranded: 3.4
  };

  class Game {
    constructor() {
      this.level = Canyon.level.createLevel("CANYON-805");
      this.state = this.createState("brief", "standard");
      this.checkpoint = this.createCheckpoint("L0 · 初始检查点");
      this.listeners = {};
      this.accumulator = 0;
      this.lastSavedAt = null;
      this.muted = false;
    }

    on(eventName, listener) {
      if (!this.listeners[eventName]) {
        this.listeners[eventName] = [];
      }
      this.listeners[eventName].push(listener);
      return this;
    }

    emit(eventName, payload) {
      const listeners = this.listeners[eventName] || [];
      for (const listener of listeners) {
        listener(payload);
      }
    }

    createState(mode, scenario) {
      const stationX = this.level.stations[0].x;
      return {
        mode,
        modeBeforePause: "running",
        scenario: scenario || "standard",
        seed: this.level.seedText,
        fingerprint: this.level.fingerprint,
        elapsed: 0,
        tick: 0,
        position: stationX,
        speed: 0,
        angle: 0,
        angularVelocity: 0,
        battery: 100,
        spare: 3,
        rope: 2,
        load: 164,
        completed: [false, false, false],
        targetIndex: 0,
        tension: 0.93,
        wind: 0,
        windInfo: { value: 0, activeSource: null },
        inputs: {
          left: false,
          right: false,
          brake: false,
          trimLeft: false,
          trimRight: false
        },
        failure: null,
        recentFailure: null,
        recovery: null,
        winStats: null,
        hint: "前往 1 号导向轮组。提前制动，保持摆角稳定。"
      };
    }

    scenarioOffset() {
      return SCENARIO_OFFSETS[this.state.scenario] || 0;
    }

    getWind() {
      return Canyon.level.getWind(this.level, this.state.elapsed, this.scenarioOffset());
    }

    getNextGust() {
      return Canyon.level.getNextGust(this.level, this.state.elapsed, this.scenarioOffset());
    }

    setSeed(seedText, options) {
      const cleanSeed = String(seedText || "CANYON-805").trim().slice(0, 24) || "CANYON-805";
      this.level = Canyon.level.createLevel(cleanSeed);
      this.hardReset({
        mode: (options && options.mode) || "running",
        scenario: "standard"
      });
      this.emit("seedchange", { seed: cleanSeed, fingerprint: this.level.fingerprint });
      this.emit("toast", { text: `SEED 已固定为 ${cleanSeed} · 地图与任务已重建`, tone: "normal" });
    }

    hardReset(options) {
      const mode = options && options.mode ? options.mode : "running";
      const scenario = options && options.scenario ? options.scenario : "standard";
      this.state = this.createState(mode, scenario);
      this.state.modeBeforePause = mode === "brief" ? "running" : mode;
      this.state.windInfo = this.getWind();
      this.state.wind = this.state.windInfo.value;
      this.checkpoint = this.createCheckpoint("L0 · 初始检查点");
      this.accumulator = 0;
      this.emit("reset", { mode, scenario });
    }

    createCheckpoint(label) {
      const state = this.state;
      return {
        label: label || "CHECKPOINT",
        scenario: state.scenario,
        position: state.position,
        speed: state.speed,
        angle: state.angle,
        angularVelocity: state.angularVelocity,
        battery: state.battery,
        spare: state.spare,
        rope: state.rope,
        load: state.load,
        completed: state.completed.slice(),
        targetIndex: state.targetIndex,
        elapsed: state.elapsed,
        checkpointTick: state.tick
      };
    }

    start() {
      if (this.state.mode === "brief" || this.state.mode === "paused") {
        this.state.mode = "running";
        this.state.modeBeforePause = "running";
        this.emit("start", {});
      }
    }

    pause() {
      if (this.state.mode !== "running" && this.state.mode !== "recovering") {
        return false;
      }
      this.state.modeBeforePause = this.state.mode;
      this.state.mode = "paused";
      this.accumulator = 0;
      this.emit("pause", {});
      return true;
    }

    resume() {
      if (this.state.mode !== "paused") {
        return false;
      }
      this.state.mode = this.state.modeBeforePause === "recovering" ? "recovering" : "running";
      this.accumulator = 0;
      this.emit("resume", {});
      return true;
    }

    togglePause() {
      if (this.state.mode === "paused") {
        return this.resume();
      }
      return this.pause();
    }

    restart() {
      this.hardReset({ mode: "running", scenario: "standard" });
      this.emit("toast", {
        text: "已完整重开：目标 0/3、电量、螺栓与回收索全部复位",
        tone: "normal"
      });
    }

    currentStation() {
      if (this.state.targetIndex >= 3) {
        return this.level.stations[0];
      }
      return this.level.stations[this.state.targetIndex + 1];
    }

    isNearTarget() {
      if (this.state.targetIndex >= 3) {
        return this.state.position <= this.level.stations[0].x + STATION_RADIUS;
      }
      const target = this.level.stations[this.state.targetIndex + 1];
      return Math.abs(this.state.position - target.x) <= STATION_RADIUS;
    }

    canRepair() {
      if (this.state.mode !== "running" || this.state.targetIndex >= 3) {
        return { ok: false, reason: "当前没有可执行维修的目标。" };
      }
      const target = this.currentStation();
      if (Math.abs(this.state.position - target.x) > STATION_RADIUS) {
        return { ok: false, reason: `尚未到达 ${target.id} 停靠窗。` };
      }
      if (Math.abs(this.state.speed) > 0.035) {
        return { ok: false, reason: "吊篮仍在移动，请按住制动完全停稳。" };
      }
      if (Math.abs(this.state.angle) > target.tolerance) {
        return {
          ok: false,
          reason: `摆角 ${Math.abs(this.state.angle).toFixed(1)}° 超过 ${target.tolerance.toFixed(1)}°，先用 Q / E 调平。`
        };
      }
      if (this.state.spare <= 0) {
        return { ok: false, reason: "备用螺栓已耗尽。" };
      }
      return { ok: true, reason: "可以执行维修。" };
    }

    repair() {
      const allowed = this.canRepair();
      if (!allowed.ok) {
        this.emit("toast", { text: allowed.reason, tone: "danger" });
        return false;
      }
      const index = this.state.targetIndex;
      const target = this.level.stations[index + 1];
      this.state.completed[index] = true;
      this.state.targetIndex += 1;
      this.state.spare -= 1;
      this.state.battery = S.clamp(this.state.battery - 1.8, 0, 100);
      this.state.load = Math.max(148, Number((this.state.load - 3.8).toFixed(1)));
      this.state.speed = 0;
      this.state.angle *= 0.45;
      this.state.angularVelocity = 0;
      this.state.position = target.x;
      this.checkpoint = this.createCheckpoint(`${target.id} · 维修完成检查点`);
      this.state.hint = this.state.targetIndex >= 3
        ? "三处维修完成。反向驱动返回左岸 L0，归站时同样需要低速。"
        : `前往 ${this.state.targetIndex + 1} 号导向轮组。注意下一段横风与摆角。`;
      this.emit("repair", {
        target,
        completed: this.state.completed.slice(),
        checkpointLabel: this.checkpoint.label
      });
      this.emit("toast", {
        text: `${target.id} 维修完成 · 已写入检查点，剩余备用螺栓 ${this.state.spare}`,
        tone: "normal"
      });
      Canyon.audio.playRepair();
      return true;
    }

    fail(code, title, reason, details) {
      if (this.state.mode === "failed" || this.state.mode === "won") {
        return;
      }
      const failure = {
        code,
        title,
        reason,
        details: details || "",
        time: this.state.elapsed,
        position: this.state.position,
        targetId: this.currentStation().id
      };
      this.state.mode = "failed";
      this.state.speed = 0;
      this.state.angularVelocity = 0;
      this.state.failure = failure;
      this.state.recentFailure = failure;
      this.state.hint = reason;
      this.emit("failure", failure);
      if (code === "overspeed") {
        Canyon.audio.playCrash();
      }
    }

    win() {
      if (this.state.mode === "won") {
        return;
      }
      this.state.mode = "won";
      this.state.speed = 0;
      this.state.angle = 0;
      this.state.angularVelocity = 0;
      this.state.position = this.level.stations[0].x;
      this.state.winStats = {
        elapsed: this.state.elapsed,
        battery: this.state.battery,
        rope: this.state.rope,
        spare: this.state.spare,
        load: this.state.load
      };
      this.state.hint = "三处滑轮已复位，吊篮安全返回左岸。";
      this.emit("win", this.state.winStats);
      Canyon.audio.playWin();
      this.save();
    }

    update(dt) {
      const state = this.state;
      if (state.mode !== "running") {
        return;
      }
      state.elapsed += dt;
      state.tick += 1;
      const previousPosition = state.position;
      const previousSpeed = state.speed;
      const windInfo = this.getWind();
      state.windInfo = windInfo;
      state.wind = windInfo.value;

      const inputs = state.inputs;
      const drive = (inputs.right ? 1 : 0) - (inputs.left ? 1 : 0);
      const trim = (inputs.trimRight ? 1 : 0) - (inputs.trimLeft ? 1 : 0);
      const hasPower = state.battery > 0;

      if (drive !== 0 && hasPower) {
        const acceleration = drive > 0 ? 0.25 : 0.21;
        state.speed += drive * acceleration * dt;
      }

      if (inputs.brake) {
        state.speed *= Math.exp(-8.5 * dt);
        state.battery = Math.max(0, state.battery - dt * 0.08);
      } else if (drive === 0) {
        state.speed *= Math.exp(-1.25 * dt);
      }

      state.speed = S.clamp(state.speed, -0.145, 0.145);
      if (Math.abs(state.speed) < 0.00045) {
        state.speed = 0;
      }

      if (drive !== 0 && hasPower) {
        state.battery = Math.max(0, state.battery - dt * (0.42 + Math.abs(state.speed) * 3.2));
      }
      if (trim !== 0 && hasPower) {
        state.battery = Math.max(0, state.battery - dt * 0.18);
      }

      state.position += state.speed * dt;
      state.position = S.clamp(state.position, this.level.stations[0].x, MAX_RIGHT);

      const actualAcceleration = (state.speed - previousSpeed) / Math.max(dt, 0.0001);
      const loadFactor = state.load / 164;
      const trimStrength = trim * 16 * (164 / state.load);
      const windTorque = windInfo.value * 5.4 / loadFactor;
      const angularAcceleration =
        windTorque -
        2.55 * state.angle -
        1.32 * state.angularVelocity -
        actualAcceleration * 36 +
        trimStrength;
      state.angularVelocity = S.clamp(
        state.angularVelocity + angularAcceleration * dt,
        -38,
        38
      );
      state.angle = S.clamp(state.angle + state.angularVelocity * dt, -32, 32);

      const tension = S.clamp(
        0.78 +
          state.load * 0.00075 +
          Math.abs(windInfo.value) * 0.055 +
          Math.abs(state.angle) * 0.004 +
          Math.abs(actualAcceleration) * 0.02,
        0.7,
        1.34
      );
      state.tension = Number(tension.toFixed(2));

      if (state.targetIndex < 3) {
        const target = this.currentStation();
        const crossedForward = previousPosition < target.x && state.position >= target.x;
        if (crossedForward && Math.abs(state.speed) > SAFE_DOCK_SPEED) {
          this.fail(
            "overspeed",
            `${target.id} 轮组过速撞击`,
            `进站速度超过安全阈值，吊篮撞上 ${target.label}。`,
            `进站速度 ${(Math.abs(state.speed) * 10).toFixed(2)} m/s · 安全阈值 ${(SAFE_DOCK_SPEED * 10).toFixed(2)} m/s\n摆动角 ${Math.abs(state.angle).toFixed(1)}° · 建议提前 0.08 索段制动。`
          );
          return;
        }
      } else if (
        state.completed.every(Boolean) &&
        previousPosition > this.level.stations[0].x &&
        state.position <= this.level.stations[0].x + STATION_RADIUS &&
        state.speed <= 0 &&
        Math.abs(state.speed) <= 0.03
      ) {
        this.win();
        return;
      } else if (
        state.completed.every(Boolean) &&
        previousPosition > this.level.stations[0].x &&
        state.position <= this.level.stations[0].x + 0.007
      ) {
        if (Math.abs(state.speed) > SAFE_DOCK_SPEED) {
          this.fail(
            "overspeed",
            "左岸归站过速",
            "吊篮返回左岸时速度过高，撞上 L0 止挡轮组。",
            `归站速度 ${(Math.abs(state.speed) * 10).toFixed(2)} m/s · 安全阈值 ${(SAFE_DOCK_SPEED * 10).toFixed(2)} m/s`
          );
          return;
        }
      }

      if (state.battery <= 0) {
        const nearest = Canyon.level.getAdjacentStation(this.level, state.position);
        this.fail(
          "stranded",
          "驱动电量耗尽 · 吊篮搁浅",
          `吊篮停在 ${nearest.id} 与下一站之间的索段，无法继续驱动。`,
          `最近检查点 ${this.checkpoint.label}\n位置 ${state.position.toFixed(3)} · 可用回收索 ${state.rope} 根`
        );
        return;
      }

      if (state.targetIndex < 3 && !this.isNearTarget()) {
        const target = this.currentStation();
        const distance = Math.abs(target.x - state.position);
        if (distance < 0.09) {
          state.hint = `${target.id} 接近中 · 距停靠窗 ${(distance * 100).toFixed(1)} · 按住 SPACE 制动`;
        } else {
          state.hint = `前往 ${target.id} ${target.label} · 当前载重 ${state.load.toFixed(1)} kg`;
        }
      }
    }

    updateRecovery(dt) {
      const state = this.state;
      if (state.mode !== "recovering" || !state.recovery) {
        return;
      }
      state.elapsed += dt;
      state.tick += 1;
      const recovery = state.recovery;
      recovery.elapsed += dt;
      const amount = S.clamp(recovery.elapsed / recovery.duration, 0, 1);
      const eased = S.smoothstep(amount);
      state.position = S.lerp(recovery.fromX, recovery.toX, eased);
      state.angle = S.lerp(recovery.fromAngle, 0, eased);
      state.angularVelocity = 0;
      state.speed = 0;
      const windInfo = this.getWind();
      state.windInfo = windInfo;
      state.wind = windInfo.value;
      state.tension = Number((0.88 + Math.abs(windInfo.value) * 0.06).toFixed(2));
      if (amount >= 1) {
        this.restoreCheckpoint(true);
        state.mode = "running";
        state.recovery = null;
        state.failure = null;
        state.hint = `回收完成 · 已回到 ${this.checkpoint.label}，检查点状态已恢复。`;
        this.emit("recovered", {
          checkpoint: this.checkpoint.label,
          rope: state.rope
        });
        this.emit("toast", {
          text: `缓慢回收完成 · 消耗 1 根回收索，剩余 ${state.rope} 根`,
          tone: "normal"
        });
      }
    }

    canRecover() {
      return Boolean(
        this.state.mode === "failed" &&
        this.state.failure &&
        this.state.failure.code === "stranded" &&
        this.state.rope > 0
      );
    }

    recover() {
      if (!this.canRecover()) {
        if (this.state.mode === "failed" && this.state.rope <= 0) {
          this.emit("toast", { text: "回收索已用尽，只能从检查点继续。", tone: "danger" });
        }
        return false;
      }
      this.state.rope -= 1;
      this.state.recovery = {
        fromX: this.state.position,
        toX: this.checkpoint.position,
        fromAngle: this.state.angle,
        elapsed: 0,
        duration: Math.max(1.8, Math.abs(this.state.position - this.checkpoint.position) * 11)
      };
      this.state.mode = "recovering";
      this.state.modeBeforePause = "recovering";
      this.state.hint = "回收索正在缓慢收紧，请保持现场稳定。";
      Canyon.audio.playRecovery();
      this.emit("recovery", { to: this.checkpoint.label });
      return true;
    }

    restoreCheckpoint(preserveRope) {
      const checkpoint = this.checkpoint;
      const rope = this.state.rope;
      this.state.position = checkpoint.position;
      this.state.speed = 0;
      this.state.angle = checkpoint.angle;
      this.state.angularVelocity = 0;
      this.state.battery = checkpoint.battery;
      this.state.spare = checkpoint.spare;
      this.state.load = checkpoint.load;
      this.state.completed = checkpoint.completed.slice();
      this.state.targetIndex = checkpoint.targetIndex;
      this.state.elapsed = checkpoint.elapsed;
      this.state.tick = checkpoint.checkpointTick;
      if (!preserveRope) {
        this.state.rope = checkpoint.rope;
      } else {
        this.state.rope = rope;
      }
      this.state.speed = 0;
      this.state.angularVelocity = 0;
    }

    continueFromCheckpoint() {
      if (this.state.mode !== "failed") {
        return false;
      }
      const failure = this.state.recentFailure;
      this.restoreCheckpoint(false);
      this.state.mode = "running";
      this.state.failure = null;
      this.state.recovery = null;
      this.state.recentFailure = failure;
      this.state.hint = `已回到 ${this.checkpoint.label}。目标与资源已恢复到该检查点。`;
      this.emit("continue", { checkpoint: this.checkpoint.label });
      this.emit("toast", {
        text: `从 ${this.checkpoint.label} 继续 · 失败原因保留在右侧复盘栏`,
        tone: "normal"
      });
      return true;
    }

    applyScenario(name) {
      const scenario = ["standard", "overspeed", "stranded"].includes(name) ? name : "standard";
      this.level = Canyon.level.createLevel(this.level.seedText);
      this.hardReset({ mode: "running", scenario });
      const state = this.state;

      if (scenario === "overspeed") {
        const target = this.level.stations[1];
        state.position = target.x - 0.035;
        state.speed = 0.145;
        state.battery = 88;
        state.angle = 3.4;
        state.hint = "调试场景：请观察 P1 进站速度。若不制动将立即撞击轮组。";
      } else if (scenario === "stranded") {
        const p1 = this.level.stations[1];
        const p2 = this.level.stations[2];
        state.completed = [true, false, false];
        state.targetIndex = 1;
        state.spare = 2;
        state.load = 160.2;
        state.battery = 27;
        state.position = p1.x;
        this.checkpoint = this.createCheckpoint("P1 · 维修完成检查点");
        state.position = (p1.x + p2.x) / 2;
        state.battery = 0;
        state.speed = 0;
        state.angle = 4.8;
        this.fail(
          "stranded",
          "驱动电量耗尽 · 吊篮搁浅",
          "调试场景：吊篮停在 P1 与 P2 之间，驱动电量归零。",
          `最近检查点 ${this.checkpoint.label}\n位置 ${state.position.toFixed(3)} · 可用回收索 ${state.rope} 根\n点击「缓慢回收」消耗 1 根回收索并回到 P1。`
        );
      }

      state.windInfo = this.getWind();
      state.wind = state.windInfo.value;
      this.emit("scenario", { scenario, seed: this.level.seedText });
      this.emit("toast", {
        text: `调试场景已载入 · ${this.scenarioLabel(scenario)} · SEED ${this.level.seedText}`,
        tone: "normal"
      });
      return scenario;
    }

    scenarioLabel(scenario) {
      return {
        standard: "标准巡回",
        overspeed: "过速撞轮",
        stranded: "中线回收"
      }[scenario || this.state.scenario] || "标准巡回";
    }

    advance(realDelta) {
      if (this.state.mode !== "running" && this.state.mode !== "recovering") {
        return;
      }
      this.accumulator += Math.min(Math.max(realDelta, 0), 0.15);
      let iterations = 0;
      while (this.accumulator >= STEP && iterations < 12) {
        if (this.state.mode === "running") {
          this.update(STEP);
        } else if (this.state.mode === "recovering") {
          this.updateRecovery(STEP);
        }
        this.accumulator -= STEP;
        iterations += 1;
      }
    }

    advanceSimulation(seconds, inputOverrides) {
      const previousInputs = this.state.inputs;
      if (inputOverrides) {
        this.state.inputs = { ...previousInputs, ...inputOverrides };
      }
      const steps = Math.min(6000, Math.max(0, Math.round(Number(seconds) / STEP)));
      for (let i = 0; i < steps; i += 1) {
        if (this.state.mode === "running") {
          this.update(STEP);
        } else if (this.state.mode === "recovering") {
          this.updateRecovery(STEP);
        } else {
          break;
        }
      }
      this.state.inputs = previousInputs;
      return this.getState();
    }

    serialize() {
      return JSON.stringify({
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        seed: this.level.seedText,
        fingerprint: this.level.fingerprint,
        state: this.state,
        checkpoint: this.checkpoint
      });
    }

    save() {
      try {
        const payload = this.serialize();
        global.localStorage.setItem(STORAGE_KEY, payload);
        this.lastSavedAt = new Date();
        this.emit("saved", { at: this.lastSavedAt });
        this.emit("toast", {
          text: "完整状态已保存：位置、目标、资源、检查点与胜负条件",
          tone: "normal"
        });
        return true;
      } catch (error) {
        this.emit("toast", { text: `保存失败：${error.message}`, tone: "danger" });
        return false;
      }
    }

    hasSave() {
      try {
        return Boolean(global.localStorage.getItem(STORAGE_KEY));
      } catch (error) {
        return false;
      }
    }

    load(options) {
      try {
        const raw = global.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          this.emit("toast", { text: "没有可载入的本地存档。", tone: "danger" });
          return false;
        }
        const save = JSON.parse(raw);
        if (save.version !== SAVE_VERSION || !save.state || !save.checkpoint) {
          throw new Error("存档版本不兼容");
        }
        const level = Canyon.level.createLevel(save.seed);
        if (level.fingerprint !== save.fingerprint || save.state.fingerprint !== save.fingerprint) {
          throw new Error("种子指纹校验失败，存档已拒绝");
        }
        const restored = save.state;
        if (!Array.isArray(restored.completed) || restored.completed.length !== 3) {
          throw new Error("目标数据损坏");
        }
        if (!Number.isFinite(restored.position) || !Number.isFinite(restored.battery)) {
          throw new Error("关键对象位置损坏");
        }
        this.level = level;
        this.state = restored;
        this.checkpoint = save.checkpoint;
        this.state.inputs = {
          left: false,
          right: false,
          brake: false,
          trimLeft: false,
          trimRight: false
        };
        if ((!options || options.pauseAfter !== false) &&
            (this.state.mode === "running" || this.state.mode === "recovering")) {
          this.state.modeBeforePause = this.state.mode;
          this.state.mode = "paused";
        }
        this.state.windInfo = this.getWind();
        this.state.wind = this.state.windInfo.value;
        this.accumulator = 0;
        this.lastSavedAt = save.savedAt ? new Date(save.savedAt) : new Date();
        this.emit("loaded", { seed: this.level.seedText, mode: this.state.mode });
        this.emit("toast", {
          text: "存档已载入并通过种子指纹校验；位置与目标状态保持不变。",
          tone: "normal"
        });
        return true;
      } catch (error) {
        this.emit("toast", { text: `载入失败：${error.message}`, tone: "danger" });
        return false;
      }
    }

    autoLoad() {
      if (!this.hasSave()) {
        return false;
      }
      return this.load({ pauseAfter: true });
    }

    getState() {
      return S.deepClone(this.state);
    }

    getSnapshot() {
      const state = this.getState();
      const current = this.currentStation();
      return {
        version: SAVE_VERSION,
        seed: this.level.seedText,
        fingerprint: this.level.fingerprint,
        scenario: state.scenario,
        mode: state.mode,
        position: state.position,
        speed: state.speed,
        angle: state.angle,
        battery: state.battery,
        spare: state.spare,
        rope: state.rope,
        load: state.load,
        completed: state.completed.slice(),
        targetIndex: state.targetIndex,
        target: {
          id: current.id,
          x: current.x,
          label: current.label,
          tolerance: current.tolerance
        },
        wind: this.getWind(),
        tension: state.tension,
        failure: state.failure,
        recentFailure: state.recentFailure,
        checkpoint: S.deepClone(this.checkpoint),
        level: {
          seed: this.level.seedText,
          fingerprint: this.level.fingerprint,
          stations: S.deepClone(this.level.stations),
          tasks: this.level.stations.slice(1).map((station) => station.task),
          obstacles: S.deepClone(this.level.obstacleOrder),
          path: this.level.pathLabel
        },
        conditions: {
          win: "完成 P1/P2/P3 三处维修，并以不超过 0.65 m/s 的速度返回 L0",
          lose: "进站速度超过 0.65 m/s，或驱动电量归零后吊篮停在索段中间",
          safeDockSpeed: SAFE_DOCK_SPEED,
          checkpoint: this.checkpoint.label
        }
      };
    }
  }

  Canyon.Game = Game;
})(window);
