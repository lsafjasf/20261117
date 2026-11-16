/* 药片装瓶线仿真核心:生产、能耗、缓存共用同一仿真时钟。
   环境无关(无 DOM),可在浏览器与 Node 中运行。 */
(function (global) {
'use strict';

var DT = 1 / 60;               // 固定步长(秒),所有子系统共用
var BATCH_SIZE = 12;           // 每批 12 瓶
var CACHE_CAP = 150;           // 缓存容量(粒)
var CACHE_INIT = 60;           // 批次重置后的初始缓存
var FILL_X = 560;              // 灌装头 x 坐标(px)
var FILL_HALF = 40;            // 灌装窗口半宽(px)
var BELT_Y = 430;              // 传送带顶面 y
var PITCH = 96;                // 瓶间距(px)
var PILL_FALL = 380;           // 药片下落速度(px/s)
var DROP_Y0 = 190;             // 落料闸出口 y
var JAM_LIMIT = 100;           // 卡料阈值
var MIN_INTERVAL_K = 4 / 85;   // 过密判定:间隔 < K*sizeFactor 即过密

var SPECS = {
  S: { key: 'S', label: 'S 小片', target: 30, sizeFactor: 0.75, feed: 1.2, pillR: 3 },
  M: { key: 'M', label: 'M 中片', target: 20, sizeFactor: 1.0,  feed: 1.0, pillR: 4 },
  L: { key: 'L', label: 'L 大片', target: 12, sizeFactor: 1.4,  feed: 0.8, pillR: 5 }
};

function Sim() {
  this.logs = [];        // 持久事件日志(批次重置不清除)
  this.events = [];      // 供 UI/声音消费的瞬时事件队列
  this.reports = {};     // 验证场景报告
  this.specKey = 'M';
  this.paused = false;
  this.devices = {
    vib:  { on: false, level: 55 },
    gate: { on: false, level: 50 },
    conv: { on: false, level: 50 }
  };
  this.resetBatch('init');
}

Sim.prototype.spec = function () { return SPECS[this.specKey]; };

/* 批次重置:清空缓存、瓶位、落料、故障与能耗,不保留任何旧缓存 */
Sim.prototype.resetBatch = function (reason) {
  this.time = 0;
  this.cache = CACHE_INIT;
  this.jamLevel = 0;
  this.waste = 0;
  this.fault = null;
  this.overlimitTimer = 0;
  this.overlimitWarned = false;
  this.energy = 0;
  this.power = 0;
  this.peakPower = 0;
  this.peakCache = this.cache;
  this.falling = [];           // 下落中的药片 [{y}]
  this.dropTimer = 0;
  this.convDist = 0;           // 传送带累计位移
  this.spawnDist = PITCH;      // 立即生成第一瓶
  this.bottles = [];           // [{x,index,count,judged,good,rejected,y,alpha}]
  this.spawned = 0;
  this.judgedCount = 0;
  this.goodCount = 0;
  this.batchDone = false;
  this.anomalies = [];         // [{t,pos,bottle,detail}]
  this.rejectTimer = 0;
  if (reason !== 'init') this.log('batch', '批次重置:缓存/瓶位/能耗已清空(' + reason + ')');
};

Sim.prototype.log = function (type, msg, data) {
  var entry = { t: Math.round(this.time * 100) / 100, type: type, msg: msg };
  if (data) entry.data = data;
  this.logs.push(entry);
  if (this.logs.length > 600) this.logs.shift();
  this.events.push(entry);
};

/* ---- 设备启停与参数 ---- */
Sim.prototype.startDevice = function (key) {
  var d = this.devices[key];
  if (d.on) return;
  d.on = true;
  this.log('device', '设备启动:' + devName(key) + ' 参数=' + d.level);
};
Sim.prototype.stopDevice = function (key, why) {
  var d = this.devices[key];
  if (!d.on) return;
  d.on = false;
  this.log('device', '设备停止:' + devName(key) + (why ? '(' + why + ')' : ''));
};
Sim.prototype.setLevel = function (key, level) {
  var d = this.devices[key];
  level = Math.max(0, Math.min(100, Math.round(level)));
  if (d.level === level) return;
  d.level = level;
  this.log('param', '参数变化:' + devName(key) + ' -> ' + level);
};

/* 换规格:必须清空缓存,同时清空在制瓶与落料,停落料闸 */
Sim.prototype.setSpec = function (key) {
  if (!SPECS[key] || key === this.specKey) return;
  this.specKey = key;
  var cleared = Math.floor(this.cache);
  this.cache = 0;
  this.falling = [];
  this.bottles = [];
  this.spawned = 0; this.judgedCount = 0; this.goodCount = 0;
  this.batchDone = false;
  this.spawnDist = PITCH;
  this.jamLevel = 0;
  if (this.devices.gate.on) this.stopDevice('gate', '换规格');
  this.log('spec', '切换规格 -> ' + SPECS[key].label + ',清空缓存 ' + cleared + ' 粒,在制瓶已清空');
};

function devName(key) {
  return key === 'vib' ? '振动盘' : key === 'gate' ? '落料闸' : '瓶体传送';
}

/* ---- 故障与恢复 ---- */
Sim.prototype.raiseFault = function (type, pos, detail) {
  if (this.fault) return;
  var snap = this.snapshot();
  this.fault = { type: type, t: snap.time, pos: pos, values: snap, detail: detail };
  this.anomalies.push({ t: snap.time, pos: pos, bottle: this.currentBottleIndex(), detail: detail });
  this.log('fault', '设备停机[' + pos + ']:' + detail +
    ' | 振动=' + this.devices.vib.level + ' 闸门=' + this.devices.gate.level +
    ' 传送=' + this.devices.conv.level + ' 缓存=' + Math.floor(this.cache) +
    ' 卡料=' + Math.round(this.jamLevel));
  this.stopDevice('vib', '故障联锁');
  this.stopDevice('gate', '故障联锁');
  this.stopDevice('conv', '故障联锁');
};

Sim.prototype.clearFault = function () {
  if (!this.fault) return false;
  var f = this.fault;
  this.jamLevel = 0;
  this.overlimitTimer = 0;
  this.overlimitWarned = false;
  this.fault = null;
  this.log('recover', '故障已排除[' + f.pos + ']:' + f.detail +
    ' | 停机时刻=' + f.t + 's,恢复时刻=' + Math.round(this.time * 100) / 100 + 's,卡料清零');
  return true;
};

Sim.prototype.snapshot = function () {
  return {
    time: Math.round(this.time * 100) / 100,
    vib: this.devices.vib.level, gate: this.devices.gate.level, conv: this.devices.conv.level,
    cache: Math.floor(this.cache), jam: Math.round(this.jamLevel),
    power: Math.round(this.power), good: this.goodCount, judged: this.judgedCount
  };
};

Sim.prototype.currentBottleIndex = function () {
  for (var i = 0; i < this.bottles.length; i++) {
    var b = this.bottles[i];
    if (!b.judged && Math.abs(b.x - FILL_X) <= FILL_HALF) return b.index;
  }
  return -1;
};

/* ---- 主步进:所有子系统共用这个时钟 ---- */
Sim.prototype.step = function () {
  if (this.paused) return;
  this.advance(DT);
};

Sim.prototype.stepOnce = function () { this.advance(DT); };  // 单步(暂停时也可用)

Sim.prototype.advance = function (dt) {
  this.time += dt;
  var dev = this.devices, spec = this.spec();

  // 1. 振动盘 -> 缓存
  if (dev.vib.on && !this.fault) {
    this.cache = Math.min(CACHE_CAP, this.cache + dev.vib.level * 0.25 * spec.feed * dt);
  }
  if (this.cache > this.peakCache) this.peakCache = this.cache;

  // 2. 落料闸 -> 下落药片(过密会累积卡料)
  if (dev.gate.on && !this.fault && !this.batchDone) {
    var interval = 4 * spec.sizeFactor / Math.max(1, dev.gate.level);
    var minInterval = MIN_INTERVAL_K * spec.sizeFactor;
    if (interval < minInterval) {
      this.jamLevel += (minInterval / interval - 1) * 40 * dt;  // 药片过密
    }
    this.dropTimer -= dt;
    while (this.dropTimer <= 0) {
      this.dropTimer += interval;
      if (this.cache >= 1) {
        this.cache -= 1;
        this.falling.push({ y: DROP_Y0 });
      } else {
        this.anomalies.push({ t: Math.round(this.time * 100) / 100, pos: '振动盘/缓存', bottle: this.currentBottleIndex(), detail: '缓存不足,落料缺粒' });
        this.log('warn', '缓存耗尽,落料缺粒(振动盘供料不足)');
        this.dropTimer = Math.max(this.dropTimer, 0.2);
        break;
      }
    }
  }
  this.jamLevel = Math.max(0, this.jamLevel - 12 * dt);  // 自然缓解

  // 3. 传送带 -> 瓶位
  if (dev.conv.on && !this.fault) {
    var speed = 8 + 0.84 * dev.conv.level;
    this.convDist += speed * dt;
    this.spawnDist += speed * dt;
    if (this.spawnDist >= PITCH && this.spawned < BATCH_SIZE && !this.batchDone) {
      this.spawnDist -= PITCH;
      this.bottles.push({ x: -30, index: this.spawned, count: 0, judged: false, good: false, rejected: false, y: 0, alpha: 1 });
      this.spawned++;
    }
    for (var i = 0; i < this.bottles.length; i++) this.bottles[i].x += speed * dt;
  }

  // 4. 下落药片 -> 入瓶计数 / 散落
  for (var p = this.falling.length - 1; p >= 0; p--) {
    var pill = this.falling[p];
    pill.y += PILL_FALL * dt;
    if (pill.y >= BELT_Y - 34) {
      var target = null;
      for (var j = 0; j < this.bottles.length; j++) {
        var b = this.bottles[j];
        if (!b.judged && Math.abs(b.x - FILL_X) <= FILL_HALF) { target = b; break; }
      }
      if (target) {
        if (target.count >= spec.target + 3) {
          this.waste++;
          this.jamLevel += 4;   // 瓶口过密溢出
        } else {
          target.count++;
        }
      } else {
        this.waste++;
        this.jamLevel += 1;   // 无瓶散落,缓慢堆积在闸口
      }
      this.falling.splice(p, 1);
    }
  }

  // 5. 计数判定与剔除
  for (var k = 0; k < this.bottles.length; k++) {
    var bt = this.bottles[k];
    if (!bt.judged && bt.x - FILL_X > FILL_HALF + 6) {
      bt.judged = true;
      bt.good = bt.count === spec.target;
      this.judgedCount++;
      if (bt.good) {
        this.goodCount++;
      } else {
        bt.rejected = true;
        this.rejectTimer = 0.2;
        var why = bt.count < spec.target ? '数量不足' : '数量超限';
        this.anomalies.push({ t: Math.round(this.time * 100) / 100, pos: '灌装头/剔除位', bottle: bt.index, detail: '第' + (bt.index + 1) + '瓶' + why + '(' + bt.count + '/' + spec.target + '),已剔除' });
        this.log('warn', '剔除:第' + (bt.index + 1) + '瓶 ' + bt.count + '/' + spec.target + ' ' + why);
        this.events.push({ t: this.time, type: 'reject' });
      }
      if (this.judgedCount >= BATCH_SIZE && !this.batchDone) this.finishBatch();
    }
    if (bt.rejected && bt.x > 700) { bt.y += 300 * dt; bt.alpha = Math.max(0, bt.alpha - 3 * dt); }
  }
  this.bottles = this.bottles.filter(function (b) { return b.x < 920 && b.alpha > 0; });
  this.rejectTimer = Math.max(0, this.rejectTimer - dt);

  // 6. 能耗(与生产共用此时钟)
  var power = 0;
  if (dev.vib.on) power += 20 + 0.8 * dev.vib.level;
  if (dev.gate.on) power += 8 + 0.25 * dev.gate.level;
  if (dev.conv.on) power += 12 + 0.5 * dev.conv.level;
  if (this.rejectTimer > 0) power += 60;
  this.power = power;
  this.energy += power * dt;
  if (power > this.peakPower) this.peakPower = power;

  // 7. 参数越限保护:负载风险持续超限 -> 保护停机
  if (!this.fault && (dev.vib.on || dev.gate.on)) {
    var risk = (dev.vib.level * dev.gate.level) / ((dev.conv.level + 15) * 60);
    if (risk > 1) {
      this.overlimitTimer += dt;
      if (!this.overlimitWarned) {
        this.overlimitWarned = true;
        this.log('warn', '参数越限警告:负载风险=' + risk.toFixed(2) + '(>1),请降低振动/闸门或提高传送速度');
      }
      if (this.overlimitTimer > 2) {
        this.raiseFault('overlimit', '振动盘/落料闸', '参数越限保护停机,负载风险=' + risk.toFixed(2));
      }
    } else if (risk < 0.8) {
      this.overlimitTimer = 0;
      this.overlimitWarned = false;
    }
  }

  // 8. 卡料停机
  if (!this.fault && this.jamLevel >= JAM_LIMIT) {
    this.raiseFault('jam', '落料闸', '药片过密卡料,卡料值=' + Math.round(this.jamLevel));
  }
};

Sim.prototype.finishBatch = function () {
  this.batchDone = true;
  var yieldRate = Math.round(this.goodCount / BATCH_SIZE * 1000) / 10;
  this.stopDevice('gate', '批次完成');
  this.stopDevice('vib', '批次完成');
  this.log('batch', '批次完成:良品 ' + this.goodCount + '/' + BATCH_SIZE +
    ' 良品率=' + yieldRate + '% 能耗=' + Math.round(this.energy) +
    ' 峰值功率=' + Math.round(this.peakPower) + (this.goodCount === BATCH_SIZE ? ' 【成功】' : ' 【未达标】'),
    { good: this.goodCount, yieldRate: yieldRate });
};

/* ---- 三类流程验证(确定性脚本,可快进运行) ---- */
var SCN_LABELS = { normal: '正常生产', overlimit: '参数越限', shutdown: '设备停机' };
var BALANCED = { vib: 55, gate: 50, conv: 50 };

Sim.prototype.runScenario = function (name) {
  this.specKey = 'M';
  this.resetBatch('场景:' + (SCN_LABELS[name] || name));
  this.paused = false;
  var self = this;
  var ctx = { faults: [], recoveries: [], faultSeen: false };
  function applyBalanced() {
    self.setLevel('vib', BALANCED.vib);
    self.setLevel('gate', BALANCED.gate);
    self.setLevel('conv', BALANCED.conv);
  }
  function startAll() {
    self.startDevice('vib'); self.startDevice('gate'); self.startDevice('conv');
  }
  var actions = [];
  if (name === 'overlimit') {
    actions.push({ at: 5, run: function () {
      self.setLevel('vib', 95); self.setLevel('gate', 95); self.setLevel('conv', 15);
      self.log('warn', '场景注入:参数越限(振动=95 闸门=95 传送=15)');
    }});
  } else if (name === 'shutdown') {
    actions.push({ at: 12, run: function () {
      self.stopDevice('conv', '人为停机(场景注入)');
    }});
  }
  applyBalanced();
  startAll();
  var timeout = 300;
  while (this.time < timeout && !this.batchDone) {
    while (actions.length && this.time >= actions[0].at) actions.shift().run();
    if (this.fault) {
      if (!ctx.faultSeen) {
        ctx.faultSeen = true;
        ctx.faults.push({ t: this.fault.t, pos: this.fault.pos, detail: this.fault.detail, values: this.fault.values });
      }
      if (this.time >= this.fault.t + 1) {   // 停机 1s 后排除故障并恢复
        this.clearFault();
        applyBalanced();
        startAll();
        ctx.recoveries.push({ t: Math.round(this.time * 100) / 100, detail: '排除故障,恢复平衡参数并重启全部设备' });
      }
    }
    this.advance(DT);
  }
  var report = {
    name: name,
    label: SCN_LABELS[name] || name,
    batchDone: this.batchDone,
    good: this.goodCount,
    total: BATCH_SIZE,
    yieldRate: Math.round(this.goodCount / BATCH_SIZE * 1000) / 10,
    peakPower: Math.round(this.peakPower),
    peakCache: Math.floor(this.peakCache),
    energy: Math.round(this.energy),
    endTime: Math.round(this.time * 100) / 100,
    faults: ctx.faults,
    recoveries: ctx.recoveries,
    anomalies: this.anomalies.slice()
  };
  this.reports[name] = report;
  this.log('batch', '验证[' + report.label + ']结束:良品=' + report.good + '/' + BATCH_SIZE +
    ' 良品率=' + report.yieldRate + '% 故障=' + ctx.faults.length + ' 恢复=' + ctx.recoveries.length);
  return report;
};

Sim.prototype.exportData = function () {
  return {
    exportedAt: new Date().toISOString(),
    simTime: Math.round(this.time * 100) / 100,
    spec: this.specKey,
    state: this.snapshot(),
    reports: this.reports,
    logs: this.logs
  };
};

/* ---- 兼容 tablet-line-report/v1 的验证报告 ---- */
var SPEC_MAP = {
  S: { spec: 'small', specCode: 'A' },
  M: { spec: 'medium', specCode: 'B' },
  L: { spec: 'large', specCode: 'C' }
};

function fmtClock(t) {
  var m = Math.floor(t / 60), s = (t % 60).toFixed(1);
  return ('0' + m).slice(-2) + ':' + ('0' + s).slice(-4);
}
function kw(w) { return Math.round(w / 10) / 100; }
function kwh(j) { return Math.round(j / 36000) / 100000; }

function anomalyType(pos) {
  if (pos.indexOf('灌装头') >= 0) return 'COUNT_MISMATCH';
  if (pos.indexOf('缓存') >= 0) return 'CACHE_STARVATION';
  if (pos.indexOf('振动盘') >= 0) return 'OVERLIMIT';
  return 'GATE_JAM';
}

Sim.prototype.buildReport = function () {
  var sm = SPEC_MAP[this.specKey];
  var rn = this.reports.normal, ro = this.reports.overlimit, rs = this.reports.shutdown;
  var self = this;

  function batchOf(r, batchNo) {
    if (!r) return null;
    var rejected = r.anomalies.filter(function (a) { return a.pos.indexOf('灌装头') >= 0; }).length;
    return {
      batchNo: batchNo, spec: sm.spec, specCode: sm.specCode, target: self.spec().target,
      status: r.good === BATCH_SIZE ? 'success' : 'failed',
      simTime: r.endTime, evaluated: r.total, good: r.good, bad: r.total - r.good,
      rejectedBottles: rejected, yieldRate: r.yieldRate,
      energyKwh: kwh(r.energy), peakPowerKw: kw(r.peakPower), cachePeak: r.peakCache,
      trayTablets: Math.floor(self.cache), anomalyCount: r.anomalies.length,
      anomalies: r.anomalies.map(function (a) {
        return { type: anomalyType(a.pos), location: a.pos, time: a.t, values: { bottle: a.bottle + 1 }, result: a.detail };
      })
    };
  }

  function validationOf(r, id, name, kind, passed) {
    var f = r.faults[0];
    return {
      id: id, name: name, kind: kind, passed: passed,
      triggerTime: f ? f.t : r.endTime,
      triggerLabel: f ? f.detail : '批次完成',
      currentValues: f ? f.values : { cache: r.peakCache },
      recoveryResult: r.recoveries.length ? r.recoveries[0].detail
        : (r.good === BATCH_SIZE ? BATCH_SIZE + ' 瓶全部计数正确,批次成功' : '无故障,批次结束'),
      yieldRate: r.yieldRate,
      anomalyLocation: r.anomalies.length ? r.anomalies[0].pos : '无',
      good: r.good, evaluated: r.total,
      peakPowerKw: kw(r.peakPower),
      stopReason: f ? f.detail : '无',
      detail: '实际运行 ' + r.endTime + 's,完成 ' + r.total + ' 瓶检验'
    };
  }

  var validations = [];
  if (rn) validations.push(validationOf(rn, 'normal', '正常生产', 'normal',
    rn.batchDone && rn.good === BATCH_SIZE && rn.faults.length === 0));
  if (ro) validations.push(validationOf(ro, 'extreme', '参数越限', 'extreme',
    ro.batchDone && ro.faults.length > 0 && ro.recoveries.length > 0));
  if (rs) validations.push(validationOf(rs, 'fault', '设备停机', 'fault',
    rs.batchDone && rs.faults.length > 0 && rs.recoveries.length > 0));
  var passedCount = validations.filter(function (v) { return v.passed; }).length;

  var anomalies = [];
  [ro, rs].forEach(function (r, ri) {
    if (!r) return;
    r.faults.forEach(function (f, fi) {
      anomalies.push({
        id: 'INC-' + ('00' + (anomalies.length + 1)).slice(-3),
        type: anomalyType(f.pos),
        title: f.detail,
        location: f.pos,
        triggerTime: f.t,
        values: f.values,
        recoveredAt: r.recoveries[fi] ? r.recoveries[fi].t : null,
        recoveryResult: r.recoveries[fi] ? r.recoveries[fi].detail : '未恢复'
      });
    });
  });

  var stopFault = (rs && rs.faults[0]) || (ro && ro.faults[0]) || null;
  var logs = this.logs.map(function (l, i) {
    var level = l.type === 'fault' ? 'danger' : l.type === 'warn' ? 'warn'
      : (l.type === 'recover' || l.type === 'batch') ? 'ok' : 'info';
    return { id: i + 1, time: l.t, clock: fmtClock(l.t), batchNo: 1, level: level, message: l.msg, type: l.type };
  });

  return {
    schema: 'tablet-line-report/v1',
    generatedAt: new Date().toISOString(),
    clockSource: 'single-fixed-step-simulation',
    fixedStepHz: 60,
    currentBatch: batchOf(rn, 1),
    currentState: {
      simTime: Math.round(this.time * 100) / 100,
      clock: fmtClock(this.time),
      cache: Math.floor(this.cache),
      cachePeak: Math.floor(this.peakCache),
      powerKw: kw(this.power),
      peakPowerKw: kw(this.peakPower),
      energyKwh: kwh(this.energy),
      stopReasons: stopFault ? [stopFault.detail] : [],
      yieldRate: rn ? rn.yieldRate : 0
    },
    anomalies: anomalies,
    batchHistory: [batchOf(rn, 1), batchOf(ro, 2), batchOf(rs, 3)].filter(Boolean),
    validation: validations,
    logs: logs,
    validationSummary: { passed: passedCount === validations.length && validations.length === 3, scenarioCount: validations.length, passedCount: passedCount },
    summary: {
      goodCount: rn ? rn.good : 0,
      evaluatedBottles: BATCH_SIZE,
      yieldRate: rn ? rn.yieldRate : 0,
      peakPowerKw: kw(Math.max(rn ? rn.peakPower : 0, ro ? ro.peakPower : 0, rs ? rs.peakPower : 0)),
      stopReason: stopFault ? stopFault.detail : '无',
      stopLocation: stopFault ? stopFault.pos : '无',
      cacheOnExport: Math.floor(this.cache),
      cachePersistedAcrossReload: false
    },
    qualityGate: {
      requiredGoodBottles: BATCH_SIZE,
      passed: !!(rn && rn.good === BATCH_SIZE),
      anomalyLocation: rn && rn.anomalies.length ? rn.anomalies[0].pos : '无质量异常',
      stopLocation: stopFault ? stopFault.pos : '无'
    }
  };
};

var API = {
  Sim: Sim, SPECS: SPECS, SCN_LABELS: SCN_LABELS,
  DT: DT, BATCH_SIZE: BATCH_SIZE, CACHE_CAP: CACHE_CAP,
  FILL_X: FILL_X, FILL_HALF: FILL_HALF, BELT_Y: BELT_Y,
  DROP_Y0: DROP_Y0, JAM_LIMIT: JAM_LIMIT, PITCH: PITCH
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
global.BottleSim = API;
})(typeof window !== 'undefined' ? window : globalThis);
