(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RigSim = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONFIG = Object.freeze({
    missionTime: 150,
    world: Object.freeze({
      minX: 175,
      maxX: 1425,
      rope: 92,
      arm: 122,
      targets: Object.freeze([515, 825, 1175]),
    }),
    physics: Object.freeze({
      driveAccel: 285,
      drag: 0.52,
      brakeDrag: 2.75,
      gravity: 980,
      swingDamp: 1.08,
      windDrive: 1.65,
      windSwing: 0.0028,
      armSpeed: 1.28,
      clampAngle: 0.092,
      clampDistance: 66,
      clampSpeed: 92,
      maxTrolleySpeed: 190,
      installTime: 1.35,
      recoverTime: 1.45,
      dropSpeed: 118,
      linkTimeout: 11.5,
    }),
  });

  const KEYS = Object.freeze({
    left: Object.freeze(["a", "d", "s"]),
    right: Object.freeze(["j", "l", "k"]),
  });

  const KEY_INFO = Object.freeze({
    a: { side: "left", label: "左移", short: "A" },
    d: { side: "left", label: "右移", short: "D" },
    s: { side: "left", label: "急停", short: "S" },
    j: { side: "right", label: "逆摆", short: "J" },
    l: { side: "right", label: "顺摆", short: "L" },
    k: { side: "right", label: "夹持", short: "K" },
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function wrapAngle(value) {
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  function cableY(x) {
    const t = clamp((x - 128) / (1470 - 128), 0, 1);
    return 230 + Math.sin(t * Math.PI) * 126 + t * 18;
  }

  function emptyKeys() {
    return { a: false, d: false, s: false, j: false, l: false, k: false };
  }

  function emptyLink() {
    return { state: "online", lastInput: 0, everActive: false, silent: 0 };
  }

  function createState(seed) {
    const state = {
      version: 1,
      seed: seed || 20261117,
      status: "running",
      paused: false,
      protection: null,
      debugSolo: false,
      debugFreezeWind: false,
      elapsed: 0,
      timeLeft: CONFIG.missionTime,
      wind: { value: 9.4, x: 10.2, dir: 1, gust: 0 },
      trolley: { x: 300, vx: 0, ax: 0 },
      swing: { theta: 0, omega: 0 },
      arm: { angle: 0 },
      keys: emptyKeys(),
      clampHeld: false,
      installProgress: 0,
      targetIndex: 0,
      pulleys: CONFIG.world.targets.map((x, index) => ({
        x,
        index,
        status: "pending",
        installedAt: null,
      })),
      resources: {
        spares: 3,
        tool: "secured",
        recoveryProgress: 0,
        dropX: null,
        dropY: null,
      },
      links: { left: emptyLink(), right: emptyLink() },
      feed: [],
      conflicts: [],
      taskLog: [],
      stats: {
        inputs: { left: 0, right: 0 },
        conflicts: 0,
        drops: 0,
        recoveries: 0,
        emergencyBrakes: 0,
      },
    };
    pushLog(state, "system", "风场接入 · 三组滑轮等待更换", "cyan");
    pushLog(state, "system", "左席负责驱动，右席负责摆臂，双方保持链路", "muted");
    recordEvent(state, "system", { text: "mission-start" });
    return state;
  }

  function target(state) {
    return state.pulleys[state.targetIndex] || null;
  }

  function basketPosition(state) {
    const trolleyY = cableY(state.trolley.x);
    const rope = CONFIG.world.rope;
    return {
      x: state.trolley.x + Math.sin(state.swing.theta) * rope,
      y: trolleyY + Math.cos(state.swing.theta) * rope,
      trolleyY,
    };
  }

  function alignMetrics(state, pulley) {
    const basket = basketPosition(state);
    const item = pulley || target(state);
    if (!item) {
      return {
        valid: false,
        xError: 0,
        desiredAngle: 0,
        angleError: 0,
        speed: Math.abs(state.trolley.vx),
        angleOk: false,
        distanceOk: false,
        speedOk: false,
        aligned: false,
      };
    }
    const pulleyY = cableY(item.x);
    const dx = item.x - basket.x;
    const up = basket.y - pulleyY;
    const desiredAngle = Math.atan2(dx, Math.max(12, up));
    const angleError = wrapAngle(state.arm.angle - desiredAngle);
    const xError = state.trolley.x - item.x;
    const angleOk = Math.abs(angleError) <= CONFIG.physics.clampAngle;
    const distanceOk = Math.abs(xError) <= CONFIG.physics.clampDistance;
    const speedOk = Math.abs(state.trolley.vx) <= CONFIG.physics.clampSpeed;
    return {
      valid: true,
      xError,
      angleError,
      desiredAngle,
      speed: Math.abs(state.trolley.vx),
      angleOk,
      distanceOk,
      speedOk,
      aligned: angleOk && distanceOk && speedOk,
    };
  }

  function snapshot(state) {
    const item = target(state);
    return {
      at: +state.elapsed.toFixed(3),
      status: state.status,
      timeLeft: +state.timeLeft.toFixed(2),
      wind: +state.wind.value.toFixed(2),
      windDir: state.wind.dir,
      x: +state.trolley.x.toFixed(2),
      vx: +state.trolley.vx.toFixed(2),
      theta: +state.swing.theta.toFixed(4),
      omega: +state.swing.omega.toFixed(3),
      arm: +state.arm.angle.toFixed(4),
      clamp: state.clampHeld,
      progress: +state.installProgress.toFixed(3),
      recovery: +state.resources.recoveryProgress.toFixed(3),
      target: item ? item.index : -1,
      targetX: item ? item.x : null,
      done: state.pulleys.filter((pulley) => pulley.status === "done").length,
      spares: state.resources.spares,
      tool: state.resources.tool,
      dropX: state.resources.dropX,
      protection: state.protection ? state.protection.side : null,
    };
  }

  function recordEvent(state, type, data) {
    const event = {
      id: state.feed.length + 1,
      at: +state.elapsed.toFixed(3),
      type,
      ...data,
      snap: snapshot(state),
    };
    state.feed.push(event);
    if (type === "conflict") {
      state.conflicts.push(event);
      state.stats.conflicts += 1;
    }
    return event;
  }

  function pushLog(state, channel, text, tone) {
    const item = {
      at: state.elapsed,
      clock: formatClock(state.elapsed),
      channel,
      text,
      tone: tone || "muted",
    };
    state.taskLog.unshift(item);
    if (state.taskLog.length > 20) state.taskLog.length = 20;
    if (state.status === "running") {
      recordEvent(state, "log", {
        text,
        channel,
        tone: item.tone,
      });
    }
    return item;
  }

  function formatClock(seconds) {
    const value = Math.max(0, Math.ceil(seconds));
    const minutes = String(Math.floor(value / 60)).padStart(2, "0");
    const rest = String(value % 60).padStart(2, "0");
    return `${minutes}:${rest}`;
  }

  function addConflict(state, code, text, severity) {
    const entry = recordEvent(state, "conflict", {
      code,
      text,
      severity: severity || "warn",
    });
    pushLog(state, "warning", text, severity === "danger" ? "danger" : "warn");
    return entry;
  }

  function toolDrop(state, reason) {
    if (state.resources.tool !== "secured") return false;
    const basket = basketPosition(state);
    state.resources.tool = "lost";
    state.resources.recoveryProgress = 0;
    state.resources.dropX = +basket.x.toFixed(1);
    state.resources.dropY = +(basket.y + 150).toFixed(1);
    state.installProgress = 0;
    state.clampHeld = false;
    state.stats.drops += 1;
    addConflict(state, "TOOL_DROP", `工具脱扣 · ${reason}`, "danger");
    pushLog(state, "resource", `锁扣坠在 ${Math.round(state.resources.dropX)}m 标位`, "danger");
    return true;
  }

  function clearKeys(state) {
    state.keys = emptyKeys();
    state.clampHeld = false;
  }

  function activateProtection(state, side, reason) {
    if (state.status !== "running" || state.protection) return false;
    const label = side === "left" ? "左席" : "右席";
    state.links[side].state = reason === "timeout" ? "timeout" : "offline";
    state.links[side].silent = +(state.elapsed - state.links[side].lastInput).toFixed(1);
    clearKeys(state);
    const message =
      reason === "timeout"
        ? `${label}链路超时 · 安全抱闸，计时冻结`
        : `${label}链路断开 · 安全抱闸，计时冻结`;
    addConflict(state, "LINK_PROTECT", message, "danger");
    state.protection = {
      side,
      reason,
      at: state.elapsed,
      message,
    };
    recordEvent(state, "protection", {
      side,
      reason,
      text: message,
    });
    return true;
  }

  function restoreLink(state) {
    if (!state.protection) return false;
    const side = state.protection.side;
    state.links[side].state = "online";
    state.links[side].lastInput = state.elapsed;
    state.links[side].silent = 0;
    state.protection = null;
    pushLog(state, "system", `${side === "left" ? "左席" : "右席"}链路恢复 · 继续作业`, "cyan");
    recordEvent(state, "protection-restore", { side });
    return true;
  }

  function setKey(state, side, rawKey, down, source) {
    const key = String(rawKey || "").toLowerCase();
    if (!KEYS[side] || !KEYS[side].includes(key)) return false;
    if (state.status !== "running" || state.paused || state.protection) return false;
    if (!state.links[side]) return false;

    state.links[side].lastInput = state.elapsed;
    state.links[side].everActive = true;
    state.links[side].silent = 0;
    state.links[side].state = "online";
    const info = KEY_INFO[key];
    const changed = state.keys[key] !== down;

    if (down) {
      state.stats.inputs[side] += 1;
      recordEvent(state, "input", {
        side,
        key,
        short: info.short,
        action: info.label,
        down: true,
        source: source || "keyboard",
      });
    } else if (changed) {
      recordEvent(state, "input", {
        side,
        key,
        short: info.short,
        action: info.label,
        down: false,
        source: source || "keyboard",
      });
    }

    state.keys[key] = down;
    if (!changed) return true;

    if (down && key === "s") {
      state.stats.emergencyBrakes += 1;
      const impulse = clamp(state.trolley.vx * 0.0047 + state.wind.dir * 0.045, -0.78, 0.78);
      state.swing.omega += impulse;
      if (state.clampHeld && state.installProgress > 0.02) {
        addConflict(state, "ESTOP_INSTALL", "左席急停 × 右席夹持 · 对位失效", "danger");
        toolDrop(state, "急停摆振扯脱夹持");
      } else if (state.clampHeld) {
        addConflict(state, "ESTOP_CLAMP", "左席急停 · 右席夹持中的吊篮开始摆振", "warn");
      } else {
        addConflict(state, "ESTOP", "左席急停 · 吊篮进入摆振", "info");
      }
    }

    if (down && key === "k") {
      state.clampHeld = true;
      if (state.resources.tool === "lost") {
        recordEvent(state, "recovery-start", {
          dropX: state.resources.dropX,
        });
      } else {
        const metrics = alignMetrics(state, target(state));
        if (metrics.valid && !metrics.aligned) {
          const near = Math.abs(metrics.xError) < 84 && Math.abs(metrics.angleError) < 0.34;
          if (near && metrics.speed > CONFIG.physics.dropSpeed) {
            addConflict(state, "HOT_CLAMP", "右席高速夹持 · 锁扣碰撞", "danger");
            toolDrop(state, "高速夹持造成碰撞");
          } else {
            addConflict(state, "CLAMP_OFFSET", "右席夹持未对中 · 安装进度无法保持", "warn");
          }
        }
      }
    }

    if (!down && key === "k") {
      state.clampHeld = false;
      if (state.installProgress > 0.02 && target(state)) {
        addConflict(state, "CLAMP_RELEASE", "右席松开夹持 · 对位进度回退", "info");
      }
    }
    return true;
  }

  function completeTarget(state) {
    const item = target(state);
    if (!item) return;
    item.status = "done";
    item.installedAt = +state.elapsed.toFixed(2);
    state.resources.spares = Math.max(0, state.resources.spares - 1);
    state.installProgress = 0;
    state.clampHeld = false;
    state.targetIndex += 1;
    recordEvent(state, "task", {
      target: item.index,
      text: `滑轮 ${item.index + 1} 更换完成`,
      spares: state.resources.spares,
    });
    pushLog(state, "task", `滑轮 ${item.index + 1} 更换完成 · 备件余 ${state.resources.spares}`, "success");
    if (state.targetIndex >= state.pulleys.length) {
      state.status = "won";
      state.timeLeft = Math.max(0, state.timeLeft);
      clearKeys(state);
      recordEvent(state, "finish", {
        result: "success",
        timeLeft: +state.timeLeft.toFixed(1),
      });
      pushLog(state, "task", "三组滑轮全部完成 · 索道恢复", "success");
    } else {
      pushLog(
        state,
        "target",
        `下一目标 P-${state.targetIndex + 1} · ${state.pulleys[state.targetIndex].x}m`,
        "cyan"
      );
    }
  }

  function updateInteraction(state, dt) {
    const item = target(state);
    if (state.clampHeld) {
      if (state.resources.tool === "lost") {
        const dropX = state.resources.dropX;
        const nearDrop = dropX !== null && Math.abs(state.trolley.x - dropX) <= 44;
        const slow = Math.abs(state.trolley.vx) <= 45;
        if (nearDrop && slow) {
          state.resources.recoveryProgress += dt / CONFIG.physics.recoverTime;
          if (state.resources.recoveryProgress >= 1) {
            state.resources.tool = "secured";
            state.resources.recoveryProgress = 0;
            state.resources.dropX = null;
            state.resources.dropY = null;
            state.stats.recoveries += 1;
            state.clampHeld = false;
            addConflict(state, "TOOL_RECOVERED", "双席配合完成工具回收", "success");
            pushLog(state, "resource", "锁扣已回收 · 可继续安装", "success");
            recordEvent(state, "resource", { tool: "secured", text: "tool-recovered" });
          }
        } else {
          state.resources.recoveryProgress = Math.max(
            0,
            state.resources.recoveryProgress - dt * 0.55
          );
        }
      } else if (item) {
        const metrics = alignMetrics(state, item);
        if (metrics.aligned) {
          state.installProgress += dt / CONFIG.physics.installTime;
          if (state.installProgress >= 1) completeTarget(state);
        } else {
          state.installProgress = Math.max(0, state.installProgress - dt * 0.6);
        }
      }
    } else if (state.installProgress > 0) {
      state.installProgress = Math.max(0, state.installProgress - dt * 0.18);
    }
  }

  function tick(state, rawDt) {
    if (state.status !== "running" || state.paused || state.protection) {
      return snapshot(state);
    }
    const dt = clamp(Number(rawDt) || 0, 0.0001, 0.05);
    const previousElapsed = state.elapsed;
    state.elapsed += dt;
    state.timeLeft = Math.max(0, state.timeLeft - dt);

    for (const side of ["left", "right"]) {
      const link = state.links[side];
      if (KEYS[side].some((key) => state.keys[key])) {
        link.lastInput = state.elapsed;
        link.silent = 0;
      } else {
        link.silent = state.elapsed - link.lastInput;
      }
    }

    if (!state.debugSolo) {
      for (const side of ["left", "right"]) {
        const link = state.links[side];
        if (link.everActive && state.elapsed - link.lastInput > CONFIG.physics.linkTimeout) {
          activateProtection(state, side, "timeout");
          return snapshot(state);
        }
      }
    }

    if (!state.debugFreezeWind) {
      const phase = state.elapsed;
      const base = 6.9 + Math.sin(phase * 0.11 + 0.3) * 2.8 + Math.sin(phase * 0.041) * 1.6;
      const gust =
        Math.max(0, Math.sin(phase * 0.23 + 1.1)) * 4.2 +
        Math.max(0, Math.sin(phase * 0.61 - 0.4)) * 1.8;
      const direction = Math.sin(phase * 0.083 + 1.45) >= -0.34 ? 1 : -1;
      state.wind.value = clamp(base + gust, 2.4, 16.4);
      state.wind.dir = direction;
      state.wind.gust = gust;
      state.wind.x = state.wind.value * direction;
    }

    let drive = 0;
    if (state.keys.a) drive -= CONFIG.physics.driveAccel;
    if (state.keys.d) drive += CONFIG.physics.driveAccel;
    const windAccel = state.wind.x * CONFIG.physics.windDrive;
    let supportAccel = drive + windAccel;
    if (state.keys.s) supportAccel -= state.trolley.vx * CONFIG.physics.brakeDrag;
    supportAccel = clamp(supportAccel, -460, 460);

    state.trolley.ax = supportAccel;
    state.trolley.vx += supportAccel * dt;
    state.trolley.vx *= Math.exp(-CONFIG.physics.drag * dt);
    if (state.keys.s) {
      state.trolley.vx *= Math.exp(-CONFIG.physics.brakeDrag * dt);
    }
    state.trolley.vx = clamp(
      state.trolley.vx,
      -CONFIG.physics.maxTrolleySpeed,
      CONFIG.physics.maxTrolleySpeed
    );
    state.trolley.x += state.trolley.vx * dt;

    if (state.trolley.x < CONFIG.world.minX) {
      state.trolley.x = CONFIG.world.minX;
      state.trolley.vx = Math.abs(state.trolley.vx) * 0.18;
    } else if (state.trolley.x > CONFIG.world.maxX) {
      state.trolley.x = CONFIG.world.maxX;
      state.trolley.vx = -Math.abs(state.trolley.vx) * 0.18;
    }

    const armDir = (state.keys.l ? 1 : 0) - (state.keys.j ? 1 : 0);
    state.arm.angle = clamp(
      state.arm.angle + armDir * CONFIG.physics.armSpeed * dt,
      -1.03,
      1.03
    );

    const rope = CONFIG.world.rope;
    const angularAccel =
      -(CONFIG.physics.gravity / rope) * Math.sin(state.swing.theta) -
      CONFIG.physics.swingDamp * state.swing.omega -
      (supportAccel / rope) * Math.cos(state.swing.theta) * 0.72 +
      state.wind.x * CONFIG.physics.windSwing * Math.cos(state.swing.theta);
    state.swing.omega += angularAccel * dt;
    state.swing.omega = clamp(state.swing.omega, -2.8, 2.8);
    state.swing.theta += state.swing.omega * dt;
    if (Math.abs(state.swing.theta) > 0.82) {
      state.swing.theta = clamp(state.swing.theta, -0.82, 0.82);
      state.swing.omega *= -0.28;
    }

    updateInteraction(state, dt);

    if (state.status === "running" && state.timeLeft <= 0) {
      state.timeLeft = 0;
      state.status = "lost";
      clearKeys(state);
      addConflict(state, "MISSION_TIMEOUT", "任务倒计时归零 · 维修窗口关闭", "danger");
      recordEvent(state, "finish", { result: "timeout" });
    }

    if (state.elapsed - previousElapsed > 0.45) {
      recordEvent(state, "heartbeat", {});
    }
    return snapshot(state);
  }

  function togglePause(state) {
    if (state.status !== "running" || state.protection) return state.paused;
    state.paused = !state.paused;
    clearKeys(state);
    recordEvent(state, state.paused ? "pause" : "resume", {});
    pushLog(state, "system", state.paused ? "维修暂停 · 计时冻结" : "维修继续", "cyan");
    if (!state.paused) {
      state.links.left.lastInput = state.elapsed;
      state.links.right.lastInput = state.elapsed;
    }
    return state.paused;
  }

  return {
    CONFIG,
    KEYS,
    KEY_INFO,
    clamp,
    cableY,
    createState,
    target,
    basketPosition,
    alignMetrics,
    snapshot,
    formatClock,
    recordEvent,
    pushLog,
    addConflict,
    toolDrop,
    setKey,
    tick,
    togglePause,
    activateProtection,
    restoreLink,
    clearKeys,
  };
});
