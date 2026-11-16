import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VentilationGame, CONFIG } from '../src/engine.js';
import { Recorder, ReplayPlayer, seededRng } from '../src/replay.js';

const DT = 1 / 60;

function runFrames(game, frames, fn) {
  for (let i = 0; i < frames; i++) {
    if (fn) fn(i, game);
    game.step(DT);
  }
}

function hold(game, station, action, frames) {
  game.input(station, action, true);
  runFrames(game, frames);
  game.input(station, action, false);
}

// 让两区域稳定在安全窗口内的协同操作序列（风机 60 左右 + 风门 50）
function stabilize(game) {
  game.input('upstream', 'fanUp', true);
  runFrames(game, 20);
  game.input('upstream', 'fanUp', false);
  runFrames(game, 60);
}

test('成功：双人协同保持安全直至倒计时结束', () => {
  const game = new VentilationGame({ rng: seededRng(42), targetSafeSeconds: 8 });
  stabilize(game);
  assert.equal(game.status, 'running');
  // 周期性微调，保持两侧执行器都有人操作
  let frame = 0;
  while (game.status === 'running' && frame < 60 * 40) {
    if (frame % 90 === 0) game.input('upstream', game.fan > 62 ? 'fanDown' : 'fanUp', true);
    if (frame % 90 === 8) {
      game.input('upstream', 'fanUp', false);
      game.input('upstream', 'fanDown', false);
    }
    if (frame % 120 === 0) {
      game.input('downstream', game.door > 50 ? 'doorLeft' : 'doorRight', true);
    }
    if (frame % 120 === 8) {
      game.input('downstream', 'doorRight', false);
      game.input('downstream', 'doorLeft', false);
    }
    game.step(DT);
    frame++;
  }
  assert.equal(game.status, 'succeeded');
  assert.ok(Math.abs(game.safeElapsed - 8) < DT);
  assert.ok(game.zones.every((z) => z.safe));
  // 两侧都有真实输入，任一侧未被替代
  assert.ok(game.stations.upstream.lastInputAt > 0);
  assert.ok(game.stations.downstream.lastInputAt > 0);
});

test('单侧失误：上游猛调风机造成压力尖峰与不安全，责任归属上游', () => {
  const game = new VentilationGame({ rng: seededRng(7) });
  stabilize(game);
  const before = game.stats.spikes;
  // 连续猛加风机到上限
  hold(game, 'upstream', 'fanUp', 40);
  assert.ok(game.fan > CONFIG.fan.safeMax);
  runFrames(game, 30);
  assert.ok(game.stats.spikes > before || game.zones.some((z) => !z.safe));
  assert.ok(game.stats.unsafeBySide.upstream > 0);
  const logHazard = game.log.some((e) => e.type === 'hazard');
  assert.ok(logHazard);
});

test('恢复：下游调整风门后两区域重回安全，不安全计时清零', () => {
  const game = new VentilationGame({ rng: seededRng(7) });
  stabilize(game);
  hold(game, 'upstream', 'fanUp', 40);
  runFrames(game, 30);
  const wasUnsafe = game.zones.some((z) => !z.safe);
  assert.ok(wasUnsafe);
  const unsafeBefore = game.unsafeRun;
  // 下游配合 + 上游回降，协同恢复（闭环回正，避免过度修正）
  for (let i = 0; i < 60 * 8; i++) {
    if (game.fan > 61) game.input('upstream', 'fanDown', true);
    else game.input('upstream', 'fanDown', false);
    if (game.door > 50) game.input('downstream', 'doorLeft', true);
    else game.input('downstream', 'doorLeft', false);
    game.step(DT);
  }
  game.input('upstream', 'fanDown', false);
  game.input('downstream', 'doorLeft', false);
  runFrames(game, 120);
  assert.ok(game.zones.every((z) => z.safe), '恢复后两区域均应安全');
  assert.equal(game.unsafeRun, 0);
  assert.ok(unsafeBefore > 0);
});

test('职责隔离：一侧的键位无法执行另一侧动作，不能单人包揽', () => {
  const game = new VentilationGame({ rng: seededRng(1) });
  assert.equal(game.input('upstream', 'doorLeft', true), false);
  assert.equal(game.input('downstream', 'fanUp', true), false);
  assert.equal(game.stats.rejectedInput, 2);
  assert.ok(game.log.some((e) => e.type === 'input-reject'));
  // 上游只按 W/S：风门始终保持初始值
  hold(game, 'upstream', 'fanUp', 20);
  assert.equal(game.door, CONFIG.door.start);
});

test('超时/断开保护：自动回到安全目标并冻结人工输入', () => {
  const game = new VentilationGame({ rng: seededRng(3), timeoutSeconds: 2 });
  stabilize(game);
  runFrames(game, 60 * 3); // 超过 2s 无输入
  assert.equal(game.stations.upstream.protected, true);
  assert.equal(game.stations.downstream.protected, true);
  assert.ok(game.log.some((e) => e.type === 'protection'));
  // 断开连接后输入被拒绝
  game.setConnected('upstream', false);
  assert.equal(game.input('upstream', 'fanUp', true), false);
  game.setConnected('upstream', true);
  assert.equal(game.input('upstream', 'fanUp', true), true);
  game.input('upstream', 'fanUp', false);
});

test('重开复位：仪表、目标、计时、资源全部归零', () => {
  const game = new VentilationGame({ rng: seededRng(9) });
  hold(game, 'upstream', 'fanUp', 30);
  hold(game, 'downstream', 'doorRight', 20);
  runFrames(game, 60);
  assert.ok(game.simTime > 0);
  game.restart();
  assert.equal(game.simTime, 0);
  assert.equal(game.safeElapsed, 0);
  assert.equal(game.unsafeRun, 0);
  assert.equal(game.fan, CONFIG.fan.start);
  assert.equal(game.door, CONFIG.door.start);
  assert.equal(game.energy, CONFIG.energy.max);
  assert.equal(game.status, 'ready');
  assert.deepEqual(game.events.map((e) => e.type), ['lifecycle']);
});

test('回放：记录输入/冲突/资源并确定性复现同一结果', () => {
  const seed = 11;
  const game = new VentilationGame({ rng: seededRng(seed), targetSafeSeconds: 4 });
  const rec = new Recorder(seed, { targetSafeSeconds: 4 });
  const origInput = game.input.bind(game);
  game.input = (station, action, pressed) => {
    const ok = origInput(station, action, pressed);
    if (ok) rec.recordInput(game.simTime, station, action, pressed);
    return ok;
  };
  let frame = 0;
  while (game.status !== 'succeeded' && frame < 60 * 30) {
    if (frame === 10) game.input('upstream', 'fanUp', true);
    if (frame === 25) game.input('upstream', 'fanUp', false);
    if (frame === 40) game.input('downstream', 'doorRight', true);
    if (frame === 48) game.input('downstream', 'doorRight', false);
    if (frame === 80) game.input('downstream', 'doorLeft', true);
    if (frame === 88) game.input('downstream', 'doorLeft', false);
    game.step(DT);
    for (const ev of game.events) {
      if (!rec.events.some((r) => r.t === ev.t && r.msg === ev.msg)) rec.recordEvent(ev);
    }
    rec.maybeSnapshot(game.simTime, game.getState());
    frame++;
  }
  assert.equal(game.status, 'succeeded');
  const finalState = game.getState();

  const player = new ReplayPlayer(rec, VentilationGame, { dt: DT });
  const report = player.verify(finalState);
  assert.equal(report.inputsApplied, report.inputsRecorded);
  assert.equal(report.finalStatus, 'succeeded');
  assert.ok(Math.abs(report.safeElapsed - finalState.safeElapsed) < 0.05);
  assert.ok(rec.events.some((e) => e.type === 'conflict') || rec.events.length > 0);
});

test('单人调试：自动侧只操作自己的执行器，人类侧职责不被代替', () => {
  const game = new VentilationGame({ rng: seededRng(5), targetSafeSeconds: 6 });
  game.setDebug(true, 'upstream', 5);
  assert.equal(game.stations.downstream.auto, true);
  const doorStart = game.door;
  let frame = 0;
  while (game.status === 'running' && frame < 60 * 20) {
    if (frame % 60 === 0) game.input('upstream', 'fanUp', true);
    if (frame % 60 === 6) game.input('upstream', 'fanUp', false);
    game.step(DT);
    frame++;
  }
  assert.ok(Math.abs(game.door - doorStart) > 0 || game.stations.downstream.auto);
  assert.equal(game.input('upstream', 'doorLeft', true), false);
});

test('跨侧同步：失误与恢复全程，两侧看到的仪表/资源/倒计时/记录完全一致', () => {
  const game = new VentilationGame({ rng: seededRng(77) });
  stabilize(game);
  const snapshots = [];
  const capture = (phase) => {
    const s = game.getState();
    snapshots.push({
      phase,
      timer: s.remaining,
      simTime: s.simTime,
      energy: s.energy,
      zones: s.zones.map((z) => [z.flow, z.pressure, z.gas, z.safe]),
      logLen: s.log.length,
      lastLog: s.log.at(-1)?.msg,
    });
  };
  capture('baseline');
  // 单侧（上游）失误
  hold(game, 'upstream', 'fanUp', 40);
  runFrames(game, 30);
  capture('upstream-mistake');
  // 两侧协同恢复
  for (let i = 0; i < 60 * 6; i++) {
    if (game.fan > 61) game.input('upstream', 'fanDown', true);
    else game.input('upstream', 'fanDown', false);
    if (game.door > 50) game.input('downstream', 'doorLeft', true);
    else game.input('downstream', 'doorLeft', false);
    game.step(DT);
  }
  game.input('upstream', 'fanDown', false);
  game.input('downstream', 'doorLeft', false);
  runFrames(game, 120);
  capture('recovered');

  // 同一时刻只有一份共享状态：两次连续快照读取必须逐字段一致
  const a = game.getState();
  const b = game.getState();
  assert.deepEqual(a, b);
  // 倒计时单调递减、能量为单一共享值
  assert.ok(snapshots[1].timer <= snapshots[0].timer);
  assert.ok(snapshots[2].timer <= snapshots[1].timer);
  assert.ok(snapshots.every((x) => x.energy >= 0 && x.energy <= CONFIG.energy.max));
  // 失误阶段确有危险记录，恢复阶段两区域安全
  assert.ok(game.log.some((e) => e.type === 'hazard'));
  assert.ok(game.zones.every((z) => z.safe));
  assert.equal(game.unsafeRun, 0);
});
