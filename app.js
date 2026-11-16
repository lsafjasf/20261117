/* 界面层: Canvas 渲染 + Web Audio 音效 + 控件绑定
 * 仿真逻辑全部在 sim.js, 此处只负责表现与输入。
 */
'use strict';
/* global FillingSim, BEVERAGES, DEVICE_NAMES, CACHE_CAPACITY, BATCH_GOAL */

const $ = (id) => document.getElementById(id);
let sim = new FillingSim('soda');

/* ---------------- 音效: 气阀嘶声 / 冷水机嗡鸣 / 封盖咔哒 ---------------- */
const audio = {
  ctx: null, muted: false, valveGain: null, chillerGain: null, noise: null,
  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // 气阀: 噪声 -> 带通 -> 增益(随压力)
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.8;
    this.valveGain = this.ctx.createGain(); this.valveGain.gain.value = 0;
    src.connect(bp).connect(this.valveGain).connect(this.ctx.destination);
    src.start();
    // 冷水机: 低频嗡鸣
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = 88;
    this.chillerGain = this.ctx.createGain(); this.chillerGain.gain.value = 0;
    osc.connect(this.chillerGain).connect(this.ctx.destination);
    osc.start();
  },
  update() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const flow = sim.devices.valve && !sim.halted && !sim.paused ? sim.params.pressure / 5 : 0;
    this.valveGain.gain.setTargetAtTime(this.muted ? 0 : flow * 0.25, t, 0.1);
    const hum = sim.devices.chiller && !this.muted ? 0.05 : 0;
    this.chillerGain.gain.setTargetAtTime(hum, t, 0.2);
  },
  click() { // 封盖咔哒
    if (!this.ctx || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1500;
    src.connect(hp).connect(g).connect(this.ctx.destination);
    src.start(t, Math.random(), 0.1);
  },
};

/* ---------------- 控件绑定 ---------------- */
const PARAM_LABELS = {
  pressure: (v) => `${v.toFixed(1)} bar`,
  tempSet: (v) => `${v.toFixed(1)} °C`,
  fillSpeed: (v) => `${v.toFixed(0)} 瓶/分`,
  capDelay: (v) => `${v.toFixed(1)} s`,
};

for (const key of Object.keys(PARAM_LABELS)) {
  const el = $(key);
  el.addEventListener('input', () => {
    audio.ensure();
    sim.setParam(key, parseFloat(el.value));
    $(key + '_v').textContent = PARAM_LABELS[key](sim.params[key]);
  });
  $(key + '_v').textContent = PARAM_LABELS[key](sim.params[key]);
}

$('beverage').addEventListener('change', (e) => {
  sim = new FillingSim(e.target.value);
  for (const key of Object.keys(PARAM_LABELS)) {
    $(key).value = sim.params[key];
    $(key + '_v').textContent = PARAM_LABELS[key](sim.params[key]);
  }
  syncDeviceButtons();
  logIndex = 0;
});

const devBox = $('devices');
for (const name of Object.keys(DEVICE_NAMES)) {
  const btn = document.createElement('button');
  btn.id = 'dev_' + name;
  btn.textContent = DEVICE_NAMES[name];
  btn.addEventListener('click', () => {
    audio.ensure();
    sim.setDevice(name, !sim.devices[name]);
    syncDeviceButtons();
  });
  devBox.appendChild(btn);
}
function syncDeviceButtons() {
  for (const name of Object.keys(DEVICE_NAMES)) {
    const btn = $('dev_' + name);
    btn.classList.toggle('active', sim.devices[name]);
    btn.textContent = DEVICE_NAMES[name] + (sim.devices[name] ? ' 运行' : ' 停止');
  }
}
syncDeviceButtons();

$('pauseBtn').addEventListener('click', () => {
  audio.ensure();
  sim.paused ? sim.resume() : sim.pause();
  $('pauseBtn').textContent = sim.paused ? '继续' : '暂停';
});
$('stepBtn').addEventListener('click', () => { audio.ensure(); sim.step(); });
$('resetBtn').addEventListener('click', () => { sim.resetBatch(); });
$('muteBtn').addEventListener('click', () => {
  audio.ensure();
  audio.muted = !audio.muted;
  $('muteBtn').textContent = audio.muted ? '声音:关' : '声音:开';
});
$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(sim.exportReport(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `batch_report_${sim.beverageKey}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ---------------- Canvas 渲染 ---------------- */
const cv = $('cv');
const ctx = cv.getContext('2d');
const CONVEYOR_Y = 330;
const splashes = []; // 喷溅粒子

function drawBottle(x, y, fillRatio, co2, capped, highlight) {
  const w = 26, h = 64;
  ctx.save();
  ctx.translate(x, y);
  // 瓶身
  ctx.strokeStyle = highlight ? '#ffd27f' : '#8fa8c0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 6, -h);
  ctx.lineTo(-w / 2 + 6, -h + 10);
  ctx.quadraticCurveTo(-w / 2, -h + 18, -w / 2, -h + 26);
  ctx.lineTo(-w / 2, 0);
  ctx.lineTo(w / 2, 0);
  ctx.lineTo(w / 2, -h + 26);
  ctx.quadraticCurveTo(w / 2, -h + 18, w / 2 - 6, -h + 10);
  ctx.lineTo(w / 2 - 6, -h);
  ctx.stroke();
  // 液位
  const lh = (h - 8) * Math.max(0, Math.min(1, fillRatio));
  if (lh > 0) {
    ctx.fillStyle = 'rgba(80, 170, 255, 0.45)';
    ctx.fillRect(-w / 2 + 2, -lh - 2, w - 4, lh);
  }
  // 气泡: 数量与 CO2 含量成正比
  const n = Math.round(co2 * 6);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < n; i++) {
    const seed = (i * 37.7 + performance.now() / (90 + i * 13)) % 1;
    const bx = ((i * 53) % (w - 8)) - (w - 8) / 2;
    const by = -2 - ((seed * (lh || 20)) % Math.max(lh, 1));
    if (by < -2 && by > -lh - 2) {
      ctx.beginPath();
      ctx.arc(bx, by, 1 + (i % 3) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 瓶盖
  if (capped) {
    ctx.fillStyle = '#e05c5c';
    ctx.fillRect(-w / 2 + 4, -h - 6, w - 8, 7);
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  const p = sim.params;

  // CO2 气罐
  ctx.fillStyle = '#243247';
  ctx.fillRect(30, 90, 90, 150);
  ctx.strokeStyle = '#3a4c66'; ctx.strokeRect(30, 90, 90, 150);
  ctx.fillStyle = '#7fd4ff';
  ctx.font = '13px sans-serif';
  ctx.fillText('CO2 气罐', 45, 108);
  ctx.fillText(`${p.pressure.toFixed(1)} bar`, 48, 128);
  // 压力表
  ctx.beginPath(); ctx.arc(75, 165, 24, 0, Math.PI * 2); ctx.strokeStyle = '#8fa8c0'; ctx.stroke();
  const ang = Math.PI * 0.75 + (p.pressure / 5) * Math.PI * 1.5;
  ctx.beginPath(); ctx.moveTo(75, 165);
  ctx.lineTo(75 + Math.cos(ang) * 18, 165 + Math.sin(ang) * 18);
  ctx.strokeStyle = p.pressure > 4 ? '#ff8080' : '#7fe0a0'; ctx.stroke();
  ctx.fillStyle = sim.devices.valve ? '#7fe0a0' : '#ff8080';
  ctx.fillText(sim.devices.valve ? '气阀开' : '气阀关', 55, 210);

  // 冷水机
  ctx.fillStyle = '#243247'; ctx.fillRect(30, 260, 90, 60);
  ctx.strokeStyle = '#3a4c66'; ctx.strokeRect(30, 260, 90, 60);
  ctx.fillStyle = '#7fd4ff';
  ctx.fillText('冷水机', 48, 280);
  ctx.fillStyle = sim.temp > 12 ? '#ff8080' : '#9fb2c8';
  ctx.fillText(`液温 ${sim.temp.toFixed(1)}°C`, 42, 300);

  // 输送带
  ctx.strokeStyle = '#3a4c66'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(140, CONVEYOR_Y); ctx.lineTo(880, CONVEYOR_Y); ctx.stroke();
  ctx.lineWidth = 1;

  // 灌装机喷头
  ctx.fillStyle = sim.devices.filler ? '#2f9be8' : '#555';
  ctx.fillRect(190, 210, 16, 46);
  ctx.fillStyle = '#9fb2c8'; ctx.fillText('灌装', 186, 200);

  // 碳酸化区
  ctx.strokeStyle = '#2c3a4e'; ctx.strokeRect(240, 240, 260, 100);
  ctx.fillStyle = '#9fb2c8'; ctx.fillText('碳酸化区', 250, 232);
  sim.pipeline.forEach((b, i) => {
    const bx = 265 + i * 30;
    const ratio = Math.min(1, b.dwell / sim.params.capDelay);
    drawBottle(bx, CONVEYOR_Y - 6, 0.6 + 0.4 * ratio, b.co2, false, false);
  });

  // 缓存区
  ctx.strokeStyle = '#2c3a4e'; ctx.strokeRect(520, 240, 200, 100);
  ctx.fillStyle = sim.cache.length >= CACHE_CAPACITY ? '#ff8080' : '#9fb2c8';
  ctx.fillText(`封盖缓存 ${sim.cache.length}/${CACHE_CAPACITY}`, 530, 232);
  sim.cache.forEach((b, i) => {
    drawBottle(542 + i * 23, CONVEYOR_Y - 6, 1, b.co2, false, false);
  });

  // 封盖机
  ctx.fillStyle = sim.devices.capper ? '#2f9be8' : '#8a3030';
  ctx.fillRect(745, 215, 50, 50);
  ctx.fillStyle = '#9fb2c8'; ctx.fillText('封盖机', 745, 205);
  const lastCapped = sim.bottles[sim.bottles.length - 1];
  if (lastCapped && sim.time - lastCapped.cappedAt < 5) {
    drawBottle(770, CONVEYOR_Y - 6, 1, lastCapped.co2Final, true, !lastCapped.qualified);
  }

  // 成品计数
  ctx.fillStyle = '#7fe0a0'; ctx.font = '15px sans-serif';
  ctx.fillText(`合格 ${sim.qualified}/${BATCH_GOAL}`, 820, 250);
  ctx.fillStyle = '#9fb2c8'; ctx.font = '12px sans-serif';
  ctx.fillText(`已封盖 ${sim.bottles.length}`, 820, 270);

  // 停机横幅
  if (sim.halted) {
    ctx.fillStyle = 'rgba(138,48,48,0.85)';
    ctx.fillRect(300, 120, 300, 40);
    ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
    ctx.fillText(`产线停机: ${sim.haltReason}`, 312, 145);
  }
  if (sim.batchDone) {
    ctx.fillStyle = 'rgba(47,155,232,0.85)';
    ctx.fillRect(300, 60, 300, 40);
    ctx.fillStyle = '#fff';
    ctx.fillText(`批次完成! 良品率 ${(sim.goodRate() * 100).toFixed(1)}%`, 322, 85);
  }

  // 喷溅粒子
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i];
    s.x += s.vx; s.y += s.vy; s.vy += 0.15; s.life--;
    ctx.fillStyle = `rgba(120,190,255,${s.life / 40})`;
    ctx.fillRect(s.x, s.y, 2, 2);
    if (s.life <= 0) splashes.splice(i, 1);
  }
}

/* ---------------- 状态面板 / 事件日志 ---------------- */
function fmtTime(t) {
  const m = Math.floor(t / 60), s = (t % 60).toFixed(1);
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`;
}

function updateStatus() {
  $('clock').textContent = `仿真时钟 ${fmtTime(sim.time)}${sim.paused ? ' (已暂停)' : ''}`;
  $('status').innerHTML = [
    ['合格/目标', `<b>${sim.qualified}</b> / ${BATCH_GOAL}`],
    ['良品率', `<b>${(sim.goodRate() * 100).toFixed(1)}%</b> (${sim.bottles.length}瓶)`],
    ['能耗', `<b>${sim.energyKJ.toFixed(0)}</b> kJ`],
    ['缓存', `<b>${sim.cache.length}</b> / ${CACHE_CAPACITY}`],
    ['液温', `<b>${sim.temp.toFixed(1)}</b> °C`],
    ['峰值压力', `<b>${sim.peaks.maxPressure.toFixed(1)}</b> bar`],
    ['停机次数', `<b>${sim.shutdownReasons.length}</b>`],
    ['状态', sim.halted ? '<b style="color:#ff8080">停机</b>' : sim.batchDone ? '<b>完成</b>' : '<b style="color:#7fe0a0">运行</b>'],
  ].map(([k, v]) => `<span>${k}: ${v}</span>`).join('');
}

let logIndex = 0;
function updateLog() {
  const box = $('log');
  for (; logIndex < sim.events.length; logIndex++) {
    const e = sim.events[logIndex];
    const div = document.createElement('div');
    div.className = 't-' + e.type;
    div.textContent = `[${fmtTime(e.t)}] ${e.msg}`;
    box.appendChild(div);
    if (e.type === 'splash') {
      for (let i = 0; i < 24; i++) {
        splashes.push({ x: 200, y: 260, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3, life: 40 });
      }
    }
    if (e.type === 'bottle_ok' || e.type === 'bottle_defect') audio.click();
  }
  while (box.children.length > 200) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

/* ---------------- 主循环: 固定步长累加器 ---------------- */
let lastTs = 0, acc = 0;
const SIM_DT = 0.05, SPEED = 1;
function frame(ts) {
  if (!lastTs) lastTs = ts;
  acc += Math.min(0.25, (ts - lastTs) / 1000) * SPEED;
  lastTs = ts;
  while (acc >= SIM_DT) { sim.tick(SIM_DT); acc -= SIM_DT; }
  audio.update();
  draw();
  updateStatus();
  updateLog();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
