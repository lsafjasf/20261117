/* 碳酸饮料灌装线仿真引擎
 * 生产、能耗、缓存状态共用同一仿真时钟 (tick)。
 * 同时支持浏览器 (window.FillingSim) 与 Node (module.exports)。
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.FillingSim = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BEVERAGES = {
    soda: { name: '苏打水', target: 4.0, tol: 0.4 },
    cola: { name: '可乐汽水', target: 3.2, tol: 0.35 },
    tea: { name: '微气泡茶', target: 2.2, tol: 0.3 },
  };

  const DEVICE_POWER = { filler: 2.0, valve: 1.0, chiller: 4.0, capper: 1.5 }; // kW
  const DEVICE_NAMES = { filler: '灌装机', valve: 'CO2气阀', chiller: '冷水机', capper: '封盖机' };
  const CACHE_CAPACITY = 8;
  const AMBIENT_TEMP = 20;
  const BATCH_GOAL = 12;
  const STEP_DT = 0.1;
  const SPLASH_LIMIT = 4.2;      // 压力 x 速度系数 超过即喷溅
  const CAP_DELAY_MIN = 1.5;     // 封盖时机窗口 (s)
  const CAP_DELAY_MAX = 6.0;

  const PARAM_RANGES = {
    pressure: [0.5, 5.0],
    tempSet: [0, 20],
    fillSpeed: [6, 30],
    capDelay: [0.5, 8.0],
  };

  // 亨利定律近似: 压力越高溶解度越大, 温度越高溶解度越低
  function solubility(pressure, temp) {
    return 1.45 * pressure * Math.exp(-0.028 * (temp - 2));
  }

  class FillingSim {
    constructor(beverageKey = 'soda') {
      this.beverageKey = beverageKey;
      this.time = 0;
      this.paused = false;
      this.params = { pressure: 3.0, tempSet: 4, fillSpeed: 12, capDelay: 3.0 };
      this.devices = { filler: true, valve: true, chiller: true, capper: true };
      this.events = [];
      this.resetBatch(false);
      this.log('init', `初始化仿真: ${BEVERAGES[beverageKey].name}`);
    }

    // 批次重置: 清空缓存/输送线/能耗, 重开不保留旧缓存
    resetBatch(logIt = true) {
      this.bottles = [];       // 已封盖瓶子记录
      this.pipeline = [];      // 碳酸化中的瓶子
      this.cache = [];         // 待封盖缓存
      this.energyKJ = 0;
      this.temp = this.params.tempSet;
      this.fillProgress = 0;
      this.capCooldown = 0;
      this.halted = false;
      this.haltReason = null;
      this.haltSince = 0;
      this.qualified = 0;
      this.batchDone = false;
      this.peaks = { maxPressure: 0, maxTemp: -Infinity, minTemp: Infinity, maxCache: 0, maxPower: 0, maxCO2: 0 };
      this.defectTally = {};
      this.shutdownReasons = [];
      if (logIt) this.log('reset', '批次重置: 清空缓存/输送线/能耗计数');
    }

    log(type, msg, data) {
      this.events.push(Object.assign({ t: +this.time.toFixed(2), type, msg }, data ? { data } : {}));
    }

    setParam(key, value) {
      const range = PARAM_RANGES[key];
      if (!range) return;
      const v = Math.max(range[0], Math.min(range[1], value));
      const old = this.params[key];
      if (old === v) return;
      this.params[key] = v;
      this.log('param_change', `参数调整 ${key}: ${old} -> ${v}`, { key, from: old, to: v });
    }

    setDevice(name, on) {
      if (!(name in this.devices) || this.devices[name] === on) return;
      this.devices[name] = on;
      this.log(on ? 'device_start' : 'device_stop', `${DEVICE_NAMES[name]}${on ? '启动' : '停止'}`, { device: name, on });
    }

    pause() { if (!this.paused) { this.paused = true; this.log('pause', '暂停仿真'); } }
    resume() { if (this.paused) { this.paused = false; this.log('resume', '恢复仿真'); } }

    step() { // 单步: 暂停状态下推进一个固定步长
      const was = this.paused;
      this.paused = false;
      this.tick(STEP_DT);
      this.paused = was;
    }

    // 主时钟: 生产、能耗、缓存、液温全部在此推进
    tick(dt) {
      if (this.paused || dt <= 0) return;
      this.time += dt;
      const p = this.params;

      // --- 液温: 冷水机拉向设定值, 停机则回升向环境温度 ---
      if (this.devices.chiller) this.temp += (p.tempSet - this.temp) * Math.min(1, dt * 0.25);
      else this.temp += (AMBIENT_TEMP - this.temp) * Math.min(1, dt * 0.02);

      // --- 能耗: 与生产共用此时钟; 线体停摆时灌装机/气阀空转为零 ---
      let power = 0;
      for (const name of Object.keys(DEVICE_POWER)) {
        if (!this.devices[name]) continue;
        if (this.halted && (name === 'filler' || name === 'valve')) continue;
        power += DEVICE_POWER[name];
      }
      this.energyKJ += power * dt;

      // --- 峰值统计 ---
      this.peaks.maxPressure = Math.max(this.peaks.maxPressure, p.pressure);
      this.peaks.maxTemp = Math.max(this.peaks.maxTemp, this.temp);
      this.peaks.minTemp = Math.min(this.peaks.minTemp, this.temp);
      this.peaks.maxCache = Math.max(this.peaks.maxCache, this.cache.length);
      this.peaks.maxPower = Math.max(this.peaks.maxPower, power);

      // --- 停机恢复判定 ---
      if (this.halted && this.devices.capper && this.cache.length < CACHE_CAPACITY) {
        this.halted = false;
        this.log('line_resume', `产线恢复: ${this.haltReason} 已解除`, { downtime: +(this.time - this.haltSince).toFixed(2) });
        this.haltReason = null;
      }

      // --- 灌装: 产生新瓶 ---
      if (!this.halted && !this.batchDone && this.devices.filler && this.devices.valve) {
        this.fillProgress += (dt * p.fillSpeed) / 60;
        if (this.fillProgress >= 1) {
          this.fillProgress -= 1;
          const turbulence = p.pressure * (p.fillSpeed / 12);
          const bottle = {
            id: this.bottles.length + this.pipeline.length + this.cache.length + 1,
            bornAt: +this.time.toFixed(2),
            dwell: 0,
            co2: 0,
            tempAtFill: +this.temp.toFixed(2),
            defects: [],
          };
          if (turbulence > SPLASH_LIMIT) {
            bottle.defects.push('喷溅');
            this.log('splash', `瓶#${bottle.id} 喷溅: 压力${p.pressure}bar x 速度${p.fillSpeed}bpm`, { bottleId: bottle.id, turbulence: +turbulence.toFixed(2) });
          }
          this.pipeline.push(bottle);
        }
      }

      // --- 碳酸化: CO2 向当前温度/压力下的溶解度平衡 ---
      const eq = this.devices.valve ? solubility(p.pressure, this.temp) : 0;
      for (let i = this.pipeline.length - 1; i >= 0; i--) {
        const b = this.pipeline[i];
        b.dwell += dt;
        b.co2 += (eq - b.co2) * (1 - Math.exp(-dt / 1.0));
        if (b.dwell >= p.capDelay) {
          if (this.cache.length >= CACHE_CAPACITY) {
            if (!this.halted) {
              this.halted = true;
              this.haltSince = this.time;
              this.haltReason = '封盖缓存溢出(封盖机停机或积压)';
              this.shutdownReasons.push({ t: +this.time.toFixed(2), reason: this.haltReason });
              this.log('line_halt', `产线停机: ${this.haltReason}`, { cacheSize: this.cache.length });
            }
            continue; // 缓存满, 瓶子滞留继续碳酸化
          }
          this.pipeline.splice(i, 1);
          if (b.dwell > CAP_DELAY_MAX) b.defects.push('封盖过迟');
          this.cache.push(b);
        }
      }

      // --- 缓存中未封盖瓶子 CO2 缓慢逸散 ---
      for (const b of this.cache) b.co2 *= Math.exp(-0.05 * dt);

      // --- 封盖机: 逐个封盖并判定质量 ---
      if (this.devices.capper && this.cache.length > 0) {
        this.capCooldown -= dt;
        if (this.capCooldown <= 0) {
          this.capCooldown = 0.8;
          this.capBottle(this.cache.shift());
        }
      }
    }

    capBottle(b) {
      const bev = BEVERAGES[this.beverageKey];
      const co2 = +b.co2.toFixed(2);
      this.peaks.maxCO2 = Math.max(this.peaks.maxCO2, co2);
      if (b.dwell < CAP_DELAY_MIN) b.defects.push('封盖过早');
      if (b.tempAtFill < 1 || b.tempAtFill > 14) b.defects.push('液温异常');
      if (co2 < bev.target - bev.tol) b.defects.push('口感不足');
      if (co2 > bev.target + bev.tol) b.defects.push('过碳酸');
      b.co2Final = co2;
      b.cappedAt = +this.time.toFixed(2);
      b.qualified = b.defects.length === 0;
      this.bottles.push(b);
      for (const d of b.defects) this.defectTally[d] = (this.defectTally[d] || 0) + 1;
      if (b.qualified) {
        this.qualified++;
        this.log('bottle_ok', `瓶#${b.id} 合格 CO2=${co2}vol`, { bottleId: b.id, co2 });
      } else {
        this.log('bottle_defect', `瓶#${b.id} 缺陷: ${b.defects.join('/')}`, { bottleId: b.id, co2, defects: b.defects.slice() });
      }
      if (this.qualified >= BATCH_GOAL && !this.batchDone) {
        this.batchDone = true;
        this.log('batch_result', `批次完成: ${this.qualified}/${this.bottles.length} 合格, 良品率 ${(this.goodRate() * 100).toFixed(1)}%`, this.batchSummary());
      }
    }

    goodRate() {
      return this.bottles.length ? this.qualified / this.bottles.length : 0;
    }

    batchSummary() {
      return {
        qualified: this.qualified,
        attempts: this.bottles.length,
        goodRate: +this.goodRate().toFixed(3),
        energyKJ: +this.energyKJ.toFixed(1),
        defectTally: Object.assign({}, this.defectTally),
      };
    }

    // 导出: 良品数、峰值、停机原因、异常位置、完整事件日志
    exportReport() {
      const peaks = {};
      for (const k of Object.keys(this.peaks)) peaks[k] = +this.peaks[k].toFixed(2);
      return {
        beverage: BEVERAGES[this.beverageKey].name,
        simTime: +this.time.toFixed(2),
        batchDone: this.batchDone,
        qualified: this.qualified,
        attempts: this.bottles.length,
        goodRate: +this.goodRate().toFixed(3),
        energyKJ: +this.energyKJ.toFixed(1),
        peaks,
        shutdownReasons: this.shutdownReasons.slice(),
        defectTally: Object.assign({}, this.defectTally),
        anomalies: this.bottles.filter((b) => !b.qualified).map((b) => ({
          bottleId: b.id, stage: 'capper', t: b.cappedAt, co2: b.co2Final, tempAtFill: b.tempAtFill, defects: b.defects,
        })),
        events: this.events.slice(),
      };
    }
  }

  return { FillingSim, BEVERAGES, DEVICE_NAMES, CACHE_CAPACITY, BATCH_GOAL, STEP_DT, solubility };
});
