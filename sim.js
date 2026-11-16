"use strict";

/* ================= 常量（重置时严格恢复，杜绝漂移） ================= */
const DT = 1 / 240;            // 物理固定步长 (s)
const STEP_FRAMES = 20;        // 单步 = 20 个子步 = 1/12 s
const CYCLE_T = 120;           // 周期时长 (s)

const TANK = { area: 2.0, hMax: 3.0 };          // m², m
const INIT = Object.freeze({
  hA: 2.0, hB: 0.5,           // 初始水位 (m)
  valve: 0, pump: 0, dir: 1,  // 执行机构实际状态
  temp: 20, press: 0, load: 0,
});
const TARGET = { hA: 1.0, hB: 1.5, tol: 0.05 }; // 目标水位与容差 (m)

const VALVE_TAU = 1.5;         // 阀门一阶延迟时间常数 (s)
const PUMP_TAU = 0.8;          // 泵转速惯性时间常数 (s)
const Q_MAX = 0.05;            // 泵满速+阀全开流量 (m³/s)
const RHO_G = 9810;            // ρg (N/m³)
const K_FRICTION = 2.0e6;      // 沿程阻力系数 Pa/(m³/s)²
const K_HAMMER = 2.0e6;        // 水锤系数 Pa/(m³/s²)
const HEAT_DRY = 6.0;          // 空转升温速率 °C/s（满速干转）
const HEAT_LOAD = 0.4;         // 带载温升 °C/s
const COOL_K = 0.05;           // 散热系数 1/s
const T_AMB = 20;

/* 安全上下限：越限即冻结计算并记录首个故障点 */
const LIMITS = Object.freeze({
  press: { lo: 0,    hi: 200, unit: "kPa", name: "管路压力" },
  temp:  { lo: -5,   hi: 90,  unit: "°C",  name: "泵体温度" },
  load:  { lo: 0,    hi: 6,   unit: "kW",  name: "泵负载" },
  speed: { lo: 0,    hi: 100, unit: "%",   name: "泵转速" },
  level: { lo: 0.05, hi: TANK.hMax, unit: "m", name: "水箱液位" },
});

/* ================= 状态 ================= */
function makeState() {
  return {
    t: 0,
    hA: INIT.hA, hB: INIT.hB,
    valve: INIT.valve,          // 阀门实际开度 0..1
    pump: INIT.pump,            // 泵实际转速 0..1
    dir: INIT.dir,              // +1: A→B, -1: B→A
    spool: 0,                   // 带符号泵流量指令惯性 (-1..1)
    temp: INIT.temp,
    press: 0, load: 0, hammer: 0,
    flow: 0, prevFlow: 0,
    dry: false,
    over: null,                 // {key, name, value, limit, t}
    done: null,                 // "success" | "fault" | "timeout"
    peaks: { press: 0, temp: T_AMB, load: 0, hammer: 0 },
    hist: [],                   // {t,hA,hB,press,temp,load}
  };
}

/* 指令输入（玩家/回放写入），与物理状态分离 */
const cmd = { valve: 0, pump: 0, dir: 1 };

let S = makeState();

/* ================= 物理子步 ================= */
function physStep() {
  if (S.done) return;

  // 阀门一阶延迟
  S.valve += (cmd.valve - S.valve) * (DT / VALVE_TAU);
  S.pump = cmd.pump;
  S.dir = cmd.dir;
  // 泵转速惯性：换向/急停经水锤惩罚，但不会瞬时跳变
  S.spool += (cmd.dir * cmd.pump - S.spool) * (DT / PUMP_TAU);

  const srcH = S.dir > 0 ? S.hA : S.hB;
  // 通流能力：阀开度与源水位平滑过渡，避免硬切换数值尖峰
  const avail = Math.min(S.valve / 0.2, 1) * Math.min(Math.max(srcH, 0) / 0.05, 1);
  const dry = Math.abs(S.spool) > 0.05 && avail < 0.2;
  S.dry = dry;

  // 流量：干转时无有效流量
  const flow = S.spool * avail * Q_MAX;
  const dQdt = (flow - S.prevFlow) / DT;
  S.prevFlow = flow;
  S.flow = flow;

  // 水位更新
  S.hA -= flow * DT / TANK.area;
  S.hB += flow * DT / TANK.area;

  // 压力 = 静压 + 沿程阻力 + 水锤（快速切换惩罚）
  const hammer = K_HAMMER * Math.abs(dQdt);
  const pressPa = RHO_G * Math.max(srcH, 0) + K_FRICTION * flow * flow + hammer;
  S.hammer = hammer / 1000;
  S.press = pressPa / 1000;

  // 泵负载 (kW)：空转仍有电耗，带载随流量与压力升高
  S.load = S.pump * (0.8 + Math.abs(flow) * 40 + S.press * 0.004);

  // 温度：空转快速升温，带载缓慢升温，向环境散热
  const heat = dry ? HEAT_DRY * S.pump : HEAT_LOAD * S.pump;
  S.temp += (heat - COOL_K * (S.temp - T_AMB)) * DT;

  S.t += DT;

  // 峰值统计
  const P = S.peaks;
  if (S.press > P.press) P.press = S.press;
  if (S.temp > P.temp) P.temp = S.temp;
  if (S.load > P.load) P.load = S.load;
  if (S.hammer > P.hammer) P.hammer = S.hammer;

  // 历史采样（每 6 子步 = 40Hz 采到 4Hz 显示）
  if ((S.hist.length === 0) || (S.t - S.hist[S.hist.length - 1].t) >= 0.25 - 1e-9) {
    S.hist.push({ t: S.t, hA: S.hA, hB: S.hB, press: S.press, temp: S.temp, load: S.load });
  }

  checkLimits();
  checkGoals();
}

/* 越限检测：记录首个故障部件与时间，随后冻结不安全计算 */
function checkLimits() {
  if (S.over) return;
  const trip = (key, value, limit) => {
    S.over = { key, name: LIMITS[key].name, value, limit, t: S.t };
    S.done = "fault";
  };
  if (S.press > LIMITS.press.hi) return trip("press", S.press, LIMITS.press.hi);
  if (S.temp > LIMITS.temp.hi) return trip("temp", S.temp, LIMITS.temp.hi);
  if (S.load > LIMITS.load.hi) return trip("load", S.load, LIMITS.load.hi);
  if (S.hA > LIMITS.level.hi || S.hB > LIMITS.level.hi)
    return trip("level", Math.max(S.hA, S.hB), LIMITS.level.hi);
  if (S.hA < 0 || S.hB < 0) return trip("level", Math.min(S.hA, S.hB), 0);
}

function checkGoals() {
  if (S.done) return;
  const okA = Math.abs(S.hA - TARGET.hA) <= TARGET.tol;
  const okB = Math.abs(S.hB - TARGET.hB) <= TARGET.tol;
  if (okA && okB) { S.done = "success"; return; }
  if (S.t >= CYCLE_T) S.done = "timeout";
}

/* ================= 输入记录（回放与确定性的基础） ================= */
let inputLog = [];        // 本次运行的输入事件 {t, key, value}
let lastRunLog = [];      // 上一次完整运行的输入（供回放）
let replayLog = null;     // 回放时正在消费的事件序列
let replayIdx = 0;

function recordInput(key, value) {
  if (replayLog) return;              // 回放期间不记录
  inputLog.push({ t: S.t, key, value });
}

function applyInput(key, value) {
  if (key === "valve") cmd.valve = value;
  else if (key === "pump") cmd.pump = value;
  else if (key === "dir") cmd.dir = value;
}

function consumeReplayEvents() {
  while (replayIdx < replayLog.length && replayLog[replayIdx].t <= S.t + 1e-9) {
    const e = replayLog[replayIdx++];
    applyInput(e.key, e.value);
    syncControlUI();
  }
}

/* ================= 运行控制 ================= */
let mode = "idle";   // idle | run | pause | replay
let acc = 0;
let lastTs = null;

function doReset(forReplay) {
  S = makeState();
  cmd.valve = 0; cmd.pump = 0; cmd.dir = 1;
  acc = 0;
  if (!forReplay) {
    inputLog = [];
    replayLog = null;
  }
  syncControlUI();
  updateStatus();
  renderAll();
}

function startRun() {
  if (S.done) return;
  mode = "run";
  updateStatus();
}

function pauseRun() {
  if (mode === "run" || mode === "replay") { mode = "pause"; updateStatus(); }
}

function singleStep() {
  if (S.done) return;
  if (mode === "run") mode = "pause";
  for (let i = 0; i < STEP_FRAMES && !S.done; i++) {
    if (replayLog) consumeReplayEvents();
    physStep();
  }
  updateStatus();
  renderAll();
}

function startReplay() {
  if (lastRunLog === null || (inputLog.length === 0 && lastRunLog.length === 0)) return;
  lastRunLog = inputLog.slice();
  doReset(true);
  replayLog = lastRunLog;
  replayIdx = 0;
  inputLog = lastRunLog.slice(); // 回放轨迹与原轨迹同源，可再次回放
  mode = "replay";
  updateStatus();
}

function finishRun() {
  if (mode === "replay") { replayLog = null; }
  lastRunLog = inputLog.slice();
  mode = "idle";
  updateStatus();
  renderAll();
}

/* 主循环：固定步长积分，暂停/单步/恢复共用同一积分器保证一致 */
function frame(ts) {
  if (lastTs === null) lastTs = ts;
  let elapsed = (ts - lastTs) / 1000;
  lastTs = ts;
  if (elapsed > 0.25) elapsed = 0.25; // 防止切后台后大步长
  if (mode === "run" || mode === "replay") {
    acc += elapsed;
    while (acc >= DT && !S.done) {
      if (replayLog) consumeReplayEvents();
      physStep();
      acc -= DT;
    }
    if (S.done) finishRun();
    renderAll();
  }
  requestAnimationFrame(frame);
}

/* ================= 场景渲染 ================= */
const view = document.getElementById("view");
const vc = view.getContext("2d");

const GEO = {
  tankW: 130, tankH: 240, floor: 340,
  ax: 70, bx: 440,               // 两箱左缘 x
  pipeY: 300, valveX: 320, pumpX: 250,
};

function tankTopY() { return GEO.floor - GEO.tankH; }
function waterY(h) { return GEO.floor - (h / TANK.hMax) * GEO.tankH; }

function drawTank(x, h, target, label) {
  const top = tankTopY();
  // 目标水位带
  const ty = waterY(target);
  const tolY = (TARGET.tol / TANK.hMax) * GEO.tankH;
  vc.fillStyle = "rgba(63,191,127,0.18)";
  vc.fillRect(x, ty - tolY, GEO.tankW, tolY * 2);
  vc.strokeStyle = "rgba(63,191,127,0.7)";
  vc.setLineDash([4, 4]);
  vc.beginPath(); vc.moveTo(x, ty); vc.lineTo(x + GEO.tankW, ty); vc.stroke();
  vc.setLineDash([]);
  // 水体
  const wy = waterY(Math.max(h, 0));
  const grad = vc.createLinearGradient(0, wy, 0, GEO.floor);
  grad.addColorStop(0, "rgba(74,163,255,0.85)");
  grad.addColorStop(1, "rgba(30,90,180,0.9)");
  vc.fillStyle = grad;
  vc.fillRect(x, wy, GEO.tankW, GEO.floor - wy);
  // 箱壁
  vc.strokeStyle = "#5a6b82"; vc.lineWidth = 3;
  vc.beginPath();
  vc.moveTo(x, top); vc.lineTo(x, GEO.floor); vc.lineTo(x + GEO.tankW, GEO.floor); vc.lineTo(x + GEO.tankW, top);
  vc.stroke();
  vc.lineWidth = 1;
  // 上限刻度
  vc.strokeStyle = "rgba(224,82,82,0.8)";
  vc.beginPath(); vc.moveTo(x - 6, top); vc.lineTo(x + 6, top); vc.stroke();
  vc.fillStyle = "#d7e2ee"; vc.font = "13px sans-serif"; vc.textAlign = "center";
  vc.fillText(`${label}  ${h.toFixed(2)} m`, x + GEO.tankW / 2, GEO.floor + 20);
  vc.fillStyle = "#8496ab"; vc.font = "11px sans-serif";
  vc.fillText(`目标 ${target.toFixed(2)} m`, x + GEO.tankW / 2, GEO.floor + 36);
}

function drawPipeAndDevices() {
  const y = GEO.pipeY;
  const left = GEO.ax + GEO.tankW / 2, right = GEO.bx + GEO.tankW / 2;
  // 竖管
  vc.strokeStyle = "#5a6b82"; vc.lineWidth = 8;
  vc.beginPath();
  vc.moveTo(left, GEO.floor - 4); vc.lineTo(left, y);
  vc.lineTo(right, y); vc.lineTo(right, GEO.floor - 4);
  vc.stroke();
  vc.lineWidth = 1;
  // 流动动画（相位由仿真时间驱动，保证确定性）
  if (Math.abs(S.flow) > 1e-5) {
    vc.fillStyle = "rgba(74,163,255,0.9)";
    const dirx = S.dir > 0 ? 1 : -1;
    const speed = 120 * Math.abs(S.flow) / Q_MAX;
    const phase = (S.t * speed) % 24;
    for (let x = left + phase; x < right; x += 24) {
      const px = dirx > 0 ? x : left + (right - x);
      vc.fillRect(px - 3, y - 2, 6, 4);
    }
  }
  // 泵（圆）
  vc.beginPath(); vc.arc(GEO.pumpX, y, 16, 0, Math.PI * 2);
  vc.fillStyle = S.dry ? "#e05252" : "#243349";
  vc.fill(); vc.strokeStyle = "#8496ab"; vc.stroke();
  const ang = S.t * S.pump * 12;
  vc.strokeStyle = "#d7e2ee";
  vc.beginPath();
  vc.moveTo(GEO.pumpX, y);
  vc.lineTo(GEO.pumpX + 11 * Math.cos(ang), y + 11 * Math.sin(ang));
  vc.stroke();
  vc.fillStyle = "#8496ab"; vc.font = "11px sans-serif"; vc.textAlign = "center";
  vc.fillText("泵", GEO.pumpX, y + 32);
  // 阀门（蝶阀示意，开度旋转）
  vc.save();
  vc.translate(GEO.valveX, y);
  vc.rotate((1 - S.valve) * Math.PI / 2);
  vc.fillStyle = "#e0a83c";
  vc.fillRect(-2, -14, 4, 28);
  vc.restore();
  vc.strokeStyle = "#8496ab";
  vc.strokeRect(GEO.valveX - 8, y - 8, 16, 16);
  vc.fillStyle = "#8496ab";
  vc.fillText(`阀 ${(S.valve * 100).toFixed(0)}%`, GEO.valveX, y + 32);
}

function drawPressureGauge() {
  const x = 590, y = 120, r = 46;
  vc.beginPath(); vc.arc(x, y, r, 0, Math.PI * 2);
  vc.fillStyle = "#0c1118"; vc.fill();
  vc.strokeStyle = "#5a6b82"; vc.stroke();
  // 刻度：0..上限*1.2
  const max = LIMITS.press.hi * 1.2;
  for (let i = 0; i <= 6; i++) {
    const v = (max * i) / 6;
    const a = Math.PI * 0.75 + (v / max) * Math.PI * 1.5;
    vc.strokeStyle = v > LIMITS.press.hi ? "#e05252" : "#8496ab";
    vc.beginPath();
    vc.moveTo(x + (r - 8) * Math.cos(a), y + (r - 8) * Math.sin(a));
    vc.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    vc.stroke();
  }
  const frac = Math.min(S.press / max, 1);
  const a = Math.PI * 0.75 + frac * Math.PI * 1.5;
  vc.strokeStyle = S.press > LIMITS.press.hi ? "#e05252" : "#4aa3ff";
  vc.lineWidth = 2;
  vc.beginPath(); vc.moveTo(x, y);
  vc.lineTo(x + (r - 12) * Math.cos(a), y + (r - 12) * Math.sin(a));
  vc.stroke(); vc.lineWidth = 1;
  vc.fillStyle = "#d7e2ee"; vc.font = "12px sans-serif"; vc.textAlign = "center";
  vc.fillText(`${S.press.toFixed(1)} kPa`, x, y + r + 16);
  vc.fillStyle = "#8496ab"; vc.font = "10px sans-serif";
  vc.fillText(`上限 ${LIMITS.press.hi}`, x, y + r + 30);
}

function drawFaultMarker() {
  if (!S.over) return;
  const o = S.over;
  let x = GEO.valveX, y = GEO.pipeY - 40, label = o.name;
  if (o.key === "temp" || o.key === "load") { x = GEO.pumpX; }
  if (o.key === "level") { x = GEO.ax + GEO.tankW / 2; y = tankTopY() - 20; }
  vc.strokeStyle = "#e05252"; vc.lineWidth = 2;
  vc.beginPath(); vc.arc(x, o.key === "level" ? y + 20 : GEO.pipeY, 24, 0, Math.PI * 2); vc.stroke();
  vc.lineWidth = 1;
  vc.fillStyle = "#e05252"; vc.font = "bold 13px sans-serif"; vc.textAlign = "center";
  vc.fillText(`⚠ ${label} 越限 @ ${o.t.toFixed(2)}s`, x, y - 12);
}

function renderView() {
  vc.clearRect(0, 0, view.width, view.height);
  vc.fillStyle = "#8496ab"; vc.font = "12px sans-serif"; vc.textAlign = "left";
  vc.fillText(`t = ${S.t.toFixed(2)} s / ${CYCLE_T} s`, 12, 20);
  vc.fillText(`流量 Q = ${(S.flow * 1000).toFixed(1)} L/s`, 12, 38);
  vc.fillText(`水锤分量 = ${S.hammer.toFixed(1)} kPa`, 12, 56);
  drawTank(GEO.ax, S.hA, TARGET.hA, "水箱 A");
  drawTank(GEO.bx, S.hB, TARGET.hB, "水箱 B");
  drawPipeAndDevices();
  drawPressureGauge();
  drawFaultMarker();
}

/* ================= 物理量仪表（含上下限显示） ================= */
const gaugesEl = document.getElementById("gauges");
const GAUGE_DEFS = [
  { key: "press", get: () => S.press },
  { key: "temp",  get: () => S.temp },
  { key: "load",  get: () => S.load },
  { key: "speed", get: () => S.pump * 100 },
];
for (const g of GAUGE_DEFS) {
  const L = LIMITS[g.key];
  const div = document.createElement("div");
  div.className = "gauge";
  div.innerHTML =
    `<div class="name"><span>${L.name}</span>` +
    `<span class="lim">[${L.lo} .. ${L.hi}] ${L.unit} · <b id="gv_${g.key}">–</b></span></div>` +
    `<div class="bar"><div id="gb_${g.key}"></div></div>`;
  gaugesEl.appendChild(div);
}

function renderGauges() {
  for (const g of GAUGE_DEFS) {
    const L = LIMITS[g.key];
    const v = g.get();
    const frac = Math.max(0, Math.min(1, (v - L.lo) / (L.hi - L.lo)));
    const bar = document.getElementById("gb_" + g.key);
    const val = document.getElementById("gv_" + g.key);
    bar.style.width = (frac * 100).toFixed(1) + "%";
    bar.className = v > L.hi ? "over" : (frac > 0.8 ? "hot" : "");
    val.textContent = v.toFixed(1);
    val.style.color = v > L.hi ? "var(--bad)" : (frac > 0.8 ? "var(--warn)" : "var(--text)");
  }
}

/* ================= 趋势图（回放受力/变化趋势） ================= */
const trend = document.getElementById("trend");
const tc = trend.getContext("2d");
const SERIES = [
  { key: "press", name: "压力 kPa", color: "#4aa3ff", max: LIMITS.press.hi * 1.2, lim: LIMITS.press.hi },
  { key: "temp",  name: "温度 °C",  color: "#e0a83c", max: LIMITS.temp.hi * 1.2,  lim: LIMITS.temp.hi },
  { key: "load",  name: "负载 kW",  color: "#c678dd", max: LIMITS.load.hi * 1.2,  lim: LIMITS.load.hi },
  { key: "hA",    name: "水位A m",  color: "#3fbf7f", max: TANK.hMax, lim: null },
  { key: "hB",    name: "水位B m",  color: "#56b6c2", max: TANK.hMax, lim: null },
];

function renderTrend() {
  tc.clearRect(0, 0, trend.width, trend.height);
  const W = trend.width, H = trend.height, padL = 40, padB = 20;
  const plotW = W - padL - 10, plotH = H - padB - 10;
  const tMax = Math.max(CYCLE_T, S.t);
  // 上限参考线
  for (const s of SERIES) {
    if (s.lim === null) continue;
    const y = 10 + plotH * (1 - s.lim / s.max);
    tc.strokeStyle = "rgba(224,82,82,0.45)";
    tc.setLineDash([5, 4]);
    tc.beginPath(); tc.moveTo(padL, y); tc.lineTo(padL + plotW, y); tc.stroke();
    tc.setLineDash([]);
  }
  // 曲线
  const hist = S.hist;
  for (const s of SERIES) {
    tc.strokeStyle = s.color;
    tc.beginPath();
    let started = false;
    for (const p of hist) {
      const x = padL + (p.t / tMax) * plotW;
      const y = 10 + plotH * (1 - Math.min(p[s.key] / s.max, 1));
      if (started) tc.lineTo(x, y); else { tc.moveTo(x, y); started = true; }
    }
    tc.stroke();
  }
  // 故障点标记
  if (S.over) {
    const x = padL + (S.over.t / tMax) * plotW;
    tc.strokeStyle = "#e05252"; tc.lineWidth = 2;
    tc.beginPath(); tc.moveTo(x, 10); tc.lineTo(x, 10 + plotH); tc.stroke();
    tc.lineWidth = 1;
    tc.fillStyle = "#e05252"; tc.font = "11px sans-serif"; tc.textAlign = "left";
    tc.fillText(`首故障 ${S.over.name} @ ${S.over.t.toFixed(2)}s`, Math.min(x + 4, W - 160), 20);
  }
  // 图例
  tc.font = "11px sans-serif"; tc.textAlign = "left";
  let lx = padL;
  for (const s of SERIES) {
    tc.fillStyle = s.color;
    tc.fillText(s.name, lx, H - 6);
    lx += 90;
  }
  tc.fillStyle = "#8496ab";
  tc.fillText(`t: 0 .. ${tMax.toFixed(0)} s`, W - 110, H - 6);
}

/* ================= 报告 ================= */
const reportEl = document.getElementById("report");

function renderReport() {
  const P = S.peaks;
  let head, cls;
  if (S.done === "success") { head = "✔ 成功：两水箱均到达目标水位，压力未超限。"; cls = "ok"; }
  else if (S.done === "fault") { head = "✘ 失败：出现越限，计算已在故障点冻结。"; cls = "bad"; }
  else if (S.done === "timeout") { head = "✘ 超时：周期结束未达成双目标。"; cls = "warn"; }
  else { head = "运行中…"; cls = ""; }
  let fault = "无";
  if (S.over) {
    const o = S.over;
    fault = `${o.name} 于 t=${o.t.toFixed(2)}s 首次越限（${o.value.toFixed(2)} > 上限 ${o.limit}）`;
  }
  reportEl.innerHTML =
    `<div id="status2" class="${cls}">${head}</div>` +
    `峰值压力: ${P.press.toFixed(1)} kPa (限 ${LIMITS.press.hi})\n` +
    `峰值温度: ${P.temp.toFixed(1)} °C (限 ${LIMITS.temp.hi})\n` +
    `峰值负载: ${P.load.toFixed(2)} kW (限 ${LIMITS.load.hi})\n` +
    `峰值水锤: ${P.hammer.toFixed(1)} kPa\n` +
    `末态水位: A=${S.hA.toFixed(3)} m, B=${S.hB.toFixed(3)} m\n` +
    `故障位置: ${fault}\n` +
    `输入事件: ${inputLog.length} 条`;
}

/* ================= 状态行与渲染汇总 ================= */
const statusEl = document.getElementById("status");
function updateStatus() {
  const names = { idle: "待机", run: "运行中", pause: "已暂停", replay: "回放中" };
  let s = `${names[mode]} · t=${S.t.toFixed(2)}s`;
  if (S.done === "success") s += " · ✔ 成功";
  if (S.done === "fault") s += ` · ✘ ${S.over.name}越限`;
  if (S.done === "timeout") s += " · ✘ 超时";
  statusEl.textContent = s;
  document.getElementById("runBtn").textContent = mode === "run" ? "⏸ 暂停" : "▶ 运行";
}

function renderAll() {
  renderView();
  renderGauges();
  renderTrend();
  renderReport();
}

/* ================= UI 接线 ================= */
const valveEl = document.getElementById("valve");
const pumpEl = document.getElementById("pump");
const valveOut = document.getElementById("valveOut");
const pumpOut = document.getElementById("pumpOut");
const dirBtn = document.getElementById("dirBtn");

function syncControlUI() {
  valveEl.value = Math.round(cmd.valve * 100);
  pumpEl.value = Math.round(cmd.pump * 100);
  valveOut.textContent = `${Math.round(cmd.valve * 100)}%`;
  pumpOut.textContent = `${Math.round(cmd.pump * 100)}%`;
  dirBtn.textContent = cmd.dir > 0 ? "A → B" : "B → A";
}

valveEl.addEventListener("input", () => {
  const v = valveEl.value / 100;
  recordInput("valve", v);
  applyInput("valve", v);
  syncControlUI();
});
pumpEl.addEventListener("input", () => {
  const v = pumpEl.value / 100;
  recordInput("pump", v);
  applyInput("pump", v);
  syncControlUI();
});
dirBtn.addEventListener("click", () => {
  const d = cmd.dir > 0 ? -1 : 1;
  recordInput("dir", d);
  applyInput("dir", d);
  syncControlUI();
});

document.getElementById("runBtn").addEventListener("click", () => {
  if (mode === "run" || mode === "replay") pauseRun();
  else startRun();
});
document.getElementById("stepBtn").addEventListener("click", singleStep);
document.getElementById("resetBtn").addEventListener("click", () => {
  mode = "idle";
  doReset(false);
});
document.getElementById("replayBtn").addEventListener("click", startReplay);

/* ================= 启动 ================= */
doReset(false);
requestAnimationFrame(frame);

/* 无头测试导出（浏览器中 module 不存在，自动跳过） */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    get S() { return S; }, cmd, LIMITS, TARGET, INIT, DT,
    physStep, doReset, singleStep,
    recordInput, applyInput,
    get inputLog() { return inputLog; },
  };
}
