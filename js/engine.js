/*
 * 步进引擎：动力学、干预措施、观测、告警与成败判定
 */
(function (global) {
  'use strict';
  var RT = global.RT;
  if (typeof require === 'function' && typeof RT === 'undefined') RT = require('./model.js');
  var TH = RT.TH;

  function setControl(sim, name, value) {
    if (name !== 'aeration' && name !== 'diversion') return;
    sim.controls[name] = RT.clamp(value, 0, 1);
  }

  function placeBuoy(sim, x, y) {
    if (x < 0 || y < 0 || x >= RT.GRID_W || y >= RT.GRID_H) return false;
    if (sim.buoys.some(function (b) { return b.x === x && b.y === y; })) return false;
    if (sim.buoys.length >= RT.MAX_BOUYS) return false;
    sim.buoys.push({ x: x, y: y });
    RT.logEvent(sim, 'buoy', '监测浮标部署于 (' + (x + 1) + ',' + (y + 1) + ')');
    return true;
  }

  function removeBuoy(sim, x, y) {
    var before = sim.buoys.length;
    sim.buoys = sim.buoys.filter(function (b) { return !(b.x === x && b.y === y); });
    if (sim.buoys.length !== before) {
      RT.logEvent(sim, 'buoy', '浮标撤离 (' + (x + 1) + ',' + (y + 1) + ')');
      return true;
    }
    return false;
  }

  // 浮标覆盖：本格 + 四邻，形成观测网络
  function coverageMap(sim) {
    var cov = new Array(RT.GRID_W * RT.GRID_H).fill(false);
    sim.buoys.forEach(function (b) {
      var dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
      dirs.forEach(function (dd) {
        var nx = b.x + dd[0], ny = b.y + dd[1];
        if (nx >= 0 && ny >= 0 && nx < RT.GRID_W && ny < RT.GRID_H) cov[ny * RT.GRID_W + nx] = true;
      });
    });
    return cov;
  }

  function updateObservations(sim) {
    var cov = coverageMap(sim);
    var noise = sim.rng(); // 每步统一噪声相位，保证可复现
    sim.cells.forEach(function (c, i) {
      c.observed = cov[i];
      if (cov[i]) {
        // 观测值带 ±6% 测量误差，与实际值明确区分
        var e = 1 + (noise - 0.5) * 0.12;
        c.obs = {
          algae: c.algae * e,
          do2: c.do2 * (1 + (sim.rng() - 0.5) * 0.08),
          turb: c.turb * (1 + (sim.rng() - 0.5) * 0.1),
          nutrient: c.nutrient * (1 + (sim.rng() - 0.5) * 0.08),
          age: 0
        };
      } else if (c.obs) {
        c.obs.age += 1; // 未覆盖：旧数据逐渐过期
      }
    });
  }

  function updateAlarms(sim) {
    var newAlarms = 0;
    var missed = 0;
    sim.cells.forEach(function (c) {
      // 告警基于观测值（未观测格无法告警，即“漏掉热点”风险）
      var triggered = false;
      if (c.obs && c.obs.age === 0) {
        if (c.obs.algae >= TH.algae || c.obs.do2 < TH.doLow ||
            c.obs.turb >= TH.turbidity) {
          triggered = true;
        }
      }
      if (triggered && !c.alarm) newAlarms++;
      c.alarm = triggered;
      // 监测缺口：热点不在任何浮标覆盖范围内即构成漏报风险（累计 tick 数）
      if (c.hot && !(c.obs && c.obs.age === 0)) missed++;
    });
    sim.alarmCount += newAlarms;
    sim.missedHotspots = missed;
    sim.missedTicks = (sim.missedTicks || 0) + missed;
    return newAlarms;
  }

  function step(sim, force) {
    if (sim.status !== 'running' && !force) return sim;
    sim.tick += 1;
    RT.refreshWeather(sim);

    // 潮汐：半日潮相位 + 天气雨量影响水位
    sim.tidePhase += (2 * Math.PI) / (RT.TICKS_PER_DAY / 2);
    var tide = Math.sin(sim.tidePhase);
    var rainPush = sim.weather.rain * 0.25;
    sim.waterLevel = RT.clamp(1.6 + 0.5 * tide + rainPush, 0.8, 2.8);

    // 营养盐脉冲（随潮水进入），时刻由 seed 决定
    if (sim.pulses.indexOf(sim.tick) >= 0) {
      sim.activePulses.push(sim.tick);
      RT.logEvent(sim, 'pulse', '涨潮营养盐脉冲入库（营养盐 +0.9 mg/L）');
    }
    var pulseFresh = sim.activePulses.filter(function (t) { return sim.tick - t <= 3; }).length > 0;

    var aer = sim.controls.aeration;
    var div = sim.controls.diversion;

    // 曝气过强（>0.75）扰动底泥：扰动等级平滑变化
    var targetDist = aer > 0.75 ? (aer - 0.75) / 0.25 : 0;
    sim.disturbance += (targetDist - sim.disturbance) * 0.25;

    sim.cells.forEach(function (c) {
      var light = sim.weather.light;
      // ---- 营养盐：潮汐脉冲 / 雨水 / 底泥释放进入，藻类吸收与引水稀释输出 ----
      var nIn = 0.012;
      if (pulseFresh) nIn += 0.3 * (0.7 + 0.3 * (1 - c.x / RT.GRID_W)); // 上游侧更浓
      if (sim.weather.rain > 0) nIn += 0.03 * sim.weather.rain;
      nIn += 0.09 * sim.disturbance; // 曝气过强：底泥营养盐释放
      nIn -= div * 0.05;             // 引水稀释
      c.nutrient = RT.clamp(c.nutrient + nIn - c.algae * 0.0025, 0.05, 6);

      // ---- 藻类：光照×营养盐限制的指数增长，引水冲刷与曝气形成死亡率 ----
      var nLim = c.nutrient / (c.nutrient + 0.8);
      var rGrow = 0.016 * light * nLim;
      var flushing = div * 0.012;
      var aerSupp = aer * 0.006;
      c.algae = RT.clamp(c.algae + c.algae * (rGrow - flushing - aerSupp) + 0.004, 0.1, 60);

      // ---- 溶氧：向饱和浓度回归（曝气加速复氧），藻呼吸与底泥耗氧构成需求 ----
      var saturation = 8.1 + light * 0.7; // 光合提饱和，上限约 8.8
      var kReaer = 0.015 + aer * 0.05;
      var oxygenDemand = 0.018 + c.algae * 0.0035 + sim.disturbance * 0.32;
      c.do2 = RT.clamp(c.do2 + kReaer * (saturation - c.do2) - oxygenDemand, 0.5, 14);

      // ---- 浊度：底泥扰动升高，引水冲刷与自然沉降降低 ----
      c.turb = RT.clamp(c.turb + sim.disturbance * 1.6 - div * 0.08 - 0.02, 1, 120);

      // ---- 鱼类：溶氧过低死亡（不可逆）；高浊度增加胁迫 ----
      if (c.do2 < TH.doLow) {
        var stress = (TH.doLow - c.do2) / TH.doLow + Math.max(0, c.turb - TH.turbidity) / 200;
        c.fish = RT.clamp(c.fish - 0.02 * (1 + stress * 4), 0, 1);
      }
    });

    updateObservations(sim);
    var newAlarms = updateAlarms(sim);
    if (newAlarms > 0) {
      RT.logEvent(sim, 'alarm', newAlarms + ' 个网格触发告警（藻密度/溶氧/浊度越限）');
    }

    var agg = RT.aggregate(sim);
    sim.stats.peakAlgae = Math.max(sim.stats.peakAlgae, agg.avgAlgae);
    sim.stats.minDo = Math.min(sim.stats.minDo, agg.avgDo);
    sim.stats.maxTurb = Math.max(sim.stats.maxTurb, agg.avgTurb);
    sim.stats.fishLost = 1 - agg.avgFish;

    // 临界事件记录：热点实际藻密度首次越限
    if (agg.hotspotAlgae >= TH.algae && !sim._criticalLogged) {
      sim._criticalLogged = true;
      RT.logEvent(sim, 'critical', '临界事件：热点实测藻密度 ' +
        agg.hotspotAlgae.toFixed(1) + ' ≥ 阈值 ' + TH.algae + ' µg/L @ ' + RT.simTimeLabel(sim.tick));
    }

    if (!force) evaluateEnd(sim, agg);
    RT.snapshot(sim);
    return sim;
  }

  function evaluateEnd(sim, agg) {
    // 处置失败：四天内鱼类存活率跌破底线，或热点持续失控
    if (agg.avgFish < TH.fishSurvival) {
      sim.status = 'failed';
      sim.endReason = '处置失败：鱼类存活率 ' + (agg.avgFish * 100).toFixed(0) +
        '% 低于达标线 ' + (TH.fishSurvival * 100) + '%';
      RT.logEvent(sim, 'fail', sim.endReason + ' @ ' + RT.simTimeLabel(sim.tick));
      return;
    }
    if (sim.tick >= RT.DURATION_TICKS) {
      var hotOk = sim.hotspots.every(function (h) {
        return RT.cellAt(sim, h.x, h.y).algae < TH.algae;
      });
      var doOk = agg.avgDo >= TH.doLow && agg.avgDo <= TH.doHigh;
      if (hotOk && doOk && agg.avgFish >= TH.fishSurvival) {
        sim.status = 'success';
        sim.endReason = '四天达标：藻密度与溶氧受控，鱼群保住';
        sim.recoveryTick = sim.tick;
        RT.logEvent(sim, 'success', sim.endReason + ' @ ' + RT.simTimeLabel(sim.tick));
      } else {
        sim.status = 'failed';
        sim.endReason = '处置失败：四天到期未达标（热点藻密度或溶氧越限）';
        RT.logEvent(sim, 'fail', sim.endReason + ' @ ' + RT.simTimeLabel(sim.tick));
      }
    }
  }

  // 恢复后固定继续运行 POST_RUN_TICKS，检查隐藏残留（藻华反弹/溶氧回落）
  function postRecoveryRun(sim) {
    if (sim.status !== 'success') return sim;
    var startAlgae = RT.aggregate(sim).avgAlgae;
    var startHot = RT.aggregate(sim).hotspotAlgae;
    while (sim.postTicks < RT.POST_RUN_TICKS && sim.status === 'success') {
      sim.postTicks += 1;
      step(sim, true);
      var agg = RT.aggregate(sim);
      var rebound = agg.avgAlgae > startAlgae * 1.6 || agg.hotspotAlgae > startHot * 1.6;
      if (agg.hotspotAlgae >= TH.algae || agg.avgDo < TH.doLow ||
          agg.avgFish < TH.fishSurvival || rebound) {
        sim.status = 'failed';
        sim.endReason = '恢复后残留反弹：放松干预后藻密度回升超 60% 或指标再次越限';
        RT.logEvent(sim, 'fail', sim.endReason + ' @ 恢复观察 ' + RT.simTimeLabel(sim.tick));
        break;
      }
    }
    if (sim.status === 'success') {
      sim.endReason += '；恢复观察 24h 无隐藏残留（藻密度 ' +
        RT.aggregate(sim).avgAlgae.toFixed(2) + '，起步 ' + startAlgae.toFixed(2) +
        '，全程峰值 ' + sim.stats.peakAlgae.toFixed(2) + '）';
      RT.logEvent(sim, 'recovery', '恢复观察期结束，无残留反弹');
    }
    return sim;
  }

  RT.setControl = setControl;
  RT.placeBuoy = placeBuoy;
  RT.removeBuoy = removeBuoy;
  RT.coverageMap = coverageMap;
  RT.step = step;
  RT.postRecoveryRun = postRecoveryRun;

  if (typeof module !== 'undefined' && module.exports) module.exports = RT;
})(typeof window !== 'undefined' ? window : globalThis);
