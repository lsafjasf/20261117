/* Node 调参/验证脚本：node scripts/tune.js
 * 验证稳定性窗口、故障触发、三圈成功与确定性。 */
const fs = require('fs');
const path = require('path');
global.window = {};
eval(fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../js/track.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../js/physics.js'), 'utf8'));

const track = window.Track.build();
const P = window.Physics, C = window.CONFIG;

function run(inputs, maxSteps = 650000) {
  const st = P.createInitial(inputs, track);
  let frames = 0;
  for (let i = 0; i < maxSteps; i++) {
    const fault = P.step(st, track, inputs.current, inputs.damping);
    frames++;
    if (fault) return { st, status: 'fault', frames };
    if (st.lap >= C.sim.lapsToWin) return { st, status: 'win', frames };
  }
  return { st, status: 'timeout', frames };
}

const base = { current: 40, damping: 2500, v0: 10, load: 80 };

console.log('== 稳定性扫描（3 圈能否完成）==');
for (const I of [20, 28, 35, 40, 45, 50, 60]) {
  const row = [];
  for (const d of [500, 1500, 2500, 4000]) {
    const r = run({ ...base, current: I, damping: d });
    row.push((r.status === 'win' ? 'OK' : r.status === 'fault'
      ? r.st.fault.key : 'T').padEnd(6));
  }
  console.log('I=' + String(I).padStart(2), row.join(' '));
}

console.log('\n== 基准工况过程量 ==');
const r = run(base);
const st = r.st;
console.log('status=', r.status, 't=', st.time.toFixed(2), 'lap=', st.lap);
console.log('gap 范围', (st.peaks.gapMin * 1000).toFixed(2), '..',
  (st.peaks.gap * 1000).toFixed(2), 'mm');
console.log('vmax=', st.peaks.speed.toFixed(2), 'Tmax=', st.peaks.temp.toFixed(1),
  'pmax=', st.peaks.pressure.toFixed(0), 'azMax=', st.peaks.accelZ.toFixed(2));
if (st.fault) console.log('fault=', st.fault);

console.log('\n== 故障触发检查 ==');
for (const [name, inp] of Object.entries({
  '低电流(触轨)': { ...base, current: 20 },
  '高电流(吸轨)': { ...base, current: 60 },
  '高电流(过热)': { ...base, current: 47, damping: 4000 },
  '大负载(触轨)': { ...base, load: 160 },
  '高初速(超压)': { ...base, v0: 20 },
  '失速': { ...base, v0: 1.5, current: 35 }
})) {
  const rr = run(inp);
  console.log(name, '->', rr.status,
    rr.st.fault ? `${rr.st.fault.name} @t=${rr.st.fault.time.toFixed(2)}s 段${rr.st.fault.segment}` : '');
}

console.log('\n== 确定性检查（两次独立运行逐步对比）==');
const a = P.createInitial(base, track), b = P.createInitial(base, track);
let diff = 0;
for (let i = 0; i < 50000; i++) {
  P.step(a, track, base.current, base.damping);
  P.step(b, track, base.current, base.damping);
  diff = Math.max(diff, Math.abs(a.gap - b.gap), Math.abs(a.s - b.s),
    Math.abs(a.temp - b.temp));
  if (a.fault || a.lap >= 3) break;
}
console.log('最大差异 =', diff.toExponential(2));
