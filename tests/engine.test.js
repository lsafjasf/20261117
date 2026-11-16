import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSim, start, pause, step, restart, resetBatch, setParam, advance, snapshot,
} from '../src/engine.js';
import { normalScenario, limitScenario, shutdownTripOnlyScenario } from '../src/scenario.js';
import { PRESSURE, FEED, COOLANT, CACHE_SIZE, TICK_MS } from '../src/config.js';

test('正常生产：三块玻璃全部良品，批次结果完整', () => {
  const { final, events } = normalScenario();
  assert.equal(final.status, 'completed');
  assert.equal(final.good, 3);
  assert.equal(final.scrap, 0);
  assert.equal(final.batchResult.yieldRate, 1);
  assert.ok(final.batchResult.peakKw > 0);
  assert.ok(final.batchResult.energyKwh > 0);
  assert.ok(events.some((e) => e.type === 'DEVICE_START'));
  assert.equal(events.filter((e) => e.type === 'GLASS_PASS').length, 3);
  final.glasses.forEach((g) => {
    assert.equal(g.pass, true);
    assert.equal(g.defects.length, 0);
  });
});

test('参数越限：高压开裂 + 冷却不足烧边，记录触发时刻/数值/位置', () => {
  const { final, events, sim } = limitScenario();
  const crackEvent = events.find((e) => e.type === 'DEFECT_CRACK');
  const burnEvent = events.find((e) => e.type === 'DEFECT_BURN');
  assert.ok(crackEvent, '应产生开裂事件');
  assert.ok(burnEvent, '应产生烧边事件');
  assert.ok(crackEvent.clock > 0);
  assert.equal(crackEvent.params.pressure, 90);
  assert.ok(crackEvent.position > 0 && crackEvent.position <= 1);
  assert.ok(burnEvent.params.coolant === 0);
  // 恢复参数后批次仍可跑完，且良品率小于 100%
  assert.equal(final.status, 'completed');
  assert.ok(final.batchResult.yieldRate < 1);
  assert.ok(events.some((e) => e.type === 'PARAM_RECOVERED'));
  // 异常位置必须随事件持久化
  const g1 = sim.glasses[0];
  assert.deepEqual(g1.defects.map((d) => d.type).sort(), ['burn', 'crack']);
});

test('设备停机：过载停机并记录时刻与数值，安全参数下恢复', () => {
  const { sim, events } = shutdownTripOnlyScenario();
  const down = events.find((e) => e.type === 'SHUTDOWN');
  assert.ok(down);
  assert.equal(down.reason, 'overload');
  assert.equal(down.pressure, 96);
  assert.ok(down.clock > 0);
  assert.equal(snapshot(sim).status, 'shutdown');
  // 停机时推进时钟不应有任何变化
  const clockBefore = sim.clock;
  advance(sim);
  assert.equal(sim.clock, clockBefore);
  // 危险参数未解除时禁止恢复
  setParam(sim, 'pressure', 96);
  restart(sim);
  assert.equal(sim.status, 'shutdown');
  assert.ok(events.some((e) => e.type === 'RESTART_BLOCKED'));
  setParam(sim, 'pressure', 55);
  restart(sim);
  assert.equal(sim.status, 'running');
  assert.equal(sim.shutdownReason, null);
  assert.ok(events.some((e) => e.type === 'DEVICE_RESTART'));
  // 恢复后批次可以完成
  while (sim.status !== 'completed') advance(sim);
  assert.equal(snapshot(sim).status, 'completed');
  const done = snapshot(sim);
  assert.ok(done.good + done.scrap === 3);
});

test('暂停与单步：可检查并恢复当前批次', () => {
  const sim = createSim();
  start(sim);
  for (let i = 0; i < 10; i += 1) advance(sim);
  const frozen = snapshot(sim);
  pause(sim);
  for (let i = 0; i < 5; i += 1) advance(sim); // 暂停态 advance 不动时钟
  assert.equal(sim.clock, frozen.clock);
  step(sim);
  assert.equal(sim.clock, 1.1);
  assert.equal(sim.clock, Number((frozen.clock + TICK_MS / 1000).toFixed(3)));
  const glassWorkBefore = sim.glasses[sim.currentIndex].work;
  start(sim);
  for (let i = 0; i < 5; i += 1) advance(sim);
  assert.ok(sim.glasses[sim.currentIndex].work > glassWorkBefore);
  assert.ok(sim.events.some((e) => e.type === 'DEVICE_PAUSE'));
  assert.ok(sim.events.some((e) => e.type === 'DEVICE_STEP'));
});

test('共享时钟：缓存、能耗、生产在同一 advance 内推进', () => {
  const sim = createSim();
  start(sim);
  advance(sim);
  const s = snapshot(sim);
  assert.equal(s.clock, TICK_MS / 1000);
  assert.equal(s.cacheSize, 1);
  assert.equal(sim.cache[0].clock, s.clock);
  assert.ok(s.energyKwh > 0);
  assert.ok(s.peakKw > 0);
  // 环形缓存上限
  for (let i = 0; i < CACHE_SIZE + 20; i += 1) advance(sim);
  assert.equal(sim.cache.length, CACHE_SIZE);
});

test('批次重置：清空缓存与批次数据，事件审计保留；重开无旧缓存', () => {
  const sim = createSim();
  start(sim);
  for (let i = 0; i < 30; i += 1) advance(sim);
  assert.ok(sim.cache.length > 0);
  const eventCount = sim.events.length;
  resetBatch(sim);
  const s = snapshot(sim);
  assert.equal(s.batchId, 2);
  assert.equal(s.clock, 0);
  assert.equal(s.cacheSize, 0);
  assert.equal(s.good, 0);
  assert.equal(s.energyKwh, 0);
  assert.equal(s.peakKw, 0);
  assert.equal(s.currentIndex, 0);
  assert.equal(s.status, 'idle');
  s.glasses.forEach((g) => assert.equal(g.work, 0));
  // 事件日志保留且记录了重置
  assert.ok(sim.events.length > eventCount);
  assert.ok(sim.events.some((e) => e.type === 'BATCH_RESET'));
});

test('参数硬限钳位与软限事件', () => {
  const sim = createSim();
  setParam(sim, 'pressure', PRESSURE.hardMax + 50);
  assert.equal(sim.params.pressure, PRESSURE.hardMax);
  assert.ok(sim.events.some((e) => e.type === 'PARAM_CLAMP'));
  assert.ok(sim.events.some((e) => e.type === 'PARAM_LIMIT'));
  setParam(sim, 'pressure', 50);
  assert.ok(sim.events.some((e) => e.type === 'PARAM_RECOVERED'));
  setParam(sim, 'feed', FEED.max + 1); // 软限内保留
  assert.equal(sim.params.feed, FEED.max + 1);
  setParam(sim, 'coolant', COOLANT.hardMax + 5);
  assert.equal(sim.params.coolant, COOLANT.hardMax);
});
