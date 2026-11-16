'use strict';

// 双人协作消防水带 —— 核心逻辑（纯状态机，无 DOM，可在 Node 中测试）
// P1 泵手：只能控制水压（up/down）；P2 枪手：只能控制水枪方向（left/right）。
// 共享状态：水量、倒计时、火点 HP、水带转弯打折、任务日志、回放。

const CONFIG = {
  timeLimit: 120,        // 倒计时（秒）
  tankMax: 100,          // 共享水量
  pressureMax: 100,
  pumpRate: 30,          // P1 增压速度 /s
  releaseRate: 45,       // P1 降压速度 /s
  decayRate: 4,          // 水压自然衰减 /s（需持续操作）
  aimRate: 50,           // P2 转向速度 度/s
  aimMin: -10,
  aimMax: 70,
  corners: [             // 水带转弯处：压力超阈值打折，降到释放值以下恢复
    { at: 0.34, threshold: 88, release: 55 },
    { at: 0.67, threshold: 93, release: 65 },
  ],
  recoilThreshold: 96,   // 超过即反冲，枪口抖动
  recoilJitter: 12,      // 反冲抖动幅度 度/s
  fires: [               // 三个火点：角度 + 所需水压区间
    { id: 1, angle: 5,  band: [35, 55], hp: 100 },
    { id: 2, angle: 28, band: [55, 75], hp: 100 },
    { id: 3, angle: 52, band: [70, 85], hp: 100 },
  ],
  aimTolerance: 6,       // 命中角度容差（度）
  hitRate: 45,           // 命中时火点 HP 下降速度 /s
  drainRate: 2.5,        // 喷水时水量消耗 /s
  protectTimeout: 5,     // 单侧无输入超过该秒数进入保护状态
  snapshotEvery: 0.5,    // 回放快照间隔
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function r1(v) { return Math.round(v * 10) / 10; }

function addLog(state, text) {
  state.log.push({ t: r1(state.t), text });
}

function pushReplay(state, kind, data) {
  state.replay.push({ t: r1(state.t), kind, data });
}

function createGame(mode) {
  const state = {
    mode: mode === 'debug' ? 'debug' : 'coop',
    t: 0,
    timeLeft: CONFIG.timeLimit,
    tank: CONFIG.tankMax,
    pressure: 0,
    aim: 20,
    spraying: false,
    corners: CONFIG.corners.map(c => ({ at: c.at, threshold: c.threshold, release: c.release, kinked: false })),
    fires: CONFIG.fires.map(f => ({ id: f.id, angle: f.angle, band: f.band.slice(), hp: f.hp })),
    status: 'running', // running | win | lose
    players: {
      p1: { lastActive: 0, protected: false, inputs: 0 },
      p2: { lastActive: 0, protected: false, inputs: 0 },
    },
    log: [],
    replay: [],
    lastInputsJson: '',
    recoilTimer: 0,
    snapTimer: 0,
    rng: Math.random,
  };
  addLog(state, '任务开始：扑灭 3 个火点，保持水压安全');
  pushReplay(state, 'event', { type: 'start', mode: state.mode });
  return state;
}

// 输入白名单：P1 只有 up/down，P2 只有 left/right。
// 任何跨通道键位在此被丢弃，保证一侧操作无法代替另一侧。
function normalizeInputs(raw) {
  const p1 = (raw && raw.p1) || {};
  const p2 = (raw && raw.p2) || {};
  return {
    p1: { up: !!p1.up, down: !!p1.down },
    p2: { left: !!p2.left, right: !!p2.right },
  };
}

function updateProtection(state, inputs) {
  if (state.mode === 'debug') return; // 单人调试不启用保护
  for (const id of ['p1', 'p2']) {
    const player = state.players[id];
    const active = id === 'p1'
      ? (inputs.p1.up || inputs.p1.down)
      : (inputs.p2.left || inputs.p2.right);
    if (active) {
      player.inputs += 1;
      player.lastActive = state.t;
      if (player.protected) {
        player.protected = false;
        addLog(state, `${id.toUpperCase()} 已重新接入，解除保护`);
        pushReplay(state, 'event', { type: 'reconnect', player: id });
      }
    } else if (!player.protected && state.t - player.lastActive > CONFIG.protectTimeout) {
      player.protected = true;
      addLog(state, `⚠ ${id.toUpperCase()} 输入超时/断开，进入保护状态（执行器冻结）`);
      pushReplay(state, 'event', { type: 'protect', player: id });
    }
  }
}

function snapshot(state) {
  return {
    pressure: r1(state.pressure),
    aim: r1(state.aim),
    tank: r1(state.tank),
    timeLeft: r1(state.timeLeft),
    hp: state.fires.map(f => r1(f.hp)),
    kinks: state.corners.map(c => c.kinked),
  };
}

function step(state, dt, rawInputs) {
  if (state.status !== 'running') return state;
  const inputs = normalizeInputs(rawInputs);
  state.t += dt;
  state.timeLeft = Math.max(0, CONFIG.timeLimit - state.t);

  updateProtection(state, inputs);

  // 记录双方输入变化到回放
  const json = JSON.stringify(inputs);
  if (json !== state.lastInputsJson) {
    state.lastInputsJson = json;
    pushReplay(state, 'input', inputs);
  }

  // 保护状态冻结该侧执行器（输入被忽略，物理量保持）
  const p1 = state.players.p1.protected ? { up: false, down: false } : inputs.p1;
  const p2 = state.players.p2.protected ? { left: false, right: false } : inputs.p2;

  // P1：水压
  if (p1.up) state.pressure += CONFIG.pumpRate * dt;
  if (p1.down) state.pressure -= CONFIG.releaseRate * dt;
  if (!state.players.p1.protected) state.pressure -= CONFIG.decayRate * dt;
  state.pressure = clamp(state.pressure, 0, CONFIG.pressureMax);

  // P2：方向
  if (p2.left) state.aim -= CONFIG.aimRate * dt;
  if (p2.right) state.aim += CONFIG.aimRate * dt;
  state.aim = clamp(state.aim, CONFIG.aimMin, CONFIG.aimMax);

  // 反冲：压力过高，枪口被顶得抖动
  if (state.pressure > CONFIG.recoilThreshold) {
    state.aim = clamp(state.aim + (state.rng() - 0.5) * 2 * CONFIG.recoilJitter * dt,
      CONFIG.aimMin, CONFIG.aimMax);
    state.recoilTimer -= dt;
    if (state.recoilTimer <= 0) {
      state.recoilTimer = 1;
      addLog(state, '⚠ 水压过高，水带反冲！枪口失控抖动');
      pushReplay(state, 'event', { type: 'recoil', pressure: r1(state.pressure) });
    }
  }

  // 转弯处打折 / 恢复
  state.corners.forEach((corner, i) => {
    if (!corner.kinked && state.pressure > corner.threshold) {
      corner.kinked = true;
      addLog(state, `⚠ 转弯 ${i + 1} 处水带打折，水流中断！降压至 ${corner.release} 以下恢复`);
      pushReplay(state, 'event', { type: 'kink', corner: i + 1, pressure: r1(state.pressure) });
    } else if (corner.kinked && state.pressure < corner.release) {
      corner.kinked = false;
      addLog(state, `✔ 转弯 ${i + 1} 处打折已恢复，水流恢复`);
      pushReplay(state, 'event', { type: 'unkink', corner: i + 1, pressure: r1(state.pressure) });
    }
  });

  // 喷水与命中判定
  const kinked = state.corners.some(c => c.kinked);
  state.spraying = state.pressure > 5 && !kinked && state.tank > 0;
  if (state.spraying) {
    state.tank = Math.max(0, state.tank - CONFIG.drainRate * dt);
    for (const fire of state.fires) {
      if (fire.hp <= 0) continue;
      const inBand = state.pressure >= fire.band[0] && state.pressure <= fire.band[1];
      const aligned = Math.abs(state.aim - fire.angle) <= CONFIG.aimTolerance;
      if (inBand && aligned) {
        fire.hp = Math.max(0, fire.hp - CONFIG.hitRate * dt);
        if (fire.hp === 0) {
          addLog(state, `✔ 火点 ${fire.id} 已扑灭`);
          pushReplay(state, 'event', { type: 'extinguish', fire: fire.id });
        }
      }
    }
  }

  // 回放快照（共享资源：水压/方向/水量/倒计时/火点/打折）
  state.snapTimer -= dt;
  if (state.snapTimer <= 0) {
    state.snapTimer = CONFIG.snapshotEvery;
    pushReplay(state, 'snap', snapshot(state));
  }

  // 结算
  if (state.fires.every(f => f.hp <= 0)) {
    state.status = 'win';
    addLog(state, '✔ 任务成功：全部火点扑灭，水压安全');
    pushReplay(state, 'event', { type: 'win' });
    pushReplay(state, 'snap', snapshot(state)); // 终局快照，保证回放尾帧与状态一致
  } else if (state.timeLeft <= 0) {
    state.status = 'lose';
    addLog(state, '✘ 任务失败：倒计时结束');
    pushReplay(state, 'event', { type: 'lose', reason: 'timeout' });
    pushReplay(state, 'snap', snapshot(state));
  } else if (state.tank <= 0) {
    state.status = 'lose';
    addLog(state, '✘ 任务失败：水量耗尽');
    pushReplay(state, 'event', { type: 'lose', reason: 'tank' });
    pushReplay(state, 'snap', snapshot(state));
  }
  return state;
}

const GameCore = { CONFIG, createGame, step, snapshot };

if (typeof module !== 'undefined' && module.exports) module.exports = GameCore;
if (typeof window !== 'undefined') window.GameCore = GameCore;
