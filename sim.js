// 双人风筝航拍协作 —— 确定性仿真核心（浏览器与 Node 共用）
// 玩家A「线手」：收/放线，控制风筝高度与位置，维持线的张力
// 玩家B「云台手」：转动云台取景，按快门拍摄三个测点
(function (global) {
  'use strict';

  var DT = 1 / 60;

  var CONST = {
    timeLimit: 240,        // 共享倒计时（秒）
    lineMin: 20,           // 线长下限（米）
    lineMax: 120,          // 线长上限（米）
    lineStart: 45,
    reelSpeed: 8,          // 收放线速度（米/秒）
    shots: 12,             // 云台手剩余快门数（共享资源）
    windBase: 5,
    windAmp: 3,
    windMax: 10,
    gimbalRate: 1.1,       // 云台角速度上限（弧度/秒）
    panLimit: 1.484,       // 水平转动范围 ±85 度
    tiltMin: 0.09,
    tiltMax: 1.48,
    aimTol: 0.06,          // 合格取景的角误差容限（弧度）
    blurThreshold: 0.35,   // 超过则照片模糊不合格
    blurDecay: 1.4,        // 静止时模糊衰减速度
    slackWarn: 0.25,       // 张力过低警告
    slackCrit: 0.15,       // 张力过低临界（持续则失速）
    strainWarn: 0.9,       // 张力过高警告
    strainCrit: 1.05,      // 张力过高临界（持续则断线）
    critTime: 2.5,         // 临界状态容忍时间（秒）
    protectAfter: 12,      // 单侧无输入超时进入保护（秒）
    reelinTarget: 25,      // 安全收线目标线长
    reelJitter: 0.35       // 收放线对云台的抖动贡献（冲突源）
  };

  // 三个测点：x 为地形水平位置，y 为纵深，alt 为要求的风筝高度带
  var POINTS = [
    { id: 0, name: '测点甲', x: 180, y: 50,  alt: [50, 68] },
    { id: 1, name: '测点乙', x: 330, y: 110, alt: [72, 88] },
    { id: 2, name: '测点丙', x: 480, y: 60,  alt: [28, 45] }
  ];

  // 键位映射：两侧键位必须互不相交，系统键独立
  var KEYMAP = {
    line:   { reelIn: 'KeyA', reelOut: 'KeyD' },
    gimbal: { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', shoot: 'Space' },
    system: { pause: 'KeyP', restart: 'KeyR', debug: 'KeyT', replay: 'KeyB', step: 'KeyN' }
  };

  // 确定性阵风：纯函数，仅依赖时间与种子，保证回放可复现
  function windAt(t, seed) {
    var p1 = (seed % 97) / 97 * Math.PI * 2;
    var p2 = (seed % 53) / 53 * Math.PI * 2;
    var g = 0.6 * Math.sin(0.13 * t + p1) + 0.4 * Math.sin(0.41 * t + p2);
    var w = CONST.windBase + CONST.windAmp * g;
    return Math.max(1.5, Math.min(CONST.windMax, w));
  }

  function createState(seed) {
    var points = POINTS.map(function (p) {
      return { id: p.id, name: p.name, x: p.x, y: p.y, alt: [p.alt[0], p.alt[1]], photographed: false };
    });
    return {
      seed: seed >>> 0,
      t: 0,
      status: 'running',        // running | won | lost
      phase: 'survey',          // survey | reelin
      failReason: null,
      timeLeft: CONST.timeLimit,
      line: { L: CONST.lineStart, tension: 0.5, slackT: 0, strainT: 0 },
      kite: { x: 150, alt: 30 },
      gimbal: { pan: 0, tilt: 0.6, blur: 0, omega: 0 },
      shotsLeft: CONST.shots,
      points: points,
      photos: [],               // 每次快门的结果记录
      log: [],                  // 共享任务记录（双方面板同源）
      events: [],               // 回放事件流：输入变化/冲突/照片/保护/警告
      roles: {
        line:   { lastActivity: 0, disconnected: false, protected: false },
        gimbal: { lastActivity: 0, disconnected: false, protected: false }
      },
      windNow: CONST.windBase,
      windNorm: 0.5,
      conflicts: 0,
      _conflictActive: false,
      _warnSlack: false,
      _warnStrain: false,
      _lastInput: null
    };
  }

  function addLog(state, msg, side) {
    state.log.push({ t: Math.round(state.t * 10) / 10, msg: msg, side: side || 'sys' });
  }

  function addEvent(state, type, data) {
    var e = { t: Math.round(state.t * 1000) / 1000, type: type };
    if (data) { for (var k in data) { e[k] = data[k]; } }
    state.events.push(e);
  }

  // 云台对准某测点所需的角度
  function aimAngles(state, point) {
    var dx = point.x - state.kite.x;
    var dist = Math.sqrt(dx * dx + point.y * point.y);
    return {
      pan: Math.atan2(dx, point.y),
      tilt: Math.atan2(state.kite.alt, dist)
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 记录单侧输入活动（用于超时保护判定）
  function noteActivity(state, role) {
    if (state.roles[role]) { state.roles[role].lastActivity = state.t; }
  }

  // 手动模拟单侧断开 / 恢复
  function setDisconnected(state, role, flag) {
    var r = state.roles[role];
    if (!r || r.disconnected === flag) { return; }
    r.disconnected = flag;
    if (flag) {
      addLog(state, (role === 'line' ? '线手' : '云台手') + '连接断开，进入保护状态', 'sys');
      addEvent(state, 'protect', { role: role, on: true, cause: 'disconnect' });
    } else {
      r.lastActivity = state.t;
      addLog(state, (role === 'line' ? '线手' : '云台手') + '已重连', 'sys');
      addEvent(state, 'protect', { role: role, on: false, cause: 'reconnect' });
    }
  }

  function updateProtection(state) {
    ['line', 'gimbal'].forEach(function (role) {
      var r = state.roles[role];
      var was = r.protected;
      var timeout = (state.t - r.lastActivity) > CONST.protectAfter;
      r.protected = r.disconnected || timeout;
      if (r.protected && !was) {
        addLog(state, (role === 'line' ? '线手' : '云台手') + '超时无输入，自动保护接管', 'sys');
        addEvent(state, 'protect', { role: role, on: true, cause: r.disconnected ? 'disconnect' : 'timeout' });
      } else if (!r.protected && was) {
        addLog(state, (role === 'line' ? '线手' : '云台手') + '恢复操作，解除保护', 'sys');
        addEvent(state, 'protect', { role: role, on: false, cause: 'active' });
      }
    });
  }

  // 线手物理：收放线 -> 线长、张力、风筝位置
  function stepLine(state, reel, dt) {
    var ln = state.line;
    var wn = state.windNorm;
    if (state.roles.line.protected) {
      reel = 0; // 保护状态：自动保持，禁止收放
    }
    ln.L = clamp(ln.L - reel * CONST.reelSpeed * dt, CONST.lineMin, CONST.lineMax);
    var base = wn * (ln.L / CONST.lineMax) * 1.2;
    var target = base + (reel > 0 ? 0.35 : (reel < 0 ? -0.45 : 0));
    if (state.roles.line.protected) {
      target = 0.55; // 保护接管时自动把张力维持到安全区
    }
    ln.tension += (clamp(target, 0, 1.3) - ln.tension) * Math.min(1, 2.5 * dt);
    // 风筝高度与水平位置
    var altTarget = ln.L * (0.55 + 0.45 * wn);
    state.kite.alt += (altTarget - state.kite.alt) * Math.min(1, 1.2 * dt);
    state.kite.x = 150 + wn * ln.L * 1.2;
    // 临界计时
    if (ln.tension < CONST.slackCrit) { ln.slackT += dt; } else { ln.slackT = Math.max(0, ln.slackT - dt * 2); }
    if (ln.tension > CONST.strainCrit) { ln.strainT += dt; } else { ln.strainT = Math.max(0, ln.strainT - dt * 2); }
    // 警告边沿触发
    var slackNow = ln.tension < CONST.slackWarn;
    var strainNow = ln.tension > CONST.strainWarn;
    if (slackNow && !state._warnSlack) {
      addLog(state, '线太松！风筝即将失控', 'line');
      addEvent(state, 'warn', { kind: 'slack', on: true });
    }
    if (!slackNow && state._warnSlack) {
      addLog(state, '张力恢复，风筝重新受控', 'line');
      addEvent(state, 'warn', { kind: 'slack', on: false });
      addEvent(state, 'recover', { role: 'line', kind: 'slack' });
    }
    if (strainNow && !state._warnStrain) {
      addLog(state, '张力过大！风筝线可能崩断', 'line');
      addEvent(state, 'warn', { kind: 'strain', on: true });
    }
    if (!strainNow && state._warnStrain) {
      addLog(state, '张力回落到安全范围', 'line');
      addEvent(state, 'warn', { kind: 'strain', on: false });
      addEvent(state, 'recover', { role: 'line', kind: 'strain' });
    }
    state._warnSlack = slackNow;
    state._warnStrain = strainNow;
    if (ln.slackT > CONST.critTime) { fail(state, 'stall'); }
    if (ln.strainT > CONST.critTime) { fail(state, 'snap'); }
  }

  // 云台物理：转动 -> 模糊；收放线造成抖动（冲突）
  function stepGimbal(state, input, dt, reel) {
    var g = state.gimbal;
    var aimX = input.aimX || 0;
    var aimY = input.aimY || 0;
    if (state.roles.gimbal.protected) {
      aimX = 0; aimY = 0; // 保护状态：云台自动锁定
    }
    g.pan = clamp(g.pan + aimX * CONST.gimbalRate * dt, -CONST.panLimit, CONST.panLimit);
    g.tilt = clamp(g.tilt + aimY * CONST.gimbalRate * dt, CONST.tiltMin, CONST.tiltMax);
    g.omega = CONST.gimbalRate * Math.min(1, Math.sqrt(aimX * aimX + aimY * aimY));
    var gust = 0.06 * (0.5 + 0.5 * Math.sin(0.9 * state.t + state.seed));
    var jitter = gust + CONST.reelJitter * Math.abs(reel);
    var blurTarget = clamp((g.omega / CONST.gimbalRate) * 0.9 + jitter, 0, 1);
    if (blurTarget > g.blur) {
      g.blur += (blurTarget - g.blur) * Math.min(1, 6 * dt);
    } else {
      g.blur = Math.max(blurTarget, g.blur - CONST.blurDecay * dt);
    }
    // 冲突时刻：线手收放线与云台手操作同时进行
    var gimbalBusy = (Math.abs(aimX) + Math.abs(aimY)) > 0 || g.blur > 0.25;
    var conflict = reel !== 0 && gimbalBusy && !state.roles.line.protected && !state.roles.gimbal.protected;
    if (conflict && !state._conflictActive) {
      state.conflicts += 1;
      addLog(state, '配合冲突：收放线与云台取景同时进行，画面抖动加剧', 'sys');
      addEvent(state, 'conflict', { reel: reel, blur: Math.round(g.blur * 100) / 100 });
    }
    state._conflictActive = conflict;
  }

  // 拍照判定：需角度对准、风筝高度在测点要求带内、模糊低于阈值
  function resolveShot(state) {
    if (state.roles.gimbal.protected) {
      addLog(state, '云台保护中，快门无效', 'gimbal');
      return;
    }
    if (state.shotsLeft <= 0) { return; }
    state.shotsLeft -= 1;
    var best = null;
    var bestErr = Infinity;
    state.points.forEach(function (p) {
      if (p.photographed) { return; }
      var ang = aimAngles(state, p);
      var err = Math.hypot(ang.pan - state.gimbal.pan, ang.tilt - state.gimbal.tilt);
      if (err < bestErr) { bestErr = err; best = p; }
    });
    var rec = { t: Math.round(state.t * 10) / 10, ok: false, reason: 'aim', point: best ? best.name : null };
    if (!best) {
      rec.reason = 'no-target';
    } else if (state.gimbal.blur >= CONST.blurThreshold) {
      rec.reason = 'blur';
    } else if (state.kite.alt < best.alt[0] || state.kite.alt > best.alt[1]) {
      rec.reason = 'altitude';
    } else if (bestErr >= CONST.aimTol) {
      rec.reason = 'aim';
    } else {
      rec.ok = true;
      best.photographed = true;
    }
    state.photos.push(rec);
    if (rec.ok) {
      addLog(state, '照片合格：' + best.name + ' 已记录（剩余快门 ' + state.shotsLeft + '）', 'gimbal');
      addEvent(state, 'photo', { ok: true, point: best.name });
    } else {
      var reasons = { blur: '取景模糊', altitude: '风筝高度不在测点要求带内', aim: '未对准测点', 'no-target': '没有待拍测点' };
      addLog(state, '照片不合格：' + reasons[rec.reason] + '（剩余快门 ' + state.shotsLeft + '）', 'gimbal');
      addEvent(state, 'photo', { ok: false, reason: rec.reason, point: rec.point });
    }
    var remaining = state.points.some(function (p) { return !p.photographed; });
    if (!remaining) {
      state.phase = 'reelin';
      addLog(state, '三个测点全部拍齐！开始安全收线（线长降至 ' + CONST.reelinTarget + ' 米）', 'sys');
      addEvent(state, 'phase', { phase: 'reelin' });
    } else if (state.shotsLeft <= 0) {
      fail(state, 'shots');
    }
  }

  // 主步进：input = { reel:-1|0|1, aimX, aimY, shoot }
  function step(state, input, dt) {
    if (state.status !== 'running') { return; }
    dt = dt || DT;
    input = input || {};
    updateProtection(state);
    var reel = input.reel || 0;
    state.windNow = windAt(state.t, state.seed);
    state.windNorm = state.windNow / CONST.windMax;
    stepLine(state, reel, dt);
    stepGimbal(state, input, dt, state.roles.line.protected ? 0 : reel);
    if (input.shoot) { resolveShot(state); }
    // 输入变化写入回放事件流
    var sig = reel + ',' + (input.aimX || 0) + ',' + (input.aimY || 0) + ',' + (input.shoot ? 1 : 0);
    if (sig !== state._lastInput) {
      addEvent(state, 'input', { reel: reel, aimX: input.aimX || 0, aimY: input.aimY || 0, shoot: !!input.shoot });
      state._lastInput = sig;
    }
    state.t += dt;
    state.timeLeft = Math.max(0, CONST.timeLimit - state.t);
    if (state.timeLeft <= 0) { fail(state, 'timeout'); }
    if (state.phase === 'reelin' && state.line.L <= CONST.reelinTarget && state.status === 'running') {
      state.status = 'won';
      addLog(state, '安全收线完成，任务成功！', 'sys');
      addEvent(state, 'win', {});
    }
  }

  // 重开：仪表、目标、计时全部同时复位
  function restart(state) {
    var seed = (state && state.seed != null) ? (state.seed + 1) >>> 0 : 1;
    return createState(seed);
  }

  // 双方面板共用的仪表快照（保证两侧读数同源同步）
  function hudSnapshot(state) {
    return {
      countdown: Math.ceil(state.timeLeft),
      phase: state.phase,
      status: state.status,
      shotsLeft: state.shotsLeft,
      lineL: Math.round(state.line.L * 10) / 10,
      tension: Math.round(state.line.tension * 100) / 100,
      blur: Math.round(state.gimbal.blur * 100) / 100,
      wind: Math.round(state.windNow * 10) / 10,
      logCount: state.log.length,
      pointsDone: state.points.filter(function (p) { return p.photographed; }).length,
      lineProtected: state.roles.line.protected,
      gimbalProtected: state.roles.gimbal.protected,
      conflicts: state.conflicts
    };
  }

  function fail(state, reason) {
    if (state.status !== 'running') { return; }
    state.status = 'lost';
    state.failReason = reason;
    var msgs = {
      timeout: '倒计时结束，任务失败',
      stall: '风筝失速坠落，任务失败',
      snap: '风筝线崩断，任务失败',
      shots: '快门耗尽且测点未拍齐，任务失败'
    };
    addLog(state, msgs[reason] || reason, 'sys');
    addEvent(state, 'fail', { reason: reason });
  }
  global.KiteSim = {
    DT: DT, CONST: CONST, POINTS: POINTS, KEYMAP: KEYMAP,
    windAt: windAt, createState: createState,
    addLog: addLog, addEvent: addEvent, aimAngles: aimAngles,
    noteActivity: noteActivity, setDisconnected: setDisconnected,
    step: step, restart: restart, hudSnapshot: hudSnapshot
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.KiteSim; }
})(typeof window !== 'undefined' ? window : globalThis);
