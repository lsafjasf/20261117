/* 无头验证：确定性、暂停/单步一致性、重置不漂移、越限停机、完整任务。
 * 运行：node tests/headless.js
 */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'js', 'config.js'));
require(path.join(__dirname, '..', 'js', 'physics.js'));

const P = globalThis.CranePhysics;
const CFG = globalThis.CRANE_CFG;

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  PASS ' + msg);
  } else {
    failures += 1;
    console.error('  FAIL ' + msg);
  }
}

// 一段固定的录制输入序列（确定性、无随机）
function recordedScript() {
  const seq = [];
  const NONE = {};
  for (let i = 0; i < 360; i++) seq.push({ hoistUp: true });
  for (let i = 0; i < 700; i++) seq.push({ right: true });
  for (let i = 0; i < 120; i++) seq.push(NONE);
  for (let i = 0; i < 300; i++) seq.push({ hoistDown: true });
  for (let i = 0; i < 120; i++) seq.push(NONE);
  return seq;
}

function run(seq) {
  const s = P.createInitialState();
  s.requestAttach = true;
  P.stepOnce(s, {});
  for (const inp of seq) P.stepOnce(s, inp);
  return s;
}

console.log('1) 同输入重复运行轨迹一致（校验和/位置）');
const seq = recordedScript();
const a = run(seq);
const b = run(seq);
assert(P.checksum(a) === P.checksum(b), '两次运行 checksum 相同：' + P.checksum(a));
assert(a.box.x === b.box.x && a.box.y === b.box.y, '货箱位置逐位相同');
assert(a.tension === b.tension && a.temp === b.temp, '张力/温度相同');

console.log('2) 暂停-单步-恢复与连续运行结果一致');
const continuous = run(seq);
const paused = P.createInitialState();
paused.requestAttach = true;
P.stepOnce(paused, {});
for (let i = 0; i < 300; i++) P.stepOnce(paused, seq[i]);
const snapAt300 = P.checksum(paused);
for (let k = 0; k < 25; k++) P.stepOnce(paused, seq[300 + k]); // 单步推进
for (let i = 325; i < seq.length; i++) P.stepOnce(paused, seq[i]);
assert(P.checksum(paused) === P.checksum(continuous),
  '暂停/单步/恢复后 checksum 与连续运行一致');
assert(snapAt300 !== P.checksum(paused), '单步确实推进了状态');

console.log('3) 重置后初始条件不漂移（资源与位置恢复）');
const r = run(seq);
const before = P.checksum(P.createInitialState());
P.resetState(r);
const fresh = P.createInitialState();
assert(r.step === 0 && r.time === 0, '步数与时间归零');
assert(r.trolleyX === fresh.trolleyX && r.r === fresh.r,
  '小车位置/绳长恢复（r=' + r.r.toFixed(3) + '）');
assert(r.energyJ === 0 && r.faults.length === 0, '能耗清零、故障清空');
assert(P.checksum(r) === before, '重置后 checksum 与全新状态一致：' + before);
P.resetState(r);
assert(P.checksum(r) === before, '多次重置后仍不漂移');

console.log('4) 越限即停机并记录首次故障位置/时间');
const over = P.createInitialState();
over.requestAttach = true;
P.stepOnce(over, {});
for (let i = 0; i < 850; i++) P.stepOnce(over, { hoistUp: true });
for (let i = 0; i < 600; i++) P.stepOnce(over, { hoistDown: true });
let fi = 0;
while (over.status === 'active' && fi < 4000) {
  for (let k = 0; k < 180 && over.status === 'active'; k++) {
    P.stepOnce(over, { right: true });
  }
  for (let k = 0; k < 180 && over.status === 'active'; k++) {
    P.stepOnce(over, { left: true });
  }
  fi += 1;
}
const stepAtFault = over.step;
for (let k = 0; k < 50; k++) P.stepOnce(over, { right: true });
assert(over.status === 'fault', '状态为 fault');
assert(over.step === stepAtFault, '故障后计算停止，步数冻结在 ' + stepAtFault);
assert(over.faults.length === 1, '仅记录首次故障（故障数=' + over.faults.length + '）');
const f = over.faults[0];
assert(typeof f.t === 'number' && typeof f.x === 'number' && typeof f.y === 'number',
  '故障含时间(' + f.t.toFixed(2) + 's)与坐标(x=' + f.x.toFixed(0) + ',y=' + f.y.toFixed(0) + ')');
assert(f.part && f.metric && f.bound !== undefined,
  '故障指出部件「' + f.part + '」与越限指标 ' + f.metric + '（限值 ' + f.bound + ' ' + f.unit + '）');

console.log('5) 碰撞检测（OBB-SAT）可识别重叠');
assert(P.rectsOverlap(
  { x: 100, y: 400, w: 40, h: 40, angle: 0.3 },
  { x: 110, w: 40, top: 390, bottom: 430 }
), '旋转货箱与墙重叠被检出');
assert(!P.rectsOverlap(
  { x: 100, y: 400, w: 40, h: 40, angle: 0 },
  { x: 300, w: 40, top: 390, bottom: 430 }
), '分离物体不误报');

console.log('6) 回放确定性：输入日志可重建相同 checksum');
const src = run(seq);
const replay = P.createInitialState();
replay.requestAttach = true;
P.stepOnce(replay, {});
for (const code of src.inputLog) {
  P.stepOnce(replay, {
    left: !!(code & 1), right: !!(code & 2),
    hoistUp: !!(code & 4), hoistDown: !!(code & 8),
    brake: !!(code & 16)
  });
}
assert(P.checksum(replay) === P.checksum(src),
  '由输入日志重建的轨迹与原运行一致');

console.log('7) 限值范围合理性');
const L = CFG.limits;
assert(L.tension.min > 0 && L.tension.max > L.tension.min, '张力上下限合理');
assert(L.speed.max === 1.1 && L.temp.max === 120 && L.pressure.max === 200,
  '速度/温度/压力上限符合设计');

console.log('8) 完整两次吊装可成功（无碰撞、无越限）');
const mission = P.createInitialState();
function drive(n, inp) {
  for (let i = 0; i < n && mission.status === 'active'; i++) P.stepOnce(mission, inp);
}
function doLift(hoistN, moveN, downCycles) {
  mission.requestAttach = true;
  P.stepOnce(mission, {});
  drive(hoistN, { hoistUp: true });
  drive(moveN, { right: true });
  drive(400, {});
  const targetPlaced = mission.placedBoxes.length + 1;
  for (let c = 0; c < downCycles && mission.status === 'active'
    && mission.placedBoxes.length < targetPlaced; c++) {
    drive(90, { hoistDown: true });
    drive(180, {});
  }
}
doLift(3600, 2400, 90);
assert(mission.liftIndex === 1 && mission.placedBoxes.length === 1, '第一次吊装落位');
mission.requestAttach = true;
P.stepOnce(mission, {});
drive(3600, { hoistUp: true });
drive(700, { right: true });
drive(400, {});
for (let c = 0; c < 90 && mission.status === 'active'
  && mission.placedBoxes.length < 2; c++) {
  drive(90, { hoistDown: true });
  drive(180, {});
}
assert(mission.status === 'done' && mission.placedBoxes.length === 2,
  '两次吊装全部完成，状态 done');
assert(mission.faults.length === 0, '全程无碰撞/越限故障');
assert(mission.peaks.tension.value <= L.tension.max
  && mission.peaks.speed.value <= L.speed.max
  && mission.peaks.temp.value <= L.temp.max
  && mission.peaks.pressure.value <= L.pressure.max, '所有峰值均在安全限值内');
assert(typeof mission.time === 'number' && mission.time > 0,
  '报告含任务用时（' + mission.time.toFixed(1) + ' s）');

console.log('9) 四类限值各自可被独立触发');
function freshAirborne(mass, hoistSteps) {
  const st = P.createInitialState();
  if (mass) st.box.mass = mass;
  st.requestAttach = true;
  P.stepOnce(st, {});
  for (let k = 0; k < hoistSteps; k++) P.stepOnce(st, { hoistUp: true });
  return st;
}
// 速度越限：高位放长绳后持续横移，长绳摆速叠加突破上限
const stSpeed = freshAirborne(0, 3600);
for (let k = 0; k < 700; k++) P.stepOnce(stSpeed, { hoistDown: true });
let cap9 = 0;
while (stSpeed.status === 'active' && cap9++ < 4000) P.stepOnce(stSpeed, { right: true });
assert(stSpeed.faults[0].metric === 'speed', '速度越限触发：' + stSpeed.faults[0].part);
// 温度越限：中程往返 + 持续刹车，刹车盘热累积
const stTemp = freshAirborne(0, 3600);
cap9 = 0;
while (stTemp.status === 'active' && cap9++ < 20000) {
  for (let k = 0; k < 200; k++) P.stepOnce(stTemp, cap9 % 2 ? { left: true } : { right: true });
  for (let k = 0; k < 200; k++) P.stepOnce(stTemp, { brake: true });
}
assert(stTemp.faults[0].metric === 'temp', '温度越限触发：' + stTemp.faults[0].part);
// 张力越限：1200 kg 重载，静/动张力超过绳索上限
const stT = freshAirborne(1200, 3600);
cap9 = 0;
while (stT.status === 'active' && cap9++ < 12000) {
  for (let k = 0; k < 170; k++) P.stepOnce(stT, { right: true });
  for (let k = 0; k < 170; k++) P.stepOnce(stT, { left: true });
}
assert(stT.faults[0].metric === 'tension', '张力越限触发：' + stT.faults[0].part);
// 压力越限：重载 + 轻配重，平稳横移
const stP = freshAirborne(1200, 3600);
stP.counterweight = 400;
cap9 = 0;
while (stP.status === 'active' && cap9++ < 8000) {
  for (let k = 0; k < 450; k++) P.stepOnce(stP, { right: true });
  for (let k = 0; k < 450; k++) P.stepOnce(stP, {});
}
assert(stP.faults[0].metric === 'pressure', '压力越限触发：' + stP.faults[0].part);


console.log(failures === 0
  ? '\n全部通过 ✔ (' + new Date().toISOString() + ')'
  : '\n存在 ' + failures + ' 项失败 ✘');
process.exit(failures === 0 ? 0 : 1);
