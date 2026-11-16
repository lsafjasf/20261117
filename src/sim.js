// 线材包胶机仿真核心：生产 / 能耗 / 缓存共用同一仿真时钟。
// 浏览器与 Node 通用（Node 用于自动化流程验证）。
(function (global) {
  'use strict';

  var SPECS = [
    { id: 'A', name: '细线 1.8mm', od: 1.8, tempMin: 168, tempOpt: 180, tempMax: 205 },
    { id: 'B', name: '中线 2.4mm', od: 2.4, tempMin: 175, tempOpt: 190, tempMax: 215 },
    { id: 'C', name: '粗线 3.0mm', od: 3.0, tempMin: 182, tempOpt: 198, tempMax: 225 }
  ];

  var CFG = {
    dt: 0.1,               // 仿真步长（秒），全系统共用一个时钟
    segmentLength: 100,    // 每种规格需完成的线段长度（米）
    defectAllowRatio: 0.05,// 段内缺陷占比 <= 5% 判为良品
    odTolerance: 0.08,     // 外径允许偏差（mm）
    poolCapacity: 100,     // 熔料缓存池容量（单位）
    poolStart: 40,
    feedRate: 1.6,         // 进料速率（单位/秒）
    purgeTime: 6,          // 换规格清料耗时（秒）
    purgeMaterial: 12,     // 清料消耗缓存
    tempAmbient: 25,
    heatRate: 3.0,         // 加热速率 °C/s（满功率）
    coolRate: 0.8,         // 自然冷却 °C/s
    tempHardMax: 260,      // 超温硬上限 -> 停机
    contamLength: 8        // 未清料换规格后的污染长度（米）
  };

  function round1(x) { return Math.round(x * 10) / 10; }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function now(m) { return Math.round(m.clock * 1000) / 1000; }

  function snapshot(m) {
    return {
      t: now(m),
      spec: m.spec.id,
      speed: round1(m.speed),
      temp: round1(m.temp),
      tension: round1(m.tension),
      od: round3(m.od),
      pool: round1(m.pool),
      energy: round3(m.energy),
      running: m.running
    };
  }

  function log(m, type, msg, extra) {
    var e = { t: now(m), type: type, msg: msg, values: snapshot(m) };
    if (extra) { for (var k in extra) e[k] = extra[k]; }
    m.events.push(e);
    return e;
  }

  function createMachine() {
    var m = {
      clock: 0,                 // 唯一仿真时钟（秒）
      running: false,           // 设备运行状态
      paused: false,            // 仿真暂停（时钟停走）
      spec: SPECS[0],
      speed: 0,                 // 挤出速度 rpm 0..120
      temp: CFG.tempAmbient,    // 模头温度
      tempTarget: SPECS[0].tempOpt,
      tension: 40,              // 收线张力 0..100
      od: 0,                    // 当前实际外径
      pool: CFG.poolStart,      // 熔料缓存（缓存状态）
      energy: 0,                // 累计能耗 kWh
      power: 0,                 // 当前功率 kW
      contaminated: false,      // 换规格未清料
      purging: 0,               // 剩余清料秒数
      shutdown: null,           // 停机原因或 null
      segmentIndex: 0,
      segLength: 0,             // 当前段已生产长度
      segDefect: 0,             // 当前段缺陷长度
      segments: [],             // 已完成段结果
      events: [],               // 事件日志
      peaks: { temp: 0, speed: 0, tension: 0, power: 0, odDev: 0 },
      anomalies: [],            // 异常位置记录
      activeDefects: {},        // 缺陷类型 -> 起始记录（用于恢复判定）
      inspected: false,
      success: false
    };
    log(m, 'device', '设备初始化完成');
    return m;
  }

  // ---- 玩家操作 ----
  function setSpeed(m, v) {
    v = clamp(Math.round(v), 0, 120);
    if (v !== m.speed) { log(m, 'param', '挤出速度 ' + m.speed + ' -> ' + v + ' rpm'); m.speed = v; }
  }
  function setTempTarget(m, v) {
    v = clamp(Math.round(v), 120, 280);
    if (v !== m.tempTarget) { log(m, 'param', '模头温度目标 ' + m.tempTarget + ' -> ' + v + ' °C'); m.tempTarget = v; }
  }
  function setTension(m, v) {
    v = clamp(Math.round(v), 0, 100);
    if (v !== m.tension) { log(m, 'param', '收线张力 ' + m.tension + ' -> ' + v + ' %'); m.tension = v; }
  }

  function start(m) {
    if (m.shutdown) { log(m, 'device', '启动被拒绝：设备处于停机状态（' + m.shutdown + '）'); return false; }
    if (!m.running) { m.running = true; log(m, 'device', '挤出机启动'); }
    return true;
  }
  function stop(m, reason) {
    if (m.running) { m.running = false; log(m, 'device', '挤出机停止' + (reason ? '：' + reason : '')); }
  }
  function tripShutdown(m, reason) {
    m.running = false;
    m.shutdown = reason;
    log(m, 'shutdown', '设备停机：' + reason, { reason: reason });
  }
  function clearShutdown(m) {
    if (!m.shutdown) return false;
    var reason = m.shutdown;
    m.shutdown = null;
    m.pool = Math.min(m.pool, CFG.poolCapacity * 0.6); // 检修后泄压
    m.temp = Math.min(m.temp, CFG.tempHardMax - 30);     // 检修后降温至安全范围
    log(m, 'device', '故障复位完成（原停机原因：' + reason + '）', { recoveredFrom: reason });
    return true;
  }

  function selectSpec(m, id) {
    var spec = null;
    for (var i = 0; i < SPECS.length; i++) if (SPECS[i].id === id) spec = SPECS[i];
    if (!spec || spec.id === m.spec.id) return false;
    var old = m.spec.id;
    m.spec = spec;
    m.contaminated = true; // 模头内残留旧料，必须清料
    log(m, 'param', '切换规格 ' + old + ' -> ' + spec.id + '（目标外径 ' + spec.od + 'mm），需清料');
    return true;
  }

  function purge(m) {
    if (m.purging > 0) return false;
    if (m.pool < CFG.purgeMaterial) { log(m, 'device', '清料失败：缓存熔料不足'); return false; }
    m.purging = CFG.purgeTime;
    log(m, 'device', '开始清料（排出旧料 ' + CFG.purgeMaterial + ' 单位）');
    return true;
  }

  // ---- 仿真步进：生产 / 能耗 / 缓存共用 m.clock ----
  function step(m) {
    if (m.paused || m.inspected) return false;
    var dt = CFG.dt;
    m.clock += dt;

    // 温度惯性：向目标温度趋近；停机时自然冷却
    var heaterOn = !m.shutdown && m.tempTarget > m.temp;
    if (heaterOn) m.temp += CFG.heatRate * dt * (m.running ? 1 : 0.6);
    else m.temp = Math.max(CFG.tempAmbient, m.temp - CFG.coolRate * dt);

    // 缓存：进料持续，挤出消耗；清料额外消耗
    var extrude = m.running ? (m.speed / 120) * 3.2 : 0; // 单位/秒
    var feed = (m.running && !m.shutdown) ? CFG.feedRate : 0;
    m.pool += (feed - extrude) * dt;
    if (m.purging > 0) {
      m.purging -= dt;
      m.pool -= (CFG.purgeMaterial / CFG.purgeTime) * dt;
      if (m.purging <= 0) {
        m.purging = 0;
        if (m.contaminated) { m.contaminated = false; log(m, 'device', '清料完成，旧料已排净'); }
        else log(m, 'device', '清料完成');
      }
    }
    if (m.pool < 0) m.pool = 0;

    // 能耗：加热 + 挤出电机 + 牵引电机（共用此时钟累计）
    var power = 0;
    if (!m.shutdown) {
      power += heaterOn ? 6.0 : 0.4;                 // 加热器 kW / 保温
      power += m.running ? (m.speed / 120) * 7.5 : 0; // 挤出电机
      power += m.running ? (m.tension / 100) * 1.5 : 0; // 牵引电机
    }
    m.power = power;
    m.energy += power * dt / 3600;

    // 停机保护（已停机则不重复触发）
    if (!m.shutdown) {
      if (m.temp >= CFG.tempHardMax) { tripShutdown(m, '模头超温 ' + round1(m.temp) + '°C ≥ ' + CFG.tempHardMax + '°C'); return true; }
      if (m.pool >= CFG.poolCapacity) { tripShutdown(m, '熔料缓存溢出（' + round1(m.pool) + '/' + CFG.poolCapacity + '）'); return true; }
    }

    // 生产：线速度、实际外径、质量判定
    if (m.running && m.speed > 0 && m.purging <= 0 && m.pool > 0.5) {
      var lineSpeed = (m.speed / 120) * 2.0 * (0.6 + 0.4 * m.tension / 100); // m/s
      // 外径：规格基准 + 速度偏厚 - 张力拉细
      var od = m.spec.od
        + (m.speed - 60) * 0.004
        - (m.tension - 40) * 0.006
        - (m.temp - m.spec.tempOpt) * 0.0005;
      m.od = od;
      var len = lineSpeed * dt;
      m.segLength += len;

      var defects = [];
      if (m.temp < m.spec.tempMin) defects.push('温度不足-表面粗糙');
      if (m.temp > m.spec.tempMax) defects.push('温度过高-材料降解');
      if (Math.abs(od - m.spec.od) > CFG.odTolerance) {
        defects.push(od < m.spec.od ? '牵引过快-外径拉细' : '外径偏粗');
      }
      if (m.contaminated) defects.push('未清料-旧料污染');
      if (m.pool < 2) defects.push('缓存不足-供料断续');

      for (var i = 0; i < defects.length; i++) defectOn(m, defects[i], len);
      for (var k in m.activeDefects) {
        if (defects.indexOf(k) < 0) defectOff(m, k);
      }
      if (defects.length) m.segDefect += len;

      if (m.segLength >= CFG.segmentLength) finishSegment(m);
    } else {
      m.od = 0;
      for (var k2 in m.activeDefects) defectOff(m, k2);
    }

    // 峰值统计
    if (m.temp > m.peaks.temp) m.peaks.temp = round1(m.temp);
    if (m.speed > m.peaks.speed) m.peaks.speed = m.speed;
    if (m.tension > m.peaks.tension) m.peaks.tension = m.tension;
    if (power > m.peaks.power) m.peaks.power = round3(power);
    var dev = Math.abs(m.od - m.spec.od);
    if (m.od > 0 && dev > m.peaks.odDev) m.peaks.odDev = round3(dev);
    return true;
  }

  function defectOn(m, type, len) {
    if (m.activeDefects[type]) { m.activeDefects[type].len += len; return; }
    var rec = {
      type: type, spec: m.spec.id, segment: m.segmentIndex,
      startT: now(m), startPos: round1(m.segLength), len: len,
      values: snapshot(m), recovered: false, recoverT: null
    };
    m.activeDefects[type] = rec;
    m.anomalies.push(rec);
    log(m, 'quality', '缺陷出现：' + type + '（段 ' + m.segmentIndex + ' @ ' + round1(m.segLength) + 'm）');
  }

  function defectOff(m, type) {
    var rec = m.activeDefects[type];
    if (!rec) return;
    rec.recovered = true;
    rec.recoverT = now(m);
    rec.len = round1(rec.len);
    log(m, 'quality', '缺陷恢复：' + type + '（持续 ' + round1(rec.recoverT - rec.startT) + 's，影响 ' + rec.len + 'm）');
    delete m.activeDefects[type];
  }

  function finishSegment(m) {
    var ratio = m.segDefect / m.segLength;
    var good = ratio <= CFG.defectAllowRatio;
    var seg = {
      index: m.segmentIndex, spec: m.spec.id, targetOd: m.spec.od,
      length: round1(m.segLength), defectLength: round1(m.segDefect),
      defectRatio: round3(ratio), good: good, finishT: now(m)
    };
    m.segments.push(seg);
    log(m, 'batch', '段 ' + m.segmentIndex + '（规格 ' + m.spec.id + '）完成：' +
      (good ? '良品' : '不良') + '，缺陷率 ' + (ratio * 100).toFixed(1) + '%', { segment: seg });
    m.segmentIndex++;
    m.segLength = 0;
    m.segDefect = 0;
  }

  // 末端检查：三段全部完成且均为良品 -> 成功
  function inspect(m) {
    if (m.segments.length < SPECS.length) {
      log(m, 'batch', '末端检查未通过：仅完成 ' + m.segments.length + '/' + SPECS.length + ' 段');
      return false;
    }
    m.inspected = true;
    m.success = m.segments.every(function (s) { return s.good; });
    log(m, 'batch', '末端检查完成：' + (m.success ? '全部合格，批次成功' : '存在不良段，批次失败'));
    return m.success;
  }

  // ---- 时钟控制：暂停 / 单步 / 批次重置 ----
  function pause(m) {
    if (!m.paused) { m.paused = true; log(m, 'device', '仿真暂停（可检查当前批次状态）'); }
  }
  function resume(m) {
    if (m.paused) { m.paused = false; log(m, 'device', '仿真恢复，继续当前批次'); }
  }
  function stepOnce(m) { // 单步：暂停状态下推进一个时钟步
    var was = m.paused;
    m.paused = false;
    var ok = step(m);
    m.paused = was;
    return ok;
  }
  // 批次重置：清空缓存与全部批次状态，不保留任何旧缓存
  function resetBatch(m) {
    var fresh = createMachine();
    for (var k in m) delete m[k];
    for (var k2 in fresh) m[k2] = fresh[k2];
    log(m, 'device', '批次重置：缓存、能耗、事件与段记录已全部清空');
    return m;
  }

  // ---- 报告导出：良品数、峰值、停机原因、异常位置 ----
  function exportReport(m) {
    var good = m.segments.filter(function (s) { return s.good; }).length;
    var shutdowns = m.events.filter(function (e) { return e.type === 'shutdown'; })
      .map(function (e) { return { t: e.t, reason: e.reason, values: e.values }; });
    return {
      simTime: now(m),
      inspected: m.inspected,
      success: m.success,
      goodCount: good,
      totalCount: m.segments.length,
      goodRate: m.segments.length ? round3(good / m.segments.length) : 0,
      segments: m.segments,
      peaks: m.peaks,
      energyKWh: round3(m.energy),
      shutdownReasons: shutdowns,
      anomalies: m.anomalies.map(function (a) {
        return {
          type: a.type, spec: a.spec, segment: a.segment,
          positionM: a.startPos, triggerT: a.startT,
          recovered: a.recovered, recoverT: a.recoverT,
          affectedM: a.len, values: a.values
        };
      }),
      events: m.events
    };
  }

  var API = {
    SPECS: SPECS, CFG: CFG,
    createMachine: createMachine,
    setSpeed: setSpeed, setTempTarget: setTempTarget, setTension: setTension,
    start: start, stop: stop, clearShutdown: clearShutdown,
    selectSpec: selectSpec, purge: purge,
    step: step, stepOnce: stepOnce,
    pause: pause, resume: resume, resetBatch: resetBatch,
    inspect: inspect, exportReport: exportReport, log: log
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.WireSim = API;
})(typeof window !== 'undefined' ? window : globalThis);
