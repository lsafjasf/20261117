#!/usr/bin/env node
'use strict';

require('../js/rng.js');
require('../js/config.js');
require('../js/sim.js');
require('../js/nav.js');
require('../js/validate.js');

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const results = [];
function test(name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail || '' });
    console.log('PASS  ' + name + (detail ? ' :: ' + detail : ''));
  } catch (err) {
    results.push({ name, pass: false, detail: err.message });
    console.error('FAIL  ' + name + ' :: ' + err.message);
  }
}

test('同一个 seed 的地图、任务顺序与障碍顺序完全一致', () => {
  const a = TowSim.createSimulation(804);
  const b = TowSim.createSimulation(804);
  assert.deepStrictEqual(a.world, b.world);
  assert.deepStrictEqual(a.world.mission.map((m) => m.cargoId), b.world.mission.map((m) => m.cargoId));
  assert.deepStrictEqual(a.world.obstacles.map((o) => [o.id, o.type, o.x, o.y]),
    b.world.obstacles.map((o) => [o.id, o.type, o.x, o.y]));
  return a.world.signature + ' / ' + a.world.mission.map((m) => m.cargoId).join('→');
});

test('不同 seed 生成不同签名', () => {
  const a = TowSim.createSimulation(804);
  const b = TowSim.createSimulation(805);
  assert.notStrictEqual(a.world.signature, b.world.signature);
  return a.world.signature + ' != ' + b.world.signature;
});

test('正常路线真实完成三段顺序运输', () => {
  const run = TowValidate.runNormal(804);
  assert.strictEqual(run.sim.phase, 'won');
  assert.strictEqual(run.sim.progress.delivered, 3);
  assert(run.sim.cargoStates.every((c) => c.status === 'delivered'));
  assert(run.sim.checkpoints.length >= 4);
  return 't=' + run.sim.t.toFixed(1) + 's, drawbar=' + run.sim.resources.drawbar.toFixed(1) + '%';
});

test('碰撞会损伤牵引杆', () => {
  const run = TowValidate.collisionScenario(804);
  assert(run.collided);
  assert(run.damage > 0);
  return 'collisions=' + run.sim.stats.collisions + ', damage=' + run.damage.toFixed(1) + '%';
});

test('撞击码头边缘会搁浅并记录失败原因', () => {
  const run = TowValidate.recoveryScenario(804);
  assert.strictEqual(run.failedType, 'stranded');
  assert(/搁浅/.test(run.failedReason));
  return run.failedReason;
});

test('失败后从最近检查点恢复目标进度与资源', () => {
  const run = TowValidate.recoveryScenario(804);
  assert(run.restore.ok);
  assert.strictEqual(run.restoredDelivered, run.deliveredBefore);
  assert(run.restoredResourceMatch);
  assert(run.failureKeptVisible);
  assert.strictEqual(run.recoveryCount, 1);
  return run.restore.checkpoint.id + ' / delivered=' + run.restoredDelivered;
});

test('保存后重新载入：关键对象位置与胜负条件不变', () => {
  const run = TowValidate.saveLoadScenario(804);
  assert(run.exact, 'critical state diverged after load');
  assert(run.loaded.checkpoints.length > 1);
  assert.deepStrictEqual(run.before.conditions, run.after.conditions);
  return run.loaded.world.signature + ' / checkpoint=' + run.after.checkpointId;
});

test('重新开始恢复所有目标与资源，不只重置角色位置', () => {
  const run = TowValidate.restartScenario(804);
  assert(run.fullReset);
  assert(run.sameWorld);
  assert.strictEqual(run.actual.delivered, 0);
  assert.strictEqual(run.actual.checkpoints, 1);
  return 'delivered=0, battery=100, drawbar=100, pending=3';
});

test('同 seed 同输入 600 步轨迹完全一致', () => {
  const run = TowValidate.deterministicScenario(804);
  assert(run.sameWorld && run.sameMissionOrder && run.sameObstacleOrder && run.sameTrajectory);
  return '600 steps identical / ' + run.signature;
});

test('调试场景可读取路径、载重与当前风向', () => {
  const run = TowValidate.debugScenario(804);
  assert(run.path.length >= 2);
  assert.strictEqual(run.load.percent, 0);
  assert(Number.isFinite(run.wind.angle));
  assert(run.obstacleOrder.length > 0);
  return run.path.length + ' path nodes / ' + run.wind.label + ' ' + run.wind.speed + 'm/s';
});

test('页面验收场景 13 项全通过', () => {
  const report = TowValidate.runAll(804);
  assert(report.allPass);
  assert.strictEqual(report.checks.length, 13);
  return report.checks.filter((c) => c.pass).length + '/13';
});

const failed = results.filter((r) => !r.pass);
const output = {
  seed: 804,
  allPass: failed.length === 0,
  passed: results.length - failed.length,
  total: results.length,
  results
};
const artifactDir = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, 'result.json'), JSON.stringify(output, null, 2) + '\n');

if (failed.length) {
  console.error('\n' + failed.length + ' test(s) failed.');
  process.exit(1);
}
console.log('\nAll ' + results.length + ' node checks passed.');
