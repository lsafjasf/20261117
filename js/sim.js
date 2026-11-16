/* 温室温控仿真核心:纯逻辑,不依赖 DOM,可在 Node 中直接运行验证。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GreenhouseSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONFIG = {
    dt: 0.1,                 // 仿真步长(秒)
    duration: 90,            // 成功需要维持的秒数
    zoneNames: ['左区', '中区', '右区'],
    safeMin: 18,             // 安全温度下限
    safeMax: 26,             // 安全温度上限
    startTemp: [21, 22, 21], // 各分区初始温度
    tolerance: [14, 9, 14],  // 各分区作物可耐受超温的累计秒数(不同作物不同)
    stressRecover: 0.45,     // 回到安全区后压力恢复速率(倍率)
    outdoorBase: 12,         // 室外基准温度
    outdoorAmp: 4,           // 室外温度波动幅度
    outdoorPeriod: 45,       // 波动周期(秒)
    coldSnapAt: 30,          // 寒潮开始时刻
    coldSnapLen: 18,         // 寒潮持续
    coldSnapDrop: 7,         // 寒潮额外降温
    heatWaveAt: 60,          // 热浪开始时刻
    heatWaveLen: 18,
    heatWaveRise: 14,        // 热浪额外升温(迫使通风侧介入)
    heaterPower: 3.2,        // 单侧加热带满功率对同侧分区的升温速率(°C/s),强于开窗散热
    heaterSpill: 0.45,       // 加热向相邻分区溢出的比例(会导致另一侧过热)
    windowCool: 1.9,         // 单侧窗户全开时同侧分区散热速率(°C/s)
    windowSpill: 0.35,       // 开窗对相邻分区的散热比例
    insulation: 0.06,        // 向室外自然散热系数
    zoneCoupling: 0.05,      // 相邻分区热交换系数
    energyMax: 100,
    energyRegen: 3.2,        // 每秒回能
    heaterCost: 5.0,         // 单侧满功率每秒耗能
    controlRate: 1.4,        // 按键调节速率(0..1 每秒)
    protectTimeout: 8,       // 玩家无输入多少秒后进入保护状态
    conflictGap: 0.25,       // 同区窗与加热同时超过该值视为冲突
    conflictCooldown: 2.0    // 冲突事件最小记录间隔(秒)
  };

  function createState(seed) {
    return {
      t: 0,
      countdown: CONFIG.duration,
      energy: CONFIG.energyMax,
      outdoor: CONFIG.outdoorBase,
      weather: '平稳',
      temps: CONFIG.startTemp.slice(),
      stress: [0, 0, 0],          // 各分区累计受压秒数
      zoneFailed: [false, false, false],
      // 执行器当前开度 0..1,只能由对应职责的玩家修改
      controls: { winL: 0, winR: 0, heatL: 0, heatR: 0 },
      players: {
        A: { lastInput: 0, protected: false },  // 通风窗
        B: { lastInput: 0, protected: false }   // 加热带
      },
      status: 'running', // running | paused | win | lose
      failReason: '',
      events: []         // 仿真期事件(冲突/保护/结果),供回放与任务记录
    };
  }

  // 每个执行器唯一归属一名玩家,键位集合互斥
  var OWNER = { winL: 'A', winR: 'A', heatL: 'B', heatR: 'B' };

  function outdoorAt(t) {
    var v = CONFIG.outdoorBase +
      CONFIG.outdoorAmp * Math.sin((t / CONFIG.outdoorPeriod) * Math.PI * 2);
    if (t >= CONFIG.coldSnapAt && t < CONFIG.coldSnapAt + CONFIG.coldSnapLen) {
      v -= CONFIG.coldSnapDrop;
    }
    if (t >= CONFIG.heatWaveAt && t < CONFIG.heatWaveAt + CONFIG.heatWaveLen) {
      v += CONFIG.heatWaveRise;
    }
    return v;
  }

  function weatherAt(t) {
    if (t >= CONFIG.coldSnapAt && t < CONFIG.coldSnapAt + CONFIG.coldSnapLen) return '寒潮';
    if (t >= CONFIG.heatWaveAt && t < CONFIG.heatWaveAt + CONFIG.heatWaveLen) return '热浪';
    return '平稳';
  }

  // 应用一名玩家对某个执行器的调节意图,delta 为 -1/0/+1
  // 强制职责隔离:玩家只能动自己的执行器,返回是否生效
  function applyControl(state, player, control, delta) {
    if (OWNER[control] !== player) return false;
    var c = state.controls;
    var next = Math.min(1, Math.max(0, c[control] + delta * CONFIG.controlRate * CONFIG.dt));
    if (next !== c[control]) {
      c[control] = next;
      var p = state.players[player];
      p.lastInput = state.t;
      if (p.protected) {
        p.protected = false;
        pushEvent(state, 'resume', { player: player });
      }
      return true;
    }
    return false;
  }

  function pushEvent(state, type, data) {
    var ev = { t: Math.round(state.t * 10) / 10, type: type };
    if (data) for (var k in data) ev[k] = data[k];
    state.events.push(ev);
    return ev;
  }

  // 保护状态:玩家超时无输入时,其执行器由安全控制器代管(朝安全区微调)
  function protectStep(state, player) {
    var c = state.controls;
    var t0 = state.temps[0], t2 = state.temps[2];
    var mid = (CONFIG.safeMin + CONFIG.safeMax) / 2;
    if (player === 'A') {
      // 通风侧:过热则开窗,过冷则关窗
      c.winL = clamp01(c.winL + (t0 > mid + 1 ? 0.3 : t0 < mid - 1 ? -0.3 : 0) * CONFIG.dt);
      c.winR = clamp01(c.winR + (t2 > mid + 1 ? 0.3 : t2 < mid - 1 ? -0.3 : 0) * CONFIG.dt);
    } else {
      c.heatL = clamp01(c.heatL + (t0 < mid - 1 ? 0.3 : t0 > mid + 1 ? -0.3 : 0) * CONFIG.dt);
      c.heatR = clamp01(c.heatR + (t2 < mid - 1 ? 0.3 : t2 > mid + 1 ? -0.3 : 0) * CONFIG.dt);
    }
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function updateProtections(state) {
    ['A', 'B'].forEach(function (id) {
      var p = state.players[id];
      var idle = state.t - p.lastInput;
      if (!p.protected && idle >= CONFIG.protectTimeout && state.t > 0) {
        p.protected = true;
        pushEvent(state, 'protect', { player: id, idle: Math.round(idle * 10) / 10 });
      }
      if (p.protected) protectStep(state, id);
    });
  }

  // 冲突检测:同一侧窗户与加热同时大幅开启 = 互相抵消,浪费能源
  function detectConflicts(state) {
    var c = state.controls;
    state._conflictTimer = state._conflictTimer || { L: 0, R: 0 };
    [['winL', 'heatL', 'L', '左侧'], ['winR', 'heatR', 'R', '右侧']].forEach(function (pair) {
      var active = c[pair[0]] > CONFIG.conflictGap && c[pair[1]] > CONFIG.conflictGap;
      if (active && state._conflictTimer[pair[2]] <= 0) {
        pushEvent(state, 'conflict', {
          side: pair[3],
          detail: pair[3] + '窗与加热带同时开启,冷热抵消',
          win: Math.round(c[pair[0]] * 100),
          heat: Math.round(c[pair[1]] * 100)
        });
        state._conflictTimer[pair[2]] = CONFIG.conflictCooldown;
      }
      if (!active) state._conflictTimer[pair[2]] = 0;
    });
    state._conflictTimer.L = Math.max(0, state._conflictTimer.L - CONFIG.dt);
    state._conflictTimer.R = Math.max(0, state._conflictTimer.R - CONFIG.dt);
  }

  function step(state) {
    if (state.status !== 'running') return;
    var dt = CONFIG.dt, c = state.controls;
    state.t += dt;
    state.countdown = Math.max(0, CONFIG.duration - state.t);
    state.outdoor = outdoorAt(state.t);
    state.weather = weatherAt(state.t);

    updateProtections(state);
    detectConflicts(state);

    // 能源:加热消耗,缓慢再生;能源耗尽则加热带失效
    var demand = (c.heatL + c.heatR) * CONFIG.heaterCost * dt;
    var supply = Math.min(demand, state.energy);
    state.energy = Math.min(CONFIG.energyMax,
      state.energy - supply + CONFIG.energyRegen * dt);
    var heatScale = demand > 0 ? supply / demand : 1;

    // 温度动力学
    var T = state.temps, next = T.slice();
    for (var i = 0; i < 3; i++) {
      var d = 0;
      // 自然散热趋向室外
      d += (state.outdoor - T[i]) * CONFIG.insulation;
      // 相邻分区热交换
      if (i > 0) d += (T[i - 1] - T[i]) * CONFIG.zoneCoupling;
      if (i < 2) d += (T[i + 1] - T[i]) * CONFIG.zoneCoupling;
      next[i] = T[i] + d * dt;
    }
    // 加热带:同侧强热,并向另一侧溢出(可能使另一侧过热)
    next[0] += c.heatL * CONFIG.heaterPower * heatScale * dt;
    next[1] += c.heatL * CONFIG.heaterPower * CONFIG.heaterSpill * heatScale * dt;
    next[2] += c.heatR * CONFIG.heaterPower * heatScale * dt;
    next[1] += c.heatR * CONFIG.heaterPower * CONFIG.heaterSpill * heatScale * dt;
    // 通风窗:同侧强散热,邻侧弱散热
    next[0] -= c.winL * CONFIG.windowCool * dt;
    next[1] -= c.winL * CONFIG.windowCool * CONFIG.windowSpill * dt;
    next[2] -= c.winR * CONFIG.windowCool * dt;
    next[1] -= c.winR * CONFIG.windowCool * CONFIG.windowSpill * dt;
    state.temps = next;

    // 作物压力:越界累计,回安全区缓慢恢复;压满则该区绝收
    for (var z = 0; z < 3; z++) {
      if (state.zoneFailed[z]) continue;
      var out = T[z] < CONFIG.safeMin || T[z] > CONFIG.safeMax;
      if (out) {
        state.stress[z] += dt;
      } else {
        state.stress[z] = Math.max(0, state.stress[z] - dt * CONFIG.stressRecover);
      }
      if (state.stress[z] >= CONFIG.tolerance[z]) {
        state.zoneFailed[z] = true;
        state.status = 'lose';
        state.failReason = CONFIG.zoneNames[z] + '作物受损(耐受' +
          CONFIG.tolerance[z] + '秒耗尽)';
        pushEvent(state, 'result', { outcome: 'lose', reason: state.failReason });
        return;
      }
    }

    if (state.t >= CONFIG.duration) {
      state.status = 'win';
      pushEvent(state, 'result', { outcome: 'win' });
    }
  }

  // 序列化快照:仪表/资源/倒计时/任务记录双方共享同一份,天然同步
  function snapshot(state) {
    return {
      t: Math.round(state.t * 10) / 10,
      countdown: Math.round(state.countdown * 10) / 10,
      energy: Math.round(state.energy * 10) / 10,
      outdoor: Math.round(state.outdoor * 10) / 10,
      weather: state.weather,
      temps: state.temps.map(function (v) { return Math.round(v * 100) / 100; }),
      stress: state.stress.map(function (v) { return Math.round(v * 100) / 100; }),
      controls: {
        winL: Math.round(state.controls.winL * 100) / 100,
        winR: Math.round(state.controls.winR * 100) / 100,
        heatL: Math.round(state.controls.heatL * 100) / 100,
        heatR: Math.round(state.controls.heatR * 100) / 100
      },
      players: {
        A: { protected: state.players.A.protected },
        B: { protected: state.players.B.protected }
      },
      status: state.status
    };
  }

  return {
    CONFIG: CONFIG,
    OWNER: OWNER,
    createState: createState,
    applyControl: applyControl,
    step: step,
    snapshot: snapshot,
    outdoorAt: outdoorAt
  };
});
