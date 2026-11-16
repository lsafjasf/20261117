/* 三风机偏航/桨距/电缆扭转仿真引擎
 * 确定性：固定步长 1s，所有随机性来自种子 PRNG。
 * 暂停/单步/恢复均调用同一 step()，结果一致；重置即按原种子重建。
 */
(function (global) {
  "use strict";

  var DT = 1;                 // 积分步长 (s)
  var TOTAL_TIME = 8 * 3600;  // 8 小时

  // 物理限值（超出即判定故障并停止不安全计算）
  var LIMITS = {
    rotorRpm:   { min: 0,    max: 24,   unit: "rpm",  name: "转速" },
    power:      { min: 0,    max: 2.75, unit: "MW",   name: "负载(功率)" },
    temp:       { min: -20,  max: 95,   unit: "°C",   name: "齿轮箱温度" },
    pressure:   { min: 90,   max: 200,  unit: "bar",  name: "液压压力" },
    cableTwist: { min: -720, max: 720,  unit: "°",    name: "电缆扭转" }
  };

  var RATED_POWER = 2.5;      // MW
  var RATED_RPM = 18;         // rpm
  var ROTOR_RADIUS = 45;      // m
  var RHO = 1.225;            // kg/m^3
  var AREA = Math.PI * ROTOR_RADIUS * ROTOR_RADIUS;

  var YAW_RATE = 0.5;         // °/s
  var YAW_DEADBAND = 8;       // °
  var YAW_PERSIST = 20;       // s，持续偏差超过该时间才偏航（减少磨损）
  var UNTWIST_ENTER = 540;    // °，电缆扭转达到该值且条件允许时自动解缆
  var PITCH_RATE = 2.0;       // °/s

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function wrap180(deg) {
    var d = ((deg % 360) + 360) % 360;
    return d > 180 ? d - 360 : d;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function makeTurbine(id, x, y, rand) {
    return {
      id: id, x: x, y: y,
      yawAngle: 90,          // 机舱朝向（度，可累计超 360 以追踪扭转）
      cableTwist: 0,         // 相对初始位置的累计扭转（度）
      yawMoving: 0,          // -1/0/+1
      misalignTimer: 0,
      untwisting: false,
      pitch: 0,              // 桨距角（度）
      rotorRpm: 0,
      power: 0,              // MW
      temp: 32,              // 齿轮箱温度 °C
      pressure: 160,         // 液压压力 bar
      turbV: 0,              // 局部风速湍流扰动
      turbDir: 0,            // 局部风向扰动
      localV: 8,             // 机位处实际风速
      localDir: 90,          // 机位处实际风向
      yawCount: 0,           // 偏航启动次数（磨损指标）
      faulted: false,
      rand: rand             // 每台风机独立噪声流，保证确定性
    };
  }

  function createSim(seed) {
    var rand = mulberry32(seed);
    var sim = {
      seed: seed,
      t: 0,
      stepCount: 0,
      windDir: 90 + rand() * 40 - 20,   // 初始风向（来流方向，度）
      windSpeed: 8 + rand() * 3,
      dirDrift: 0,
      gustTimer: 0,
      gustActive: 0,
      rand: rand,
      turbines: [
        makeTurbine(0, 160, 150, mulberry32(seed * 7 + 1)),
        makeTurbine(1, 320, 300, mulberry32(seed * 7 + 2)),
        makeTurbine(2, 480, 180, mulberry32(seed * 7 + 3))
      ],
      fault: null,           // {turbineId, variable, value, limit, time}
      done: false,
      history: [],           // 每步快照（供回放/趋势）
      peaks: null
    };
    sim.peaks = makePeaks();
    recordHistory(sim);
    return sim;
  }

  function makePeaks() {
    var keys = ["rotorRpm", "power", "temp", "pressure", "cableTwist"];
    var p = {};
    for (var i = 0; i < 3; i++) {
      p[i] = {};
      for (var k = 0; k < keys.length; k++) {
        p[i][keys[k]] = { max: -Infinity, min: Infinity, tMax: 0, tMin: 0 };
      }
    }
    return p;
  }

  // ---- 风模型：缓慢漂移 + 阵发性快速转向事件（OU 过程，种子确定）----
  function updateWind(sim) {
    var r = sim.rand;
    sim.dirDrift += (0 - sim.dirDrift) * 0.002 * DT + (r() - 0.5) * 0.35;
    sim.dirDrift = clamp(sim.dirDrift, -0.6, 0.6);
    sim.windDir += sim.dirDrift * DT;
    // 主导风向均值回归（防止风向无界随机游走）
    sim.windDir += (90 - sim.windDir) * 0.0006 * DT;

    sim.gustTimer -= DT;
    if (sim.gustTimer <= 0) {
      if (sim.gustActive > 0) {
        sim.gustActive = 0;
        sim.gustTimer = 300 + r() * 900;      // 平静期 5~20 分钟
      } else {
        sim.gustActive = 60 + r() * 120;      // 阵风期 1~3 分钟
        sim.gustDir = (r() - 0.5) * 3.2;      // 快速风向变化速率 °/s
        sim.gustTimer = sim.gustActive;
      }
    }
    if (sim.gustActive > 0) {
      sim.windDir += sim.gustDir * DT;
      sim.windSpeed += (r() - 0.35) * 0.5;
    }
    sim.windSpeed += (9 - sim.windSpeed) * 0.004 * DT + (r() - 0.5) * 0.22;
    sim.windSpeed = clamp(sim.windSpeed, 1.5, 24);
  }

  // ---- 偏航控制：死区 + 持续计时（减少磨损），电缆超限时自动解缆 ----
  function updateYaw(sim, tb) {
    // 局部湍流扰动（每台风机独立噪声流，确定性）
    tb.turbV += (0 - tb.turbV) * 0.01 * DT + (tb.rand() - 0.5) * 0.3;
    tb.turbDir += (0 - tb.turbDir) * 0.01 * DT + (tb.rand() - 0.5) * 0.9;
    tb.turbV = clamp(tb.turbV, -2.5, 2.5);
    tb.turbDir = clamp(tb.turbDir, -8, 8);
    tb.localV = clamp(sim.windSpeed + tb.turbV, 1, 26);
    tb.localDir = sim.windDir + tb.turbDir;

    var mis = wrap180(tb.localDir - tb.yawAngle);
    var want = 0;

    if (tb.untwisting) {
      // 解缆：向扭转减小的方向转，直到 |twist| < 30°
      want = tb.cableTwist > 0 ? -1 : 1;
      if (Math.abs(tb.cableTwist) < 30) { tb.untwisting = false; want = 0; }
    } else if (Math.abs(tb.cableTwist) > UNTWIST_ENTER && tb.localV < 8) {
      tb.untwisting = true;
    } else if (Math.abs(mis) > YAW_DEADBAND) {
      tb.misalignTimer += DT;
      if (tb.misalignTimer >= YAW_PERSIST) want = mis > 0 ? 1 : -1;
    } else {
      tb.misalignTimer = 0;
    }

    if (want !== 0 && tb.yawMoving === 0) tb.yawCount++;   // 记录一次偏航启动
    tb.yawMoving = want;

    var dYaw = want * YAW_RATE * DT;
    // 到位即停，避免过冲
    if (want !== 0 && !tb.untwisting && Math.abs(mis) < Math.abs(dYaw)) {
      dYaw = mis;
    }
    tb.yawAngle += dYaw;
    tb.cableTwist += dYaw;

    // 对准良好且电缆有扭转时，缓慢 opportunistic 解缆（避免长期累积）
    if (want === 0 && !tb.untwisting &&
        Math.abs(tb.cableTwist) > 120 && Math.abs(mis) < YAW_DEADBAND * 0.6) {
      var dU = (tb.cableTwist > 0 ? -1 : 1) * 0.15 * DT;
      tb.yawAngle += dU;
      tb.cableTwist += dU;
    }
  }

  // ---- 桨距控制：限功率/限转速 ----
  function updatePitch(sim, tb) {
    // 前馈：风速超过额定风速(~10.5m/s)后按比例顺桨
    var target = clamp((tb.localV - 10.5) * 5.5, 0, 85);
    var overpower = tb.power - RATED_POWER;
    var overspeed = tb.rotorRpm - RATED_RPM;
    if (overpower > 0 || overspeed > 0) {
      var demand = Math.max(overpower * 8, overspeed * 1.5);
      target = clamp(Math.max(target, tb.pitch) + demand, 0, 85);
    }
    // 超功率时提高变桨速率以快速限载
    var rate = tb.power > RATED_POWER * 1.02 ? PITCH_RATE * 2.5 : PITCH_RATE;
    var d = clamp(target - tb.pitch, -rate * DT, rate * DT);
    tb.pitch += d;
    // 液压系统：变桨耗压，泵缓慢恢复
    tb.pressure -= Math.abs(d) * 0.35;
    tb.pressure += (160 - tb.pressure) * 0.08 * DT;
    tb.pressure = clamp(tb.pressure, 0, 200);
  }

  // ---- 气动与热模型 ----
  function updateAero(sim, tb) {
    var mis = wrap180(tb.localDir - tb.yawAngle);
    var cosLoss = Math.pow(Math.max(Math.cos(mis * Math.PI / 180), 0), 2);
    var cp = 0.42 * Math.max(1 - tb.pitch / 45, 0.03);
    var pAero = 0.5 * RHO * AREA * cp * Math.pow(tb.localV, 3) * cosLoss / 1e6;
    tb.power = clamp(pAero, 0, 3.0);

    // 转速一阶惯性响应，目标转速随风速与桨距变化
    var rpmTarget = clamp(tb.localV * 1.9 * (1 - tb.pitch / 90) * Math.sqrt(cosLoss), 0, 28);
    tb.rotorRpm += (rpmTarget - tb.rotorRpm) * 0.08 * DT;

    // 齿轮箱热模型：负载生热，风冷散热
    var heat = tb.power * 6.5;
    var cool = (tb.temp - 20) * (0.05 + tb.localV * 0.01);
    tb.temp += (heat - cool) * 0.02 * DT;
  }

  // ---- 限值检查：首次越限即记录并停止不安全计算 ----
  function checkLimits(sim, tb) {
    if (sim.fault) return;
    var keys = ["rotorRpm", "power", "temp", "pressure", "cableTwist"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = tb[k];
      var L = LIMITS[k];
      if (v > L.max || v < L.min) {
        sim.fault = {
          turbineId: tb.id,
          variable: k,
          name: L.name,
          value: v,
          limit: v > L.max ? L.max : L.min,
          time: sim.t
        };
        tb.faulted = true;
        return;
      }
    }
  }

  function updatePeaks(sim, tb) {
    var p = sim.peaks[tb.id];
    var keys = ["rotorRpm", "power", "temp", "pressure", "cableTwist"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = tb[k];
      if (v > p[k].max) { p[k].max = v; p[k].tMax = sim.t; }
      if (v < p[k].min) { p[k].min = v; p[k].tMin = sim.t; }
    }
  }

  function recordHistory(sim) {
    var snap = { t: sim.t, windDir: sim.windDir, windSpeed: sim.windSpeed, tb: [] };
    for (var i = 0; i < 3; i++) {
      var tb = sim.turbines[i];
      snap.tb.push({
        yaw: tb.yawAngle, twist: tb.cableTwist, pitch: tb.pitch,
        rpm: tb.rotorRpm, power: tb.power, temp: tb.temp,
        pressure: tb.pressure, yawCount: tb.yawCount
      });
    }
    sim.history.push(snap);
  }

  // 单步推进：暂停/单步/恢复共用此函数，保证物理结果一致
  function step(sim) {
    if (sim.done || sim.fault) return;
    updateWind(sim);
    for (var i = 0; i < 3; i++) {
      var tb = sim.turbines[i];
      updateYaw(sim, tb);
      updatePitch(sim, tb);
      updateAero(sim, tb);
      updatePeaks(sim, tb);
      checkLimits(sim, tb);
    }
    sim.t += DT;
    sim.stepCount++;
    recordHistory(sim);
    if (sim.t >= TOTAL_TIME && !sim.fault) sim.done = true;
  }

  var API = {
    DT: DT, TOTAL_TIME: TOTAL_TIME, LIMITS: LIMITS,
    RATED_POWER: RATED_POWER, RATED_RPM: RATED_RPM,
    createSim: createSim, step: step, wrap180: wrap180
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.WindSim = API;
})(typeof window !== "undefined" ? window : this);
