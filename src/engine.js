import {
  tileAt,
  centerYAt,
  ceilingYAt,
  currentAt,
  columnAt,
  TILE,
} from './world.js';
import { hashSeed } from './rng.js';

export const FIXED_DT = 1 / 60;
const BOAT_R = 12;
const HULL_MAX = 100;
const MAX_SPEED = 130;
const THRUST = 170;
const TURN = 2.2;
const DRAG = 0.9;
const FUEL_MAX = 320;
const LETTER_WEIGHT = 26;
const BASE_LOAD_HALF = 30; // 空载货物顶端距水面中心的高度（像素）
const INVULN_SECONDS = 1.0;

const FAIL_MESSAGES = {
  hull: '船体受损过重，小邮船沉没了',
  fuel: '燃料耗尽，船在暗河上失去动力',
};

export function createInitialState(world) {
  const start = world.waypoints[1];
  return {
    boat: {
      x: start.x,
      y: start.y,
      angle: 0,
      vx: 0,
      vy: 0,
      speed: 0,
      hull: HULL_MAX,
      fuel: FUEL_MAX,
      tilt: 0,
      grounded: false,
      refloatHold: 0,
      invuln: 0,
      lampOn: true,
    },
    letters: world.warehouses.map((w) => ({
      warehouseId: w.id,
      delivered: false,
      weight: LETTER_WEIGHT,
    })),
    frame: 0,
    status: 'running', // running | won | failed | paused
    failReason: null,
    lastFailReason: null,
    lastEvent: '任务开始：把三封信送到地下河仓库',
    events: [
      { frame: 0, text: '任务开始：把三封信送到地下河仓库', kind: 'info' },
    ],
    checkpointsVisited: [0],
    checkpointSnapshot: null,
    recoveryCount: 0,
    recovering: false,
    deliveredCount: 0,
    wind: { angle: 0, strength: 26 },
    seedHash: hashSeed(world.seed),
  };
}

function logEvent(state, text, kind = 'info') {
  state.lastEvent = text;
  state.events.push({ frame: state.frame, text, kind });
  if (state.events.length > 60) state.events.shift();
}

export function carriedWeight(state) {
  return state.letters
    .filter((l) => !l.delivered)
    .reduce((sum, l) => sum + l.weight, 0);
}

// 货箱偏心导致的侧倾角（弧度）。
export function computeTilt(state, angle) {
  const w = carriedWeight(state);
  if (w === 0) return -angle * 0.12;
  const imbalance =
    Math.cos(angle) * 0.06 + Math.sin(angle * 1.7 + state.frame * 0.05) * 0.04;
  return -angle * 0.12 + imbalance * (w / (LETTER_WEIGHT * 3));
}

// 当前货物顶端高度（相对水面中心线，像素），用于判断洞顶限制。
export function cargoTopOffset(state, angle) {
  const w = carriedWeight(state);
  return BASE_LOAD_HALF + w * 0.55 + Math.abs(computeTilt(state, angle)) * 26;
}

export function currentWind(state) {
  const t = state.frame / 60;
  const angle =
    Math.sin(t * 0.11 + state.seedHash * 0.000001) * 0.9 +
    Math.sin(t * 0.037 + 1.7) * 0.5;
  const strength = 26 + Math.sin(t * 0.07 + state.seedHash * 0.000003) * 14;
  return { angle, strength };
}

function checkCheckpoint(world, state) {
  for (const cp of world.checkpoints) {
    const idx = world.checkpoints.indexOf(cp);
    if (
      !state.checkpointsVisited.includes(idx) &&
      Math.abs(state.boat.x - cp.x) < TILE * 1.2
    ) {
      state.checkpointsVisited.push(idx);
      state.checkpointSnapshot = snapshotForCheckpoint(world, state);
      logEvent(state, `抵达检查点 ${idx}，已保存进度`, 'checkpoint');
    }
  }
}

function checkDelivery(world, state) {
  const boat = state.boat;
  for (const warehouse of world.warehouses) {
    const dist = Math.hypot(boat.x - warehouse.x, boat.y - warehouse.y);
    if (dist < TILE * 2.2) {
      const letter = state.letters.find((l) => l.warehouseId === warehouse.id);
      if (letter && !letter.delivered) {
        letter.delivered = true;
        state.deliveredCount += 1;
        logEvent(state, `信件已送达仓库 ${warehouse.index + 1}`, 'delivery');
      }
    }
  }
}

function fail(state, code) {
  state.status = 'failed';
  state.failReason = FAIL_MESSAGES[code];
  state.lastFailReason = state.failReason;
  logEvent(state, state.failReason, 'fail');
}

function handleEnvironment(world, state, input) {
  const boat = state.boat;
  const center = centerYAt(world, boat.x);

  // 岩石碰撞：扣船体耐久、击退并短暂无敌。
  if (boat.invuln <= 0) {
    for (const rock of world.obstacles) {
      const dx = boat.x - rock.x;
      const dy = boat.y - rock.y;
      const dist = Math.hypot(dx, dy);
      if (dist < rock.r + BOAT_R) {
        const nx = dist > 0.001 ? dx / dist : 1;
        const ny = dist > 0.001 ? dy / dist : 0;
        const overlap = rock.r + BOAT_R - dist;
        boat.x += nx * (overlap + 1.5);
        boat.y += ny * (overlap + 1.5);
        boat.vx = boat.vx * 0.3 + nx * 130;
        boat.vy = boat.vy * 0.3 + ny * 130;
        boat.hull = Math.max(0, boat.hull - 28);
        boat.invuln = INVULN_SECONDS;
        logEvent(state, `撞上 ${rock.id}，船体 -28`, 'damage');
        if (boat.hull <= 0) fail(state, 'hull');
        return;
      }
    }
  }

  // 浅水搁浅：按住 S（后退）可脱困；岩石格按碰撞处理，不算搁浅。
  const tile = tileAt(world, boat.x, boat.y);
  if (tile === 'shoal') {
    boat.grounded = true;
    if (input.backward) {
      boat.refloatHold += FIXED_DT;
      if (boat.refloatHold >= 0.6) {
        boat.grounded = false;
        boat.refloatHold = 0;
        boat.y += Math.sign(center - boat.y || 1) * world.TILE * 0.8;
        boat.vx = 60;
        boat.vy = (center - boat.y) * 1.2;
        boat.angle = Math.max(-0.6, Math.min(0.6, Math.atan2(center - boat.y, 80)));
        state.recoveryCount += 1;
        logEvent(state, '倒车脱困成功，恢复航行', 'recovery');
      }
    } else {
      boat.refloatHold = 0;
    }
  } else {
    boat.grounded = false;
    boat.refloatHold = 0;
  }

  // 洞顶刮蹭：货物越高越危险。
  if (boat.invuln <= 0) {
    const topY = center - cargoTopOffset(state, boat.angle);
    const ceilingY = ceilingYAt(world, boat.x);
    if (topY < ceilingY) {
      boat.hull = Math.max(0, boat.hull - 12);
      boat.invuln = INVULN_SECONDS;
      logEvent(state, '货箱刮到洞顶，船体 -12', 'damage');
      if (boat.hull <= 0) fail(state, 'hull');
    }
  }
}

export function step(world, state, input) {
  if (state.status === 'paused' || state.status === 'won' || state.status === 'failed') {
    return state;
  }
  const boat = state.boat;
  state.frame += 1;

  if (input.lampToggle) boat.lampOn = !boat.lampOn;

  if (typeof input.steer === 'number') {
    boat.angle -= TURN * FIXED_DT * Math.max(-1, Math.min(1, input.steer));
  } else {
    if (input.forward) boat.angle -= TURN * FIXED_DT;
    if (input.backward && !boat.grounded) boat.angle += TURN * FIXED_DT;
  }
  // 禁止船头完全朝左，保证始终有向右的推进分量。
  // 归一化到 [-pi, pi)，不做硬钳制，避免在极限角度死锁。
  while (boat.angle >= Math.PI) boat.angle -= Math.PI * 2;
  while (boat.angle < -Math.PI) boat.angle += Math.PI * 2;

  const throttle = (input.throttle ?? 1) * (!boat.grounded ? 1 : 0.15);
  const propel = input.propel !== undefined ? input.propel : input.forward;
  if (boat.speed === undefined) boat.speed = 0;
  if (boat.fuel > 0 && !boat.grounded && propel) {
    boat.speed += THRUST * FIXED_DT * throttle;
    boat.fuel = Math.max(0, boat.fuel - 0.009 * throttle);
  } else if (input.reverse && !boat.grounded) {
    boat.speed -= THRUST * 0.7 * FIXED_DT;
  }
  boat.speed *= Math.pow(DRAG, FIXED_DT * 60);
  boat.speed = Math.max(-40, Math.min(MAX_SPEED, boat.speed));

  const cur = currentAt(world, boat.x);
  const currentVx = Math.cos(cur.angle) * cur.strength;
  const currentVy = Math.sin(cur.angle) * cur.strength;
  // 河道回正浮力：偏离中心越远，向中心的回复力越强，抑制横向漂移搁浅。
  const center = centerYAt(world, boat.x);
  const lateralOffset = boat.y - center;
  state.wind = currentWind(state);
  const windVx = Math.cos(state.wind.angle) * state.wind.strength * 0.4;
  const windVy = Math.sin(state.wind.angle) * state.wind.strength * 0.4;
  // 搁浅时回正浮力失效，必须由玩家倒车脱困。
  const recenterVy = boat.grounded ? 0 : -lateralOffset * 0.35;

  boat.vx = Math.cos(boat.angle) * boat.speed + currentVx + windVx;
  boat.vy = Math.sin(boat.angle) * boat.speed + currentVy + windVy + recenterVy;

  boat.x += boat.vx * FIXED_DT;
  boat.y += boat.vy * FIXED_DT;
  // 世界边界：不允许驶出地图。
  boat.x = Math.max(BOAT_R, Math.min(world.width - BOAT_R, boat.x));
  boat.y = Math.max(BOAT_R, Math.min(world.height - BOAT_R, boat.y));
  boat.tilt = computeTilt(state, boat.angle);

  handleEnvironment(world, state, input);
  boat.invuln = Math.max(0, boat.invuln - FIXED_DT);
  if (state.status === 'failed') return state;

  checkCheckpoint(world, state);
  checkDelivery(world, state);

  if (boat.fuel <= 0 && Math.hypot(boat.vx, boat.vy) < 6) {
    fail(state, 'fuel');
    return state;
  }
  if (state.deliveredCount === world.warehouses.length) {
    state.status = 'won';
    logEvent(state, '三封信全部送达，任务完成！', 'win');
  }
  return state;
}

export function isWarehouseDelivered(state, warehouseId) {
  const letter = state.letters.find((l) => l.warehouseId === warehouseId);
  return Boolean(letter && letter.delivered);
}

export function snapshotForCheckpoint(world, state) {
  const boat = { ...state.boat, grounded: false, refloatHold: 0, invuln: 0 };
  return {
    boat,
    letters: state.letters.map((l) => ({ ...l })),
    frame: state.frame,
    checkpointsVisited: [...state.checkpointsVisited],
    deliveredCount: state.deliveredCount,
    recoveryCount: state.recoveryCount,
    wind: { ...state.wind },
    seedHash: state.seedHash,
  };
}

// 从最近检查点继续：恢复位置与资源，但保留最近失败原因展示。
export function resumeFromCheckpoint(world, state) {
  const snap = state.checkpointSnapshot;
  if (!snap) return createInitialState(world);
  state.boat = { ...snap.boat };
  state.letters = snap.letters.map((l) => ({ ...l }));
  state.frame = snap.frame;
  state.checkpointsVisited = [...snap.checkpointsVisited];
  state.deliveredCount = snap.deliveredCount;
  state.recoveryCount = snap.recoveryCount;
  state.wind = { ...snap.wind };
  state.status = 'running';
  state.failReason = null;
  logEvent(state, '从最近检查点继续航行', 'recovery');
  return state;
}

// 重开：恢复全部目标、燃料、船体与检查点，而不是只重置船。
export function restart(world) {
  return createInitialState(world);
}

export function togglePause(state) {
  if (state.status === 'running') state.status = 'paused';
  else if (state.status === 'paused') state.status = 'running';
  return state;
}

const SAVE_VERSION = 1;

export function serialize(world, state) {
  return JSON.stringify({
    version: SAVE_VERSION,
    seed: world.seed,
    state,
    savedAt: new Date().toISOString(),
  });
}

export function validateSavedState(world, raw) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!data || data.version !== SAVE_VERSION || String(data.seed) !== String(world.seed)) {
    return null;
  }
  const state = data.state;
  if (!state || !state.boat || !Array.isArray(state.letters) || state.letters.length !== world.warehouses.length) {
    return null;
  }
  return state;
}

export function getHud(world, state) {
  return {
    delivered: state.deliveredCount,
    total: world.warehouses.length,
    hull: state.boat.hull,
    hullMax: HULL_MAX,
    fuel: state.boat.fuel,
    fuelMax: FUEL_MAX,
    carriedWeight: carriedWeight(state),
    status: state.status,
    lastFailReason: state.lastFailReason,
    lastEvent: state.lastEvent,
    recoveryCount: state.recoveryCount,
    checkpointsVisited: state.checkpointsVisited.length,
    checkpointsTotal: world.checkpoints.length,
  };
}

export function nearestWaypoint(world, boat) {
  let best = world.waypoints[0];
  let bestD = Infinity;
  for (const wp of world.waypoints) {
    const d = Math.hypot(wp.x - boat.x, wp.y - boat.y);
    if (d < bestD) {
      bestD = d;
      best = wp;
    }
  }
  return best;
}

export const constants = {
  BOAT_R,
  HULL_MAX,
  FUEL_MAX,
  LETTER_WEIGHT,
  INVULN_SECONDS,
  FAIL_MESSAGES,
};
