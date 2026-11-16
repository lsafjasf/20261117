/* 确定性物理核心：固定步长 + 半隐式欧拉，无随机源。挂到 window.CranePhysics。 */
(function (global) {
  'use strict';
  const CFG = global.CRANE_CFG;

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // 初始条件模板：重置时从同一深拷贝恢复，保证初始位置/资源不漂移
  function buildTemplate() {
    const lift0 = CFG.lifts[0];
    const box0 = lift0.box;
    const groundY = CFG.groundY;
    const pivotY = CFG.beam.y + CFG.trolley.height;
    const r0 = (groundY - box0.h / 2 - pivotY) / CFG.PX_PER_M;
    return {
      status: 'idle', // idle | active | fault | done
      step: 0, time: 0, liftIndex: 0,
      trolleyX: CFG.trolley.startX, trolleyV: 0,
      r: r0, winchV: 0, theta: 0, omega: 0,
      brake: false, counterweight: 800, energyJ: 0,
      box: {
        attached: false, airborne: false, placed: false, falling: false,
        x: box0.x, y: groundY - box0.h / 2, vx: 0, vy: 0, angle: 0,
        w: box0.w, h: box0.h, mass: box0.mass, color: box0.color
      },
      pivotY,
      tension: 0, speed: 0, temp: CFG.brake.ambient, pressure: CFG.pressure.p0,
      peaks: {
        tension: { value: 0, t: 0, step: 0 },
        speed: { value: 0, t: 0, step: 0 },
        temp: { value: CFG.brake.ambient, t: 0, step: 0 },
        pressure: { value: CFG.pressure.p0, t: 0, step: 0 }
      },
      faults: [], events: [], history: [], inputLog: [],
      placedBoxes: [], requestAttach: false
    };
  }

  function createInitialState() {
    const s = buildTemplate();
    s._template = buildTemplate();
    return s;
  }

  function resetState(state) {
    const tpl = state._template || buildTemplate();
    const fresh = clone(tpl);
    fresh._template = tpl;
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, fresh);
    logEvent(state, '系统重置：位置、绳长、能量与峰值全部恢复初始值');
  }

  function logEvent(state, msg) {
    state.events.push({ t: state.time, step: state.step, msg });
    if (state.events.length > 200) state.events.shift();
  }

  // FNV-1a 确定性校验和：同输入重复运行轨迹一致时 chk 相同
  function checksum(state) {
    const keys = ['trolleyX', 'trolleyV', 'r', 'winchV', 'theta', 'omega',
      'temp', 'pressure', 'tension', 'speed'];
    let h = 0x811c9dc5;
    keys.forEach((k) => {
      const num = state[k] !== undefined ? state[k] : state.box[k];
      const str = num.toFixed(6) + '|' + state.box.x.toFixed(4) + '|'
        + state.box.y.toFixed(4) + '|';
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
    });
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function encodeInput(inp) {
    return (inp.left ? 1 : 0) | (inp.right ? 2 : 0) |
      (inp.hoistUp ? 4 : 0) | (inp.hoistDown ? 8 : 0) | (inp.brake ? 16 : 0);
  }

  function pivotX(state) { return state.trolleyX; }

  function boxCenterFromRope(state) {
    const Lpx = state.r * CFG.PX_PER_M;
    return {
      x: state.trolleyX + Lpx * Math.sin(state.theta),
      y: state.pivotY + Lpx * Math.cos(state.theta)
    };
  }

  function boxCorners(box) {
    const a = box.angle || 0;
    const ca = Math.cos(a), sa = Math.sin(a);
    const hw = box.w / 2, hh = box.h / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => ({
      x: box.x + lx * ca - ly * sa,
      y: box.y + lx * sa + ly * ca
    }));
  }

  function updateActuators(state, inp) {
    const dt = CFG.DT;
    state.brake = !!inp.brake;
    const box = state.box;
    const grounded = box.attached && !box.airborne && !box.falling;

    const tvTarget = (!state.brake && !grounded && (inp.left || inp.right))
      ? ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * CFG.trolley.vMax
      : 0;
    if (state.trolleyV !== tvTarget) {
      const maxDv = CFG.trolley.accel * dt;
      state.trolleyV += clamp(tvTarget - state.trolleyV, -maxDv, maxDv);
    }
    if (grounded) state.trolleyV = 0;
    state.trolleyX = clamp(
      state.trolleyX + state.trolleyV * CFG.PX_PER_M * dt,
      CFG.track.xMin, CFG.track.xMax
    );

    const wTarget = (!state.brake && (inp.hoistUp || inp.hoistDown))
      ? ((inp.hoistDown ? 1 : 0) - (inp.hoistUp ? 1 : 0)) * CFG.winch.vMax
      : 0;
    if (state.winchV !== wTarget) {
      const maxDv = CFG.winch.accel * dt;
      state.winchV += clamp(wTarget - state.winchV, -maxDv, maxDv);
    }
    state.r = clamp(state.r + state.winchV * dt,
      CFG.winch.rMin, CFG.winch.rMax);
  }

  function updateDynamics(state) {
    const dt = CFG.DT;
    const box = state.box;

    if (box.falling) {
      box.vy += CFG.G * CFG.PX_PER_M * dt;
      box.x += box.vx * dt;
      box.y += box.vy * dt;
      box.angle += (box.vx / CFG.PX_PER_M) * 0.6 * dt;
      state.speed = Math.hypot(box.vx, box.vy) / CFG.PX_PER_M;
      state.tension = 0;
      return;
    }

    if (box.attached && !box.airborne) {
      box.x = state.trolleyX;
      box.y = CFG.groundY - box.h / 2;
      box.angle = state.theta = 0;
      box.vx = box.vy = 0;
      state.omega = 0;
      const c = boxCenterFromRope(state);
      if (c.y <= box.y - 0.5) {
        box.airborne = true;
        state._skipLimitOnce = true;
        state._airborneFirstStep = true;
        logEvent(state, '货箱离地，进入摆动状态');
      }
      state.tension = 0;
      state.speed = 0;
      return;
    }

    // 空中：移动支点 + 变绳长单摆
    const g = CFG.G, L = state.r, dL = state.winchV;
    const pivotAcc = state._lastPivotV !== undefined
      ? (state.trolleyV - state._lastPivotV) / dt : 0;
    state._lastPivotV = state.trolleyV;
    const s = Math.sin(state.theta), c = Math.cos(state.theta);

    const alpha = (-pivotAcc * c / L) - (2 * dL * state.omega / L)
      - (g * s / L) - CFG.DAMP * state.omega;
    state.omega += alpha * dt;
    state.theta += state.omega * dt;

    state.tension = box.mass * (
      L * state.omega * state.omega + 2 * dL * state.omega
      + g * c - pivotAcc * s
    );

    const prevX = box.x, prevY = box.y;
    const pos = boxCenterFromRope(state);
    box.x = pos.x; box.y = pos.y;
    box.angle = state.theta;
    if (state._airborneFirstStep) {
      // 离地首帧：位置差分跨越了地面→空中的状态切换，直接用绞车速度初始化
      box.vx = 0;
      box.vy = state.winchV * CFG.PX_PER_M;
      state._airborneFirstStep = false;
    } else {
      box.vx = (box.x - prevX) / dt;
      box.vy = (box.y - prevY) / dt;
    }
    state.speed = Math.max(0, Math.hypot(box.vx, box.vy) / CFG.PX_PER_M);
  }

  function updateThermalPressure(state) {
    const dt = CFG.DT;
    const brakingPower = state.brake
      ? 0.5 * (Math.abs(state.trolleyV) + Math.abs(state.winchV)) * 4000
      : 0;
    state.temp += (CFG.brake.kb * brakingPower
      - CFG.brake.cool * (state.temp - CFG.brake.ambient)) * dt;

    const staticNet = (state.box.mass - state.counterweight) * CFG.G;
    const dynamicT = state.tension - state.box.mass * CFG.G;
    state.pressure = CFG.pressure.p0
      + CFG.pressure.kp * (staticNet + dynamicT);

    state.energyJ += (Math.abs(state.trolleyV) + Math.abs(state.winchV))
      * state.box.mass * CFG.G * 0.02 * dt;
  }

  function checkLimits(state) {
    if (state._skipLimitOnce) { state._skipLimitOnce = false; return true; }
    const activeLoad = state.box.airborne || state.box.falling;
    const list = [
      ['tension', state.tension, state.box.airborne],
      ['speed', state.speed, activeLoad],
      ['temp', state.temp, activeLoad],
      ['pressure', state.pressure, activeLoad]
    ];
    for (const [key, val, active] of list) {
      if (!active) continue;
      const lim = CFG.limits[key];
      if (val > state.peaks[key].value) {
        state.peaks[key] = { value: val, t: state.time, step: state.step };
      }
      if (val > lim.max || val < lim.min) {
        raiseFault(state, key, val, lim);
        return false;
      }
    }
    return true;
  }

  function raiseFault(state, key, val, lim) {
    const over = val > lim.max;
    const part = {
      tension: '起重绳索', speed: '货箱',
      temp: '刹车盘', pressure: '液压系统'
    }[key];
    state.faults.push({
      kind: 'limit', part, metric: key, value: val,
      bound: over ? lim.max : lim.min, dir: over ? '超过上限' : '低于下限',
      t: state.time, step: state.step, x: state.box.x, y: state.box.y,
      unit: lim.unit, label: lim.label
    });
    state.status = 'fault';
    const f = state.faults[state.faults.length - 1];
    logEvent(state, `故障：${part}·${lim.label}=${val.toFixed(2)} ${lim.unit}，`
      + `${f.dir}（${over ? '>' : '<'} ${f.bound} ${lim.unit}）@ t=${state.time.toFixed(2)}s`);
  }

  function rectsOverlap(box, rect) {
    // OBB（旋转货箱）vs AABB，SAT 检测
    const corners = boxCorners(box);
    const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
    const a = box.angle || 0;
    axes.push({ x: -Math.sin(a), y: Math.cos(a) });
    axes.push({ x: Math.cos(a), y: Math.sin(a) });
    const rPts = [
      { x: rect.x, y: rect.top },
      { x: rect.x + rect.w, y: rect.top },
      { x: rect.x + rect.w, y: rect.bottom },
      { x: rect.x, y: rect.bottom }
    ];
    for (const ax of axes) {
      let bMin = Infinity, bMax = -Infinity, rMin = Infinity, rMax = -Infinity;
      corners.forEach((p) => {
        const d = p.x * ax.x + p.y * ax.y;
        bMin = Math.min(bMin, d); bMax = Math.max(bMax, d);
      });
      rPts.forEach((p) => {
        const d = p.x * ax.x + p.y * ax.y;
        rMin = Math.min(rMin, d); rMax = Math.max(rMax, d);
      });
      if (bMax <= rMin || rMax <= bMin) return false;
    }
    return true;
  }

  function solidRects(state) {
    const rects = [
      { name: '地面', x: 0, w: CFG.view.w, top: CFG.groundY, bottom: CFG.view.h },
      { name: '横梁', x: CFG.beam.x0, w: CFG.beam.x1 - CFG.beam.x0,
        top: 0, bottom: CFG.beam.y + CFG.beam.thickness },
      { name: '中间障碍墙', x: CFG.wall.x, w: CFG.wall.w,
        top: CFG.wall.top, bottom: CFG.wall.bottom }
    ];
    CFG.lifts.forEach((lf, i) => {
      rects.push({
        name: `平台${i + 1}`, x: lf.platform.x, w: lf.platform.w,
        top: lf.platform.top, bottom: CFG.groundY
      });
    });
    state.placedBoxes.forEach((pb, i) => {
      rects.push({
        name: `已放置货箱${i + 1}`, x: pb.x - pb.w / 2, w: pb.w,
        top: pb.y - pb.h / 2, bottom: pb.y + pb.h / 2
      });
    });
    return rects;
  }

  function collisionFault(state, rectName) {
    const f = {
      kind: 'collision', part: rectName, metric: 'collision',
      value: 1, bound: 0, dir: '发生碰撞',
      t: state.time, step: state.step,
      x: state.box.x, y: state.box.y, unit: '', label: '碰撞'
    };
    state.faults.push(f);
    state.status = 'fault';
    logEvent(state, `故障：货箱与${rectName}碰撞 @ t=${state.time.toFixed(2)}s`);
  }

  function tryPlace(state) {
    const lift = CFG.lifts[state.liftIndex];
    const pf = lift.platform;
    const box = state.box;
    const bottom = box.y + box.h / 2;
    const overX = box.x > pf.x && box.x < pf.x + pf.w;
    const nearTop = Math.abs(bottom - pf.top) <= CFG.settle.placeTolerance;
    const slow = state.speed <= CFG.settle.maxPlaceSpeed;
    const calm = Math.abs(state.theta) <= CFG.settle.maxPlaceSwing;
    if (overX && nearTop && slow && calm) {
      box.placed = true; box.airborne = false; box.attached = false;
      box.y = pf.top - box.h / 2; box.vx = box.vy = 0; box.angle = 0;
      state.placedBoxes.push(clone(box));
      logEvent(state, `第 ${state.liftIndex + 1} 次吊装完成：货箱平稳落位平台`
        + `（速度 ${state.speed.toFixed(2)} m/s，摆角 ${(state.theta * 180 / Math.PI).toFixed(1)}°）`);
      advanceLift(state);
      return true;
    }
    return false;
  }

  function checkCollisions(state) {
    const box = state.box;
    if (box.placed || (box.attached && !box.airborne && !box.falling)) return;
    const lift = CFG.lifts[state.liftIndex];
    for (const rect of solidRects(state)) {
      if (!rectsOverlap(box, rect)) continue;
      const onTarget = rect.name === `平台${state.liftIndex + 1}`;
      if (onTarget && box.attached && !box.falling && tryPlace(state)) return;
      // 从目标平台上方横移经过：仅当正在下放（winchV>0）或坠落时才算碰撞，
      // 允许带载从平台上空越过，避免误判
      if (onTarget && box.attached && state.winchV <= 0 && !box.falling) continue;
      if (box.falling || box.airborne) { collisionFault(state, rect.name); return; }
    }
  }

  function advanceLift(state) {
    if (state.liftIndex >= CFG.lifts.length - 1) {
      state.status = 'done';
      logEvent(state, '全部吊装任务完成，未发生碰撞与越限，任务成功');
      return;
    }
    state.liftIndex += 1;
    const lf = CFG.lifts[state.liftIndex];
    const b = lf.box;
    state.trolleyX = CFG.trolley.startX;
    state.trolleyV = state.winchV = state.omega = 0;
    state.theta = 0;
    state.box = {
      attached: false, airborne: false, placed: false, falling: false,
      x: b.x, y: CFG.groundY - b.h / 2, vx: 0, vy: 0, angle: 0,
      w: b.w, h: b.h, mass: b.mass, color: b.color
    };
    state.r = ((CFG.groundY - b.h / 2) - state.pivotY) / CFG.PX_PER_M;
    state.tension = state.speed = 0;
  }

  function handleAttach(state) {
    const box = state.box;
    if (box.attached) {
      // 手动释放：仅在目标平台正上方且低速时允许，否则判为危险脱钩
      const lf = CFG.lifts[state.liftIndex];
      const pf = lf.platform;
      const overX = box.x > pf.x && box.x < pf.x + pf.w;
      if (box.airborne && !(overX && state.speed <= CFG.settle.maxPlaceSpeed)) {
        state.faults.push({
          kind: 'collision', part: '起重绳索（违规脱钩）', metric: 'collision',
          value: 1, bound: 0, dir: '危险释放', t: state.time, step: state.step,
          x: box.x, y: box.y, unit: '', label: '脱钩'
        });
        state.status = 'fault';
        logEvent(state, `故障：在非安全位置脱钩 @ t=${state.time.toFixed(2)}s`);
        return;
      }
      box.attached = false; box.falling = true;
      logEvent(state, '货箱已在平台上方释放');
      return;
    }
    const dx = Math.abs(box.x - state.trolleyX);
    if (!box.placed && !box.falling && dx <= 26) {
      box.attached = true;
      state.r = (box.y - state.pivotY) / CFG.PX_PER_M;
      state.theta = state.omega = 0;
      logEvent(state, '挂钩完成，可以起升');
    } else {
      logEvent(state, '挂钩失败：吊钩未对准货箱');
    }
  }

  function pushHistory(state) {
    state.history.push({
      t: state.time,
      tension: state.tension, speed: state.speed,
      temp: state.temp, pressure: state.pressure,
      theta: state.theta, trolleyX: state.trolleyX
    });
    const maxSamples = Math.round(CFG.historySeconds / CFG.DT);
    if (state.history.length > maxSamples) state.history.shift();
  }

  function stepOnce(state, inp) {
    if (state.status === 'fault' || state.status === 'done') {
      return state; // 故障/完成后立即冻结，停止一切不安全计算
    }
    state.status = 'active';
    state.inputLog.push(encodeInput(inp));
    state.step += 1;
    state.time = state.step * CFG.DT;
    if (state.requestAttach) {
      handleAttach(state);
      state.requestAttach = false;
      if (state.status === 'fault') return state;
    }
    updateActuators(state, inp);
    updateDynamics(state);
    updateThermalPressure(state);
    checkCollisions(state);
    if (state.status === 'fault') return state;
    if (!checkLimits(state)) return state; // 越限：立即停机，停止不安全计算
    if (state.step % 2 === 0) pushHistory(state);
    return state;
  }

  global.CranePhysics = {
    createInitialState, resetState, checksum, encodeInput,
    logEvent, clone, boxCenterFromRope, pivotX, clamp, boxCorners,
    buildTemplate, stepOnce, handleAttach, rectsOverlap,
    solidRects, checkCollisions, CFG
  };
})(typeof window !== 'undefined' ? window : globalThis);
