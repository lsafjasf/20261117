/*
 * 三热源-热管-散热器 集中参数热网络模拟核心。
 * 纯确定性：固定步长 dt，无随机数、无 wall-clock 依赖。
 * 浏览器与 Node 均可加载（Node 用于确定性/重置回归验证）。
 */
(function (global) {
  "use strict";

  // ---- 物理常量（重置后严格恢复，绝不漂移）----
  var PHYS = {
    dt: 0.1,            // 物理步长 s
    duration: 600,      // 目标时长 s（10 分钟）
    tAmb: 25,           // 环境温度 °C
    tInit: 30,          // 初始温度 °C
    cSrc: 40,           // 单块热源热容 J/K
    cSink: 400,         // 散热器热容 J/K
    gPipe: 5,           // 单根热管导热 W/K
    gAdj: 1.5,          // 相邻热源间导热 W/K（过载传热通道）
    fanH0: 2,           // 自然对流 W/K
    fanH1: 14,          // 风冷增益系数 W/K
    fanExp: 0.7,        // 风量-换热指数
    fanPmax: 30,        // 风扇满转功耗 W
    pRef: 0.101,        // 热管参考压力 MPa（25°C 饱和）
    tRefK: 298.15
  };

  // ---- 安全边界（越限即触发并停止计算）----
  var LIMITS = {
    T_SOURCE_MAX: 95,     // °C 单块热源
    T_SINK_MAX: 80,       // °C 散热器
    P_PIPE_MAX: 0.35,     // MPa 热管内部压力
    ENERGY_MAX: 12000,    // J 风扇电量预算（10 分钟）
    FAN_MIN: 0, FAN_MAX: 1,
    PAD_MIN: 1, PAD_MAX: 10,    // W/K
    LOAD_MIN: 0, LOAD_MAX: 100  // 权重
  };

  // 确定性总负载曲线（仅依赖 t，分段工况）
  function loadProfile(t) {
    if (t < 120) return 120;
    if (t < 300) return 180;
    if (t < 420) return 260; // 高峰冲击
    if (t < 600) return 160;
    return 0;
  }

  // 热管饱和压力近似（MPa），随蒸汽温度陡升
  function pipePressure(tVaporC) {
    var r = (tVaporC + 273.15) / PHYS.tRefK;
    return PHYS.pRef * Math.pow(r, 8);
  }

  function clampInputs(inp) {
    return {
      fan: Math.min(LIMITS.FAN_MAX, Math.max(LIMITS.FAN_MIN, inp.fan)),
      pads: inp.pads.map(function (g) {
        return Math.min(LIMITS.PAD_MAX, Math.max(LIMITS.PAD_MIN, g));
      }),
      weights: inp.weights.map(function (w) {
        return Math.min(LIMITS.LOAD_MAX, Math.max(LIMITS.LOAD_MIN, w));
      })
    };
  }

  function defaultInputs() {
    return { fan: 0.5, pads: [5, 5, 5], weights: [33, 33, 34] };
  }

  // 全新初始状态；重复调用返回完全一致的对象
  function createState() {
    return {
      t: 0,
      step: 0,
      temp: [PHYS.tInit, PHYS.tInit, PHYS.tInit],
      tSink: PHYS.tInit,
      energy: 0,
      inputs: defaultInputs(),
      failed: null,   // {type, component, time, value, limit}
      won: false,
      finished: false,
      flows: { pad: [0, 0, 0], adj: [0, 0], fan: 0 },
      pressures: [PHYS.pRef, PHYS.pRef, PHYS.pRef],
      pTotal: 0,
      loads: [0, 0, 0],
      peaks: { temp: [PHYS.tInit, PHYS.tInit, PHYS.tInit], tSink: PHYS.tInit, pressure: PHYS.pRef },
      hist: { t: [], temp: [[], [], []], tSink: [], pressure: [], energy: [], load: [],
        fan: [], qPad: [[], [], []], qAdj: [[], []], qFan: [], loads: [[], [], []] }
    };
  }

  function fail(state, type, component, value, limit) {
    if (state.failed) return; // 只记录首次越限
    state.failed = { type: type, component: component, time: state.t, value: value, limit: limit };
    state.finished = true; // 停止不安全的后续计算
  }

  // 推进一个固定步长；输入在步首快照，保证暂停/单步/连续结果一致
  function step(state, rawInputs) {
    if (state.finished) return state;
    var inp = clampInputs(rawInputs || state.inputs);
    state.inputs = inp;

    var dt = PHYS.dt;
    var T = state.temp, Ts = state.tSink;

    // 负载分配
    var wSum = inp.weights[0] + inp.weights[1] + inp.weights[2];
    var pTot = loadProfile(state.t);
    var loads = [0, 0, 0];
    if (wSum > 0 && pTot > 0) {
      for (var i = 0; i < 3; i++) loads[i] = pTot * inp.weights[i] / wSum;
    }

    // 热路：热源--导热片--热管--散热器（片与管串联）
    var gEff = [0, 0, 0], qPad = [0, 0, 0];
    for (i = 0; i < 3; i++) {
      gEff[i] = 1 / (1 / inp.pads[i] + 1 / PHYS.gPipe);
      qPad[i] = gEff[i] * (T[i] - Ts);
    }
    // 相邻传热（过载扩散）
    var qAdj = [PHYS.gAdj * (T[0] - T[1]), PHYS.gAdj * (T[1] - T[2])];
    // 风扇散热与耗电
    var h = PHYS.fanH0 + PHYS.fanH1 * Math.pow(inp.fan, PHYS.fanExp);
    var qFan = h * (Ts - PHYS.tAmb);
    var pFan = PHYS.fanPmax * Math.pow(inp.fan, 3);

    // 显式欧拉积分（固定 dt → 完全可复现）
    var nT = [0, 0, 0];
    nT[0] = T[0] + dt * (loads[0] - qPad[0] - qAdj[0]) / PHYS.cSrc;
    nT[1] = T[1] + dt * (loads[1] - qPad[1] + qAdj[0] - qAdj[1]) / PHYS.cSrc;
    nT[2] = T[2] + dt * (loads[2] - qPad[2] + qAdj[1]) / PHYS.cSrc;
    var nTs = Ts + dt * (qPad[0] + qPad[1] + qPad[2] - qFan) / PHYS.cSink;

    state.temp = nT;
    state.tSink = nTs;
    state.energy += pFan * dt;
    state.t += dt;
    state.step += 1;
    state.loads = loads;
    state.pTotal = pTot;
    state.flows = { pad: qPad, adj: qAdj, fan: qFan };

    // 热管压力（取热源/散热器均温为蒸汽温度）
    for (i = 0; i < 3; i++) {
      state.pressures[i] = pipePressure((nT[i] + nTs) / 2);
    }

    // 峰值统计
    for (i = 0; i < 3; i++) {
      if (nT[i] > state.peaks.temp[i]) state.peaks.temp[i] = nT[i];
    }
    if (nTs > state.peaks.tSink) state.peaks.tSink = nTs;
    var pMax = Math.max(state.pressures[0], state.pressures[1], state.pressures[2]);
    if (pMax > state.peaks.pressure) state.peaks.pressure = pMax;

    // 历史记录（回放数据源）
    state.hist.t.push(state.t);
    for (i = 0; i < 3; i++) state.hist.temp[i].push(nT[i]);
    state.hist.tSink.push(nTs);
    state.hist.pressure.push(pMax);
    state.hist.energy.push(state.energy);
    state.hist.load.push(pTot);
    state.hist.fan.push(inp.fan);
    for (i = 0; i < 3; i++) state.hist.qPad[i].push(qPad[i]);
    state.hist.qAdj[0].push(qAdj[0]);
    state.hist.qAdj[1].push(qAdj[1]);
    state.hist.qFan.push(qFan);
    for (i = 0; i < 3; i++) state.hist.loads[i].push(loads[i]);

    // ---- 越限检查：记录首个触发点并停机 ----
    for (i = 0; i < 3; i++) {
      if (nT[i] > LIMITS.T_SOURCE_MAX) {
        fail(state, "温度越限", "热源" + (i + 1), nT[i], LIMITS.T_SOURCE_MAX);
      }
    }
    if (nTs > LIMITS.T_SINK_MAX) {
      fail(state, "温度越限", "散热器", nTs, LIMITS.T_SINK_MAX);
    }
    for (i = 0; i < 3; i++) {
      if (state.pressures[i] > LIMITS.P_PIPE_MAX) {
        fail(state, "压力越限", "热管" + (i + 1), state.pressures[i], LIMITS.P_PIPE_MAX);
      }
    }
    if (state.energy > LIMITS.ENERGY_MAX) {
      fail(state, "电量超支", "风扇", state.energy, LIMITS.ENERGY_MAX);
    }

    if (!state.failed && state.t >= PHYS.duration - 1e-9) {
      state.won = true;
      state.finished = true;
    }
    return state;
  }

  var API = {
    PHYS: PHYS,
    LIMITS: LIMITS,
    loadProfile: loadProfile,
    pipePressure: pipePressure,
    createState: createState,
    defaultInputs: defaultInputs,
    step: step
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.SIM = API;
})(typeof window !== "undefined" ? window : globalThis);
