// 红树林修复区模拟核心(纯逻辑,无 DOM,可在 Node 中运行)
// 所有随机性来自 seed 派生的独立随机流,保证同一 seed 重开时
// 目标位置(幼苗点位/潮沟)与天气序列完全复现。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MangroveSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 确定性随机 ----------
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 常量 ----------
  const TICKS_PER_DAY = 24;          // 1 tick = 1 模拟小时
  const HORIZON_DAYS = 100;          // 90 天评估 + 10 天恢复确认
  const EVAL_DAY = 90;
  const RECOVERY_DAYS = 10;          // 风暴后固定恢复确认期
  const SURVIVAL_TARGET = 0.70;      // 存活率达标线
  const WATER_WARN = 1.20;           // 水位告警阈值(m)
  const WATER_CRIT = 1.60;           // 水位临界阈值(m)
  const TURB_WARN = 40;              // 浊度告警阈值(NTU)
  const TURB_CRIT = 80;              // 浊度临界阈值(NTU)
  const SEEDLING_COUNT = 24;
  const COMPARE_DELAY_DAYS = 2;      // 干预前后对比延迟

  function createSim(seed) {
    const baseHash = hashSeed(seed);
    // 独立随机流:布局(目标位置)、天气、漂浮物、传感器噪声
    const layoutRng = mulberry32(baseHash ^ 0x1A2B3C4D);
    const weatherRng = mulberry32(baseHash ^ 0x5E6F7081);
    const debrisRng = mulberry32(baseHash ^ 0x92A3B4C5);
    const sensorRng = mulberry32(baseHash ^ 0xD6E7F809);

    // ---------- 目标布局(同一 seed 必复现) ----------
    const seedlings = [];
    for (let i = 0; i < SEEDLING_COUNT; i++) {
      seedlings.push({
        id: i,
        x: 80 + layoutRng() * 800,                 // 画布横向位置
        elevation: 0.35 + layoutRng() * 0.60,      // 滩面高程(m)
        health: 1,
        bent: false,
        alive: true,
        subHours: 0,                               // 连续被淹小时数
      });
    }
    const channels = [];
    for (let i = 0; i < 3; i++) {
      const baseWidth = 8 + layoutRng() * 6;       // 设计宽度(m)
      channels.push({ id: i, x: 180 + i * 280 + layoutRng() * 60, baseWidth, width: baseWidth });
    }
    // 补植备用点位(确定性)
    const reserveSpots = [];
    for (let i = 0; i < 30; i++) {
      reserveSpots.push({ x: 80 + layoutRng() * 800, elevation: 0.40 + layoutRng() * 0.50 });
    }

    // ---------- 天气序列(同一 seed 必复现) ----------
    const stormStart = 30 + Math.floor(weatherRng() * 8);   // 第 30~37 天
    const stormDuration = 3;
    const stormAmp = 1.1 + weatherRng() * 0.4;              // 风暴增水幅度
    let wind = 2 + weatherRng() * 2;                        // AR(1) 风速
    let rain = 0;                                           // 降雨

    // ---------- 状态 ----------
    const state = {
      seed: String(seed),
      tick: 0,
      day: 0,
      phase: 'steady',            // steady | storm | recovery | normal | done
      waterActual: 0.5,
      waterObserved: 0.5,
      sensorBias: 0,
      turbidity: 15,
      debris: [],                 // {x, y}
      intercepted: 0,
      debrisHits: 0,
      boom: { active: false, integrity: 1, x: 700, deployedDay: null },
      currentIntervention: '无',
      alarm: { water: 'OK', turbidity: 'OK' },
      sedimentLoss: 0,
      recoveryChecked: false,
      recoveryClean: null,
      evaluated: false,
      success: null,
      survivalRate: 1,
    };

    const log = [];               // {day, type, msg}
    const pendingCompares = [];   // 干预前后对比任务
    let nextSeedlingId = SEEDLING_COUNT;
    let prevWaterAlarm = 'OK';
    let prevTurbAlarm = 'OK';

    function pushLog(type, msg) {
      log.push({ day: +(state.day.toFixed(2)), type, msg });
    }

    function snapshotMetrics() {
      return {
        alive: seedlings.filter(s => s.alive).length,
        water: +state.waterActual.toFixed(3),
        turbidity: +state.turbidity.toFixed(1),
        debris: state.debris.length,
        channelWidth: +(channels.reduce((a, c) => a + c.width, 0) / channels.length).toFixed(2),
      };
    }

    // ---------- 干预措施 ----------
    function applyIntervention(type) {
      const before = snapshotMetrics();
      if (type === 'plant') {
        let n = 0;
        for (let i = 0; i < 6 && reserveSpots.length; i++) {
          const spot = reserveSpots.shift();
          seedlings.push({
            id: nextSeedlingId++, x: spot.x, elevation: spot.elevation,
            health: 1, bent: false, alive: true, subHours: 0,
          });
          n++;
        }
        state.currentIntervention = '补植幼苗(+' + n + ')';
        pushLog('intervention', '干预:补植幼苗 ' + n + ' 株');
      } else if (type === 'channel') {
        for (const c of channels) c.width = Math.max(c.baseWidth, c.width * 0.5);
        state.currentIntervention = '收窄潮沟';
        pushLog('intervention', '干预:收窄潮沟至设计宽度');
      } else if (type === 'boom') {
        state.boom.active = true;
        state.boom.integrity = 1;
        state.boom.deployedDay = state.day;
        state.currentIntervention = '布设拦污带';
        pushLog('intervention', '干预:布设拦污带(完整度 100%)');
      }
      pendingCompares.push({ atDay: state.day + COMPARE_DELAY_DAYS, type, before });
    }

    function runCompares() {
      for (let i = pendingCompares.length - 1; i >= 0; i--) {
        const pc = pendingCompares[i];
        if (state.day >= pc.atDay) {
          const after = snapshotMetrics();
          pushLog('compare',
            '干预前后对比[' + pc.type + '] 存活 ' + pc.before.alive + '→' + after.alive +
            ' 水位 ' + pc.before.water + '→' + after.water + 'm' +
            ' 浊度 ' + pc.before.turbidity + '→' + after.turbidity + 'NTU' +
            ' 漂浮物 ' + pc.before.debris + '→' + after.debris +
            ' 潮沟均宽 ' + pc.before.channelWidth + '→' + after.channelWidth + 'm');
          pendingCompares.splice(i, 1);
        }
      }
    }

    // ---------- 单步推进(1 模拟小时) ----------
    function step() {
      if (state.phase === 'done') return;
      state.tick++;
      state.day = state.tick / TICKS_PER_DAY;
      const t = state.day;

      // 阶段判定
      const stormEnd = stormStart + stormDuration;
      if (t < stormStart) state.phase = 'steady';
      else if (t < stormEnd) state.phase = 'storm';
      else if (t < stormEnd + RECOVERY_DAYS) state.phase = 'recovery';
      else state.phase = 'normal';
      if (t >= HORIZON_DAYS) state.phase = 'done';

      // 天气:AR(1) 风速与降雨(固定顺序抽取,保证序列复现)
      const inStorm = state.phase === 'storm';
      wind = Math.max(0.2, wind * 0.96 + (weatherRng() - 0.5) * 1.2 + (inStorm ? 0.9 : 0));
      rain = inStorm ? 5 + weatherRng() * 10 : Math.max(0, rain * 0.9 + (weatherRng() - 0.55) * 2);
      const stormProfile = inStorm
        ? Math.sin(Math.PI * (t - stormStart) / stormDuration) : 0;
      const surge = stormAmp * stormProfile;

      // 水位:半日潮 + 大小潮 + 风暴增水 + 降雨(稳态峰值低于告警线)
      const tide = 0.48 * Math.sin(2 * Math.PI * t / 0.5)
                 + 0.12 * Math.sin(2 * Math.PI * t / 14);
      state.waterActual = Math.max(0.05, 0.50 + tide + surge + rain * 0.01);

      // 传感器观测值:实际值 + 漂移偏差 + 噪声
      state.sensorBias += (sensorRng() - 0.5) * 0.004;
      state.sensorBias = Math.max(-0.06, Math.min(0.06, state.sensorBias));
      const noise = (sensorRng() + sensorRng() + sensorRng() - 1.5) * 0.03;
      state.waterObserved = Math.max(0, state.waterActual + state.sensorBias + noise);

      // 浊度(污染指标):风暴、漂浮物、潮沟冲刷抬升,自然衰减
      state.turbidity += surge * 3 + state.debris.length * 0.15
        + state.sedimentLoss * 0.4 - state.turbidity * 0.04;
      state.turbidity = Math.max(12, state.turbidity);

      // 潮沟:强潮流与风暴冲刷拓宽,平静期缓慢回淤
      const flow = Math.abs(Math.cos(2 * Math.PI * t / 0.5)) * (1 + surge);
      state.sedimentLoss = 0;
      for (const c of channels) {
        if (flow > 0.9) c.width += 0.02 * flow;
        else c.width = Math.max(c.baseWidth, c.width - 0.005);
        state.sedimentLoss += Math.max(0, c.width - c.baseWidth);
      }

      // 漂浮物:风暴与涨潮时生成,随水流漂移
      const spawnP = 0.02 + surge * 0.25 + Math.max(0, tide) * 0.03;
      if (debrisRng() < spawnP) {
        state.debris.push({ x: 940, y: 0, vx: 0 });
      }
      const current = -Math.cos(2 * Math.PI * t / 0.5) * 3 - wind * 0.4 - 0.4;
      for (let i = state.debris.length - 1; i >= 0; i--) {
        const d = state.debris[i];
        d.x += current + (debrisRng() - 0.5) * 2;
        // 低潮搁浅清除
        if (state.waterActual < 0.35 && debrisRng() < 0.05) {
          state.debris.splice(i, 1);
          continue;
        }
        // 拦污带拦截(失效时不再拦截)
        if (state.boom.active && d.x <= state.boom.x && d.x > state.boom.x - 12) {
          state.debris.splice(i, 1);
          state.intercepted++;
          continue;
        }
        // 撞击幼苗:压弯并损伤
        if (d.x < 880 && d.x > 60) {
          for (const s of seedlings) {
            if (s.alive && Math.abs(s.x - d.x) < 6 && state.waterActual > s.elevation - 0.3) {
              s.bent = true;
              s.health -= 0.35;
              state.debrisHits++;
              pushLog('hit', '漂浮物撞击幼苗#' + s.id + '(压弯)');
              d.x = -1; // 消耗掉
              break;
            }
          }
        }
        if (d.x < 40) state.debris.splice(i, 1);
      }

      // 拦污带在风暴中磨损,可能处置失败
      if (state.boom.active && inStorm) {
        state.boom.integrity -= stormAmp * 0.02 * stormProfile;
        if (state.boom.integrity <= 0) {
          state.boom.active = false;
          state.boom.integrity = 0;
          pushLog('failure', '处置失败:拦污带在风暴中断裂失效(完整度耗尽)');
        }
      }

      // 幼苗:淹水胁迫 + 风暴损伤 + 恢复
      for (const s of seedlings) {
        if (!s.alive) continue;
        if (state.waterActual > s.elevation) {
          s.subHours++;
          if (s.subHours > 10) s.health -= 0.008;
        } else {
          s.subHours = 0;
          s.health = Math.min(1, s.health + 0.005);
        }
        if (inStorm && wind > 6) s.health -= 0.004;
        if (s.health <= 0) {
          s.alive = false;
          pushLog('death', '幼苗#' + s.id + ' 死亡(长期淹水/损伤)');
        }
      }

      // 告警状态(基于观测值)
      state.alarm.water = state.waterObserved >= WATER_CRIT ? 'CRITICAL'
        : state.waterObserved >= WATER_WARN ? 'WARN' : 'OK';
      state.alarm.turbidity = state.turbidity >= TURB_CRIT ? 'CRITICAL'
        : state.turbidity >= TURB_WARN ? 'WARN' : 'OK';
      if (state.alarm.water === 'CRITICAL' && prevWaterAlarm !== 'CRITICAL') {
        pushLog('critical', '临界事件:水位观测值 ' + state.waterObserved.toFixed(2)
          + 'm 超过临界阈值 ' + WATER_CRIT + 'm');
      }
      if (state.alarm.turbidity === 'CRITICAL' && prevTurbAlarm !== 'CRITICAL') {
        pushLog('critical', '临界事件:浊度 ' + state.turbidity.toFixed(0)
          + 'NTU 超过临界阈值 ' + TURB_CRIT + 'NTU');
      }
      prevWaterAlarm = state.alarm.water;
      prevTurbAlarm = state.alarm.turbidity;

      // 存活率
      const alive = seedlings.filter(s => s.alive).length;
      state.survivalRate = alive / seedlings.length;

      // 恢复确认期结束:固定运行 RECOVERY_DAYS 后检查隐藏残留
      if (!state.recoveryChecked && t >= stormEnd + RECOVERY_DAYS) {
        state.recoveryChecked = true;
        // 漂浮物为持续过程,允许基线少量;告警必须清零
        const clean = state.alarm.water === 'OK' && state.alarm.turbidity === 'OK'
          && state.debris.length <= 2;
        state.recoveryClean = clean;
        pushLog('recovery', clean
          ? '恢复确认:连续运行 ' + RECOVERY_DAYS + ' 天,无隐藏残留(告警清零/无漂浮物)'
          : '恢复确认:仍有残留(告警或漂浮物未清零),需继续处置');
      }

      // 九十天评估
      if (!state.evaluated && t >= EVAL_DAY) {
        state.evaluated = true;
        state.success = state.survivalRate >= SURVIVAL_TARGET;
        pushLog('eval', '九十天评估:存活率 ' + (state.survivalRate * 100).toFixed(1)
          + '% ' + (state.success ? '达标,修复成功' : '未达标,修复失败'));
      }

      runCompares();
    }

    function getState() {
      return {
        seed: state.seed,
        day: +state.day.toFixed(3),
        phase: state.phase,
        waterActual: +state.waterActual.toFixed(3),
        waterObserved: +state.waterObserved.toFixed(3),
        turbidity: +state.turbidity.toFixed(1),
        wind: +wind.toFixed(1),
        rain: +rain.toFixed(1),
        alarm: { water: state.alarm.water, turbidity: state.alarm.turbidity },
        seedlings: seedlings.map(s => ({
          id: s.id, x: +s.x.toFixed(1), elevation: +s.elevation.toFixed(2),
          health: +s.health.toFixed(2), bent: s.bent, alive: s.alive,
        })),
        channels: channels.map(c => ({
          id: c.id, x: +c.x.toFixed(1), width: +c.width.toFixed(2), baseWidth: +c.baseWidth.toFixed(2),
        })),
        debris: state.debris.map(d => ({ x: +d.x.toFixed(1) })),
        intercepted: state.intercepted,
        debrisHits: state.debrisHits,
        boom: {
          active: state.boom.active,
          integrity: +state.boom.integrity.toFixed(2),
          x: state.boom.x,
        },
        currentIntervention: state.currentIntervention,
        survivalRate: +state.survivalRate.toFixed(3),
        aliveCount: seedlings.filter(s => s.alive).length,
        totalCount: seedlings.length,
        sedimentLoss: +state.sedimentLoss.toFixed(2),
        recoveryChecked: state.recoveryChecked,
        recoveryClean: state.recoveryClean,
        evaluated: state.evaluated,
        success: state.success,
        stormStart,
        stormEnd: stormStart + stormDuration,
      };
    }

    return {
      step,
      getState,
      applyIntervention,
      getLog: () => log.slice(),
      constants: {
        TICKS_PER_DAY, HORIZON_DAYS, EVAL_DAY, RECOVERY_DAYS,
        SURVIVAL_TARGET, WATER_WARN, WATER_CRIT, TURB_WARN, TURB_CRIT,
      },
    };
  }

  return { createSim };
});
