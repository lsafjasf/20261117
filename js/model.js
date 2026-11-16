/*
 * 河口赤潮处置模拟引擎（纯逻辑，无 DOM 依赖）
 * 时间步长 TICK_MIN = 10 分钟；场景 4 天 = 576 步。
 * 同一 seed 下：目标（热点）位置、天气序列、营养盐脉冲完全可复现。
 */
(function (global) {
  'use strict';

  var TICK_MIN = 10;
  var TICKS_PER_DAY = (24 * 60) / TICK_MIN; // 144
  var DURATION_TICKS = 4 * TICKS_PER_DAY;   // 576
  var POST_RUN_TICKS = 24 * (60 / TICK_MIN); // 恢复后固定再运行 24h = 144 步
  var GRID_W = 16;
  var GRID_H = 10;

  // 临界阈值（统一在引擎中定义，UI 与测试共用）
  var TH = {
    algae: 15.0,      // 藻密度（µg Chl-a / L）临界阈值
    doLow: 5.0,       // 溶氧下限 mg/L
    doHigh: 9.0,      // 溶氧上限（超饱和，曝气过强）
    turbidity: 30.0,  // 浊度 NTU，底泥扰动阈值
    nutrient: 2.0,    // 营养盐 mg/L
    fishSurvival: 0.75 // 鱼类存活率达标线
  };

  var MAX_BOUYS = 6;

  // ---------- 确定性随机数（mulberry32） ----------
  function RNG(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(seedStr) {
    var h = 2166136261 >>> 0;
    var s = String(seedStr);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // ---------- 工厂 ----------
  function createSim(seed) {
    var rng = RNG(hashSeed(seed));
    var cells = [];
    var x, y, c;
    for (y = 0; y < GRID_H; y++) {
      for (x = 0; x < GRID_W; x++) {
        c = {
          x: x, y: y,
          algae: 2.0 + rng() * 1.5,
          nutrient: 0.45 + rng() * 0.25,
          do2: 7.5 + rng() * 0.8,
          turb: 4.0 + rng() * 2.0,
          fish: 1.0,                 // 1 = 满鱼群，0 = 死亡
          observed: false,
          obs: null,                 // 观测快照 {algae, do2, turb, nutrient, age}
          hot: false,                // 是否为热点目标
          alarm: false               // 该格当前告警
        };
        cells.push(c);
      }
    }

    // 复现的热点目标：3 个，左半区（河口上游来水方向）
    var hotspots = [];
    var used = {};
    while (hotspots.length < 3) {
      x = Math.floor(rng() * (GRID_W / 2));
      y = Math.floor(rng() * GRID_H);
      var key = x + ',' + y;
      if (used[key]) continue;
      used[key] = 1;
      hotspots.push({ x: x, y: y });
      var cell = cells[y * GRID_W + x];
      cell.hot = true;
      cell.algae = 10.5 + rng() * 2.0; // 热点初始藻密度已接近临界
      cell.nutrient = 1.2 + rng() * 0.4;
    }

    // 复现的天气序列（4 天，每日 4 个 6h 时段）
    var weatherSeq = [];
    var kinds = ['sunny', 'cloudy', 'overcast', 'rain'];
    for (var i = 0; i < 16; i++) {
      weatherSeq.push({
        kind: kinds[Math.floor(rng() * kinds.length)],
        light: 0,
        rain: 0
      });
    }

    // 复现的营养盐潮汐脉冲时刻（步），每日 2 次涨潮
    var pulses = [];
    for (var d = 0; d < 4; d++) {
      pulses.push(d * TICKS_PER_DAY + 12 + Math.floor(rng() * 10));
      pulses.push(d * TICKS_PER_DAY + 80 + Math.floor(rng() * 10));
    }

    var sim = {
      seed: String(seed),
      rng: rng,
      tick: 0,
      cells: cells,
      hotspots: hotspots,
      weatherSeq: weatherSeq,
      pulses: pulses,
      activePulses: [],
      buoys: [],                 // {x,y}
      controls: { aeration: 0.3, diversion: 0.2 },
      waterLevel: 1.6,           // 水位 m
      tidePhase: 0,
      weather: weatherSeq[0],
      events: [],                // {tick, simTime, wallTime, type, msg}
      alarmCount: 0,
      missedHotspots: 0,
      disturbance: 0,            // 底泥扰动等级 0..1
      status: 'running',         // running | success | failed
      endReason: '',
      postTicks: 0,
      recoveryTick: -1,
      history: [],               // 每步全局均值快照
      stats: {
        peakAlgae: 0,
        minDo: 20,
        fishLost: 0,
        maxTurb: 0
      }
    };
    refreshWeather(sim);
    snapshot(sim);
    return sim;
  }

  function idx(x, y) { return y * GRID_W + x; }
  function cellAt(sim, x, y) { return sim.cells[idx(x, y)]; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function refreshWeather(sim) {
    var slot = Math.min(15, Math.floor(sim.tick / (TICKS_PER_DAY / 4)));
    var w = sim.weatherSeq[slot];
    sim.weather = w;
    if (w.kind === 'sunny') { w.light = 1.0; w.rain = 0; }
    else if (w.kind === 'cloudy') { w.light = 0.7; w.rain = 0; }
    else if (w.kind === 'overcast') { w.light = 0.45; w.rain = 0.1; }
    else { w.light = 0.3; w.rain = 1.0; }
  }

  function simTimeLabel(tick) {
    var totalMin = tick * TICK_MIN;
    var day = Math.floor(totalMin / 1440) + 1;
    var hh = Math.floor((totalMin % 1440) / 60);
    var mm = totalMin % 60;
    return 'D' + day + ' ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function logEvent(sim, type, msg) {
    sim.events.push({
      tick: sim.tick,
      simTime: simTimeLabel(sim.tick),
      wallTime: new Date().toISOString(),
      type: type,
      msg: msg
    });
    if (sim.events.length > 400) sim.events.shift();
  }

  function snapshot(sim) {
    var s = aggregate(sim);
    sim.history.push({
      tick: sim.tick,
      algae: s.avgAlgae,
      do2: s.avgDo,
      turb: s.avgTurb,
      nutrient: s.avgNutrient,
      fish: s.avgFish,
      level: sim.waterLevel
    });
    if (sim.history.length > 700) sim.history.shift();
  }

  function aggregate(sim) {
    var a = 0, d = 0, t = 0, n = 0, f = 0, hotA = 0;
    for (var i = 0; i < sim.cells.length; i++) {
      var c = sim.cells[i];
      a += c.algae; d += c.do2; t += c.turb; n += c.nutrient; f += c.fish;
      if (c.hot) hotA += c.algae;
    }
    var k = sim.cells.length;
    return {
      avgAlgae: a / k,
      avgDo: d / k,
      avgTurb: t / k,
      avgNutrient: n / k,
      avgFish: f / k,
      hotspotAlgae: hotA / sim.hotspots.length
    };
  }

  global.RT = {
    TICK_MIN: TICK_MIN,
    TICKS_PER_DAY: TICKS_PER_DAY,
    DURATION_TICKS: DURATION_TICKS,
    POST_RUN_TICKS: POST_RUN_TICKS,
    GRID_W: GRID_W,
    GRID_H: GRID_H,
    TH: TH,
    MAX_BOUYS: MAX_BOUYS,
    RNG: RNG,
    hashSeed: hashSeed,
    createSim: createSim,
    cellAt: cellAt,
    clamp: clamp,
    simTimeLabel: simTimeLabel,
    logEvent: logEvent,
    refreshWeather: refreshWeather,
    aggregate: aggregate,
    snapshot: snapshot
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.RT;
})(typeof window !== 'undefined' ? window : globalThis);
