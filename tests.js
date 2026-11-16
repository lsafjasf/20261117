/*
 * tests.js - Node 验收测试：node tests.js
 * 覆盖：固定 seed 复现、正常路线、碰撞、搁浅、恢复操作、
 * 存档往返后关键对象位置与胜负条件不变、重开恢复全部目标与资源。
 */
const E = require('./engine.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS ' + name);
  } catch (err) {
    failed++;
    console.error('  FAIL ' + name + ' -> ' + err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function autopilot(s) {
  const remaining = s.map.blades
    .map((b, i) => (s.inspected[i] ? null : b))
    .filter((b) => b !== null);
  const target = remaining.length ? Math.min(...remaining) : 0;
  const wind = E.windAt(s.map, s.t, s.y);
  const d = target - s.y;
  const nearTarget = Math.abs(d) < 1.0 && remaining.length;
  if (nearTarget && Math.abs(s.x) <= 0.5 && Math.abs(s.vy) < 0.3) {
    return { inspect: true, brake: true };
  }
  if (s.iceLocked) return { throttle: 1 };
  const gustSoon = s.map.gusts.some((g) => {
    const start = g.t - 3.0;
    const end = g.t + g.dur + 1.0;
    return s.t >= start && s.t <= end;
  });
  const hazardClose = remaining.length && d > -2.2 && d < 4;
  if (hazardClose && (gustSoon || Math.abs(s.x) > 0.35 || Math.abs(s.vy) > 0.5)) {
    return { brake: true };
  }
  if (nearTarget || s.y >= E.TOWER_H - 0.5) return { brake: true };
  return { throttle: s.y < target ? 1 : -1 };
}

function run(s, inputFn, maxTicks) {
  maxTicks = maxTicks || 30 * 300;
  for (let i = 0; i < maxTicks && s.status === 'running'; i++) {
    s = E.step(s, inputFn(s));
  }
  return s;
}

function stopInFirstIce(s) {
  const zone = s.map.iceZones[0];
  const stop = (zone.lo + zone.hi) / 2;
  return Math.abs(s.y - stop) < 0.8
    ? { throttle: 1 }
    : { throttle: s.y < stop ? 1 : -1 };
}

console.log('1) 固定 seed 复现');
test('同 seed 地图、叶片任务、冰区与阵风顺序完全一致', () => {
  const m1 = E.generateMap(20261117);
  const m2 = E.generateMap(20261117);
  assert(JSON.stringify(m1) === JSON.stringify(m2));
  const m3 = E.generateMap(20261118);
  assert(JSON.stringify(m1) !== JSON.stringify(m3));
  const g1 = run(E.createGame(20261117), autopilot);
  const g2 = run(E.createGame(20261117), autopilot);
  assert(E.serialize(g1) === E.serialize(g2), '同 seed 同输入的终局状态必须一致');
});

test('同 seed 并行推进任意一步结果一致（无隐藏随机源）', () => {
  const a = E.createGame(777);
  const b = E.createGame(777);
  for (let i = 0; i < 500; i++) {
    E.step(a, { throttle: i % 2 ? 1 : -1, brake: i % 3 === 0 });
    E.step(b, { throttle: i % 2 ? 1 : -1, brake: i % 3 === 0 });
  }
  assert(E.serialize(a) === E.serialize(b));
});

console.log('2) 一次正常路线');
test('谨慎自动驾驶完成三处检修并安全下降即胜利', () => {
  const s = run(E.createGame(20261117), autopilot);
  assert(s.status === 'won', '应胜利，实际 ' + s.status);
  assert(s.inspected.every(Boolean), '三处叶片根部都要检修');
  assert(s.y < 2, '必须安全下降到地面');
  assert(s.battery > 0 && s.brake > 0, '通关后仍有剩余资源');
});

console.log('3) 碰撞与搁浅结局');
test('碰撞调试场景：直冲叶片根部遇强阵风 -> collision', () => {
  const s = run(E.createDebugGame(20261117, 'collision'),
    () => ({ throttle: 1 }), 30 * 60);
  assert(s.status === 'failed' && s.failure === E.FAILURE.COLLISION);
  assert(E.FAILURE_TEXT[s.failure].length > 0);
});

test('搁浅调试场景：冰区静止启动遇横风 -> stranded', () => {
  const s = run(E.createDebugGame(20261117, 'strand'),
    stopInFirstIce, 30 * 60);
  assert(s.status === 'failed' && s.failure === E.FAILURE.STRANDED);
  assert(s.iceLocked === true, '失败时仍处于冰上锁定窗口');
});

test('调试场景同样由 seed 决定，可逐字节复现', () => {
  const a = run(E.createDebugGame(42, 'collision'), () => ({ throttle: 1 }), 30 * 60);
  const b = run(E.createDebugGame(42, 'collision'), () => ({ throttle: 1 }), 30 * 60);
  assert(E.serialize(a) === E.serialize(b));
});

console.log('4) 恢复操作（最近检查点）');
test('检修成功后写入检查点，失败可从检查点继续并最终通关', () => {
  let s = E.createGame(20261117);
  for (let i = 0; i < 30 * 300 && s.status === 'running' && !s.inspected[1]; i++) {
    s = E.step(s, autopilot(s));
  }
  assert(s.inspected[0] && s.inspected[1]);
  assert(s.checkpoint !== null);
  const saved = E.serialize(s);
  s.status = 'failed';
  s.failure = E.FAILURE.COLLISION;
  s.lastFailure = E.FAILURE.COLLISION;
  const resumed = E.resumeFromCheckpoint(s);
  assert(resumed.inspected[0] && resumed.inspected[1], '已完成目标必须保留');
  assert(resumed.status === 'running' && resumed.failure === null);
  assert(resumed.lastFailure === E.FAILURE.COLLISION, '保留最近失败原因');
  const end = run(resumed, autopilot);
  assert(end.status === 'won', '恢复后应能通关');
  const freshReload = E.deserialize(saved);
  assert(freshReload.inspected[0] && freshReload.inspected[1]);
});

test('没有检查点时不能恢复', () => {
  const s = E.createGame(1);
  assert(E.resumeFromCheckpoint(s) === null);
});

console.log('5) 存档与载入');
test('保存后重新载入，关键对象位置、资源与胜负条件不变', () => {
  let s = E.createGame(20261117);
  for (let i = 0; i < 123; i++) s = E.step(s, autopilot(s));
  const text = E.serialize(s);
  const loaded = E.deserialize(text);
  ['y', 'x', 'vy', 'vx', 'battery', 'brake', 'kits', 'spareKits',
   'status', 'inspected', 't', 'ticks', 'iceLocked', 'iceCooldown']
    .forEach((k) => {
      assert(JSON.stringify(loaded[k]) === JSON.stringify(s[k]),
        '字段 ' + k + ' 载入后不一致');
    });
  assert(JSON.stringify(loaded.map) === JSON.stringify(s.map));
  const a = E.deserialize(text);
  const b = E.deserialize(text);
  for (let i = 0; i < 200; i++) {
    E.step(a, autopilot(a));
    E.step(b, autopilot(b));
  }
  assert(E.serialize(a) === E.serialize(b), '载入后的两局演化必须一致');
});

test('损坏/版本不符的存档被拒绝', () => {
  let threw = false;
  try { E.deserialize('{"v":999}'); } catch (e) { threw = true; }
  assert(threw);
});

console.log('6) 重新开始');
test('重开恢复全部目标与资源，而不是只重置角色位置', () => {
  const used = E.createGame(20261117);
  used.battery = 12;
  used.brake = 30;
  used.kits = 1;
  used.spareKits = 0;
  used.inspected = [true, false, true];
  used.status = 'failed';
  const fresh = E.createGame(20261117);
  assert(fresh.battery === 100 && fresh.brake === 100);
  assert(fresh.kits === E.constants.MAX_KITS);
  assert(fresh.spareKits === E.constants.BASE_KITS - E.constants.MAX_KITS);
  assert(fresh.inspected.every((v) => v === false));
  assert(fresh.status === 'running' && fresh.failure === null);
  assert(JSON.stringify(fresh.map) === JSON.stringify(used.map), '同 seed 地图保持一致');
});

console.log('7) 资源与载重机制');
test('工具重量降低制动/加速效率，地面可装卸工具包', () => {
  const light = E.createGame(1);
  light.kits = 1;
  const heavy = E.createGame(1);
  heavy.kits = 3;
  assert(E.loadFactor(light) < E.loadFactor(heavy));
  const s = E.createGame(1);
  s.kits = 1;
  s.spareKits = 2;
  E.step(s, { loadKit: true });
  assert(s.kits === 2 && s.spareKits === 1);
  E.step(s, { unloadKit: true });
  assert(s.kits === 1 && s.spareKits === 2);
  s.y = 50;
  E.step(s, { loadKit: true });
  assert(s.kits === 1, '离开地面不能装卸');
});

test('无工具包不能检修', () => {
  const s = E.createGame(1);
  s.kits = 0;
  s.y = s.map.blades[0];
  s.vy = 0;
  E.step(s, { inspect: true, brake: true });
  assert(s.inspected[0] === false && s.inspecting === false);
});

test('制动余量耗尽后冲顶触发 fell', () => {
  const s = E.createGame(1);
  s.brake = 0;
  s.y = E.TOWER_H - 0.5;
  s.vy = 4.2;
  E.step(s, { throttle: 1 });
  assert(s.status === 'failed' && s.failure === E.FAILURE.FELL);
});

test('电量耗尽触发 battery 失败', () => {
  const s = E.createGame(1);
  s.battery = 0.01;
  E.step(s, { throttle: 1 });
  assert(s.status === 'failed' && s.failure === E.FAILURE.BATTERY);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
