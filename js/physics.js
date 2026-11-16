/* 磁悬浮小车物理引擎（确定性，固定步长 1 ms，半隐式欧拉）。
 * 所有状态仅来自初始条件与输入序列；无随机数、无 Date.now，
 * 因此暂停/单步/恢复与重复运行得到完全一致的轨迹。 */
(function () {
  const C = window.CONFIG;

  function ring(capacity) {
    return { buf: new Float64Array(capacity), i: 0, n: 0, cap: capacity };
  }
  function ringPush(r, v) {
    r.buf[r.i] = v;
    r.i = (r.i + 1) % r.cap;
    if (r.n < r.cap) r.n++;
  }
  function ringMaxAbs(r) {
    let m = 0;
    for (let k = 0; k < r.n; k++) m = Math.max(m, Math.abs(r.buf[k]));
    return m;
  }
  function ringRms(r) {
    let sum = 0;
    for (let k = 0; k < r.n; k++) sum += r.buf[k] * r.buf[k];
    return Math.sqrt(sum / r.n);
  }

  function createInitial(inputs, track) {
    const m = C.car.m0 + inputs.load;
    const p0 = track.at(0);
    return {
      s: 0,
      v: inputs.v0,
      gap: C.car.gap0,                 // 统一从名义间隙启动，悬浮动态建立
      gapV: 0,
      temp: C.temp.ambient,
      time: 0,
      lap: 0,
      mass: m,
      pos: { x: p0.x, y: p0.y },
      curveId: p0.id,
      curvature: 1 / track.radii[p0.id - 1],
      Fm: 0, Fspring: 0, Fdamp: 0, accelZ: 0,
      pressure: 0,
      B: 0,
      oscRing: ring(Math.round(1 / C.sim.dt)), // 最近 1 s 竖向加速度
      peaks: {
        gap: C.car.gap0, gapMin: C.car.gap0,
        speed: inputs.v0, temp: C.temp.ambient,
        pressure: 0, accelZ: 0
      },
      fault: null
    };
  }

  // 周期性轨道不平顺（仅依赖弧长，保证确定性）
  function irregularity(s) {
    return 0.00015 * Math.sin(2 * Math.PI * s / 7.3)
      + 0.00008 * Math.sin(2 * Math.PI * s / 2.7 + 1.3);
  }

  function forces(st, track, I, c) {
    const g = C.car.gap0;
    const Fm = C.car.kI * I * g / st.gap;
    // 恢复力（沿间隙轴，与位移/速度反向）
    const Fspring = -C.car.kSpring * (st.gap - g);
    const Fdamp = -c * st.gapV;
    const Fg = st.mass * C.car.g;
    const dist = irregularity(st.s);
    // 间隙动力学（间隙增大方向为正）：重力为正，磁吸力/弹簧/阻尼为负
    const accelZ = (Fg - Fm + Fspring + Fdamp - C.car.kSpring * dist)
      / st.mass;
    return { Fm, Fspring, Fdamp, accelZ, dist };
  }

  // 给定质量与电流时的静平衡间隙：在 [g0, 上限] 内二分，
  // 取靠近设计点的工作点根（f 在此区间单调递减）
  function equilibriumGap(m, I) {
    const g0 = C.car.gap0;
    const f = (gap) => m * C.car.g
      - C.car.kI * I * g0 / gap - C.car.kSpring * (gap - g0);
    if (f(g0) <= 0) return g0;                 // 电流过大，工作点压到设计间隙
    let hi = 0.05;
    if (f(hi) > 0) return C.limits.gap.max;   // 电流过小，间隙发散
    let lo = g0;
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function checkLimits(st, track) {
    const L = C.limits;
    const tryFault = (key, value, name, low) => {
      const lim = L[key];
      if (value < lim.min || value > lim.max) {
        return {
          key, name: low ? lim.lowName : lim.highName,
          value, limit: low ? lim.min : lim.max,
          unit: lim.unit, time: st.time,
          s: st.s, lap: st.lap, segment: st.curveId,
          x: st.pos.x, y: st.pos.y
        };
      }
      return null;
    };
    let f;
    if ((f = tryFault('gap', st.gap, null, st.gap < L.gap.min))) return f;
    if ((f = tryFault('speed', st.v, null, st.v < L.speed.min))) return f;
    if ((f = tryFault('temp', st.temp, null, st.temp < L.temp.min))) return f;
    if ((f = tryFault('pressure', st.pressure, null,
      st.pressure < L.pressure.min))) return f;
    const osc = st.time < 2 ? 0 : ringRms(st.oscRing);
    if (osc > L.osc.max) {
      return {
        key: 'osc', name: L.osc.highName, value: osc,
        limit: L.osc.max, unit: L.osc.unit, time: st.time,
        s: st.s, lap: st.lap, segment: st.curveId,
        x: st.pos.x, y: st.pos.y
      };
    }
    return null;
  }

  function step(st, track, I, c) {
    const dt = C.sim.dt;
    const f0 = forces(st, track, I, c);

    // 半隐式欧拉：先更新速度，再用新速度更新位置
    st.gapV += f0.accelZ * dt;
    st.gap += st.gapV * dt;

    // 纵向动力学：电磁直线驱动 − 空气阻力 − 磁滞/涡流阻力
    const drag = 0.5 * C.car.rhoAir * C.car.Cd * C.car.area * st.v * st.v;
    const eddy = C.car.eddyK * st.v;
    const aT = (C.car.driveK * I - drag - eddy) / st.mass;
    st.v += aT * dt;
    st.s += st.v * dt;

    // 圈数检测：按总行驶弧长整除周长（s 不回绕，保证每圈都计数）
    st.lap = Math.floor(st.s / track.length);

    // 温度：焦耳热 − 牛顿冷却
    st.temp += (C.temp.heatK * I * I
      - C.temp.coolK * (st.temp - C.temp.ambient)) * dt;

    // 几何与派生量
    const geo = track.at(st.s);
    st.pos.x = geo.x; st.pos.y = geo.y;
    st.curveId = geo.id;
    st.curvature = 1 / track.radii[geo.id - 1];
    st.Fm = f0.Fm; st.Fspring = f0.Fspring; st.Fdamp = f0.Fdamp;
    st.accelZ = f0.accelZ;
    // 支撑压力：法向载荷（重力 + 向心载荷）作用在等效承压面积上
    const area = 0.08;
    const centripetal = st.mass * st.v * st.v * Math.abs(st.curvature);
    st.pressure = (st.mass * C.car.g + centripetal) / area;
    // 磁场强度（归一化，用于声音与显示）
    st.B = I * C.car.gap0 / st.gap;
    ringPush(st.oscRing, f0.accelZ);

    st.time += dt;

    // 峰值记录
    const pk = st.peaks;
    pk.gap = Math.max(pk.gap, st.gap);
    pk.gapMin = Math.min(pk.gapMin, st.gap);
    pk.speed = Math.max(pk.speed, st.v);
    pk.temp = Math.max(pk.temp, st.temp);
    pk.pressure = Math.max(pk.pressure, st.pressure);
    pk.accelZ = Math.max(pk.accelZ, Math.abs(f0.accelZ));

    st.fault = checkLimits(st, track);
    return st.fault;
  }

  window.Physics = {
    createInitial, step, forces, irregularity, ring, equilibriumGap
  };
})();
