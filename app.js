'use strict';
/* 弹簧轨道门 —— UI / 渲染 / 控制。物理见 sim.js（固定步长，确定性）。 */

const worldCv = document.getElementById('world');
const wctx = worldCv.getContext('2d');
const chartCv = document.getElementById('chart');
const cctx = chartCv.getContext('2d');
const banner = document.getElementById('banner');

const SCALE = 38;            // px / m
const ORIGIN_X = 24;         // 世界 x=0 对应的画布 x
const GROUND_Y = worldCv.height - 30;

const game = {
  zonesFilled: [false, false, false],
  runNo: 0,
  run: null,            // 当前 sim run
  mode: 'idle',         // idle | running | paused | done | replay
  acc: 0,
  lastTs: 0,
  replayIdx: 0,
  replayAcc: 0,
  reports: [],
};

function targetZone() {
  return game.zonesFilled.findIndex((f) => !f);
}

function readParams() {
  return {
    k: parseFloat(document.getElementById('inK').value),
    c: parseFloat(document.getElementById('inC').value),
    angle: parseFloat(document.getElementById('inA').value),
  };
}

function setBanner(cls, text) {
  banner.className = 'banner ' + cls;
  banner.textContent = text;
}

function fmt(v, n) { return Number(v).toFixed(n); }

// ---------- 主循环：固定步长累加器，暂停/单步/恢复物理一致 ----------
function frame(ts) {
  requestAnimationFrame(frame);
  if (!game.lastTs) game.lastTs = ts;
  let elapsed = (ts - game.lastTs) / 1000;
  game.lastTs = ts;
  if (elapsed > 0.25) elapsed = 0.25;

  if (game.mode === 'running' && game.run) {
    game.acc += elapsed;
    while (game.acc >= SIM.dt && !game.run.done) {
      stepRun(game.run);
      game.acc -= SIM.dt;
    }
    if (game.run.done) onRunDone();
  } else if (game.mode === 'replay' && game.run) {
    game.replayAcc += elapsed;
    const stepT = SIM.dt * 4; // 每渲染帧前进 4 个物理步
    while (game.replayAcc >= stepT) {
      game.replayAcc -= stepT;
      game.replayIdx = Math.min(game.replayIdx + 4, game.run.frames.length - 1);
    }
    if (game.replayIdx >= game.run.frames.length - 1) {
      game.mode = 'done';
      syncButtons();
      setBanner(game.run.result === 'zone' ? 'run' : 'fail', '回放结束 — ' + resultText(game.run));
    }
  }
  render();
}

function onRunDone() {
  game.mode = 'done';
  const r = game.run;
  game.replayIdx = r.frames.length - 1;
  if (r.result === 'zone') {
    game.zonesFilled[r.targetZone] = true;
  }
  addReport(r);
  syncZoneChips();
  if (game.zonesFilled.every(Boolean)) {
    setBanner('win', '成功！三个收集区全部命中。最终报告见右侧面板。');
    addFinalReport();
  } else if (r.result === 'zone') {
    setBanner('run', SIM.zones[r.targetZone].label + ' 命中！继续下一球。');
  } else {
    const f = r.fault;
    setBanner('fail', '失败 — ' + f.label + '｜t=' + fmt(f.t, 2) + 's｜位置 (' + fmt(f.x, 2) + ', ' + fmt(f.y, 2) + ') m');
  }
  syncButtons();
}

function resultText(r) {
  if (r.result === 'zone') return '命中 ' + SIM.zones[r.targetZone].label;
  return r.fault ? r.fault.label : '未命中';
}

// ---------- 坐标变换 ----------
function wx(x) { return ORIGIN_X + x * SCALE; }
function wy(y) { return GROUND_Y - y * SCALE; }

function curFrame() {
  const r = game.run;
  if (!r || r.frames.length === 0) return null;
  if (game.mode === 'replay' || game.mode === 'done') {
    return r.frames[Math.min(game.replayIdx, r.frames.length - 1)];
  }
  return r.frames[r.frames.length - 1];
}

function frameCount() {
  const r = game.run;
  if (!r) return 0;
  if (game.mode === 'replay' || game.mode === 'done') {
    return Math.min(game.replayIdx + 1, r.frames.length);
  }
  return r.frames.length;
}

// ---------- 世界渲染 ----------
function render() {
  wctx.clearRect(0, 0, worldCv.width, worldCv.height);
  drawStatic();
  const r = game.run;
  if (r) {
    drawTrajectory(r);
    drawRamp(r);
    const f = curFrame();
    if (f) {
      drawBall(f);
      if (game.mode !== 'running') drawForces(f, r);
    }
    if (r.fault && r.done) drawFaultMarker(r.fault);
  } else {
    drawRamp(null);
  }
  drawHud();
  renderChart();
  syncGauges();
}

function drawStatic() {
  // 地面
  wctx.strokeStyle = '#3a4c66';
  wctx.lineWidth = 2;
  wctx.beginPath();
  wctx.moveTo(0, GROUND_Y);
  wctx.lineTo(worldCv.width, GROUND_Y);
  wctx.stroke();
  // 安全边界
  wctx.strokeStyle = 'rgba(255,110,110,0.7)';
  wctx.setLineDash([6, 6]);
  wctx.beginPath();
  wctx.moveTo(wx(SIM.worldWidth), 10);
  wctx.lineTo(wx(SIM.worldWidth), GROUND_Y);
  wctx.stroke();
  wctx.setLineDash([]);
  wctx.fillStyle = '#ff8a8a';
  wctx.font = '12px sans-serif';
  wctx.fillText('安全边界 x=' + SIM.worldWidth + 'm', wx(SIM.worldWidth) - 118, 24);
  // 收集区
  const tgt = targetZone();
  SIM.zones.forEach((z, i) => {
    const x0 = wx(z.x0), x1 = wx(z.x1);
    const filled = game.zonesFilled[i];
    wctx.fillStyle = filled ? 'rgba(60,180,110,0.35)'
      : i === tgt ? 'rgba(240,207,122,0.30)' : 'rgba(90,120,160,0.18)';
    wctx.fillRect(x0, GROUND_Y - 26, x1 - x0, 26);
    wctx.strokeStyle = filled ? '#3cb46e' : i === tgt ? '#f0cf7a' : '#4a5f7d';
    wctx.strokeRect(x0, GROUND_Y - 26, x1 - x0, 26);
    wctx.fillStyle = filled ? '#7fd4a8' : i === tgt ? '#f0cf7a' : '#8fa3bd';
    wctx.font = '12px sans-serif';
    wctx.fillText(z.label + (filled ? ' ✓' : i === tgt ? ' ←目标' : ''), x0 + 4, GROUND_Y - 32);
  });
}

function drawRamp(r) {
  const angle = r ? r.params.angle : readParams().angle;
  const th = (angle * Math.PI) / 180;
  const x0 = wx(SIM.pivot.x), y0 = wy(SIM.pivot.y);
  const x1 = wx(SIM.pivot.x + SIM.rampLength * Math.cos(th));
  const y1 = wy(SIM.pivot.y + SIM.rampLength * Math.sin(th));
  const broken = r && r.fault && r.fault.type === 'load';
  // 弹簧（轨道连接）
  wctx.strokeStyle = broken ? '#ff6e6e' : '#7fd4a8';
  wctx.lineWidth = 2;
  wctx.beginPath();
  const coils = 8, sx = wx(SIM.pivot.x - 1.0), sy = wy(SIM.pivot.y);
  wctx.moveTo(sx, sy);
  for (let i = 1; i <= coils; i++) {
    const cx = sx + ((x0 - sx) * i) / coils;
    wctx.lineTo(cx, sy + (i % 2 === 0 ? 0 : i === coils ? 0 : 8));
  }
  wctx.stroke();
  if (broken) {
    wctx.fillStyle = '#ff6e6e';
    wctx.font = '12px sans-serif';
    wctx.fillText('连接断开!', sx - 6, sy - 12);
  }
  // 轨道门
  wctx.strokeStyle = broken ? 'rgba(160,90,90,0.6)' : '#9fc2ec';
  wctx.lineWidth = 5;
  wctx.beginPath();
  wctx.moveTo(x0, y0);
  wctx.lineTo(x1, y1);
  wctx.stroke();
  // 铰接点
  wctx.fillStyle = '#5a7396';
  wctx.beginPath();
  wctx.arc(x0, y0, 5, 0, Math.PI * 2);
  wctx.fill();
}

function drawTrajectory(r) {
  const n = frameCount();
  if (n < 2) return;
  wctx.strokeStyle = 'rgba(127,212,168,0.55)';
  wctx.lineWidth = 1.5;
  wctx.beginPath();
  wctx.moveTo(wx(r.frames[0].x), wy(r.frames[0].y));
  for (let i = 4; i < n; i += 4) {
    wctx.lineTo(wx(r.frames[i].x), wy(r.frames[i].y));
  }
  const last = r.frames[n - 1];
  wctx.lineTo(wx(last.x), wy(last.y));
  wctx.stroke();
}

function drawBall(f) {
  wctx.fillStyle = '#ffd166';
  wctx.beginPath();
  wctx.arc(wx(f.x), wy(f.y), SIM.ballRadius * SCALE, 0, Math.PI * 2);
  wctx.fill();
  wctx.strokeStyle = '#8a6d1f';
  wctx.lineWidth = 1;
  wctx.stroke();
}

function arrow(x0, y0, dx, dy, color, label) {
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  wctx.strokeStyle = color;
  wctx.fillStyle = color;
  wctx.lineWidth = 2;
  wctx.beginPath();
  wctx.moveTo(x0, y0);
  wctx.lineTo(x0 + dx, y0 + dy);
  wctx.stroke();
  const ux = dx / len, uy = dy / len;
  const tx = x0 + dx, ty = y0 + dy;
  wctx.beginPath();
  wctx.moveTo(tx, ty);
  wctx.lineTo(tx - 8 * ux + 4 * uy, ty - 8 * uy - 4 * ux);
  wctx.lineTo(tx - 8 * ux - 4 * uy, ty - 8 * uy + 4 * ux);
  wctx.closePath();
  wctx.fill();
  wctx.font = '11px sans-serif';
  wctx.fillText(label, tx + 6, ty - 4);
}

// 暂停 / 单步 / 回放时展示受力
function drawForces(f, r) {
  const bx = wx(f.x), by = wy(f.y);
  const th = (r.params.angle * Math.PI) / 180;
  const fx = Math.cos(th), fy = -Math.sin(th); // 屏幕 y 向下
  if (f.phase === 'ramp') {
    const kSpring = 0.35;
    arrow(bx, by, fx * f.load * kSpring, fy * f.load * kSpring, '#7fd4a8', '弹簧力 ' + fmt(f.load, 1) + 'N');
    if (f.damp > 0.01) {
      arrow(bx, by, -fx * f.damp * kSpring, -fy * f.damp * kSpring, '#f0a35e', '阻尼 ' + fmt(f.damp, 1) + 'N');
    }
  }
  const gLen = SIM.mass * SIM.g * 0.35;
  arrow(bx, by, 0, gLen, '#9aa7b8', '重力 ' + fmt(SIM.mass * SIM.g, 1) + 'N');
}

function drawFaultMarker(fault) {
  const x = wx(fault.x), y = wy(fault.y);
  wctx.strokeStyle = '#ff5c5c';
  wctx.lineWidth = 3;
  wctx.beginPath();
  wctx.moveTo(x - 9, y - 9); wctx.lineTo(x + 9, y + 9);
  wctx.moveTo(x + 9, y - 9); wctx.lineTo(x - 9, y + 9);
  wctx.stroke();
  wctx.fillStyle = '#ff8a8a';
  wctx.font = '12px sans-serif';
  wctx.fillText('故障点: ' + fault.label + ' (t=' + fmt(fault.t, 2) + 's)', x + 14, y - 12);
}

function drawHud() {
  const r = game.run;
  wctx.fillStyle = '#9fb4cc';
  wctx.font = '13px sans-serif';
  const modeText = { idle: '待机', running: '运行中', paused: '已暂停', done: '已结束', replay: '回放中' }[game.mode];
  let txt = '状态: ' + modeText + '｜第 ' + (game.runNo + (r ? 1 : 0)) + ' 球';
  if (r) {
    const f = curFrame();
    txt += '｜t=' + fmt(f ? f.t : 0, 2) + 's｜阶段=' + (f && f.phase === 'flight' ? '飞行' : '轨道');
  }
  wctx.fillText(txt, 14, 22);
}

// ---------- 趋势图：速度/负载/温度/压力，按各自上限归一化 ----------
const CHART_SERIES = [
  { key: 'speed',    label: '速度',   color: '#7fd4a8', lim: () => SIM.limits.speed },
  { key: 'load',     label: '负载',   color: '#f0cf7a', lim: () => SIM.limits.load },
  { key: 'temp',     label: '温度',   color: '#ff9a9a', lim: () => SIM.limits.temp },
  { key: 'pressure', label: '压力',   color: '#c39bff', lim: () => SIM.limits.pressure },
];

function renderChart() {
  cctx.clearRect(0, 0, chartCv.width, chartCv.height);
  const padL = 44, padR = 10, padT = 18, padB = 16;
  const W = chartCv.width - padL - padR;
  const H = chartCv.height - padT - padB;
  const r = game.run;

  // 限值线（归一化 100%）
  cctx.strokeStyle = 'rgba(255,110,110,0.6)';
  cctx.setLineDash([5, 5]);
  cctx.beginPath();
  cctx.moveTo(padL, padT);
  cctx.lineTo(padL + W, padT);
  cctx.stroke();
  cctx.setLineDash([]);
  cctx.fillStyle = '#ff8a8a';
  cctx.font = '11px sans-serif';
  cctx.fillText('上限 100%', 4, padT + 4);
  cctx.strokeStyle = '#2c3a4f';
  cctx.strokeRect(padL, padT, W, H);

  if (!r || r.frames.length < 2) {
    cctx.fillStyle = '#7789a0';
    cctx.fillText('趋势图：发射后显示速度 / 负载 / 温度 / 压力变化', padL + 12, padT + H / 2);
    return;
  }
  const n = r.frames.length;
  const tMax = r.frames[n - 1].t || SIM.dt;
  const xOf = (i) => padL + (r.frames[i].t / tMax) * W;
  const yOf = (v, lim) => padT + H - Math.min(v / lim, 1.15) / 1.15 * H;

  CHART_SERIES.forEach((s) => {
    cctx.strokeStyle = s.color;
    cctx.lineWidth = 1.5;
    cctx.beginPath();
    const lim = s.lim();
    for (let i = 0; i < n; i += 2) {
      const x = xOf(i), y = yOf(r.frames[i][s.key], lim);
      if (i === 0) cctx.moveTo(x, y); else cctx.lineTo(x, y);
    }
    cctx.stroke();
  });

  // 图例
  let lx = padL + 10;
  CHART_SERIES.forEach((s) => {
    cctx.fillStyle = s.color;
    cctx.fillText(s.label, lx, chartCv.height - 4);
    lx += 52;
  });

  // 暂停/回放游标
  if (game.mode !== 'running' && game.mode !== 'idle') {
    const f = curFrame();
    if (f) {
      const cx = padL + (f.t / tMax) * W;
      cctx.strokeStyle = 'rgba(255,255,255,0.5)';
      cctx.beginPath();
      cctx.moveTo(cx, padT);
      cctx.lineTo(cx, padT + H);
      cctx.stroke();
    }
  }
}

// ---------- 实时读数 ----------
function syncGauges() {
  const r = game.run;
  const f = curFrame();
  const vals = {
    gSpeed: f ? fmt(f.speed, 2) : '0.00',
    gLoad: f ? fmt(f.load, 1) : '0.0',
    gTemp: f ? fmt(f.temp, 1) : fmt(SIM.ambient, 1),
    gPress: f ? fmt(f.pressure, 0) : '0',
  };
  Object.keys(vals).forEach((id) => { document.getElementById(id).textContent = vals[id]; });
  document.getElementById('lSpeed').textContent = '≤ ' + SIM.limits.speed;
  document.getElementById('lLoad').textContent = '≤ ' + SIM.limits.load;
  document.getElementById('lTemp').textContent = '≤ ' + SIM.limits.temp;
  document.getElementById('lPress').textContent = '≤ ' + SIM.limits.pressure;
  if (f) {
    document.getElementById('gSpeed').className = f.speed > SIM.limits.speed ? 'over' : '';
    document.getElementById('gLoad').className = f.load > SIM.limits.load ? 'over' : '';
    document.getElementById('gTemp').className = f.temp > SIM.limits.temp ? 'over' : '';
    document.getElementById('gPress').className = f.pressure > SIM.limits.pressure ? 'over' : '';
  }
}

// ---------- 报告 ----------
function addReport(r) {
  game.runNo += 1;
  const entry = {
    no: game.runNo,
    params: { ...r.params },
    result: r.result,
    target: r.targetZone,
    peaks: { ...r.peaks },
    fault: r.fault ? { ...r.fault } : null,
    landedX: r.landedX,
  };
  game.reports.push(entry);
  renderReports();
}

function addFinalReport() {
  const okRuns = game.reports.filter((e) => e.result === 'zone');
  const div = document.createElement('div');
  div.className = 'entry ok';
  div.innerHTML = '<b>最终报告：三球全部入区 ✓</b><br>' +
    '总发射 ' + game.reports.length + ' 次，成功 ' + okRuns.length + ' 次<br>' +
    game.reports.map((e) =>
      '#' + e.no + ' 峰值 v=' + fmt(e.peaks.speed, 1) + 'm/s F=' + fmt(e.peaks.load, 0) +
      'N T=' + fmt(e.peaks.temp, 0) + '°C P=' + fmt(e.peaks.pressure, 0) + 'Pa'
    ).join('<br>');
  document.getElementById('report').prepend(div);
}

function renderReports() {
  const box = document.getElementById('report');
  box.innerHTML = '';
  if (game.reports.length === 0) {
    box.textContent = '暂无记录';
    return;
  }
  [...game.reports].reverse().forEach((e) => {
    const div = document.createElement('div');
    div.className = 'entry ' + (e.result === 'zone' ? 'ok' : 'bad');
    let html = '<b>第 ' + e.no + ' 球</b> → 目标 ' + SIM.zones[e.target].label +
      '｜k=' + e.params.k + ' c=' + e.params.c + ' θ=' + e.params.angle + '°<br>' +
      '<span class="peak-line">峰值: v=' + fmt(e.peaks.speed, 2) + 'm/s｜F=' + fmt(e.peaks.load, 1) +
      'N｜T=' + fmt(e.peaks.temp, 1) + '°C｜P=' + fmt(e.peaks.pressure, 0) + 'Pa</span><br>';
    if (e.result === 'zone') {
      html += '结果: 命中（落点 x=' + fmt(e.landedX, 2) + 'm）';
    } else if (e.fault) {
      html += '<span class="fault-line">首次越限: ' + e.fault.label +
        '｜t=' + fmt(e.fault.t, 2) + 's｜位置 (' + fmt(e.fault.x, 2) + ', ' + fmt(e.fault.y, 2) + ')m</span>';
      if (e.fault.type === 'miss' && e.landedX !== undefined) {
        html += '<br>落点 x=' + fmt(e.landedX, 2) + 'm';
      }
    }
    div.innerHTML = html;
    box.appendChild(div);
  });
}

// ---------- 控制 ----------
function syncButtons() {
  const m = game.mode;
  document.getElementById('btnLaunch').disabled = m === 'running' || m === 'replay' || targetZone() === -1;
  document.getElementById('btnPause').disabled = m !== 'running';
  document.getElementById('btnStep').disabled = m !== 'paused';
  document.getElementById('btnResume').disabled = m !== 'paused';
  document.getElementById('btnReplay').disabled = !(m === 'done' || m === 'paused') || !game.run || game.run.frames.length === 0;
}

function syncZoneChips() {
  const box = document.getElementById('zones');
  box.innerHTML = '';
  const tgt = targetZone();
  SIM.zones.forEach((z, i) => {
    const d = document.createElement('div');
    d.className = 'zone-chip' + (game.zonesFilled[i] ? ' filled' : i === tgt ? ' target' : '');
    d.textContent = z.label + (game.zonesFilled[i] ? ' ✓' : '');
    box.appendChild(d);
  });
}

function doLaunch() {
  if (targetZone() === -1) return;
  game.run = createRun(readParams(), targetZone());
  game.mode = 'running';
  game.acc = 0;
  game.replayIdx = 0;
  setBanner('run', '第 ' + (game.runNo + 1) + ' 球发射！目标：' + SIM.zones[targetZone()].label);
  syncButtons();
}

function doPause() {
  if (game.mode !== 'running') return;
  game.mode = 'paused';
  setBanner('pause', '已暂停 — 可单步查看受力，或恢复继续');
  syncButtons();
}

function doStep() {
  if (game.mode !== 'paused' || !game.run) return;
  for (let i = 0; i < 4 && !game.run.done; i++) stepRun(game.run); // 单步 = 1/60s
  if (game.run.done) { onRunDone(); return; }
  const f = game.run.frames[game.run.frames.length - 1];
  setBanner('pause', '单步中 — t=' + fmt(f.t, 3) + 's v=' + fmt(f.speed, 2) + 'm/s F=' + fmt(f.load, 1) + 'N');
}

function doResume() {
  if (game.mode !== 'paused') return;
  game.mode = 'running';
  setBanner('run', '继续运行');
  syncButtons();
}

function doReplay() {
  if (!game.run || game.run.frames.length === 0) return;
  game.mode = 'replay';
  game.replayIdx = 0;
  game.replayAcc = 0;
  setBanner('pause', '回放中 — 展示轨迹、受力与趋势（与首次运行完全一致）');
  syncButtons();
}

function doReset() {
  // 初始条件由常量重建，重复重置不会漂移
  game.run = null;
  game.mode = 'idle';
  game.acc = 0;
  game.replayIdx = 0;
  setBanner('idle', '已重置 — 初始位置与资源恢复，调整参数后重新发射');
  syncButtons();
}

function doNewGame() {
  game.zonesFilled = [false, false, false];
  game.runNo = 0;
  game.reports = [];
  doReset();
  renderReports();
  setBanner('idle', '新游戏 — 让小球依次落入三个收集区');
}

// ---------- 初始化 ----------
function initSliders() {
  const map = { inK: 'k', inC: 'c', inA: 'angle' };
  const labels = { inK: 'valK', inC: 'valC', inA: 'valA' };
  Object.keys(map).forEach((id) => {
    const range = SIM.paramRanges[map[id]];
    const el = document.getElementById(id);
    el.min = range.min; el.max = range.max;
    el.step = map[id] === 'c' ? 0.1 : 1;
    el.value = range.def;
    const show = () => { document.getElementById(labels[id]).textContent = el.value; };
    el.addEventListener('input', show);
    show();
  });
}

document.getElementById('btnLaunch').addEventListener('click', doLaunch);
document.getElementById('btnPause').addEventListener('click', doPause);
document.getElementById('btnStep').addEventListener('click', doStep);
document.getElementById('btnResume').addEventListener('click', doResume);
document.getElementById('btnReplay').addEventListener('click', doReplay);
document.getElementById('btnReset').addEventListener('click', doReset);
document.getElementById('btnNew').addEventListener('click', doNewGame);

initSliders();
syncZoneChips();
syncButtons();
requestAnimationFrame(frame);
