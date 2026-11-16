// 集成测试：验证暂停/单步/恢复的物理一致性、回放与重置无漂移
const fs = require('fs');
const path = require('path');
global.window = {};
['config', 'track', 'physics', 'simulator'].forEach(f =>
  eval(fs.readFileSync(path.join(__dirname, '../js/' + f + '.js'), 'utf8')));

const C = window.CONFIG, track = window.Track.build();
const inputs = { current: 40, damping: 2500, v0: 10, load: 80 };
let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

// 参考：连续运行 N 个物理步
function reference(steps) {
  const st = window.Physics.createInitial(inputs, track);
  for (let i = 0; i < steps; i++) window.Physics.step(st, track, inputs.current, inputs.damping);
  return st;
}

console.log('== 暂停/单步/恢复一致性 ==');
const sim = new window.Simulator(track);
sim.reset(inputs);
sim.start();
sim.update(0.05);                 // 连续 50ms
sim.pause();
const pausedState = { time: sim.state.time, s: sim.state.s, gap: sim.state.gap };
for (let i = 0; i < 10; i++) sim.singleStep(); // 单步 10 帧 = 200ms
const afterSteps = sim.state.time;
sim.start();
sim.update(0.1);                  // 恢复后连续 100ms

// 参考轨迹：同样的总物理时间
const totalSteps = Math.round(sim.state.time / C.sim.dt);
const ref = reference(totalSteps);
assert(Math.abs(sim.state.gap - ref.gap) < 1e-12, '间隙与连续参考一致');
assert(Math.abs(sim.state.s - ref.s) < 1e-9, '弧长与连续参考一致');
assert(Math.abs(sim.state.temp - ref.temp) < 1e-9, '温度与连续参考一致');
assert(Math.abs(afterSteps - (pausedState.time + 10 * C.sim.replayEvery)) < 1e-9,
  '单步推进固定 20ms/次');

console.log('== 回放录制 ==');
assert(sim.replay.length >= 2, '已录制回放帧 (' + sim.replay.length + ' 帧)');
const tSorted = sim.replay.every((f, i, arr) => i === 0 || f.time >= arr[i - 1].time);
assert(tSorted, '回放时间单调不减');
const lastFrame = sim.replay[sim.replay.length - 1];
assert(Math.abs(lastFrame.gap - sim.state.gap) < 1e-12, '末帧与当前状态一致');

console.log('== 重置无漂移 ==');
const s1 = new window.Simulator(track); s1.reset(inputs);
const s2 = new window.Simulator(track); s2.reset(inputs);
assert(s1.state.gap === s2.state.gap && s1.state.s === s2.state.s &&
  s1.state.v === s2.state.v && s1.state.temp === s2.state.temp, '重复重置初始条件完全相同');
assert(s1.replay.length === s2.replay.length, '重置后回放缓存清空');

console.log('== 故障即停（停止不安全计算）==');
const bad = new window.Simulator(track);
bad.reset({ current: 60, damping: 2500, v0: 10, load: 80 });
bad.start();
let guard = 0;
while (bad.mode === 'running' && guard++ < 500000) bad.update(0.02);
assert(bad.mode === 'fault', '高电流触发故障并停机');
const frozenTime = bad.state.time;
bad.update(0.5);
assert(bad.state.time === frozenTime, '故障后不再推进物理计算');
assert(bad.state.fault && bad.state.fault.segment >= 1, '记录故障弧段');

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
