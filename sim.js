/* 保护区自动相机监测模拟核心 —— 确定性、可在浏览器与 Node 中运行。
 * 同 seed 重开时：天气序列、目标位置、动物行为完全复现。
 * 区分：观测值(带噪声/延迟) / 实际值(真值) / 告警状态(由观测值越限触发)。
 */
(function (global) {
  'use strict';

  // ---------- 确定性随机 ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 整数哈希噪声：天气必须是 (seed, t) 的纯函数，保证重开复现
  function hashNoise(seed, n) {
    let h = (seed ^ Math.imul(n, 0x9E3779B1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x21F0AAAD);
    h = Math.imul(h ^ (h >>> 15), 0x735A2D97);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  function valueNoise(seed, t, scale) {
    const x = t / scale;
    const i = Math.floor(x);
    const f = x - i;
    const a = hashNoise(seed, i);
    const b = hashNoise(seed, i + 1);
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }

  // ---------- 天气序列：纯函数 (seed, t) ----------
  function weatherAt(seed, t) {
    const day = (t / 120) * Math.PI * 2; // 120s 一个昼夜循环(加速)
    const sev = Math.min(1, 0.35 + t / 120); // 强度渐入：开局平稳，利于稳态观察
    const temp = -10 - 8 * sev
      + 6 * Math.sin(day - 1.2) * (0.4 + 0.6 * sev)
      + (valueNoise(seed ^ 0x11, t, 45) - 0.5) * 8 * sev
      - (valueNoise(seed ^ 0x22, t, 300) > 0.72 ? 9 * sev : 0); // 寒潮
    const wind = 2 + valueNoise(seed ^ 0x33, t, 30) * 12 * sev
      + (valueNoise(seed ^ 0x44, t, 9) > 0.8 ? 6 * sev : 0); // 阵风
    const snowRaw = valueNoise(seed ^ 0x55, t, 90);
    let snowfall = Math.max(0, snowRaw - 0.52) * 3.2 * sev; // 间歇性降雪/暴雪
    // 开局 90s 保护期：不会寒潮/暴雪，保证可观察的稳态
    let temp2 = temp;
    if (t < 90) { temp2 = Math.max(temp2, -16); snowfall = Math.min(snowfall, 1.0); }
    return { temp: temp2, wind, snowfall };
  }

  const SPECIES = ['雪豹', '岩羊', '赤狐', '旱獭', '雪鸡', '猞猁'];
  const CAM_DEFS = [
    { x: 18, y: 62, angle: -0.5 },
    { x: 50, y: 40, angle: 0.2 },
    { x: 80, y: 58, angle: 0.7 },
  ];
  const CAM_RANGE = 26;        // 覆盖半径(场景单位)
  const CAM_HALF_ANGLE = 0.62; // 覆盖半角(弧度)

  const THRESH = {
    batteryLow: 20,       // 低电量告警(%)
    lensCovered: 0.7,     // 镜头被雪覆盖告警
    coldSnap: -18,        // 寒潮告警(℃)
    blizzard: 1.2,        // 暴雪告警
    captureLensMax: 0.45, // 超过则影像无效
    lightAvoid: 0.6,      // 超过则动物绕开强光
    wipeFailSnow: 1.0,    // 风雪过大导致擦拭失败
    batteryFailTemp: -20, // 低温导致换电池失败
    heatMinBattery: 15,   // 加热所需最低电量
  };

  const RECOVERY_WATCH = 60;  // 告警恢复后固定观察时长(s)，确认无隐藏残留
  const REPORT_SETTLE = 30;   // 干预后指标对比的沉降窗口(s)

  // ---------- 模拟器 ----------
  function createSim(seed) {
    seed = (seed >>> 0) || 1;
    const rng = mulberry32(seed ^ 0xBEEF); // 动物行为流

    const animals = [];
    for (let i = 0; i < 5; i++) {
      animals.push({
        id: i,
        species: SPECIES[i % SPECIES.length],
        x: 8 + rng() * 84,
        y: 15 + rng() * 70,
        heading: rng() * Math.PI * 2,
        speed: 1.8 + rng() * 1.8,
        avoidT: 0,        // 躲避强光剩余时间
        dwell: 0,         // 在覆盖区内的驻留计时
        captured: false,
      });
    }

    const cams = CAM_DEFS.map((d, i) => ({
      id: i,
      x: d.x, y: d.y, angle: d.angle,
      on: false,
      battery: 55 + Math.floor(hashNoise(seed, 900 + i) * 20), // 初始电量由 seed 决定
      lensSnow: 0.2 + 0.35 * hashNoise(seed, 950 + i),
      light: 0.35,        // 补光强度 0..1，玩家可调
      heaterT: 0,         // 加热剩余时间
      captureProgress: 0,
    }));

    const S = {
      seed,
      t: 0,
      env: {              // 实际值(真值)
        temp: -12, wind: 3, snowfall: 0,
        snowWater: 12,    // 积雪水位 mm
        pollution: 30,    // 污染指数
        activity: 0.5,    // 物种活动指数 0..1
      },
      obs: {              // 观测值(延迟+噪声，每 2s 采样一次)
        temp: -12, wind: 3, snowfall: 0,
        snowWater: 12, pollution: 30, activity: 0.5,
        battery: cams.map(c => c.battery),
        lensSnow: cams.map(c => c.lensSnow),
        signal: [0, 0, 0],
        sampledAt: 0,
      },
      animals, cams,
      footprints: [],     // {x,y,species,t}
      captures: [],       // 有效影像 {t, cam, species}
      alarms: [],         // {key,type,cam,triggerT,clearT,active,value}
      log: [],            // {t, kind, msg}
      interventions: [],  // 当前/历史干预 {t,type,cam,ok,reason}
      reports: [],        // 干预前后指标对比 {t,type,cam,ok,before,after}
      pendingReports: [], // 等待沉降窗口结束
      recoveryWatch: [],  // {alarmKey, until, done, relapsed}
      success: false,
      successT: null,
    };

    function log(kind, msg) {
      S.log.push({ t: S.t, kind, msg });
    }

    function metricsSnapshot() {
      return {
        activity: +S.env.activity.toFixed(3),
        snowWater: +S.env.snowWater.toFixed(2),
        pollution: +S.env.pollution.toFixed(2),
      };
    }

    // 告警：由观测值越限触发，记录触发时刻与解除时刻
    function setAlarm(key, type, cam, active, value) {
      let a = S.alarms.find(x => x.key === key);
      if (!a) {
        a = { key, type, cam, triggerT: null, clearT: null, active: false, value: 0 };
        S.alarms.push(a);
      }
      a.value = value;
      if (active && !a.active) {
        a.active = true;
        a.triggerT = S.t;
        a.clearT = null;
        log('alarm', `告警触发 [${type}] 相机${cam === null ? '-' : cam + 1} 值=${(+value).toFixed(2)}`);
      } else if (!active && a.active) {
        a.active = false;
        a.clearT = S.t;
        log('recover', `告警解除 [${type}] 相机${cam === null ? '-' : cam + 1}，进入 ${RECOVERY_WATCH}s 残留观察`);
        S.recoveryWatch.push({ alarmKey: key, until: S.t + RECOVERY_WATCH, done: false, relapsed: false });
      }
    }

    function angleDiff(a, b) {
      let d = a - b;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    }

    function inCoverage(cam, a) {
      const dx = a.x - cam.x, dy = a.y - cam.y;
      const dist = Math.hypot(dx, dy);
      if (dist > CAM_RANGE) return false;
      return Math.abs(angleDiff(Math.atan2(dy, dx), cam.angle)) < CAM_HALF_ANGLE;
    }

    // 环境连续变化
    function stepEnv(dt) {
      const w = weatherAt(S.seed, S.t);
      S.env.temp = w.temp;
      S.env.wind = w.wind;
      S.env.snowfall = w.snowfall;
      // 积雪水位：降雪累积，0℃ 以上融化
      S.env.snowWater = Math.max(0,
        S.env.snowWater + w.snowfall * dt * 0.8
        - (w.temp > 0 ? 0.6 * dt : 0)
        - 0.01 * dt);
      // 污染指数：风大扬尘升高，降雪净化空气
      S.env.pollution = Math.max(5, Math.min(100,
        S.env.pollution + (w.wind - 6) * 0.05 * dt - w.snowfall * 0.5 * dt));
      // 物种活动：晨昏高、暴雪大风低
      const day = (S.t / 120) * Math.PI * 2;
      const diurnal = 0.5 + 0.4 * Math.cos(day - 0.6);
      S.env.activity = Math.max(0.02, Math.min(1,
        diurnal - w.snowfall * 0.25 - Math.max(0, w.wind - 9) * 0.04));
    }

    // 观测值：2s 采样一次，带噪声与量化 —— 与实际值分离
    function stepObserve() {
      if (S.t - S.obs.sampledAt < 2) return;
      S.obs.sampledAt = S.t;
      const n = (amp) => (hashNoise(S.seed ^ 0xAB, Math.round(S.t * 7)) - 0.5) * amp;
      S.obs.temp = +(S.env.temp + n(1.2)).toFixed(1);
      S.obs.wind = +Math.max(0, S.env.wind + n(1.5)).toFixed(1);
      S.obs.snowfall = +Math.max(0, S.env.snowfall + n(0.15)).toFixed(2);
      S.obs.snowWater = +Math.max(0, S.env.snowWater + n(0.8)).toFixed(1);
      S.obs.pollution = +Math.max(0, S.env.pollution + n(3)).toFixed(1);
      S.obs.activity = +Math.max(0, Math.min(1, S.env.activity + n(0.06))).toFixed(2);
      S.cams.forEach((c, i) => {
        S.obs.battery[i] = Math.max(0, Math.round(c.battery + n(2)));
        S.obs.lensSnow[i] = +Math.max(0, Math.min(1, c.lensSnow + n(0.05))).toFixed(2);
      });
    }

    // 动物：游荡、留足迹、绕开强光、被有效拍摄
    function stepAnimals(dt) {
      for (const a of S.animals) {
        if (a.captured) continue;
        a.heading += (rng() - 0.5) * 0.6 * dt;
        let sp = a.speed * (0.4 + S.env.activity);
        if (a.avoidT > 0) { a.avoidT -= dt; sp *= 2.2; } // 躲避强光时加速逃离
        a.x += Math.cos(a.heading) * sp * dt;
        a.y += Math.sin(a.heading) * sp * dt;
        if (a.x < 4 || a.x > 96) { a.heading = Math.PI - a.heading; a.x = Math.max(4, Math.min(96, a.x)); }
        if (a.y < 8 || a.y > 92) { a.heading = -a.heading; a.y = Math.max(8, Math.min(92, a.y)); }
        // 留下足迹(随时间消退)
        if (rng() < 0.25 * dt * 10) {
          S.footprints.push({ x: a.x, y: a.y, species: a.species, t: S.t });
        }
        for (const cam of S.cams) {
          if (!cam.on || cam.battery <= 0) continue;
          if (!inCoverage(cam, a)) continue;
          if (cam.light > THRESH.lightAvoid) {
            if (a.avoidT <= 0) {
              a.avoidT = 6;
              a.heading = Math.atan2(a.y - cam.y, a.x - cam.x); // 背向相机逃离
              log('avoid', `${a.species} 绕开相机${cam.id + 1} 的强光`);
            }
            continue;
          }
          if (cam.lensSnow > THRESH.captureLensMax) continue; // 镜头被雪覆盖，影像无效
          cam.captureProgress += dt;
          if (cam.captureProgress >= 8) { // 需连续驻留 8s 才成像
            cam.captureProgress = 0;
            a.captured = true;
            S.captures.push({ t: S.t, cam: cam.id, species: a.species });
            log('capture', `获得有效影像：${a.species} @相机${cam.id + 1}（${S.captures.length}/3）`);
            if (S.captures.length >= 3 && !S.success) {
              S.success = true;
              S.successT = S.t;
              log('success', `集齐三组有效影像，监测成功！`);
            }
            break;
          }
        }
      }
      // 足迹 120s 后消融
      S.footprints = S.footprints.filter(f => S.t - f.t < 120);
    }

    // 相机：电池低温快速下降、镜头积雪、加热融雪
    function stepCams(dt) {
      for (const cam of S.cams) {
        if (cam.on && cam.battery > 0) {
          const coldFactor = S.env.temp < 0 ? 1 + Math.min(2.5, -S.env.temp / 10) : 1;
          let drain = 0.10 * coldFactor * (1 + cam.light * 0.8);
          if (cam.heaterT > 0) drain *= 2.2; // 加热耗电
          cam.battery = Math.max(0, cam.battery - drain * dt);
          if (cam.battery <= 0) {
            cam.on = false;
            log('device', `相机${cam.id + 1} 电量耗尽自动关机`);
          }
        }
        // 镜头积雪：降雪累积；加热或气温>0 时融化
        cam.lensSnow = Math.max(0, Math.min(1,
          cam.lensSnow + S.env.snowfall * 0.015 * dt
          - (cam.heaterT > 0 ? 0.08 * dt : 0)
          - (S.env.temp > 0 ? 0.02 * dt : 0)));
        if (cam.heaterT > 0) cam.heaterT -= dt;
        // 无合格目标驻留时，成像进度逐渐消退
        const occupied = cam.on && cam.battery > 0 && S.animals.some(a =>
          !a.captured && a.avoidT <= 0 && inCoverage(cam, a)
          && cam.light <= THRESH.lightAvoid && cam.lensSnow <= THRESH.captureLensMax);
        if (!occupied) cam.captureProgress = Math.max(0, cam.captureProgress - dt * 1.0);
      }
    }

    // 信号强度：相机探测范围内最近动物的距离(观测线索)
    function stepSignals() {
      S.cams.forEach((cam, i) => {
        let best = Infinity;
        for (const a of S.animals) {
          if (a.captured) continue;
          const d = Math.hypot(a.x - cam.x, a.y - cam.y);
          if (d < CAM_RANGE * 1.6 && d < best) best = d;
        }
        S.obs.signal[i] = best === Infinity ? 0 : +(1 - best / (CAM_RANGE * 1.6)).toFixed(2);
      });
    }

    // 告警评估：基于观测值
    function stepAlarms() {
      // 迟滞：触发与解除使用不同阈值，避免边界抖动
      const hys = (key, trigger, clear) => {
        const a = S.alarms.find(x => x.key === key);
        return a && a.active ? !clear : trigger;
      };
      S.cams.forEach((cam, i) => {
        setAlarm(`bat${i}`, '低电量', i,
          hys(`bat${i}`, S.obs.battery[i] < THRESH.batteryLow, S.obs.battery[i] > THRESH.batteryLow + 6),
          S.obs.battery[i]);
        setAlarm(`lens${i}`, '镜头覆盖', i,
          hys(`lens${i}`, S.obs.lensSnow[i] > THRESH.lensCovered, S.obs.lensSnow[i] < THRESH.lensCovered - 0.15),
          S.obs.lensSnow[i]);
      });
      setAlarm('cold', '寒潮', null,
        hys('cold', S.obs.temp < THRESH.coldSnap, S.obs.temp > THRESH.coldSnap + 1.5), S.obs.temp);
      setAlarm('blizzard', '暴雪', null,
        hys('blizzard', S.obs.snowfall > THRESH.blizzard, S.obs.snowfall < THRESH.blizzard - 0.3), S.obs.snowfall);
    }

    // 恢复观察：固定时长内确认无隐藏残留
    function stepRecovery() {
      for (const w of S.recoveryWatch) {
        if (w.done) continue;
        const a = S.alarms.find(x => x.key === w.alarmKey);
        if (a && a.active) {
          w.relapsed = true;
          w.done = true;
          log('alarm', `残留复发：[${a.type}] 在观察期内再次触发`);
        } else if (S.t >= w.until) {
          w.done = true;
          log('recover', `恢复确认：[${a ? a.type : w.alarmKey}] ${RECOVERY_WATCH}s 内无隐藏残留`);
        }
      }
    }

    // 干预报告沉降：窗口结束后补齐 after 指标
    function stepReports() {
      for (const r of S.pendingReports) {
        if (S.t >= r.settleAt) {
          r.report.after = metricsSnapshot();
          S.reports.push(r.report);
          log('report', `干预对比 [${r.report.type}] 物种活动 ${r.report.before.activity}→${r.report.after.activity}，`
            + `积雪水位 ${r.report.before.snowWater}→${r.report.after.snowWater}mm，`
            + `污染 ${r.report.before.pollution}→${r.report.after.pollution}`);
        }
      }
      S.pendingReports = S.pendingReports.filter(r => !r.report.after);
    }

    function step(dt) {
      S.t += dt;
      stepEnv(dt);
      stepObserve();
      stepAnimals(dt);
      stepCams(dt);
      stepSignals();
      stepAlarms();
      stepRecovery();
      stepReports();
    }

    // ---------- 干预措施（含处置失败路径） ----------
    function intervene(camId, type) {
      const cam = S.cams[camId];
      const before = metricsSnapshot();
      let ok = true, reason = '';
      if (type === 'wipe') { // 除雪擦拭：风雪过大时失败
        if (S.env.snowfall > THRESH.wipeFailSnow) {
          ok = false;
          reason = `风雪过大(${(+S.env.snowfall).toFixed(2)}>${THRESH.wipeFailSnow})，擦拭无效`;
          cam.lensSnow *= 0.6; // 仅部分清除
        } else {
          cam.lensSnow = 0;
        }
      } else if (type === 'battery') { // 更换电池：低温冷浸失败
        if (S.env.temp < THRESH.batteryFailTemp) {
          ok = false;
          reason = `低温(${(+S.env.temp).toFixed(1)}℃<${THRESH.batteryFailTemp}℃)导致新电池冷浸，更换失败`;
          cam.battery = Math.min(100, cam.battery + 25);
        } else {
          cam.battery = 100;
        }
      } else if (type === 'heat') { // 加热除冰：电量不足无法启动
        if (cam.battery < THRESH.heatMinBattery) {
          ok = false;
          reason = `电量不足(${(+cam.battery).toFixed(0)}%<${THRESH.heatMinBattery}%)，加热启动失败`;
        } else {
          cam.heaterT = 30;
        }
      }
      const rec = { t: S.t, type, cam: camId, ok, reason };
      S.interventions.push(rec);
      if (ok) {
        log('action', `干预成功 [${type}] 相机${camId + 1}`);
      } else {
        log('fail', `处置失败 [${type}] 相机${camId + 1}：${reason}`);
      }
      S.pendingReports.push({
        settleAt: S.t + REPORT_SETTLE,
        report: { t: S.t, type, cam: camId, ok, reason, before, after: null },
      });
      return rec;
    }

    function setCameraOn(i, on) {
      const cam = S.cams[i];
      if (on && cam.battery <= 0) return false;
      cam.on = !!on;
      log('device', `相机${i + 1} ${cam.on ? '开机' : '关机'}`);
      return true;
    }

    function setLight(i, v) {
      S.cams[i].light = Math.max(0, Math.min(1, v));
    }

    function snapshot() {
      return {
        seed: S.seed, t: S.t,
        env: { ...S.env },
        obs: { ...S.obs, battery: [...S.obs.battery], lensSnow: [...S.obs.lensSnow], signal: [...S.obs.signal] },
        cams: S.cams.map(c => ({ ...c })),
        animals: S.animals.map(a => ({ ...a })),
        footprints: S.footprints.map(f => ({ ...f })),
        captures: [...S.captures],
        alarms: S.alarms.map(a => ({ ...a })),
        log: [...S.log],
        interventions: [...S.interventions],
        reports: [...S.reports],
        recoveryWatch: S.recoveryWatch.map(w => ({ ...w })),
        success: S.success, successT: S.successT,
      };
    }

    return { step, intervene, setCameraOn, setLight, snapshot, state: S, THRESH, RECOVERY_WATCH };
  }

  const api = { createSim, weatherAt, THRESH, CAM_DEFS, CAM_RANGE, CAM_HALF_ANGLE, SPECIES, RECOVERY_WATCH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SimCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
