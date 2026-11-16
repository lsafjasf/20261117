// 玻璃磨边仿真核心：与 DOM 无关，可在 Node 与浏览器中运行。
// 生产进度、能耗积分、环形缓存全部在同一个 advance() 仿真时钟内更新。
import {
  TICK_MS, PRESSURE, FEED, COOLANT, BURN_TEMP, CRACK_LIMIT, ROUGH_GOOD,
  TEMP_TRIP, PRESSURE_TRIP, ENERGY, CACHE_SIZE, GLASS_SPECS, DEFAULT_PARAMS,
} from './config.js';

const DT = TICK_MS / 1000;
const AMBIENT = 25;

function freshGlasses() {
  return GLASS_SPECS.map((spec) => ({
    ...spec,
    work: 0,
    heat: AMBIENT,
    crack: 0,
    roughness: 9,
    burn: false,
    cracked: false,
    done: false,
    pass: null,
    defects: [],
  }));
}

export function createSim() {
  return {
    batchId: 1,
    clock: 0,
    tickCount: 0,
    running: false,
    status: 'idle', // idle | running | paused | shutdown | completed
    params: { ...DEFAULT_PARAMS },
    limitState: 'ok', // ok | warning | danger
    currentIndex: 0,
    glasses: freshGlasses(),
    energyKwh: 0,
    peakKw: 0,
    good: 0,
    scrap: 0,
    shutdownReason: null,
    events: [],
    cache: [],
    batchResult: null,
    _seq: 0,
  };
}

export function record(sim, type, message, extra = {}) {
  const event = {
    seq: sim._seq++,
    batchId: sim.batchId,
    clock: Number(sim.clock.toFixed(2)),
    wall: new Date().toISOString(),
    type,
    message,
    params: { ...sim.params },
    ...extra,
  };
  sim.events.push(event);
  return event;
}

function checkSoftLimits(sim) {
  const { pressure, feed, coolant } = sim.params;
  let level = 'ok';
  if (pressure >= PRESSURE_TRIP || feed > FEED.hardMax || coolant > COOLANT.hardMax) level = 'danger';
  else if (
    pressure < PRESSURE.min || pressure > PRESSURE.max ||
    feed < FEED.min || feed > FEED.max ||
    coolant < COOLANT.min || coolant > COOLANT.max
  ) level = 'warning';
  if (level !== sim.limitState) {
    if (level !== 'ok') {
      record(sim, 'PARAM_LIMIT', `参数进入${level === 'danger' ? '危险' : '越限'}区间`, { level });
    } else {
      record(sim, 'PARAM_RECOVERED', '参数恢复到正常区间');
    }
    sim.limitState = level;
  }
}

// 参数调整：硬限外钳位并记录，软限外保留数值（触发越限事件，由物理模型体现后果）
export function setParam(sim, key, rawValue) {
  const limits = { pressure: PRESSURE, feed: FEED, coolant: COOLANT }[key];
  if (!limits) return false;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return false;
  const clamped = Math.min(limits.hardMax, Math.max(key === 'coolant' ? 0 : limits.min * 0.5, value));
  const old = sim.params[key];
  if (clamped === old) return false;
  sim.params[key] = clamped;
  record(sim, 'PARAM_CHANGE', `${key} ${old} → ${clamped}`, { key, old, value: clamped });
  if (value !== clamped) record(sim, 'PARAM_CLAMP', `${key} 越硬限被钳位为 ${clamped}`, { key, raw: value, value: clamped });
  checkSoftLimits(sim);
  return true;
}

function shutdown(sim, reason, message, extra = {}) {
  sim.running = false;
  sim.status = 'shutdown';
  sim.shutdownReason = reason;
  record(sim, 'SHUTDOWN', message, { reason, ...extra });
}

function anomalyPosition(glass) {
  return Number(Math.min(1, glass.work / glass.workRequired).toFixed(3));
}

function completeGlass(sim, glass) {
  glass.done = true;
  glass.pass = !glass.burn && !glass.cracked && glass.roughness <= ROUGH_GOOD;
  if (glass.pass) sim.good += 1;
  else sim.scrap += 1;
  record(sim, glass.pass ? 'GLASS_PASS' : 'GLASS_FAIL',
    `${glass.id} ${glass.pass ? '良品' : '不良品'}（粗糙度 ${glass.roughness.toFixed(2)}）`,
    { glassId: glass.id, pass: glass.pass, roughness: glass.roughness,
      heat: glass.heat, crack: glass.crack, defects: glass.defects });
  sim.currentIndex += 1;
  if (sim.currentIndex >= sim.glasses.length) finishBatch(sim);
}

function finishBatch(sim) {
  sim.running = false;
  sim.status = 'completed';
  const total = sim.good + sim.scrap;
  sim.batchResult = {
    batchId: sim.batchId,
    good: sim.good,
    scrap: sim.scrap,
    yieldRate: total ? Number((sim.good / total).toFixed(4)) : 0,
    peakKw: Number(sim.peakKw.toFixed(3)),
    energyKwh: Number(sim.energyKwh.toFixed(4)),
    durationSec: Number(sim.clock.toFixed(2)),
    glasses: sim.glasses.map((g) => ({
      id: g.id, pass: g.pass, roughness: g.roughness, defects: g.defects,
    })),
  };
  record(sim, 'BATCH_RESULT', `批次结束：良品 ${sim.good}/${total}`, { result: sim.batchResult });
}

function pushCache(sim, glass) {
  sim.cache.push({
    clock: Number(sim.clock.toFixed(2)),
    pressure: sim.params.pressure,
    feed: sim.params.feed,
    coolant: sim.params.coolant,
    heat: Number(glass.heat.toFixed(2)),
    crack: Number(glass.crack.toFixed(3)),
    roughness: Number(glass.roughness.toFixed(3)),
    work: Number(glass.work.toFixed(2)),
    index: sim.currentIndex,
  });
  if (sim.cache.length > CACHE_SIZE) sim.cache.splice(0, sim.cache.length - CACHE_SIZE);
}

// 一个仿真步：时钟、生产物理、能耗积分、缓存推送在此同一原子步内完成
export function advance(sim) {
  if (sim.status !== 'running') return sim;
  sim.tickCount += 1;
  sim.clock = Number(((sim.tickCount * TICK_MS) / 1000).toFixed(3));

  const { pressure, feed, coolant } = sim.params;
  const glass = sim.glasses[sim.currentIndex];

  // 压力硬限：机械停机（仅在研磨中触发）
  if (pressure >= PRESSURE_TRIP) {
    glass.defects.push({ type: 'overload', clock: sim.clock, position: anomalyPosition(glass) });
    shutdown(sim, 'overload', `压力 ${pressure}N 达机械极限，过载停机`, {
      glassId: glass.id, pressure,
    });
    pushCache(sim, glass);
    return sim;
  }

  // 热量：磨轮生热（随压力/进给），冷却水与环境散热
  const heatGen = (0.28 * pressure + 2.0 * feed) * (0.6 + 0.4 * glass.sensitivity) * DT;
  const cooling = (0.35 + 1.05 * coolant) * ((glass.heat - AMBIENT) / 100);
  glass.heat = Math.max(AMBIENT, glass.heat + heatGen - cooling);

  // 超温停机
  if (glass.heat >= TEMP_TRIP) {
    glass.defects.push({ type: 'overheat', clock: sim.clock, position: anomalyPosition(glass) });
    shutdown(sim, 'overheat', `温度 ${glass.heat.toFixed(1)}°C 超温停机`, {
      glassId: glass.id, heat: Number(glass.heat.toFixed(2)),
    });
    pushCache(sim, glass);
    return sim;
  }

  // 裂纹：压力超过 80N 后快速累积，高曲率更敏感
  if (pressure > 80) {
    glass.crack += ((pressure - 80) / 20) * 0.5 * glass.sensitivity * DT;
  }
  // 烧边：超过 BURN_TEMP 即形成烧边缺陷（位置只记首次）
  if (glass.heat >= BURN_TEMP && !glass.burn) {
    glass.burn = true;
    glass.defects.push({ type: 'burn', clock: sim.clock, position: anomalyPosition(glass) });
    record(sim, 'DEFECT_BURN', `${glass.id} 烧边 @ ${sim.clock}s`, {
      glassId: glass.id, heat: Number(glass.heat.toFixed(2)), position: anomalyPosition(glass),
    });
  }
  // 开裂：裂纹累计到阈值，当前玻璃报废（不停机，继续下一块）
  if (glass.crack >= CRACK_LIMIT && !glass.cracked) {
    glass.cracked = true;
    glass.defects.push({ type: 'crack', clock: sim.clock, position: anomalyPosition(glass) });
    record(sim, 'DEFECT_CRACK', `${glass.id} 开裂 @ ${sim.clock}s`, {
      glassId: glass.id, crack: Number(glass.crack.toFixed(3)), position: anomalyPosition(glass),
    });
  }

  // 研磨工作量与粗糙度演化
  const removal = pressure * feed * 0.0011 * glass.sensitivity;
  glass.work += removal * DT * 10;
  // 最终粗糙度由压力（适度加压更光滑）、冷却水、进给共同决定
  const pressureQuality = Math.min(7.6, Math.max(0, pressure - 20) * 0.22);
  const coolantQuality = Math.min(1.0, coolant * 0.12);
  const feedPenalty = feed > FEED.max ? (feed - FEED.max) * 0.35 : 0;
  const finalRoughness = Math.max(0.8, 9 - pressureQuality - coolantQuality + feedPenalty);
  // 粗糙度随研磨进度从 9 线性光滑到终值
  const progress = Math.min(1, glass.work / glass.workRequired);
  glass.roughness = 9 - (9 - finalRoughness) * progress;
  glass.roughness = Math.max(0.8, glass.roughness);

  // 能耗：同一时钟积分，记录峰值功率
  const power = ENERGY.wheelBase + ENERGY.pressureGain * pressure + ENERGY.coolantPump * coolant;
  sim.energyKwh += (power * DT) / 3600;
  sim.peakKw = Math.max(sim.peakKw, power);

  pushCache(sim, glass);

  if (glass.work >= glass.workRequired) completeGlass(sim, glass);
  return sim;
}

export function start(sim) {
  if (sim.status === 'completed' || sim.status === 'shutdown') return sim;
  if (!sim.running) {
    sim.running = true;
    sim.status = 'running';
    record(sim, 'DEVICE_START', '磨轮启动');
  }
  return sim;
}

export function pause(sim) {
  if (sim.status === 'running') {
    sim.running = false;
    sim.status = 'paused';
    record(sim, 'DEVICE_PAUSE', '磨轮暂停（可检查后恢复）');
  }
  return sim;
}

// 单步：暂停状态下推进一个仿真时钟步
export function step(sim) {
  if (sim.status === 'running' || sim.status === 'shutdown' || sim.status === 'completed') return sim;
  if (sim.status === 'idle') sim.status = 'paused';
  record(sim, 'DEVICE_STEP', `单步推进 ${TICK_MS}ms`);
  sim.status = 'running';
  advance(sim);
  if (sim.status === 'running') sim.status = 'paused';
  return sim;
}

// 故障恢复：仅停机状态可用，参数必须先回到安全区间
export function restart(sim) {
  if (sim.status !== 'shutdown') return sim;
  const { pressure, feed, coolant } = sim.params;
  if (pressure >= PRESSURE_TRIP || feed > FEED.hardMax || coolant > COOLANT.hardMax) {
    record(sim, 'RESTART_BLOCKED', '参数仍在危险区间，无法恢复');
    return sim;
  }
  const reason = sim.shutdownReason;
  sim.shutdownReason = null;
  sim.running = true;
  sim.status = 'running';
  checkSoftLimits(sim);
  record(sim, 'DEVICE_RESTART', `故障恢复（原因为 ${reason}）`, { recoveredReason: reason });
  return sim;
}

// 批次重置：清空生产状态、能耗、环形缓存与批次结果；事件全量保留以备审计
export function resetBatch(sim) {
  record(sim, 'BATCH_RESET', `批次 ${sim.batchId} 重置，缓存清空`);
  sim.batchId += 1;
  sim.clock = 0;
  sim.tickCount = 0;
  sim.running = false;
  sim.status = 'idle';
  sim.params = { ...DEFAULT_PARAMS };
  sim.limitState = 'ok';
  sim.currentIndex = 0;
  sim.glasses = freshGlasses();
  sim.energyKwh = 0;
  sim.peakKw = 0;
  sim.good = 0;
  sim.scrap = 0;
  sim.shutdownReason = null;
  sim.cache = [];
  sim.batchResult = null;
  return sim;
}

export function snapshot(sim) {
  return JSON.parse(JSON.stringify({
    batchId: sim.batchId, clock: sim.clock, status: sim.status, running: sim.running,
    params: sim.params, limitState: sim.limitState, currentIndex: sim.currentIndex,
    energyKwh: sim.energyKwh, peakKw: sim.peakKw, good: sim.good, scrap: sim.scrap,
    shutdownReason: sim.shutdownReason, cacheSize: sim.cache.length,
    cacheHead: sim.cache[0]?.clock ?? null,
    batchResult: sim.batchResult,
    glasses: sim.glasses.map((g) => ({
      id: g.id, work: g.work, heat: g.heat, crack: g.crack, roughness: g.roughness,
      burn: g.burn, cracked: g.cracked, done: g.done, pass: g.pass, defects: g.defects,
    })),
  }));
}
