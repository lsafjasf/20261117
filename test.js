'use strict';
// 场景验证：成功一局 / 单侧失误 / 失误后恢复 / 单侧无法包办 / 保护状态 / 重开复位
const assert = require('assert');
const { CONFIG, createGame, step } = require('./game.js');

const DT = 0.05;

function run(game, seconds, inputFn) {
  for (let t = 0; t < seconds; t += DT) {
    step(game, DT, inputFn(game));
    if (game.status !== 'running') break;
  }
}

// 运行直到条件满足（或超时/对局结束）
function runUntil(game, cond, maxSeconds, inputFn) {
  for (let t = 0; t < maxSeconds && !cond(game); t += DT) {
    step(game, DT, inputFn(game));
    if (game.status !== 'running') break;
  }
}

function extinguish(game, fire) {
  runUntil(game, (g) => g.fires[fire.id - 1].hp <= 0, 40,
    coopBot(fire.angle, fire.band[0] + 3, fire.band[1] - 3));
}

// 协作机器人：P1 维持压力区间，P2 对准目标角度（模拟两人同时输入）
function coopBot(targetAim, pMin, pMax) {
  return (game) => ({
    p1: { up: game.pressure < pMin, down: game.pressure > pMax },
    p2: { left: game.aim > targetAim + 0.3, right: game.aim < targetAim - 0.3 },
  });
}

const noInput = () => ({ p1: {}, p2: {} });

function logHas(game, text) {
  return game.log.some(e => e.text.includes(text));
}

function replayEvents(game, type) {
  return game.replay.filter(e => e.kind === 'event' && e.data.type === type);
}

// 场景 1：成功一局 —— 扑灭全部 3 个火点
function testSuccess() {
  const game = createGame('coop');
  game.rng = () => 0.5;
  for (const fire of CONFIG.fires) extinguish(game, fire);
  assert.strictEqual(game.status, 'win', '应成功');
  assert.ok(game.players.p1.inputs > 0 && game.players.p2.inputs > 0, '双方都必须有输入');
  assert.ok(logHas(game, '火点 1 已扑灭') && logHas(game, '火点 3 已扑灭'), '日志记录扑灭');
  assert.ok(game.tank < CONFIG.tankMax && game.timeLeft < CONFIG.timeLimit, '共享资源被消耗');
  // 回放完整性：输入 + 快照 + 事件三类都有
  const kinds = new Set(game.replay.map(e => e.kind));
  assert.ok(kinds.has('input') && kinds.has('snap') && kinds.has('event'), '回放含输入/快照/事件');
  // 同步校验：最后一个快照 == 当前共享状态（双方仪表读同一状态）
  const snaps = game.replay.filter(e => e.kind === 'snap');
  const last = snaps[snaps.length - 1].data;
  assert.strictEqual(last.pressure, Math.round(game.pressure * 10) / 10, '压力表同步');
  assert.strictEqual(last.tank, Math.round(game.tank * 10) / 10, '水量同步');
  assert.strictEqual(last.timeLeft, Math.round(game.timeLeft * 10) / 10, '倒计时同步');
  assert.deepStrictEqual(last.hp, game.fires.map(f => Math.round(f.hp * 10) / 10), '火点同步');
  console.log('✔ 场景1 成功一局（双方输入、日志、回放、仪表同步）');
}

// 场景 2：单侧失误 —— P1 超压导致转弯打折 + 反冲
function testMistake() {
  const game = createGame('coop');
  game.rng = () => 0.5;
  run(game, 6, () => ({ p1: { up: true }, p2: {} }));
  assert.ok(game.pressure > CONFIG.recoilThreshold, '压力应超过反冲阈值');
  assert.ok(game.corners.every(c => c.kinked), '两个转弯都应打折');
  assert.ok(replayEvents(game, 'kink').length === 2, '回放记录两次打折');
  assert.ok(replayEvents(game, 'recoil').length > 0, '回放记录反冲');
  assert.strictEqual(game.spraying, false, '打折时水流中断');
  assert.ok(logHas(game, '打折'), '日志记录冲突时刻');
  console.log('✔ 场景2 单侧失误（超压 → 打折 + 反冲，冲突已记录）');
}

// 场景 3：恢复 —— 降压解除打折后继续完成任务
function testRecovery() {
  const game = createGame('coop');
  game.rng = () => 0.5;
  run(game, 6, () => ({ p1: { up: true }, p2: {} })); // 先失误
  assert.ok(game.corners.some(c => c.kinked));
  run(game, 6, () => ({ p1: { down: true }, p2: {} })); // 降压恢复
  assert.ok(game.corners.every(c => !c.kinked), '打折应全部恢复');
  assert.ok(replayEvents(game, 'unkink').length === 2, '回放记录恢复');
  for (const fire of CONFIG.fires) extinguish(game, fire);
  assert.strictEqual(game.status, 'win', '恢复后应能成功');
  console.log('✔ 场景3 失误后恢复（解除打折 → 继续 → 成功）');
}

// 场景 4：一侧操作无法代替另一侧
function testNoSolo() {
  const onlyPump = createGame('coop');
  run(onlyPump, 30, () => ({ p1: { up: true, down: false }, p2: {} }));
  assert.ok(onlyPump.fires.every(f => f.hp > 0), '只控压无法扑灭任何火点');

  const onlyAim = createGame('coop');
  run(onlyAim, 30, (g) => ({
    p1: {},
    p2: { left: g.aim > 5, right: g.aim < 5 },
  }));
  assert.ok(onlyAim.fires.every(f => f.hp > 0), '只控向无法扑灭任何火点');

  // 跨通道键位被核心丢弃：p1 传 left 不影响方向
  const cross = createGame('coop');
  const aimBefore = cross.aim;
  run(cross, 2, () => ({ p1: { left: true, right: true }, p2: {} }));
  assert.strictEqual(cross.aim, aimBefore, 'P1 无法控制方向');
  console.log('✔ 场景4 单侧无法包办（键位职责隔离）');
}

// 场景 5：单侧断开/超时进入保护状态，重新接入后解除
function testProtection() {
  const game = createGame('coop');
  run(game, 3, () => ({ p1: { up: true }, p2: { left: true } })); // 双方先活动
  run(game, CONFIG.protectTimeout + 1, noInput); // 双双超时
  assert.ok(game.players.p1.protected && game.players.p2.protected, '双方应进入保护');
  const frozen = game.pressure;
  run(game, 2, noInput);
  assert.strictEqual(game.pressure, frozen, '保护期间压力冻结（不衰减）');
  assert.ok(replayEvents(game, 'protect').length === 2, '回放记录保护事件');
  // P1 重新接入
  run(game, 1, () => ({ p1: { down: true }, p2: {} }));
  assert.ok(!game.players.p1.protected && game.players.p2.protected, 'P1 解除保护，P2 仍保护');
  assert.ok(replayEvents(game, 'reconnect').length === 1, '回放记录重新接入');
  console.log('✔ 场景5 断开/超时保护（冻结执行器，重接解除）');
}

// 场景 6：重开复位 —— 仪表、目标、计时、日志同时归零
function testRestart() {
  const game = createGame('coop');
  run(game, 5, () => ({ p1: { up: true }, p2: { right: true } }));
  const fresh = createGame(game.mode); // main.js 的 restart 即重新 createGame
  assert.strictEqual(fresh.pressure, 0);
  assert.strictEqual(fresh.aim, 20);
  assert.strictEqual(fresh.tank, CONFIG.tankMax);
  assert.strictEqual(fresh.timeLeft, CONFIG.timeLimit);
  assert.ok(fresh.fires.every(f => f.hp === 100), '火点全部复位');
  assert.strictEqual(fresh.status, 'running');
  assert.strictEqual(fresh.log.length, 1, '任务记录重置为开局条目');
  console.log('✔ 场景6 重开复位（仪表/目标/计时/记录同时归零）');
}

testSuccess();
testMistake();
testRecovery();
testNoSolo();
testProtection();
testRestart();
console.log('\n全部 6 个场景通过。');
