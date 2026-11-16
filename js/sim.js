/* 湿地模拟内核：完全确定性，同 seed 重置后天气/位点/噪声序列一致 */
(function (root) {
  'use strict';

  const U = root.WetlandUtil || require('./util.js');
  const CFG = U.CFG;

  function gaussian(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function WetlandSim(seedText, options) {
    options = options || {};
    this.seedText = String(seedText || 'WETLAND-2026');
    this.seedInt = U.hashSeed(this.seedText);
    this.mode = options.mode || 'validation';
    this._resetRng();
    this._generateWeather();
    this._generateSites();
    this.resetState();
  }

  WetlandSim.prototype._resetRng = function () {
    this.rng = {
      weather: U.subRng(this.seedInt, 'weather-stream'),
      sensor: U.subRng(this.seedInt, 'sensor-noise'),
      site: U.subRng(this.seedInt, 'bird-sites'),
      move: U.subRng(this.seedInt, 'bird-movement'),
      event: U.subRng(this.seedInt, 'stochastic-events'),
    };
  };

  // 预生成全年 8640 小时天气，只依赖 seed 的 weather 子流
  WetlandSim.prototype._generateWeather = function () {
    const rng = this.rng.weather;
    const weather = new Array(CFG.HOURS_PER_YEAR);
    for (let day = 0; day < CFG.DAYS_PER_YEAR; day++) {
      const phase = (day - 105) / CFG.DAYS_PER_YEAR;
      const baseTemp = 16 + 12 * Math.sin(2 * Math.PI * phase);
      const rainy = rng() < 0.3;
      const rainDaily = rainy ? 2 + rng() * 14 : rng() * 0.6;
      const cloud = rainy ? 0.6 + 0.4 * rng() : 0.08 + 0.42 * rng();
      const wind = 0.8 + rng() * 4.2;
      const tempDay = baseTemp + (rng() - 0.5) * 4;
      for (let h = 0; h < 24; h++) {
        const solar = Math.max(0, Math.sin((Math.PI * h) / 24));
        const hourlyRain = (rainDaily / 24) * (0.6 + 0.8 * rng());
        const temp = tempDay + 4 * Math.sin((2 * Math.PI * (h - 9)) / 24);
        const et = 0.085 * (1 - cloud) * solar * (0.55 + 0.02 * temp);
        weather[day * 24 + h] = {
          tempC: temp,
          rainMmH: hourlyRain,
          windMs: wind * (0.7 + 0.6 * rng()),
          cloud: cloud,
          etCmH: Math.max(0, et),
          rainy: rainy,
        };
      }
    }
    this.weather = weather;
  };

  // 6 个鸟类目标位点：横向位置与偏好水深由 seed 决定，重开完全复现
  WetlandSim.prototype._generateSites = function () {
    const rng = this.rng.site;
    this.sites = [];
    for (let i = 0; i < CFG.SITE_COUNT; i++) {
      this.sites.push({
        id: i + 1,
        x: 0.08 + 0.84 * ((i + 0.15 + 0.7 * rng()) / CFG.SITE_COUNT),
        preferredDepth: 8 + rng() * 22,
        occupants: 0,
        species: 2 + Math.floor(rng() * 5),
        label: ['浅滩鹭位', '鸻鹬觅食带', '雁鸭休息区', '苇丛雀位',
          '湖心浅台', '泥滩觅食位'][i],
      });
    }
  };

  WetlandSim.prototype.resetState = function () {
    // 重新派生子流，保证噪声/鸟移动序列也随重置复现
    this._resetRng();
    this.hour = 0;
    this.state = {
      levelCm: 18,          // 实际水位（cm，相对泥面）
      carbon: 96,           // 土壤有机碳储量 t/ha（实际值）
      pollution: 18,        // 营养盐/污染指数 0-100（实际值）
      doMgL: 8.2,           // 溶解氧 mg/L（实际值）
      reed: 62,             // 芦苇生物量指数 0-100
      birds: 92,            // 鸟个体总数
      species: 7,           // 物种数
    };
    this.interventions = { gateOpen: false, pumpRate: 0, lastHarvestHour: -9999 };
    this.harvestEffectUntil = -1;       // 收割干扰持续到该小时
    this.drought = null;                // 导演触发的临界干旱事件
    this.alarms = this._emptyAlarms();
    this.latchedCritical = {};          // 年内是否曾进入临界
    this.observations = this._initialObservations();
    this.snapshots = [];                // 处置前后对比
    this.logs = [];
    this.checkpoints = this._initialCheckpoints();
    this.droughtRecoveredAt = null;
    this.steadyWindow = null;
    this._steadyMetrics = { samples: [], stable: false };
    this.finished = false;
    this.verdict = null;
    this._updateSites();
    this._log('info', '模拟初始化完成，seed=' + this.seedText + '，6 个目标位点与天气序列已锁定');
  };

  WetlandSim.prototype._emptyAlarms = function () {
    return {
      level: { status: 'ok' },
      pollution: { status: 'ok' },
      carbon: { status: 'ok' },
      birds: { status: 'ok' },
    };
  };

  WetlandSim.prototype._initialObservations = function () {
    return {
      level: this.state.levelCm, carbon: this.state.carbon,
      pollution: this.state.pollution, birds: this.state.birds,
      doMgL: this.state.doMgL,
    };
  };

  WetlandSim.prototype._initialCheckpoints = function () {
    return [
      { id: 'steady', label: '稳态窗口（前 30 天指标稳定）', status: 'pending', time: null },
      { id: 'critical', label: '临界阈值事件（干旱低水位 CRITICAL）', status: 'pending', time: null },
      { id: 'failure', label: '处置失败（繁殖期收割致鸟类骤降）', status: 'pending', time: null },
      { id: 'recovery', label: '恢复后 30 天残留观察（无告警复发）', status: 'pending', time: null },
      { id: 'targets', label: '年末双指标达标（鸟量/物种 + 碳储存）', status: 'pending', time: null },
    ];
  };

  WetlandSim.prototype.setGate = function (open) {
    this.interventions.gateOpen = !!open;
  };

  WetlandSim.prototype.setPump = function (rate) {
    this.interventions.pumpRate = U.clamp(Number(rate) || 0, 0, 2);
  };

  // 收割：成功与失败都记录快照；繁殖季(第 120-270 天)触发即判定处置失败
  WetlandSim.prototype.harvest = function () {
    if (this.finished) return;
    const before = this._snapshotState();
    const hour = this.hour;
    const day = Math.floor(hour / 24);
    const inBreeding = day >= 120 && day <= 270;
    this.interventions.lastHarvestHour = hour;
    this.harvestEffectUntil = hour + 24 * 14;
    let result;
    if (inBreeding) {
      result = 'failure';
      this.checkpoints.forEach(function (cp) {
        if (cp.id === 'failure' && cp.status === 'pending') {
          cp.status = 'fail'; cp.time = hour;
        }
      });
      this._log('fail', '处置失败：繁殖期收割芦苇，栖息地与巢区破坏，鸟类将持续下降');
    } else {
      result = 'success';
      this._log('ok', '非繁殖期收割：芦苇移除，未惊扰繁殖种群');
    }
    this.snapshots.push({
      type: 'harvest', result: result, hour: hour,
      before: before, after: null, settled: false,
    });
  };

  WetlandSim.prototype._snapshotState = function () {
    const s = this.state;
    return { level: s.levelCm, carbon: s.carbon, pollution: s.pollution,
      birds: s.birds, species: s.species, reed: s.reed, doMgL: s.doMgL };
  };

  WetlandSim.prototype._log = function (level, msg) {
    this.logs.push({ hour: this.hour, level: level, msg: msg });
    if (this.logs.length > 600) this.logs.shift();
  };

  WetlandSim.prototype.triggerDrought = function (durationHours, intensity) {
    if (this.drought) return;
    this.drought = { start: this.hour, end: this.hour + durationHours,
      intensity: intensity || 1 };
    this._log('warn', '临界事件预告：持续干旱 ' + (durationHours / 24) +
      ' 天开始，蒸散增强、补水受限');
  };

  WetlandSim.prototype.step = function (n) {
    n = n || 1;
    for (let i = 0; i < n && !this.finished; i++) this._stepOne();
  };

  WetlandSim.prototype._stepOne = function () {
    const h = this.hour;
    const baseW = this.weather[h];
    const s = this.state;
    const iv = this.interventions;
    const day = Math.floor(h / 24);
    const droughtActive = this.drought && h >= this.drought.start && h < this.drought.end;
    // 干旱事件：降雨几乎消失、云量降低，蒸散随之增强（确定性，不改动原始天气表）
    const w = droughtActive ? {
      tempC: baseW.tempC + 2.5,
      rainMmH: baseW.rainMmH * 0.04,
      windMs: baseW.windMs * 1.25,
      cloud: baseW.cloud * 0.25,
      etCmH: baseW.etCmH,
      rainy: false,
    } : baseW;

    this._updateHydrology(w, droughtActive);
    this._updatePollution(w, droughtActive);
    this._updateCarbon(w, day);
    this._updateReed(day, h);
    this._updateBirds(day, h);
    this._updateSites();
    this._updateSensors();
    this._updateAlarms();
    this._sampleSteady();
    this._settleSnapshots();
    this._updateCheckpoints(h);

    this.hour++;
    if (this.hour >= CFG.HOURS_PER_YEAR) this._finish();
  };

  WetlandSim.prototype._updateHydrology = function (w, droughtActive) {
    const s = this.state;
    const iv = this.interventions;
    const rainIn = w.rainMmH * 0.1;                       // mm→cm 折算
    const baseIn = 0.012;                                // 地下水基流，维持湿地基本水量
    const etOut = droughtActive ? w.etCmH * 5 : w.etCmH;
    const pumpIn = iv.pumpRate;
    const gateOut = iv.gateOpen ? 1.6 : 0;
    const droughtLoss = droughtActive ? 0.36 * (this.drought.intensity || 1) : 0;
    s.levelCm += rainIn + baseIn + pumpIn - etOut - gateOut - droughtLoss;
    s.levelCm = U.clamp(s.levelCm, CFG.LEVEL_MIN, CFG.LEVEL_MAX);
  };

  WetlandSim.prototype._updatePollution = function (w, droughtActive) {
    const s = this.state;
    const runoff = w.rainMmH > 0.5 ? w.rainMmH * 0.05 : 0;
    const decay = 0.0035 * s.pollution;                  // 湿地自净
    const dilution = s.levelCm > 10 ? 0.012 : 0;         // 水量充足时稀释
    const concentration = droughtActive && s.levelCm < 0 ? 0.06 : 0;
    s.pollution += 0.055 + runoff + concentration - decay - dilution;
    s.pollution = U.clamp(s.pollution, 0, 100);
    const target = 9.2 - 0.05 * s.pollution + (s.levelCm < 0 ? -0.8 : 0);
    s.doMgL += (U.clamp(target, 2, 11) - s.doMgL) * 0.05;
  };

  WetlandSim.prototype._updateCarbon = function (w, day) {
    const s = this.state;
    const season = U.clamp(Math.sin(Math.PI * (day - 60) / 180), 0, 1); // 4-10 月生长
    const sequestration = 0.0016 * s.reed * (0.25 + 0.75 * season);
    const tempFactor = 1 + 0.03 * Math.max(0, w.tempC - 16);
    let moistureFactor;
    if (s.levelCm < 0) moistureFactor = 1 + (-s.levelCm) * 0.035;       // 干土加速分解
    else if (s.levelCm > 45) moistureFactor = 0.55;                     // 深水抑制分解
    else moistureFactor = 0.85;
    const decomposition = 0.0005 * s.carbon * tempFactor * moistureFactor;
    s.carbon += sequestration - decomposition;
  };

  WetlandSim.prototype._updateReed = function (day, hour) {
    const s = this.state;
    const season = U.clamp(Math.sin(Math.PI * (day - 60) / 180), 0, 1);
    const harvestActive = hour < this.harvestEffectUntil;
    if (harvestActive) {
      s.reed += (12 - s.reed) * 0.01;
    } else {
      const waterPenalty = s.levelCm < 0 ? 0.06 : (s.levelCm > 55 ? 0.05 : 0);
      s.reed += (0.10 * season - waterPenalty) * (0.4 + s.reed / 100);
    }
    s.reed = U.clamp(s.reed, 2, 100);
  };

  WetlandSim.prototype._habitatScore = function (day, hour) {
    const s = this.state;
    let score = 1;
    if (s.levelCm < CFG.LEVEL_IDEAL_LOW) {
      score -= Math.min(0.8, (CFG.LEVEL_IDEAL_LOW - s.levelCm) * 0.02);
    } else if (s.levelCm > CFG.LEVEL_IDEAL_HIGH) {
      score -= Math.min(0.7, (s.levelCm - CFG.LEVEL_IDEAL_HIGH) * 0.018);
    }
    score -= Math.max(0, s.pollution - 30) * 0.006;
    if (hour < this.harvestEffectUntil) score -= 0.35;       // 收割干扰
    return U.clamp(score, 0.05, 1);
  };

  WetlandSim.prototype._updateBirds = function (day, hour) {
    const s = this.state;
    const score = this._habitatScore(day, hour);
    const carrying = 120 * score * (1 - Math.max(0, s.pollution - 30) / 120);
    const rng = this.rng.move;
    const migration = Math.sin(2 * Math.PI * (day - 90) / 360); // 春秋迁徙节律
    let delta = (carrying - s.birds) * 0.012 + migration * 0.15;
    delta += gaussian(rng) * 0.5;
    if (hour < this.harvestEffectUntil) {
      const inBreeding = day >= 120 && day <= 270;
      delta -= inBreeding ? 0.55 : 0.12;                     // 繁殖期失败处置的骤降
    }
    s.birds = U.clamp(s.birds + delta, 0, 180);
    const targetSpecies = U.clamp(
      Math.round(3 + 5 * score - (s.pollution > 55 ? 2 : 0)), 2, 9);
    s.species += Math.sign(targetSpecies - s.species) *
      (rng() < 0.08 ? 1 : 0);
    s.species = U.clamp(s.species, 2, 9);
  };

  WetlandSim.prototype._updateSites = function () {
    const rng = this.rng.move;
    const s = this.state;
    let allocated = 0;
    this.sites.forEach((site) => {
      const depthMatch = 1 - U.clamp(Math.abs(s.levelCm - site.preferredDepth) / 40, 0, 1);
      const share = Math.max(0.02, depthMatch * (0.6 + 0.8 * rng()));
      site.occupants = share;
      allocated += share;
    }, this);
    this.sites.forEach((site) => {
      site.birds = Math.round((site.occupants / allocated) * s.birds);
      site.jitterX = (rng() - 0.5) * 0.012;
      site.jitterY = (rng() - 0.5) * 0.01;
    }, this);
  };

  // 观测值 = 实际值 + 传感器噪声（独立确定性子流）+ 一阶滞后
  WetlandSim.prototype._updateSensors = function () {
    const rng = this.rng.sensor;
    const s = this.state;
    const o = this.observations;
    o.level += (s.levelCm + gaussian(rng) * 1.4 - o.level) * 0.25;
    o.carbon += (s.carbon + gaussian(rng) * 0.25 - o.carbon) * 0.12;
    o.pollution += (s.pollution + gaussian(rng) * 1.6 - o.pollution) * 0.3;
    o.birds += (s.birds + gaussian(rng) * 2.2 - o.birds) * 0.2;
    o.doMgL += (s.doMgL + gaussian(rng) * 0.18 - o.doMgL) * 0.3;
  };

  WetlandSim.prototype._updateAlarms = function () {
    const s = this.state;
    this._evalAlarm('level',
      s.levelCm <= CFG.LEVEL_CRIT_LOW || s.levelCm >= CFG.LEVEL_CRIT_HIGH,
      s.levelCm <= CFG.LEVEL_WARN_LOW || s.levelCm >= CFG.LEVEL_WARN_HIGH,
      '水位 ' + s.levelCm.toFixed(1) + ' cm');
    this._evalAlarm('pollution',
      s.pollution >= CFG.POLLUTION_CRIT, s.pollution >= CFG.POLLUTION_WARN,
      '污染指数 ' + s.pollution.toFixed(1));
    this._evalAlarm('carbon',
      s.carbon <= CFG.CARBON_CRIT, s.carbon <= CFG.CARBON_WARN,
      '碳储量 ' + s.carbon.toFixed(1) + ' t/ha');
    this._evalAlarm('birds',
      s.birds <= CFG.BIRDS_CRIT, s.birds <= CFG.BIRDS_WARN,
      '鸟类 ' + Math.round(s.birds) + ' 只');
  };

  WetlandSim.prototype._evalAlarm = function (key, crit, warn, detail) {
    const a = this.alarms[key];
    const prev = a.status;
    let next = 'ok';
    if (crit) next = 'critical';
    else if (warn) next = 'warn';
    // 滞回复位：回到安全区间后再降一级，避免边界抖动
    if (prev === 'critical' && next === 'ok' && warn) next = 'warn';
    if (next !== prev) {
      a.status = next;
      a.since = this.hour;
      a.detail = detail;
      if (next === 'critical') {
        this.latchedCritical[key] = this.hour;
        this._log('critical', '【' + key + ' CRITICAL】' + detail);
      } else if (next === 'warn') {
        this._log('warn', '【' + key + ' WARN】' + detail);
      } else {
        this._log('ok', '【' + key + ' 恢复正常】' + detail);
      }
    }
  };

  WetlandSim.prototype._settleSnapshots = function () {
    this.snapshots.forEach((snap) => {
      if (snap.settled) return;
      if (this.hour - snap.hour >= 24 * 7) {
        snap.after = this._snapshotState();
        snap.settled = true;
      }
    });
  };

  WetlandSim.prototype._sampleSteady = function () {
    if (this.hour >= 24 * 10 && this.hour < 24 * 30) {
      const m = this._steadyMetrics;
      m.samples.push({ level: this.state.levelCm, birds: this.state.birds });
      if (this.hour === 24 * 30 - 1) {
        m.stable = this._coefficientVariation(m.samples, 'level') < 0.08 &&
          this._coefficientVariation(m.samples, 'birds') < 0.08;
      }
    }
  };

  WetlandSim.prototype._coefficientVariation = function (samples, key) {
    const n = samples.length;
    const mean = samples.reduce((a, x) => a + x[key], 0) / n;
    const variance = samples.reduce((a, x) => a + (x[key] - mean) ** 2, 0) / n;
    return mean === 0 ? 99 : Math.sqrt(variance) / Math.abs(mean);
  };

  WetlandSim.prototype._updateCheckpoints = function (hour) {
    const cp = {};
    this.checkpoints.forEach((c) => { cp[c.id] = c; });
    const s = this.state;

    // 稳态：前 30 天内任取 7 天窗口，水位/鸟量波动率均低于 8%
    if (cp.steady.status === 'pending' && hour === 24 * 30) {
      const stable = this._steadyMetrics ? this._steadyMetrics.stable : false;
      if (stable) {
        cp.steady.status = 'pass';
        cp.steady.time = hour;
        this._log('ok', '检查点：稳态窗口通过，关键指标波动率 < 8%');
      } else {
        cp.steady.status = 'fail';
        cp.steady.time = hour;
        this._log('fail', '检查点：稳态窗口未通过');
      }
    }

    // 临界事件：告警状态机进入 critical 即记录触发时刻
    if (cp.critical.status === 'pending' && this.alarms.level.status === 'critical') {
      cp.critical.status = this.latchedCritical.level !== undefined ? 'pass' : 'fail';
      cp.critical.time = hour;
    }

    // 干旱恢复：水位重回理想区且全部告警 ok，随后开启固定 30 天残留观察
    if (this.drought && this.droughtRecoveredAt === null &&
        hour > this.drought.end &&
        s.levelCm >= CFG.LEVEL_IDEAL_LOW &&
        s.levelCm <= CFG.LEVEL_IDEAL_HIGH &&
        this._allOk()) {
      this.droughtRecoveredAt = hour;
      this._log('ok', '干旱处置后系统恢复，开始 30 天固定残留观察');
    }
    if (cp.recovery.status === 'pending' && this.droughtRecoveredAt !== null &&
        hour - this.droughtRecoveredAt >= 24 * 30) {
      const relapse = Object.keys(this.alarms).some((k) => {
        const a = this.alarms[k];
        return a.status !== 'ok' && a.since >= this.droughtRecoveredAt;
      });
      if (!relapse) {
        cp.recovery.status = 'pass';
        cp.recovery.time = hour;
        this._log('ok', '检查点：30 天残留观察无告警复发，无隐藏残留');
      } else {
        cp.recovery.status = 'fail';
        cp.recovery.time = hour;
        this._log('fail', '检查点：残留观察期内告警复发，存在隐藏残留');
      }
    }
  };

  WetlandSim.prototype._allOk = function () {
    return Object.keys(this.alarms).every((k) => this.alarms[k].status === 'ok');
  };

  WetlandSim.prototype._finish = function () {
    this.finished = true;
    const s = this.state;
    const birdMet = s.birds >= CFG.TARGET_BIRDS && s.species >= CFG.TARGET_SPECIES;
    const carbonMet = s.carbon >= CFG.TARGET_CARBON;
    const cp = {};
    this.checkpoints.forEach((c) => { cp[c.id] = c; });
    cp.targets.status = (birdMet && carbonMet) ? 'pass' : 'fail';
    cp.targets.time = this.hour;
    this.verdict = {
      success: birdMet && carbonMet,
      birdMet: birdMet,
      carbonMet: carbonMet,
      birds: s.birds, species: s.species, carbon: s.carbon,
    };
    this._log(birdMet && carbonMet ? 'ok' : 'fail',
      '一年模拟结束：鸟类目标 ' + (birdMet ? '达标' : '未达标') +
      '，碳储存目标 ' + (carbonMet ? '达标' : '未达标'));
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WetlandSim: WetlandSim, gaussian: gaussian };
  }
  root.WetlandSimModule = { WetlandSim: WetlandSim, gaussian: gaussian };
})(typeof self !== 'undefined' ? self : this);
