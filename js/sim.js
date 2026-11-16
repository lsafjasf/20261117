// 牧场轮牧模拟核心(纯逻辑,不依赖 DOM,可在 node 中测试)
(function (global) {
  'use strict';
  const RNG = global.RNG || require('./rng.js');

  const CONFIG = {
    days: 30,
    growthPerHour: 0.55,          // 草量逻辑斯蒂增长基数
    grazePerHead: 0.012,          // 每头每小时吃草
    compactPerHead: 0.004,        // 踩踏压实
    compactRecover: 0.02,         // 休牧压实恢复
    drinkPerHead: 0.05,           // 饮水消耗水位
    rainWater: 1.4,               // 降雨补水
    droughtWater: 0.4,            // 干旱蒸发
    pollutePerHead: 0.010,        // 饮水点污染
    pollutionDecay: 0.05,
    diversityLoss: 0.08,          // 草量过低时物种多样性下降
    diversityRecover: 0.03,
    observeEvery: 6,              // 观测间隔(小时)
    observeNoise: 4,              // 观测噪声幅度
    minGrassForMove: 15,          // 转入草地最低草量,否则处置失败
    maxWaterPoints: 3,
    weatherMult: { rain: 1.6, normal: 1.0, drought: 0.35 },
    thresholds: { grass: 25, water: 20, pollution: 60, compaction: 70 },
  };

  const WEATHER_NAME = { rain: '雨季', normal: '晴', drought: '干旱' };
  const PASTURE_NAMES = ['A', 'B', 'C', 'D'];
  const HERD_DEFS = [
    { species: '牛', size: 18 },
    { species: '羊', size: 30 },
    { species: '马', size: 22 },
  ];

  function clamp(v) { return v < 0 ? 0 : v > 100 ? 100 : v; }

  class Sim {
    constructor(seed) { this.reset(seed); }

    reset(seed) {
      this.seed = String(seed);
      this.rng = RNG.makeRng(RNG.hashSeed(this.seed));
      this.obsRng = RNG.makeRng(RNG.hashSeed(this.seed + '#obs'));
      this.hour = 0;
      this.finished = false;
      this.success = false;
      this.grazeHours = 10;
      this.waterPointsLeft = CONFIG.maxWaterPoints;
      this.logs = [];
      this.activeAlerts = {};
      this.weather = this._genWeather();
      this.targets = this._genTargets();
      this.pastures = PASTURE_NAMES.map((name, i) => ({
        id: i, name,
        grass: 55 + this.rng() * 20,
        compaction: 5 + this.rng() * 8,
        diversity: 60 + this.rng() * 20,
        water: 45 + this.rng() * 20,
        pollution: 5 + this.rng() * 5,
        waterPoint: i < 2,
        obs: null,
      }));
      this.pastures.forEach(p => { if (p.waterPoint) this.waterPointsLeft--; });
      this.herds = HERD_DEFS.map((d, i) => ({
        id: i, species: d.species, size: d.size, pasture: i, hoursOn: 0,
      }));
      this._nextObserve = 0;
      this._observe();
      this.log('info', `模拟开始 seed=${this.seed},目标已生成`);
    }

    _genWeather() {
      const seq = [];
      for (let d = 0; d < CONFIG.days; d++) {
        const r = this.rng();
        let type = 'normal';
        if (d >= 8 && d <= 14) type = r < 0.55 ? 'rain' : (r < 0.8 ? 'normal' : 'drought');
        else if (d >= 20 && d <= 27) type = r < 0.5 ? 'drought' : (r < 0.75 ? 'normal' : 'rain');
        else type = r < 0.2 ? 'rain' : (r < 0.4 ? 'drought' : 'normal');
        seq.push(type);
      }
      return seq;
    }

    _genTargets() {
      return {
        grass: PASTURE_NAMES.map(() => Math.round(55 + this.rng() * 20)),
        waterCoverage: 3,
        herdFinal: HERD_DEFS.map(() => Math.floor(this.rng() * 4)),
        pollutionMax: 40,
      };
    }

    get day() { return Math.min(Math.floor(this.hour / 24), CONFIG.days); }
    get weatherNow() { return this.weather[Math.min(this.day, CONFIG.days - 1)]; }

    timeStr(h) {
      const t = h === undefined ? this.hour : h;
      return `第${Math.floor(t / 24)}天 ${String(Math.floor(t % 24)).padStart(2, '0')}:00`;
    }

    log(type, msg) {
      this.logs.push({ t: this.hour, time: this.timeStr(), type, msg });
    }

    _observe() {
      for (const p of this.pastures) {
        const n = () => (this.obsRng() * 2 - 1) * CONFIG.observeNoise;
        p.obs = {
          grass: clamp(p.grass + n()),
          water: clamp(p.water + n()),
          pollution: clamp(p.pollution + n()),
          compaction: clamp(p.compaction + n()),
          diversity: clamp(p.diversity + n()),
        };
      }
      this._updateAlerts();
    }

    _updateAlerts() {
      const T = CONFIG.thresholds;
      for (const p of this.pastures) {
        const checks = [
          ['grass', p.obs.grass < T.grass, `草量告急(观测 ${p.obs.grass.toFixed(0)}<${T.grass})`],
          ['water', p.waterPoint && p.obs.water < T.water, `水位过低(观测 ${p.obs.water.toFixed(0)}<${T.water})`],
          ['pollution', p.obs.pollution > T.pollution, `污染超标(观测 ${p.obs.pollution.toFixed(0)}>${T.pollution})`],
          ['compaction', p.obs.compaction > T.compaction, `土壤压实(观测 ${p.obs.compaction.toFixed(0)}>${T.compaction})`],
        ];
        for (const [key, bad, msg] of checks) {
          const id = p.id + ':' + key;
          if (bad && !this.activeAlerts[id]) {
            this.activeAlerts[id] = true;
            this.log('alert', `草地${p.name} ${msg}`);
          } else if (!bad && this.activeAlerts[id]) {
            delete this.activeAlerts[id];
            this.log('recover', `草地${p.name} ${key} 告警解除`);
          }
        }
      }
    }

    alerts() {
      const out = {};
      for (const k of Object.keys(this.activeAlerts)) {
        const [pid, key] = k.split(':');
        (out[pid] = out[pid] || []).push(key);
      }
      return out;
    }

    step(dtH) {
      if (this.finished) return;
      const w = this.weatherNow;
      const mult = CONFIG.weatherMult[w];
      const grazing = (this.hour % 24) < this.grazeHours;
      for (const p of this.pastures) {
        const herdHere = this.herds.some(h => h.pasture === p.id);
        const compactPenalty = 1 - p.compaction / 150;
        p.grass = clamp(p.grass + CONFIG.growthPerHour * mult * compactPenalty * (1 - p.grass / 100) * dtH);
        if (w === 'rain') p.water = clamp(p.water + CONFIG.rainWater * dtH);
        if (w === 'drought') p.water = clamp(p.water - CONFIG.droughtWater * dtH);
        p.compaction = clamp(p.compaction - CONFIG.compactRecover * (herdHere ? 0.2 : 1) * dtH);
        p.pollution = clamp(p.pollution - CONFIG.pollutionDecay * dtH);
        if (p.grass < CONFIG.thresholds.grass) p.diversity = clamp(p.diversity - CONFIG.diversityLoss * dtH);
        else if (p.grass > 50 && !herdHere) p.diversity = clamp(p.diversity + CONFIG.diversityRecover * dtH);
      }
      if (grazing) {
        for (const h of this.herds) {
          const p = this.pastures[h.pasture];
          p.grass = clamp(p.grass - CONFIG.grazePerHead * h.size * dtH);
          p.compaction = clamp(p.compaction + CONFIG.compactPerHead * h.size * dtH);
          h.hoursOn += dtH;
          if (p.waterPoint) {
            p.water = clamp(p.water - CONFIG.drinkPerHead * h.size * dtH);
            p.pollution = clamp(p.pollution + CONFIG.pollutePerHead * h.size * (h.hoursOn > 48 ? 2 : 1) * dtH);
          }
        }
      }
      this.hour += dtH;
      if (this.hour >= this._nextObserve) { this._observe(); this._nextObserve += CONFIG.observeEvery; }
      if (this.day >= CONFIG.days) this._finish();
    }

    moveHerd(herdId, pastureId) {
      const h = this.herds[herdId];
      const p = this.pastures[pastureId];
      if (!h || !p) return { ok: false, reason: '无效目标' };
      if (h.pasture === pastureId) return { ok: false, reason: '畜群已在该草地' };
      if (p.grass < CONFIG.minGrassForMove) {
        this.log('fail', `处置失败:${h.species}群转入草地${p.name}被拒,草量 ${p.grass.toFixed(0)}<${CONFIG.minGrassForMove}`);
        return { ok: false, reason: `草地${p.name}草量不足` };
      }
      h.pasture = pastureId;
      h.hoursOn = 0;
      this.log('op', `轮牧:${h.species}群(${h.size}头)转入草地${p.name}`);
      return { ok: true };
    }

    placeWater(pastureId) {
      const p = this.pastures[pastureId];
      if (!p) return { ok: false, reason: '无效草地' };
      if (p.waterPoint) {
        this.log('fail', `处置失败:草地${p.name}已有饮水点`);
        return { ok: false, reason: '已有饮水点' };
      }
      if (this.waterPointsLeft <= 0) {
        this.log('fail', `处置失败:饮水点配额已用完`);
        return { ok: false, reason: '配额不足' };
      }
      p.waterPoint = true;
      this.waterPointsLeft--;
      this.log('op', `在草地${p.name}设置饮水点`);
      return { ok: true };
    }

    metrics() {
      const avg = k => this.pastures.reduce((s, p) => s + p[k], 0) / this.pastures.length;
      return {
        grass: avg('grass'), water: avg('water'), pollution: avg('pollution'),
        compaction: avg('compaction'), diversity: avg('diversity'),
        waterCoverage: this.pastures.filter(p => p.waterPoint && p.water > CONFIG.thresholds.water).length,
      };
    }

    _finish() {
      this.finished = true;
      const m = this.metrics();
      const targetGrassAvg = this.targets.grass.reduce((a, b) => a + b, 0) / 4;
      this.success = m.grass >= targetGrassAvg * 0.9 &&
        m.waterCoverage >= this.targets.waterCoverage &&
        m.pollution <= this.targets.pollutionMax;
      this.log(this.success ? 'info' : 'fail',
        `30天结束:${this.success ? '成功' : '未达标'} 草量${m.grass.toFixed(0)}/${targetGrassAvg.toFixed(0)} ` +
        `饮水覆盖${m.waterCoverage}/${this.targets.waterCoverage} 污染${m.pollution.toFixed(0)}/${this.targets.pollutionMax}`);
    }
  }

  const api = { Sim, CONFIG, WEATHER_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.RanchSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
