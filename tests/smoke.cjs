const assert = require('node:assert/strict');
const {
  StackingSimulator,
  runValidationSuite,
  formatSimTime
} = require('../simulation.js');

function runClockAndResetChecks() {
  const sim = new StackingSimulator({ seed: 5 });
  sim.start('test');
  sim.advance(4);
  assert.equal(sim.status, 'running');
  assert.ok(sim.batch.cache > 0);
  assert.ok(sim.batch.energyKwh > 0);

  sim.pause();
  const frozen = {
    time: sim.simTime,
    cache: sim.batch.cache,
    energy: sim.batch.energyKwh,
    stack: sim.batch.stack.length
  };
  sim.advance(2);
  assert.equal(sim.simTime, frozen.time);
  assert.equal(sim.batch.cache, frozen.cache);
  assert.equal(sim.batch.energyKwh, frozen.energy);

  sim.singleStep(0.25);
  assert.ok(sim.simTime > frozen.time);
  assert.equal(sim.status, 'paused');
  assert.ok(sim.logs.some((entry) => entry.code === 'SINGLE_STEP'));

  const reset = sim.resetBatch();
  assert.equal(reset.cache, 0);
  assert.equal(sim.status, 'idle');
  assert.equal(sim.batch.cache, 0);
  assert.equal(sim.batch.stack.length, 0);
  assert.ok(sim.logs.some((entry) => entry.code === 'BATCH_RESET'));
  assert.ok(sim.batchResults.length >= 1);

  const equipmentEvents = sim.logs.filter((entry) =>
    entry.code === 'EQUIPMENT_START' || entry.code === 'EQUIPMENT_STOP');
  assert.ok(equipmentEvents.length >= 8);
  assert.ok(sim.logs.some((entry) => entry.code === 'PARAM_CHANGE') === false);
  sim.setParams({ pressure: 61 }, 'test');
  assert.ok(sim.logs.some((entry) => entry.code === 'PARAM_CHANGE' && entry.next === 61));
}

function runLimitRecoveryChecks() {
  const sim = new StackingSimulator({ seed: 9 });
  sim.setParams({ pressure: 72, offset: 0.48, speed: 122 }, 'test');
  sim.start('test-limit');
  for (let index = 0; index < 400 && sim.status === 'running'; index += 1) sim.advance(0.05);
  assert.equal(sim.status, 'fault');
  assert.equal(sim._lastStop.station, '隔膜工位');
  assert.ok(sim._lastStop.values.pressure > 65);
  assert.ok(sim.logs.some((entry) => entry.code === 'SEPARATOR_CRUSH'));
  const groupsBefore = sim.batch.groupsDone;
  sim.setParams({ pressure: 52, offset: 0, speed: 78 }, 'test-recovery');
  sim.recover();
  for (let index = 0; index < 300 && sim.status === 'running' &&
    sim.batch.groupsDone === groupsBefore; index += 1) sim.advance(0.05);
  assert.equal(sim.status, 'running');
  assert.ok(sim.batch.groupsDone > groupsBefore);
  assert.ok(sim.logs.some((entry) => entry.code === 'RECOVERY'));
}

function runCacheJamChecks() {
  const sim = new StackingSimulator({ seed: 13 });
  sim.setParams({ pressure: 50, offset: 0, speed: 124 }, 'test-cache');
  sim.start('test-cache');
  for (let index = 0; index < 500 && sim.status === 'running'; index += 1) sim.advance(0.05);
  assert.equal(sim.status, 'fault');
  assert.equal(sim._lastStop.station, '缓存线');
  assert.equal(sim._lastStop.code, 'CACHE_JAM');
  assert.ok(sim._lastStop.values.cache >= 99);
  assert.equal(sim.equipment.cache, '故障');
}

function runSuiteChecks() {
  const report = runValidationSuite();
  assert.equal(report.total, 3);
  assert.equal(report.passed, 3);
  const normal = report.results.find((item) => item.id === 'normal');
  const limit = report.results.find((item) => item.id === 'limit');
  const stop = report.results.find((item) => item.id === 'stop');
  assert.equal(normal.values.good, 10);
  assert.equal(normal.triggerClock, formatSimTime(normal.triggerSeconds));
  assert.equal(limit.abnormalStation, '隔膜工位');
  assert.ok(limit.values.pressure > 65);
  assert.match(limit.stopReason, /隔膜/);
  assert.match(stop.stopReason, /急停/);
  assert.ok(stop.recovery.passed);
  report.results.forEach((result) => {
    assert.ok(result.simulationSteps > 0);
    assert.ok(result.checks.every((check) => check.pass));
  });
  return report;
}

runClockAndResetChecks();
runLimitRecoveryChecks();
runCacheJamChecks();
const report = runSuiteChecks();
console.log(JSON.stringify({
  normal: '10/10 good',
  limit: `${report.results[1].triggerClock} ${report.results[1].abnormalStation}`,
  stop: `${report.results[2].triggerClock} recovered`,
  validation: `${report.passed}/${report.total}`,
  cacheReset: true
}, null, 2));
