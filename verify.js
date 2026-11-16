// 无头验证：稳态 / 临界阈值 / 处置失败 / seed 复现 / 恢复后残留检查
const { createSim, THRESH, RECOVERY_WATCH } = require('./sim.js');

const DT = 0.1;
let passed = 0, failed = 0;

function check(name, cond, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

function run(sim, seconds, each) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) { sim.step(DT); if (each) each(sim.state.t); }
}

const SEED = 20261117;

// ---------- 1. 稳态：前 60s 无告警、指标在合理区间 ----------
{
  const sim = createSim(SEED);
  run(sim, 60);
  const s = sim.snapshot();
  // 稳态针对环境类告警(寒潮/暴雪)；设备类告警取决于玩家操作，不在此列
  const noAlarm = s.alarms
    .filter(a => a.key === 'cold' || a.key === 'blizzard')
    .every(a => a.triggerT === null);
  const envOk = s.env.temp > -25 && s.env.temp < 5 && s.env.snowWater >= 0 && s.env.pollution >= 5;
  check('稳态：60s 内无告警且环境指标平稳', noAlarm && envOk,
    `temp=${s.env.temp.toFixed(1)}℃ snowWater=${s.env.snowWater.toFixed(1)}mm`);
}

// ---------- 2. 临界事件：低电量阈值穿越，记录触发时刻 ----------
{
  const sim = createSim(SEED);
  sim.setCameraOn(0, true);
  let crossT = null, crossVal = null;
  run(sim, 600, () => {
    const o = sim.state.obs;
    if (crossT === null && sim.state.cams[0].on && o.battery[0] < THRESH.batteryLow) {
      crossT = sim.state.t; crossVal = o.battery[0];
    }
  });
  const s = sim.snapshot();
  const alarm = s.alarms.find(a => a.key === 'bat0');
  check('临界：低电量阈值穿越被观测到', crossT !== null, crossT && `t=${crossT.toFixed(1)}s obs=${crossVal}%`);
  check('临界：告警记录含触发时刻', alarm && alarm.triggerT !== null,
    alarm && `triggerT=${alarm.triggerT.toFixed(1)}s`);
}

// ---------- 3. 处置失败：暴雪中擦拭镜头 / 低温换电池 ----------
{
  const sim = createSim(SEED);
  // 找到暴雪时刻
  let failRec = null;
  run(sim, 900, () => {
    if (!failRec && sim.state.env.snowfall > THRESH.wipeFailSnow) {
      failRec = sim.intervene(0, 'wipe');
    }
  });
  check('处置失败：暴雪中擦拭被拒绝并记录', failRec && failRec.ok === false,
    failRec && failRec.reason);
  const s = sim.snapshot();
  const failLog = s.log.find(l => l.kind === 'fail');
  check('处置失败：日志含触发时刻', !!failLog && typeof failLog.t === 'number',
    failLog && `t=${failLog.t.toFixed(1)}s "${failLog.msg}"`);
}

// ---------- 4. seed 复现：天气序列与目标分布一致 ----------
{
  function trace(seed) {
    const sim = createSim(seed);
    const w = [], pos = [];
    let nextSample = 10;
    run(sim, 300, () => {
      const t = sim.state.t;
      if (t >= nextSample) {
        nextSample += 10;
        const e = sim.state.env;
        w.push([+e.temp.toFixed(4), +e.wind.toFixed(4), +e.snowfall.toFixed(4)]);
      }
    });
    for (const a of sim.state.animals) pos.push([+a.x.toFixed(4), +a.y.toFixed(4)]);
    return { w, pos };
  }
  const a = trace(SEED), b = trace(SEED), c = trace(999);
  check('复现：同 seed 天气序列一致', JSON.stringify(a.w) === JSON.stringify(b.w),
    `采样${a.w.length}点`);
  check('复现：同 seed 目标位置一致', JSON.stringify(a.pos) === JSON.stringify(b.pos));
  check('复现：异 seed 天气序列不同', JSON.stringify(a.w) !== JSON.stringify(c.w));
}

// ---------- 5. 恢复后固定时长运行，确认无隐藏残留 ----------
{
  const sim = createSim(SEED);
  sim.setCameraOn(1, true);
  run(sim, 600); // 跑到低电量告警并耗尽关机
  const before = sim.snapshot();
  const hadAlarm = before.alarms.some(a => a.key === 'bat1' && a.triggerT !== null);
  // 处置：换掉电池(若低温失败则推进到回暖再换)
  let rec = sim.intervene(1, 'battery');
  let guard = 0;
  while (!rec.ok && guard++ < 2000) { sim.step(1); rec = sim.intervene(1, 'battery'); }
  sim.setCameraOn(1, true);
  run(sim, RECOVERY_WATCH + 5); // 恢复后继续运行固定时长
  const after = sim.snapshot();
  const watches = after.recoveryWatch.filter(w => w.alarmKey === 'bat1');
  const watch = watches[watches.length - 1];
  const relapse = watch && watch.relapsed;
  check('恢复：低电量告警曾触发并完成处置', hadAlarm && rec.ok);
  check(`恢复：${RECOVERY_WATCH}s 观察期结束且无隐藏残留`, !!watch && watch.done && !watch.relapsed && !relapse,
    watch && `done=${watch.done} relapsed=${watch.relapsed}`);
}

// ---------- 6. 干预前后指标对比(物种/水位/污染) ----------
{
  const sim = createSim(SEED);
  sim.intervene(0, 'wipe');
  run(sim, 40); // 超过沉降窗口 30s
  const s = sim.snapshot();
  const r = s.reports.find(x => x.type === 'wipe');
  const keys = r && r.before && r.after && ['activity', 'snowWater', 'pollution']
    .every(k => typeof r.before[k] === 'number' && typeof r.after[k] === 'number');
  check('对比：干预报告含前后物种活动/积雪水位/污染指标', !!r && keys,
    r && r.after && `activity ${r.before.activity}→${r.after.activity}`);
}

// ---------- 7. 可玩性：合理策略下可集齐三组有效影像 ----------
{
  const sim = createSim(SEED);
  for (let i = 0; i < 3; i++) sim.setLight(i, 0.4);
  let t = 0;
  while (t < 1500 && !sim.state.success) {
    sim.step(0.5); t += 0.5;
    const st = sim.state;
    st.cams.forEach((c, i) => {
      const sig = st.obs.signal[i];
      if (!c.on && sig > 0.45 && c.battery > 30) sim.setCameraOn(i, true);
      if (c.on && (sig < 0.1 || c.battery < 25)) sim.setCameraOn(i, false);
      if (c.lensSnow > 0.5) { const r = sim.intervene(i, 'wipe'); if (!r.ok) sim.intervene(i, 'heat'); }
      if (c.battery < 15) sim.intervene(i, 'battery');
    });
  }
  const s = sim.snapshot();
  check('可玩性：策略游玩可集齐 3 组有效影像', s.success,
    s.successT && `t=${s.successT.toFixed(0)}s，干预${s.interventions.length}次`);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
