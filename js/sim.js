// 核心模拟:固定步长(60Hz),所有动态均为 tick 的确定性函数
import { generateWorld, windAt, obstaclePositions, WORLD } from './world.js';

export const DT = 1 / 60;
const SHIP_R = 26;
const DOCK_SPEED = 2.0;
const LOAD_TIME = 12 * 60;      // 装卸耗时(tick)
const RECOVER_TIME = 3 * 60;    // 搁浅脱困耗时
const RECOVER_FUEL = 15;
const OVERLOAD_COOL = 20 * 60;  // 压缩机过载停机冷却

export function createGame(seedNum) {
  const world = generateWorld(seedNum);
  const state = {
    seedNum,
    world,
    tick: 0,
    status: 'playing',           // playing | won | failed
    paused: false,
    ship: { x: world.docks[0].x, y: world.docks[0].y, heading: 0, speed: 0, vx: 0, vy: 0 },
    hull: 100,
    zones: [0, 1, 2].map(() => ({ temp: -4, doorOpen: false, overTime: 0 })),
    compressor: { on: true, power: 2, heat: 10, overloaded: false, cooldown: 0 },
    resources: { fuel: 100, repairKits: 2, timeLeft: 900 },
    loading: null,               // {taskId, timer}
    grounded: false,
    recovery: null,              // {timer}
    invuln: 0,
    weight: 0,
    nextDock: 0,                 // 下一个目标码头 index
    lastFailure: null,           // {reason, tick}
    checkpoint: null,            // 最近检查点快照(JSON)
    events: [],
  };
  state.checkpoint = saveState(state); // 初始检查点
  return state;
}

function stepShip(state, input) {
  const s = state.ship;
  if (state.grounded || state.loading) { s.speed = 0; s.vx = 0; s.vy = 0; return; }
  const vmax = maxSpeed(state);
  if (input.up) s.speed = Math.min(vmax, s.speed + 0.03);
  if (input.down) s.speed = Math.max(0, s.speed - 0.05);
  const turn = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  s.heading += turn * 0.02 * Math.min(1, s.speed / 2 + 0.3);
  // 风推漂移
  const w = windAt(state.world, state.tick);
  const drift = w.speed * 0.004;
  s.vx = Math.cos(s.heading) * s.speed + Math.cos(w.dir) * drift;
  s.vy = Math.sin(s.heading) * s.speed + Math.sin(w.dir) * drift;
  s.x += s.vx; s.y += s.vy;
  s.x = Math.max(SHIP_R, Math.min(WORLD.width - SHIP_R, s.x));
  s.y = Math.max(SHIP_R, Math.min(WORLD.height - SHIP_R, s.y));
  // 燃料
  state.resources.fuel -= s.speed * 0.0004;
  if (state.resources.fuel <= 0) {
    state.resources.fuel = 0;
    fail(state, '燃料耗尽,失去动力');
  }
}

function stepHazards(state) {
  const s = state.ship;
  for (const { ob, x, y } of obstaclePositions(state.world, state.tick)) {
    const dx = s.x - x, dy = s.y - y;
    const d2 = dx * dx + dy * dy;
    if (ob.type === 'ship' && state.invuln <= 0 && d2 < (ob.r + SHIP_R) ** 2) {
      state.hull -= 40;
      state.invuln = 120;
      s.speed *= 0.3;
      log(state, `与船只碰撞!船体剩余 ${Math.max(0, Math.round(state.hull))}%`);
      if (state.hull <= 0) return fail(state, '碰撞导致船体破损沉没');
    }
    if (ob.type === 'shoal' && !state.grounded && d2 < (ob.r * 0.8) ** 2) {
      state.grounded = true;
      s.speed = 0;
      log(state, '触礁搁浅!按 R 倒车脱困(耗燃料)');
    }
  }
}

function stepArrival(state) {
  const dock = currentDock(state);
  if (!dock) return;
  // 到达装货港 -> 记录检查点
  if (!dock.isDestination && dock.id === state.nextDock) {
    const task = state.world.tasks.find((t) => t.dockId === dock.id);
    if (task && task.loaded) {
      state.nextDock += 1;
      state.checkpoint = saveState(state);
      log(state, `离开${dock.name},检查点已保存`);
    }
  }
  // 目的港交付
  if (dock.isDestination && state.world.tasks.every((t) => t.loaded)) {
    for (const t of state.world.tasks) t.delivered = true;
    const spoiled = state.world.tasks.filter((t) => t.spoiled);
    if (spoiled.length > 0) {
      fail(state, `${spoiled.length} 批货物温度超标变质,交付失败`);
    } else {
      state.status = 'won';
      log(state, '三批冷藏货全部在温度范围内抵达,任务完成!');
    }
  }
}

// ---- 暂停 / 重开 / 检查点 / 存档 ----
export function setPaused(state, p) { state.paused = p; }

export function restart(state) {
  return createGame(state.seedNum); // 同 seed 完整重建:目标与资源全部复位
}

export function continueFromCheckpoint(state) {
  if (!state.checkpoint) return restart(state);
  const snap = loadState(state.checkpoint);
  snap.lastFailure = state.lastFailure; // 保留最近失败原因用于显示
  log(snap, '从最近检查点继续');
  return snap;
}

export function saveState(state) {
  return JSON.stringify(state);
}

export function loadState(json) {
  const s = JSON.parse(json);
  return s;
}

// ---- 进度显示 ----
export function getProgress(state) {
  const tasks = state.world.tasks;
  return {
    loaded: tasks.filter((t) => t.loaded).length,
    delivered: tasks.filter((t) => t.delivered && !t.spoiled).length,
    spoiled: tasks.filter((t) => t.spoiled).length,
    total: tasks.length,
    fuel: Math.round(state.resources.fuel),
    repairKits: state.resources.repairKits,
    hull: Math.round(state.hull),
    timeLeft: Math.max(0, Math.round(state.resources.timeLeft)),
    weight: cargoWeight(state),
    lastFailure: state.lastFailure ? state.lastFailure.reason : null,
  };
}

// ---- 主步进 ----
// input: {up,down,left,right, action: null|'load'|'compressor'|'powerUp'|'powerDown'|'recover'|'repair'}
export function step(state, input = {}) {
  if (state.status !== 'playing' || state.paused) return state;
  state.tick += 1;
  state.resources.timeLeft -= DT;
  if (state.resources.timeLeft <= 0) return fail(state, '超过交货时限'), state;

  handleAction(state, input);
  stepLoading(state);
  stepRecovery(state);
  stepShip(state, input);
  stepThermal(state);
  stepHazards(state);
  stepArrival(state);
  if (state.invuln > 0) state.invuln -= 1;
  state.weight = cargoWeight(state);
  return state;
}

function handleAction(state, input) {
  const c = state.compressor;
  switch (input.action) {
    case 'compressor':
      if (!c.overloaded) { c.on = !c.on; log(state, c.on ? '压缩机启动' : '压缩机关闭'); }
      break;
    case 'powerUp': c.power = Math.min(3, c.power + 1); break;
    case 'powerDown': c.power = Math.max(1, c.power - 1); break;
    case 'repair':
      if (state.resources.repairKits > 0 && (c.overloaded || state.hull < 100)) {
        state.resources.repairKits -= 1;
        if (c.overloaded) { c.overloaded = false; c.cooldown = 0; c.heat = 40; }
        state.hull = Math.min(100, state.hull + 30);
        log(state, '使用维修包: 压缩机复位 / 船体修复');
      }
      break;
    case 'load': tryLoad(state); break;
    case 'recover': tryRecover(state); break;
  }
}

function tryLoad(state) {
  if (state.loading || state.grounded) return;
  const dock = currentDock(state);
  if (!dock || dock.isDestination) return;
  const task = state.world.tasks.find((t) => t.dockId === dock.id && !t.loaded);
  if (!task) return;
  state.loading = { taskId: task.id, timer: LOAD_TIME };
  state.zones[task.zone].doorOpen = true;
  log(state, `舱门打开,吊机开始装载第 ${task.id + 1} 批货(舱区 ${task.zone + 1})`);
}

function stepLoading(state) {
  if (!state.loading) return;
  const task = state.world.tasks[state.loading.taskId];
  state.loading.timer -= 1;
  if (state.loading.timer <= 0) {
    task.loaded = true;
    state.zones[task.zone].doorOpen = false;
    state.loading = null;
    log(state, `第 ${task.id + 1} 批货装载完成,舱门关闭`);
  }
}

function tryRecover(state) {
  if (!state.grounded || state.recovery) return;
  if (state.resources.fuel < RECOVER_FUEL) {
    return fail(state, '搁浅且燃料不足,无法脱困');
  }
  state.recovery = { timer: RECOVER_TIME };
  log(state, '搁浅!正在倒车脱困...');
}

function stepRecovery(state) {
  if (!state.recovery) return;
  state.recovery.timer -= 1;
  if (state.recovery.timer <= 0) {
    state.resources.fuel -= RECOVER_FUEL;
    state.grounded = false;
    state.recovery = null;
    // 向后弹出浅滩
    state.ship.x -= Math.cos(state.ship.heading) * 80;
    state.ship.y -= Math.sin(state.ship.heading) * 80;
    log(state, `脱困成功,消耗燃料 ${RECOVER_FUEL}`);
  }
}

function log(state, msg) {
  state.events.push({ tick: state.tick, msg });
  if (state.events.length > 8) state.events.shift();
}

function fail(state, reason) {
  if (state.status !== 'playing') return;
  state.status = 'failed';
  state.lastFailure = { reason, tick: state.tick };
  log(state, `失败: ${reason}`);
}

export function cargoWeight(state) {
  return state.world.tasks.reduce((s, t) => s + (t.loaded && !t.delivered ? t.weight : 0), 0);
}

function maxSpeed(state) {
  return 7 / (1 + cargoWeight(state) * 0.06); // 冷藏箱重量降低航速
}

function currentDock(state) {
  return state.world.docks.find((d) => {
    const dx = state.ship.x - d.x, dy = state.ship.y - d.y;
    return dx * dx + dy * dy < d.r * d.r && state.ship.speed < DOCK_SPEED;
  }) || null;
}

// ---- 温度与压缩机 ----
function stepThermal(state) {
  const c = state.compressor;
  if (c.overloaded) {
    c.cooldown -= 1;
    if (c.cooldown <= 0) { c.overloaded = false; c.heat = 40; log(state, '压缩机冷却完成,已复位'); }
  } else if (c.on) {
    c.heat += c.power * 0.008;
    if (c.heat >= 100) {
      c.heat = 100; c.on = false; c.overloaded = true; c.cooldown = OVERLOAD_COOL;
      log(state, '压缩机过载停机!');
    }
  } else {
    c.heat = Math.max(0, c.heat - 0.05);
  }
  for (let i = 0; i < 3; i++) {
    const z = state.zones[i];
    // 开门升温快,关门缓慢渗漏
    const leak = z.doorOpen ? 0.002 : 0.0004;
    z.temp += (WORLD.ambientTemp - z.temp) * leak;
    if (c.on && !c.overloaded) z.temp -= c.power * 0.02;
    // 越限计时 -> 货物变质
    const out = z.temp < WORLD.tempMin || z.temp > WORLD.tempMax;
    z.overTime = out ? z.overTime + DT : 0;
    if (z.overTime > WORLD.spoilGrace) {
      const t = state.world.tasks.find((t) => t.zone === i && t.loaded && !t.delivered && !t.spoiled);
      if (t) { t.spoiled = true; log(state, `舱区 ${i + 1} 温度失控,第 ${t.id + 1} 批货变质!`); }
    }
  }
}
