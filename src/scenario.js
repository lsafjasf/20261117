// 确定性场景脚本：同一套既可在 Node 测试中跑，也可由界面演示按钮调用。
import {
  createSim, start, pause, step, restart, resetBatch, setParam, advance, snapshot,
} from './engine.js';

function wait(sim, ticks) {
  for (let i = 0; i < ticks; i += 1) advance(sim);
}

function waitUntil(sim, predicate, maxTicks = 20000) {
  let n = 0;
  while (!predicate(snapshot(sim)) && n < maxTicks && sim.status !== 'shutdown') {
    advance(sim);
    n += 1;
  }
  return n;
}

function waitBatchDone(sim, maxTicks = 20000) {
  let n = 0;
  while (sim.status !== 'completed' && sim.status !== 'shutdown' && n < maxTicks) {
    advance(sim);
    n += 1;
  }
  return n;
}

export function runScenario(name, actions, initialSim = createSim()) {
  const sim = initialSim;
  const triggers = [];
  const capturedSeqs = new Set();
  const capture = (types) => {
    sim.events
      .filter((e) => types.includes(e.type) && !capturedSeqs.has(e.seq))
      .forEach((e) => { capturedSeqs.add(e.seq); triggers.push(snapshot(sim)); });
  };
  for (const action of actions) {
    if (action.op === 'set') setParam(sim, action.key, action.value);
    else if (action.op === 'start') start(sim);
    else if (action.op === 'pause') pause(sim);
    else if (action.op === 'step') step(sim);
    else if (action.op === 'restart') restart(sim);
    else if (action.op === 'reset') resetBatch(sim);
    else if (action.op === 'wait') wait(sim, action.ticks);
    else if (action.op === 'waitUntil') waitUntil(sim, action.predicate, action.maxTicks);
    else if (action.op === 'waitBatch') waitBatchDone(sim, action.maxTicks);
    else if (action.op === 'capture') { /* 仅触发下方 capture */ }
    capture(action.capture || []);
  }
  return { name, sim, final: snapshot(sim), triggers, events: sim.events };
}

export const SCENARIO_ACTIONS = {
  // 场景一：正常生产 —— 全程安全参数，三块均达标
  normal: [
    { op: 'start' },
    { op: 'waitBatch' },
    { op: 'capture', capture: ['BATCH_RESULT', 'GLASS_PASS'] },
  ],
  // 场景二：参数越限 —— 高压致裂、高温烧边并记录位置，随后恢复参数完成批次
  limit: [
    { op: 'start' },
    { op: 'set', key: 'pressure', value: 90, capture: ['PARAM_LIMIT', 'PARAM_CHANGE'] },
    { op: 'waitUntil', predicate: (s) => s.glasses[0].cracked },
    { op: 'set', key: 'pressure', value: 50 },
    { op: 'set', key: 'coolant', value: 0, capture: ['PARAM_LIMIT'] },
    { op: 'set', key: 'feed', value: 25 },
    { op: 'waitUntil', predicate: (s) => s.glasses[0].burn || s.status === 'shutdown' },
    { op: 'set', key: 'coolant', value: 7 },
    { op: 'set', key: 'feed', value: 15, capture: ['PARAM_RECOVERED'] },
    { op: 'waitBatch' },
  ],
  // 场景三：设备停机 —— 压力冲硬限触发过载停机，降参数后恢复批次
  shutdown: [
    { op: 'start' },
    { op: 'set', key: 'pressure', value: 96, capture: ['SHUTDOWN', 'PARAM_LIMIT'] },
    { op: 'wait', ticks: 3 },
    { op: 'set', key: 'pressure', value: 55 },
    { op: 'restart', capture: ['DEVICE_RESTART', 'RESTART_BLOCKED'] },
    { op: 'waitBatch' },
  ],
  // 停机流程的前半段：仅触发停机并保持停机态，供恢复逻辑测试使用
  shutdownTrip: [
    { op: 'start' },
    { op: 'set', key: 'pressure', value: 96, capture: ['SHUTDOWN', 'PARAM_LIMIT'] },
    { op: 'wait', ticks: 3 },
  ],
};

export const normalScenario = () => runScenario('normal', SCENARIO_ACTIONS.normal);
export const limitScenario = () => runScenario('limit', SCENARIO_ACTIONS.limit);
export const shutdownScenario = () => runScenario('shutdown', SCENARIO_ACTIONS.shutdown);
export const shutdownTripOnlyScenario = () => runScenario('shutdown-trip', SCENARIO_ACTIONS.shutdownTrip);
export const SCENARIOS = Object.fromEntries(
  Object.entries(SCENARIO_ACTIONS).map(([k, actions]) => [k, () => runScenario(k, actions)]),
);
