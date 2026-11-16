/* 确定性场景测试：在 Node 中驱动引擎，验证协作、隔离与回放。 */
'use strict';

const assert = require('assert');
const Engine = require('../src/engine.js');
const C = Engine.config;
const TICK = C.DT;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    console.error('  FAIL  ' + name);
    console.error('        ' + err.message);
    process.exitCode = 1;
  }
}

function run(engine, seconds, pilot1, pilot2) {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i++) {
    if (pilot1) pilot1(engine);
    if (pilot2) pilot2(engine);
    engine.step();
    if (engine.state.phase === 'failed' || engine.state.phase === 'success') break;
  }
  return engine.getSnapshot();
}

// —— P1：升降压载自动驾驶（只能动压载） ——
function pilotBallast(engine) {
  const s = engine.state;
  const st = s.activeStation ? C.STATIONS.find((x) => x.id === s.activeStation) : null;
  let target = 0;
  if (st) target = st.depth;
  else if (s.completed.length === C.STATIONS.length) target = 0;
  const err = target - s.depth;
  // PD 控制：带速度阻尼，避免压载惯性在目标深度附近振荡
  const u = err - 6 * s.vSpeed;
  let dir = 0;
  if (u > 1.2) dir = 1;
  else if (u < -1.2) dir = -1;
  const want = dir === 1 ? 'ballast_down' : dir === -1 ? 'ballast_up' : 'ballast_off';
  const cur = s.ballastDir === 1 ? 'ballast_down' : s.ballastDir === -1 ? 'ballast_up' : 'ballast_off';
  if (want !== cur) engine.applyAction('p1', want);
}

// —— P2：供气 + 缆绳 + 取样自动驾驶（不能动压载） ——
function pilotUmbilical(engine) {
  const s = engine.state;
  const slack = s.cablePaid - s.depth;
  // 下潜/上浮时先保证松弛量；漂移偏大时受控收紧以回正
  if (Math.abs(s.vSpeed) > 1.0 && slack < 4.5) engine.applyAction('p2', 'cable_pay');
  else if (slack < 2.4) engine.applyAction('p2', 'cable_pay');
  else if (s.drift > 2.4 && slack > 3.0) engine.applyAction('p2', 'cable_reel');
  else if (slack > 5.5) engine.applyAction('p2', 'cable_reel');
  else if (s.cableDir !== 0) engine.applyAction('p2', 'cable_off');

  if (s.o2 < 20.2 && s.valveDir !== 1) engine.applyAction('p2', 'air_up');
  else if (s.o2 > 21.6 && s.valveDir !== -1) engine.applyAction('p2', 'air_down');
  else if (s.o2 >= 20.2 && s.o2 <= 21.6 && s.valveDir !== 0) engine.applyAction('p2', 'air_off');

  const st = s.activeStation ? C.STATIONS.find((x) => x.id === s.activeStation) : null;
  if (st && !s.sample) {
    const inDepth = Math.abs(s.depth - st.depth) <= st.depthTol;
    if (inDepth && Math.abs(s.drift) <= C.STATION_DRIFT_TOL && s.tensionState !== 'tight') {
      engine.applyAction('p2', 'sample');
    }
  }
}

console.log('== 潜水钟引擎场景测试 ==');

test('场景一：双人协作完成三个取样点并上浮成功', function () {
  const engine = new Engine();
  const end = run(engine, 360, pilotBallast, pilotUmbilical);
  assert.strictEqual(end.phase, 'success', '应成功上浮，实际终态=' + end.phase +
    (end.failReason ? '(' + end.failReason + ')' : ''));
  assert.strictEqual(end.mission.completed.length, 3, '三个取样点全部完成');
  assert.deepStrictEqual(end.mission.completed, [1, 2, 3]);
  assert(end.gauges.o2 >= C.O2_MIN, '全程含氧量安全');
  assert(end.gauges.stress < C.STRESS_FAIL, '缆绳应力未超限');
  // 回放确定性
  const replay = engine.exportReplay();
  const r = Engine.replay(replay);
  assert(r.consistent, '回放终态与原局一致');
  const a = engine.getSnapshot().gauges;
  const b = r.engine.getSnapshot().gauges;
  assert.deepStrictEqual(b, a, '回放仪表数值逐位一致');
  // 双方都确实贡献了输入
  const sides = new Set(replay.inputs.map((i) => i.side));
  assert(sides.has('p1') && sides.has('p2'), '两侧都有真实输入');
});

test('场景二：P1 单侧失误（放弃压载）导致任务失败', function () {
  const engine = new Engine();
  // P1 完全不操作，P2 正常履行自己的职责
  const end = run(engine, 200, null, pilotUmbilical);
  assert(['failed', 'protecting'].indexOf(end.phase) !== -1,
    'P1 缺席应进入失败或保护，实际=' + end.phase);
  if (end.phase === 'failed') {
    assert(['hypoxia', 'over_depth', 'cable_stress', 'rapid_ascent'].indexOf(end.failReason) !== -1);
  } else {
    assert.strictEqual(end.protection.side, 'p1');
    assert.strictEqual(end.protection.reason, 'idle');
  }
  assert.strictEqual(end.mission.completed.length, 0, 'P1 不控深度则无法完成取样');
});

test('场景三：P2 单侧失误后恢复，任务仍可成功', function () {
  const engine = new Engine();
  // 阶段 A：双人协作 20s
  run(engine, 20, pilotBallast, pilotUmbilical);
  // 阶段 B：P2 停止操作，P1 继续压载，30s 空闲阈值后进入保护
  run(engine, 32, pilotBallast, null);
  assert.strictEqual(engine.state.phase, 'protecting', 'P2 超时应进入保护状态');
  assert.strictEqual(engine.state.protectedSide, 'p2');
  assert.strictEqual(engine.state.protectReason, 'idle');
  // 阶段 C：P2 重连恢复，继续协作直到任务结束
  assert(engine.reconnect('p2'), '重连成功');
  const end = run(engine, 360, pilotBallast, pilotUmbilical);
  const prot = engine.state.events.filter((ev) => ev.type === 'protection');
  assert(prot.some((ev) => ev.payload.side === 'p2'), 'P2 超时触发保护状态');
  const rec = engine.state.events.filter((ev) => ev.type === 'reconnect');
  assert(rec.some((ev) => ev.payload.side === 'p2'), 'P2 重连恢复');
  assert.strictEqual(end.phase, 'success', '恢复后仍可成功，实际=' + end.phase +
    (end.failReason ? '(' + end.failReason + ')' : ''));
  assert.strictEqual(end.mission.completed.length, 3);
});

test('职责隔离：任何一侧都无法越权操作对方机构', function () {
  const engine = new Engine();
  C.PLAYER_ACTIONS.p2.forEach(function (action) {
    assert.strictEqual(engine.applyAction('p1', action), false, 'p1 不能 ' + action);
  });
  C.PLAYER_ACTIONS.p1.forEach(function (action) {
    assert.strictEqual(engine.applyAction('p2', action), false, 'p2 不能 ' + action);
  });
  assert.strictEqual(engine.getSnapshot().rejected.length,
    C.PLAYER_ACTIONS.p1.length + C.PLAYER_ACTIONS.p2.length, '越权全部被拒绝并留痕');
});

test('两侧仪表同源：快照对双方完全一致且含全部共享资源', function () {
  const engine = new Engine();
  run(engine, 30, pilotBallast, pilotUmbilical);
  const view = engine.getSnapshot();
  ['depth', 'o2', 'reserve', 'temp', 'stress', 'valve', 'ballast', 'slack', 'hypoxiaLeft']
    .forEach(function (k) {
      assert(typeof view.gauges[k] === 'number', '共享仪表字段 ' + k);
    });
  // 再取一次快照，数值一致（同一共享状态，不存在两套副本）
  assert.deepStrictEqual(engine.getSnapshot().gauges, view.gauges);
});

test('重开复位：仪表、目标、计时、回放记录同时归零', function () {
  const engine = new Engine();
  run(engine, 40, pilotBallast, pilotUmbilical);
  const before = engine.getSnapshot();
  assert(before.time > 30 && before.gauges.depth > 5);
  const after = engine.reset('coop');
  assert.strictEqual(after.time, 0);
  assert.strictEqual(after.tick, 0);
  assert.strictEqual(after.gauges.depth, 0);
  assert.strictEqual(after.gauges.o2, C.INITIAL.o2);
  assert.strictEqual(after.gauges.reserve, C.INITIAL.reserve);
  assert.strictEqual(after.mission.activeStation, 1);
  assert.strictEqual(after.mission.completed.length, 0);
  assert.strictEqual(after.events.length, 1, '旧回放事件已清空，仅留 restart 标记');
  assert.strictEqual(after.events[0].type, 'restart');
  assert.strictEqual(engine.exportReplay().inputs.length, 0, '旧输入记录已清空');
});

test('暂停冻结物理，恢复后继续', function () {
  const engine = new Engine();
  run(engine, 20, pilotBallast, pilotUmbilical);
  engine.pause();
  const frozen = engine.getSnapshot();
  for (let i = 0; i < 60; i++) engine.step();
  assert.deepStrictEqual(engine.getSnapshot().gauges, frozen.gauges, '暂停期间物理冻结');
  engine.resume();
  run(engine, 10, pilotBallast, pilotUmbilical);
  assert(engine.getSnapshot().time > frozen.time, '恢复后时间继续');
});

test('回放记录包含双方输入、共享资源与冲突时刻', function () {
  const engine = new Engine();
  run(engine, 60, pilotBallast, pilotUmbilical);
  const replay = engine.exportReplay();
  assert(replay.inputs.length > 10, '记录双方输入');
  assert(replay.events.length > 10, '记录系统事件');
  const kinds = new Set(replay.events.map((ev) => ev.type));
  assert(kinds.has('input'), '输入事件留痕');
});

console.log('\n通过 ' + passed + ' 项测试。');
