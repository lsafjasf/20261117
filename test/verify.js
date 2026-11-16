// 验证:同seed一致性 / 正常路线 / 搁浅+恢复 / 碰撞失败 / 重开复位 / 暂停 / 存读档 / 检查点
import { createGame, step, restart, continueFromCheckpoint, saveState, loadState, setPaused, getProgress } from '../js/sim.js';
import { generateWorld, obstaclePositions } from '../js/world.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 自动驾驶:朝目标码头航行,避障,管理压缩机
function autopilot(state) {
  const s = state.ship;
  const input = {};
  const c = state.compressor;
  const warm = state.zones.some((z) => z.temp > -2.5);
  const cold = state.zones.every((z) => z.temp < -6);
  if (!c.on && !c.overloaded && warm) input.action = 'compressor';
  else if (c.on && c.heat > 80 && c.power > 1) input.action = 'powerDown';
  else if (c.on && warm && c.power < 3 && c.heat < 55) input.action = 'powerUp';
  else if (c.on && cold) input.action = 'compressor';
  const dockIdx = Math.min(state.nextDock, 3);
  const dock = state.world.docks[dockIdx];
  const dx = dock.x - s.x, dy = dock.y - s.y;
  const dist = Math.hypot(dx, dy);
  if (dist < dock.r * 0.55) {
    input.down = true;
    if (s.speed < 1 && !dock.isDestination) {
      const task = state.world.tasks.find((t) => t.dockId === dock.id && !t.loaded);
      if (task && !state.loading) input.action = 'load';
    }
    return input;
  }
  let desired = Math.atan2(dy, dx);
  for (const { ob, x, y } of obstaclePositions(state.world, state.tick)) {
    const ox = x - s.x, oy = y - s.y;
    const od = Math.hypot(ox, oy);
    if (od < 200 + ob.r) {
      const oa = Math.atan2(oy, ox);
      if (Math.abs(norm(oa - s.heading)) < 0.7) {
        desired = oa + (norm(oa - desired) > 0 ? -1 : 1) * Math.PI / 2;
      }
    }
  }
  const diff = norm(desired - s.heading);
  if (diff < -0.06) input.left = true;
  if (diff > 0.06) input.right = true;
  if (dist > 160) input.up = true;
  else input.down = true;
  return input;
}

function runAutopilot(state, maxTicks) {
  for (let i = 0; i < maxTicks && state.status === 'playing'; i++) {
    step(state, autopilot(state));
  }
  return state;
}

console.log('1. 同 seed 世界一致性');
{
  const w1 = generateWorld(42), w2 = generateWorld(42), w3 = generateWorld(43);
  check('同 seed 地图/码头一致', JSON.stringify(w1.docks) === JSON.stringify(w2.docks));
  check('同 seed 任务一致', JSON.stringify(w1.tasks) === JSON.stringify(w2.tasks));
  check('同 seed 障碍顺序一致', JSON.stringify(w1.obstacles) === JSON.stringify(w2.obstacles));
  check('不同 seed 障碍不同', JSON.stringify(w1.obstacles) !== JSON.stringify(w3.obstacles));
}

console.log('2. 正常路线(自动驾驶完成三次装卸并送达)');
{
  let winSeed = null, st = null;
  for (const seed of [20261117, 7, 99, 1234, 555, 31415, 271828, 8888]) {
    const s = runAutopilot(createGame(seed), 60 * 60 * 20);
    if (s.status === 'won') { winSeed = seed; st = s; break; }
  }
  check(`存在可通关 seed (seed=${winSeed})`, winSeed !== null);
  if (st) {
    const p = getProgress(st);
    check('三批货全部送达且未变质', p.delivered === 3 && p.spoiled === 0);
    check('无失败记录', p.lastFailure === null);
  }
  globalThis.DEBUG_SEED = winSeed;
}

console.log('3. 搁浅 + 恢复操作');
{
  const s = createGame(42);
  const shoal = s.world.obstacles.find((o) => o.type === 'shoal');
  check('地图含浅滩', !!shoal);
  s.ship.x = shoal.baseX; s.ship.y = shoal.baseY; s.ship.speed = 3;
  step(s, {});
  check('触礁后搁浅', s.grounded === true);
  const fuelBefore = s.resources.fuel;
  step(s, { action: 'recover' });
  for (let i = 0; i < 4 * 60; i++) step(s, {});
  check('恢复操作后脱困', s.grounded === false);
  check('脱困消耗燃料', s.resources.fuel < fuelBefore);
  check('脱困后仍可继续游戏', s.status === 'playing');
}

console.log('4. 碰撞失败与失败原因记录');
{
  const s = createGame(42);
  for (let k = 0; k < 4 && s.status === 'playing'; k++) {
    const ship = s.world.obstacles.find((o) => o.type === 'ship');
    const pos = obstaclePositions(s.world, s.tick).find((p) => p.ob === ship);
    s.ship.x = pos.x; s.ship.y = pos.y; s.invuln = 0;
    step(s, {});
  }
  check('船体耗尽后失败', s.status === 'failed');
  check('记录最近失败原因(碰撞)', s.lastFailure && s.lastFailure.reason.includes('碰撞'));
}
console.log('5. 重开恢复全部目标与资源');
{
  const s = createGame(777);
  runAutopilot(s, 60 * 300);
  const fresh = createGame(777);
  check('游玩后状态已改变', JSON.stringify(s) !== JSON.stringify(fresh));
  const r = restart(s);
  check('重开后与全新局完全一致(目标/资源/位置)', JSON.stringify(r) === JSON.stringify(fresh));
  const p = getProgress(r);
  check('资源复位(燃料100/维修包2/船体100)', p.fuel === 100 && p.repairKits === 2 && p.hull === 100);
}

console.log('6. 暂停');
{
  const s = createGame(42);
  step(s, { up: true });
  setPaused(s, true);
  const t = s.tick;
  for (let i = 0; i < 60; i++) step(s, { up: true });
  check('暂停时 tick 不推进', s.tick === t);
  setPaused(s, false);
  step(s, {});
  check('恢复后继续推进', s.tick === t + 1);
}

console.log('7. 存档/读档:关键对象位置与胜负条件不变');
{
  const s = createGame(20261117);
  runAutopilot(s, 60 * 200);
  const save = saveState(s);
  const loaded = loadState(save);
  check('读档后关键状态一致', JSON.stringify(loaded.ship) === JSON.stringify(s.ship)
    && loaded.status === s.status
    && JSON.stringify(loaded.world.tasks) === JSON.stringify(s.world.tasks));
  const a = loadState(save), b = loadState(save);
  for (let i = 0; i < 60 * 120; i++) {
    const inp = autopilot(a);
    step(a, inp); step(b, inp);
  }
  check('读档后续模拟完全确定', JSON.stringify(a) === JSON.stringify(b));
  const end = runAutopilot(a, 60 * 60 * 20);
  check('读档后胜负判定仍有效', end.status === 'won' || end.status === 'failed');
}

console.log('8. 失败后从最近检查点继续');
{
  const s = createGame(20261117);
  // 玩到第一批货离港(检查点保存)即停
  for (let i = 0; i < 60 * 60 * 5 && s.nextDock < 1 && s.status === 'playing'; i++) {
    step(s, autopilot(s));
  }
  const loadedCount = s.world.tasks.filter((t) => t.loaded).length;
  check('已装载至少一批货', loadedCount >= 1);
  for (let k = 0; k < 4 && s.status === 'playing'; k++) {
    const ship = s.world.obstacles.find((o) => o.type === 'ship');
    const pos = obstaclePositions(s.world, s.tick).find((p) => p.ob === ship);
    s.ship.x = pos.x; s.ship.y = pos.y; s.invuln = 0;
    step(s, {});
  }
  check('已触发失败', s.status === 'failed');
  const failReason = s.lastFailure.reason;
  const c = continueFromCheckpoint(s);
  check('从检查点恢复为进行中', c.status === 'playing');
  check('检查点保留已装载货物', c.world.tasks.filter((t) => t.loaded).length === loadedCount);
  check('保留最近失败原因用于显示', c.lastFailure && c.lastFailure.reason === failReason);
  const end = runAutopilot(c, 60 * 60 * 20);
  check('检查点继续后仍能达成终局', end.status === 'won' || end.status === 'failed');
}
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
console.log(`调试场景: 在浏览器打开 index.html?seed=${globalThis.DEBUG_SEED}&debug`);
process.exit(failed ? 1 : 0);
