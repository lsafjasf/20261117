/* 场景验证:成功 / 单侧失误 / 恢复,以及同步、职责隔离、保护、回放一致性。 */
'use strict';
var Sim = require('../js/sim.js');
var Replay = require('../js/replay.js');
var C = Sim.CONFIG;

var passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name + (extra ? ' -> ' + extra : '')); }
}

// 双人协同控制器:A 只管窗(降温),B 只管加热(升温)
function coopTick(state, rec) {
  var T = state.temps;
  var intents = [
    ['A', 'winL', T[0] > 24 ? 1 : T[0] < 23 ? -1 : 0],
    ['A', 'winR', T[2] > 24 ? 1 : T[2] < 23 ? -1 : 0],
    ['B', 'heatL', T[0] < 21 ? 1 : T[0] > 22.5 ? -1 : 0],
    ['B', 'heatR', T[2] < 21 ? 1 : T[2] > 22.5 ? -1 : 0]
  ];
  // 中区由两侧溢出共同调节
  if (T[1] > 24.5) { intents[0][2] = 1; intents[1][2] = 1; }
  if (T[1] < 20) { intents[2][2] = 1; intents[3][2] = 1; }
  intents.forEach(function (it) {
    if (it[2] !== 0 && Sim.applyControl(state, it[0], it[1], it[2]) && rec) {
      Replay.recordInput(rec, state, it[0], it[1], it[2]);
    }
  });
}

function runGame(tickFn, maxT) {
  var state = Sim.createState();
  var rec = Replay.createRecorder();
  var steps = Math.ceil((maxT || C.duration + 5) / C.dt);
  for (var i = 0; i < steps && state.status === 'running'; i++) {
    tickFn(state, rec);
    Sim.step(state);
    Replay.collect(rec, state);
  }
  Replay.finalize(rec, state);
  return { state: state, rec: rec };
}

console.log('\n[1] 成功场景:双人协同维持 90 秒');
(function () {
  var r = runGame(coopTick);
  var s = r.state;
  check('三分区全程安全,判定成功', s.status === 'win', s.status + ' ' + s.failReason);
  check('倒计时归零', s.countdown === 0);
  check('任务记录含成功事件', s.events.some(function (e) {
    return e.type === 'result' && e.outcome === 'win';
  }));
  check('回放含双方输入', r.rec.inputs.some(function (i) { return i.player === 'A'; }) &&
    r.rec.inputs.some(function (i) { return i.player === 'B'; }));
  check('回放确定性校验通过', Replay.verify(r.rec).ok);
  var snap = r.rec.samples[r.rec.samples.length - 1];
  check('共享采样与终态一致(能源/倒计时/温度)',
    Math.abs(snap.energy - r.rec.final.energy) < 5 &&
    snap.status === r.rec.final.status);
})();

console.log('\n[2] 单侧失误场景:玩家 B 左加热拉满不松手');
(function () {
  var r = runGame(function (state, rec) {
    // B 单侧失误:左加热持续拉满;右侧仍正常管理;A 正常履职试图补救
    if (Sim.applyControl(state, 'B', 'heatL', 1)) {
      Replay.recordInput(rec, state, 'B', 'heatL', 1);
    }
    var dR = state.temps[2] < 21 ? 1 : state.temps[2] > 22.5 ? -1 : 0;
    if (dR && Sim.applyControl(state, 'B', 'heatR', dR)) {
      Replay.recordInput(rec, state, 'B', 'heatR', dR);
    }
    var T = state.temps;
    [['winL', T[0]], ['winR', T[2]]].forEach(function (p, idx) {
      var z = idx === 0 ? 0 : 2;
      var d = T[z] > 24 ? 1 : T[z] < 23 ? -1 : 0;
      if (d && Sim.applyControl(state, 'A', p[0], d)) {
        Replay.recordInput(rec, state, 'A', p[0], d);
      }
    });
  });
  var s = r.state;
  check('判定失败且指向左区', s.status === 'lose' && /左区/.test(s.failReason), s.failReason);
  check('左区温度曾超出安全上限', r.rec.samples.some(function (sp) {
    return sp.temps[0] > C.safeMax;
  }));
  check('另一侧仪表仍同步(共享同一 state)',
    typeof r.rec.final.temps[2] === 'number' &&
    r.rec.final.countdown >= 0 && r.rec.final.energy >= 0);
  check('失误时刻能源被大量消耗(双方可见)',
    r.rec.samples.some(function (sp) { return sp.energy < 65; }));
  check('任务记录含失败原因', s.events.some(function (e) {
    return e.type === 'result' && e.outcome === 'lose';
  }));
  check('回放确定性校验通过', Replay.verify(r.rec).ok);
})();

console.log('\n[3] 恢复场景:左区先越界受压,玩家 B 及时补救');
(function () {
  var savedTimeout = C.protectTimeout;
  C.protectTimeout = 1e9; // 本场景专注"恢复",暂时停用保护代管
  var r = runGame(function (state, rec) {
    // 前 14 秒双方都不作为,让分区跌出安全区;之后双人协同补救
    if (state.t < 14) return;
    coopTick(state, rec);
  });
  C.protectTimeout = savedTimeout;
  var s = r.state;
  var maxStress = 0;
  r.rec.samples.forEach(function (sp) { maxStress = Math.max(maxStress, sp.stress[0]); });
  check('左区曾越界累积压力', maxStress > 1, 'maxStress=' + maxStress);
  check('压力随后恢复(未耗尽耐受)', s.stress[0] < C.tolerance[0] * 0.5,
    'final stress=' + s.stress[0]);
  check('恢复后最终成功', s.status === 'win', s.status + ' ' + s.failReason);
  check('回放确定性校验通过', Replay.verify(r.rec).ok);
})();

console.log('\n[4] 职责隔离:一侧操作无法代替另一侧');
(function () {
  var s = Sim.createState();
  check('A 无法操作加热带', Sim.applyControl(s, 'A', 'heatL', 1) === false &&
    s.controls.heatL === 0);
  check('B 无法操作通风窗', Sim.applyControl(s, 'B', 'winL', 1) === false &&
    s.controls.winL === 0);
  check('执行器归属表互斥', Sim.OWNER.winL === 'A' && Sim.OWNER.winR === 'A' &&
    Sim.OWNER.heatL === 'B' && Sim.OWNER.heatR === 'B');
  // 只有 B 加热、A 完全缺席(且禁用保护代管):寒潮中无法降温散热不是问题,
  // 但 A 缺席时热浪期无法散热 -> 失败,证明单侧无法包打全场
  var savedTimeout = C.protectTimeout;
  C.protectTimeout = 1e9;
  var onlyB = runGame(function (state) {
    var T = state.temps;
    if (T[0] < 21) Sim.applyControl(state, 'B', 'heatL', 1);
    if (T[2] < 21) Sim.applyControl(state, 'B', 'heatR', 1);
  });
  var onlyA = runGame(function (state) {
    var T = state.temps;
    if (T[0] > 24) Sim.applyControl(state, 'A', 'winL', 1);
    if (T[2] > 24) Sim.applyControl(state, 'A', 'winR', 1);
  });
  C.protectTimeout = savedTimeout;
  check('仅 B 在岗无法成功(热浪期无散热手段)', onlyB.state.status === 'lose',
    onlyB.state.status);
  check('仅 A 在岗无法成功(寒潮期无升温手段)', onlyA.state.status === 'lose',
    onlyA.state.status);
})();

console.log('\n[5] 超时保护与恢复');
(function () {
  var s = Sim.createState();
  for (var i = 0; i < Math.ceil(9 / C.dt); i++) Sim.step(s);
  check('8 秒无输入后双方进入保护状态',
    s.players.A.protected && s.players.B.protected);
  check('任务记录含保护事件', s.events.some(function (e) {
    return e.type === 'protect' && e.player === 'A';
  }));
  Sim.applyControl(s, 'A', 'winL', 1);
  check('A 重新输入后解除保护', !s.players.A.protected && s.players.B.protected);
  check('任务记录含恢复事件', s.events.some(function (e) {
    return e.type === 'resume' && e.player === 'A';
  }));
})();

console.log('\n[6] 重开复位一致性');
(function () {
  var a = Sim.createState(), b = Sim.createState();
  var sa = Sim.snapshot(a), sb = Sim.snapshot(b);
  check('仪表/目标/计时/能源全部复位一致',
    JSON.stringify(sa) === JSON.stringify(sb));
  check('倒计时回到时长上限', a.countdown === C.duration && a.t === 0);
})();

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
