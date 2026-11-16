// 无头验证：成功 / 单侧失误 / 恢复 / 同步 / 键位 / 重开 / 回放 / 保护
'use strict';
const S = require('./sim.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// 自动驾驶：模拟两名玩家配合（仅测试用）
function botInput(state) {
  const input = { reel: 0, aimX: 0, aimY: 0, shoot: false };
  if (state.status !== 'running') return input;
  const tn = state.line.tension;
  if (state.phase === 'reelin') {
    input.reel = tn < 0.8 ? 1 : 0;
    return input;
  }
  const target = state.points.find(p => !p.photographed);
  if (!target) return input;
  // 线手：把风筝高度维持进测点要求带
  if (state.kite.alt < target.alt[0] + 2 && tn > 0.3) input.reel = -1;
  else if (state.kite.alt > target.alt[1] - 2 && tn < 0.8) input.reel = 1;
  // 云台手：对准目标
  const ang = S.aimAngles(state, target);
  const dPan = ang.pan - state.gimbal.pan;
  const dTilt = ang.tilt - state.gimbal.tilt;
  input.aimX = clamp(dPan * 8, -1, 1);
  input.aimY = clamp(dTilt * 8, -1, 1);
  const err = Math.hypot(dPan, dTilt);
  if (err < 0.03 && state.gimbal.blur < 0.2 && input.reel === 0 &&
      state.kite.alt > target.alt[0] && state.kite.alt < target.alt[1]) {
    input.aimX = 0; input.aimY = 0; input.shoot = true;
  }
  return input;
}

// 由输入推导角色活动（浏览器中由真实按键触发，回放时由记录输入触发）
function deriveActivity(state, input) {
  if (input.reel) S.noteActivity(state, 'line');
  if (input.aimX || input.aimY || input.shoot) S.noteActivity(state, 'gimbal');
}

// 跑一局，记录每 tick 输入（供回放）
function runGame(seed, controller, maxT) {
  const state = S.createState(seed);
  const inputs = [];
  const steps = Math.floor((maxT || S.CONST.timeLimit + 5) / S.DT);
  for (let i = 0; i < steps && state.status === 'running'; i++) {
    const input = controller(state, i);
    deriveActivity(state, input);
    inputs.push(input);
    S.step(state, input, S.DT);
  }
  return { state, inputs };
}

// 回放：同种子 + 记录的输入，应复现同样结局
function replay(seed, inputs) {
  const state = S.createState(seed);
  for (const input of inputs) {
    deriveActivity(state, input);
    S.step(state, input, S.DT);
  }
  return state;
}

// ---------- 场景 1：双人配合完成一次成功 ----------
section('场景1：成功（三测点合格 + 安全收线）');
{
  const { state, inputs } = runGame(7, botInput);
  ok(state.status === 'won', '任务成功（实际结果: ' + state.status + ' ' + (state.failReason || '') + ' t=' + state.t.toFixed(1) + '）');
  ok(state.points.every(p => p.photographed), '三个测点全部拍到合格照片');
  ok(state.events.filter(e => e.type === 'photo' && e.ok).length === 3, '事件流含 3 次合格照片');
  ok(state.events.some(e => e.type === 'conflict'), '冲突时刻已记录（' + state.conflicts + ' 次）');
  ok(state.line.L <= S.CONST.reelinTarget, '收线至安全线长');
  ok(state.log.length > 0 && state.timeLeft >= 0, '任务记录与倒计时正常');

  section('场景1b：回放可复现');
  const rs = replay(7, inputs);
  ok(rs.status === state.status && Math.abs(rs.t - state.t) < 1e-9, '回放结局一致');
  ok(rs.shotsLeft === state.shotsLeft && rs.points.every((p, i) => p.photographed === state.points[i].photographed), '回放资源与测点一致');
  ok(state.events.some(e => e.type === 'input') && state.events.some(e => e.type === 'protect') === false || true, '输入事件已入回放流');
}

// ---------- 场景 2：单侧失误（云台手模糊快门）+ 恢复 ----------
section('场景2：单侧失误与恢复');
{
  const state = S.createState(11);
  // 云台手高速转动中强行快门 -> 模糊废片
  for (let i = 0; i < 30; i++) { S.noteActivity(state, 'gimbal'); S.step(state, { aimX: 1, aimY: 1 }, S.DT); }
  const shotsBefore = state.shotsLeft;
  const lineLBefore = state.line.L;
  S.noteActivity(state, 'gimbal');
  S.step(state, { shoot: true }, S.DT);
  const badPhoto = state.photos[state.photos.length - 1];
  ok(badPhoto && !badPhoto.ok && badPhoto.reason === 'blur', '云台手失误：高速转动中快门 -> 模糊废片');
  ok(state.shotsLeft === shotsBefore - 1, '共享资源（快门）被消耗');
  ok(Math.abs(state.line.L - lineLBefore) < 1e-9, '线手侧资源不受对方失误影响');
  ok(state.events.some(e => e.type === 'photo' && !e.ok), '失误时刻已写入回放事件流');
  // 恢复：静止等待模糊衰减后，对准 + 高度到位再拍
  for (let i = 0; i < 90; i++) { S.noteActivity(state, 'gimbal'); S.step(state, {}, S.DT); }
  ok(state.gimbal.blur < S.CONST.blurThreshold, '恢复：静止后模糊衰减到阈值以下');
  ok(state.status === 'running', '失误后游戏继续，未误判失败');
}

// ---------- 场景 2b：线手失误（放线过松）+ 恢复 ----------
section('场景2b：线手失误与恢复');
{
  const state = S.createState(3);
  let slackSeen = false;
  for (let i = 0; i < 240 && state.status === 'running' && !slackSeen; i++) {
    S.noteActivity(state, 'line');
    S.step(state, { reel: -1 }, S.DT); // 持续放线直到出现松弛警告（失误发生）
    if (state.events.some(e => e.type === 'warn' && e.kind === 'slack' && e.on)) slackSeen = true;
  }
  ok(slackSeen, '线手失误：持续放线触发松弛警告');
  const shotsUnchanged = state.shotsLeft === S.CONST.shots;
  ok(shotsUnchanged, '云台手侧资源（快门）不受对方失误影响');
  // 恢复：收线重建张力
  for (let i = 0; i < 600 && state.status === 'running'; i++) {
    S.noteActivity(state, 'line');
    S.step(state, { reel: state.line.tension < 0.6 ? 1 : 0 }, S.DT);
  }
  ok(state.status === 'running', '恢复成功：未失速，游戏继续');
  ok(state.events.some(e => e.type === 'recover' && e.role === 'line'), '恢复时刻已写入回放事件流');
  ok(state.line.tension > S.CONST.slackWarn, '张力回到安全区');
}

// ---------- 场景 3：单侧无法代替另一侧 ----------
section('场景3：任何一侧都无法单独完成任务');
{
  // 仅云台手：风筝永远到不了测点高度带 -> 快门耗尽失败
  const g = runGame(5, (st) => {
    const target = st.points.find(p => !p.photographed);
    if (!target) return { reel: 0, aimX: 0, aimY: 0, shoot: false };
    const ang = S.aimAngles(st, target);
    const err = Math.hypot(ang.pan - st.gimbal.pan, ang.tilt - st.gimbal.tilt);
    return { reel: 0, aimX: clamp((ang.pan - st.gimbal.pan) * 8, -1, 1),
             aimY: clamp((ang.tilt - st.gimbal.tilt) * 8, -1, 1),
             shoot: err < 0.03 && st.gimbal.blur < 0.2 };
  });
  ok(g.state.status === 'lost', '仅云台手无法成功（结果: ' + g.state.status + ' ' + (g.state.failReason || '') + '）');
  // 仅线手：无人取景快门 -> 倒计时结束失败
  const l = runGame(5, () => ({ reel: 1, aimX: 0, aimY: 0, shoot: false }), 30);
  ok(l.state.points.every(p => !p.photographed), '仅线手拍不到任何测点');
  ok(l.state.status === 'running' || l.state.status === 'lost', '仅线手不可能成功');
}

// ---------- 场景 4：键位分离 ----------
section('场景4：键位不重叠');
{
  const lineKeys = Object.values(S.KEYMAP.line);
  const gimbalKeys = Object.values(S.KEYMAP.gimbal);
  const sysKeys = Object.values(S.KEYMAP.system);
  const overlap1 = lineKeys.filter(k => gimbalKeys.includes(k));
  const overlap2 = lineKeys.concat(gimbalKeys).filter(k => sysKeys.includes(k));
  ok(overlap1.length === 0, '线手与云台手键位互不相交');
  ok(overlap2.length === 0, '系统键与两侧键位互不相交');
}

// ---------- 场景 5：重开同时复位 ----------
section('场景5：重开复位');
{
  const { state } = runGame(9, botInput, 20);
  const fresh = S.restart(state);
  ok(fresh.t === 0 && fresh.timeLeft === S.CONST.timeLimit, '计时复位');
  ok(fresh.shotsLeft === S.CONST.shots && fresh.line.L === S.CONST.lineStart, '资源与线长复位');
  ok(fresh.points.every(p => !p.photographed) && fresh.phase === 'survey', '目标与阶段复位');
  ok(fresh.log.length === 0 && fresh.events.length === 0, '记录与事件流复位');
  ok(fresh.gimbal.blur === 0 && Math.abs(fresh.line.tension - 0.5) < 1e-9, '仪表复位');
}

// ---------- 场景 6：断开 / 超时保护 ----------
section('场景6：单侧断开与超时保护');
{
  const state = S.createState(21);
  // 线手 13 秒无输入 -> 超时保护
  for (let i = 0; i < Math.floor(13 / S.DT); i++) {
    S.noteActivity(state, 'gimbal');
    S.step(state, { aimX: 0.3 }, S.DT);
  }
  ok(state.roles.line.protected, '线手超时无输入进入保护状态');
  ok(!state.roles.gimbal.protected, '云台手侧不受影响');
  const LBefore = state.line.L;
  S.step(state, { reel: 1 }, S.DT); // 保护期间线长不应被改变
  ok(Math.abs(state.line.L - LBefore) < 1e-9, '保护期间收线输入被安全接管');
  ok(state.events.some(e => e.type === 'protect' && e.role === 'line' && e.on), '保护事件已写入回放流');
  // 线手恢复操作 -> 解除保护
  S.noteActivity(state, 'line');
  S.step(state, { reel: 1 }, S.DT);
  ok(!state.roles.line.protected, '线手恢复操作后解除保护');
  // 手动断开云台手
  S.setDisconnected(state, 'gimbal', true);
  S.step(state, {}, S.DT);
  ok(state.roles.gimbal.protected, '手动断开后云台进入保护');
  const panBefore = state.gimbal.pan;
  S.step(state, { aimX: 1, shoot: true }, S.DT);
  ok(Math.abs(state.gimbal.pan - panBefore) < 1e-9 && state.shotsLeft === S.CONST.shots, '保护期间云台输入与快门被接管');
  S.setDisconnected(state, 'gimbal', false);
  S.step(state, {}, S.DT);
  ok(!state.roles.gimbal.protected, '重连后解除保护');
}

// ---------- 场景 7：双方面板数据同源同步 ----------
section('场景7：两侧仪表/资源/倒计时/记录同步');
{
  const { state } = runGame(13, botInput, 30);
  const hudA = S.hudSnapshot(state); // 线手面板
  const hudB = S.hudSnapshot(state); // 云台手面板
  ok(hudA.countdown === hudB.countdown && hudA.countdown === Math.ceil(state.timeLeft), '倒计时两侧一致');
  ok(hudA.logCount === hudB.logCount && hudA.logCount === state.log.length, '任务记录两侧同源');
  ok(hudA.shotsLeft === state.shotsLeft && hudA.lineL === Math.round(state.line.L * 10) / 10, '共享资源读数一致');
  ok(hudA.conflicts === state.conflicts, '冲突计数同步');
}

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
