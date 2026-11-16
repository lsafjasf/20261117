// UI 层:Canvas 渲染 + 控制 + WebAudio 声音
/* global MangroveSim */
'use strict';

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const W = cv.width, H = cv.height;

let sim = null;
let running = false;
let speed = 4;
let acc = 0;
let lastTs = 0;
let lastLogLen = 0;

const $ = id => document.getElementById(id);
const PHASE_NAMES = { steady: '稳态', storm: '风暴(临界)', recovery: '恢复确认期', normal: '常态', done: '已完结' };

function reset() {
  sim = MangroveSim.createSim($('seedInput').value || 'mangrove-42');
  lastLogLen = 0;
  $('logList').innerHTML = '';
  $('evalLabel').classList.add('hidden');
  render(0);
  updatePanel();
}

// ---------- 主循环:1 实时秒 = 1 模拟天 × speed ----------
function frame(ts) {
  requestAnimationFrame(frame);
  if (!sim) return;
  const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  if (running && sim.getState().phase !== 'done') {
    acc += dt * speed * sim.constants.TICKS_PER_DAY;
    while (acc >= 1) { sim.step(); acc -= 1; }
    updatePanel();
  }
  render(ts / 1000);
  updateAudio();
}

// ---------- 指标面板 ----------
function alarmClass(a) { return 'alarm-' + a; }

function updatePanel() {
  const s = sim.getState();
  $('dayLabel').textContent = '第 ' + s.day.toFixed(1) + ' 天 / ' + sim.constants.HORIZON_DAYS;
  const ph = $('phaseLabel');
  ph.textContent = PHASE_NAMES[s.phase] || s.phase;
  ph.className = 'badge' + (s.phase === 'storm' ? ' storm' : s.phase === 'recovery' ? ' recovery' : '');

  $('mWObs').textContent = s.waterObserved.toFixed(2);
  $('mWAct').textContent = s.waterActual.toFixed(2);
  $('mWAlarm').textContent = s.alarm.water;
  $('mWAlarm').className = alarmClass(s.alarm.water);
  // 浊度观测值带少量展示噪声,实际值为真值
  $('mTObs').textContent = (s.turbidity * (1 + (Math.random() - 0.5) * 0.04)).toFixed(0);
  $('mTAct').textContent = s.turbidity.toFixed(0);
  $('mTAlarm').textContent = s.alarm.turbidity;
  $('mTAlarm').className = alarmClass(s.alarm.turbidity);
  $('mWind').textContent = s.wind.toFixed(1);
  const cw = s.channels.reduce((a, c) => a + c.width, 0) / s.channels.length;
  $('mChan').textContent = cw.toFixed(1);

  $('mAlive').textContent = s.aliveCount + ' / ' + s.totalCount;
  $('mSurv').textContent = (s.survivalRate * 100).toFixed(1) + '%';
  $('mSurv').className = s.survivalRate >= sim.constants.SURVIVAL_TARGET ? 'alarm-OK' : 'alarm-CRITICAL';
  $('mDebris').textContent = s.debris.length + ' / ' + s.intercepted;
  $('mBoom').textContent = s.boom.active ? (s.boom.integrity * 100).toFixed(0) + '%' : '未布设/已失效';
  $('curIv').textContent = '当前:' + s.currentIntervention;

  if (s.evaluated) {
    const el = $('evalLabel');
    el.classList.remove('hidden');
    el.classList.add(s.success ? 'ok' : 'storm');
    el.textContent = s.success ? '✔ 九十天存活率达标' : '✘ 九十天存活率未达标';
  }

  const log = sim.getLog();
  for (; lastLogLen < log.length; lastLogLen++) {
    const e = log[lastLogLen];
    const li = document.createElement('li');
    li.className = e.type;
    li.innerHTML = '<span class="d">[第' + e.day.toFixed(1) + '天]</span>' + e.msg;
    $('logList').prepend(li);
  }
}

// ---------- Canvas 渲染 ----------
// 高程(m)→画布 y:0m 在底部上方 60px,每米 220px
function elevToY(e) { return H - 60 - e * 220; }

function render(time) {
  const s = sim ? sim.getState() : null;
  ctx.clearRect(0, 0, W, H);

  // 天空(风暴时变暗)
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  const stormy = s && s.phase === 'storm';
  sky.addColorStop(0, stormy ? '#2c3540' : '#274b63');
  sky.addColorStop(1, stormy ? '#3d4a4a' : '#4a7a8c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 滩涂(含潮沟下切)
  ctx.fillStyle = '#6b543a';
  ctx.beginPath();
  ctx.moveTo(0, elevToY(0.95));
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, elevToY(0.9) + Math.sin(x * 0.01) * 6);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

  if (s) {
    // 潮沟:深色下切水道,宽度随冲刷变化
    for (const c of s.channels) {
      const wpx = c.width * 6;
      ctx.fillStyle = '#3a2f22';
      ctx.beginPath();
      ctx.moveTo(c.x - wpx / 2, elevToY(0.9));
      ctx.lineTo(c.x + wpx / 2, elevToY(0.9));
      ctx.lineTo(c.x + wpx * 0.3, H);
      ctx.lineTo(c.x - wpx * 0.3, H);
      ctx.closePath(); ctx.fill();
    }

    // 水体:水位连续变化
    const wy = elevToY(s.waterActual);
    ctx.fillStyle = stormy ? 'rgba(40,80,95,0.72)' : 'rgba(50,120,150,0.62)';
    ctx.beginPath();
    ctx.moveTo(0, wy);
    for (let x = 0; x <= W; x += 16) {
      ctx.lineTo(x, wy + Math.sin(x * 0.03 + time * 2.2) * (stormy ? 6 : 2.5));
    }
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

    // 拦污带
    if (s.boom.active) {
      ctx.strokeStyle = '#f08c28';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(s.boom.x, wy - 6);
      ctx.lineTo(s.boom.x, H - 20);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f08c28';
      for (let y = wy; y < H - 30; y += 34) {
        ctx.beginPath(); ctx.arc(s.boom.x, y, 4, 0, 7); ctx.fill();
      }
    }

    // 幼苗:绿色小树苗,压弯倾斜,死亡变灰
    for (const sd of s.seedlings) {
      const y = elevToY(sd.elevation);
      ctx.strokeStyle = sd.alive ? (sd.bent ? '#9ab86a' : '#4fae5c') : '#6f6f6f';
      ctx.lineWidth = 2;
      const lean = sd.bent ? 9 : 2;
      const hgt = 14 + sd.health * 10;
      ctx.beginPath();
      ctx.moveTo(sd.x, y);
      ctx.quadraticCurveTo(sd.x + lean * 0.4, y - hgt * 0.6, sd.x + lean, y - hgt);
      ctx.stroke();
      if (sd.alive) {
        ctx.fillStyle = sd.bent ? '#9ab86a' : '#5cc46a';
        ctx.beginPath(); ctx.arc(sd.x + lean, y - hgt, 3.5, 0, 7); ctx.fill();
      }
    }

    // 漂浮物:棕色碎块随水漂移
    ctx.fillStyle = '#8a5a2b';
    for (const d of s.debris) {
      ctx.save();
      ctx.translate(d.x, wy + 4 + Math.sin(d.x * 0.1 + time * 3) * 2);
      ctx.rotate(Math.sin(time + d.x) * 0.3);
      ctx.fillRect(-6, -3, 12, 6);
      ctx.restore();
    }

    // 临界告警横幅
    if (s.alarm.water === 'CRITICAL' || s.alarm.turbidity === 'CRITICAL') {
      ctx.fillStyle = 'rgba(160,30,30,0.85)';
      ctx.fillRect(0, 0, W, 30);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText('⚠ 临界告警:' +
        (s.alarm.water === 'CRITICAL' ? ' 水位超阈值' : '') +
        (s.alarm.turbidity === 'CRITICAL' ? ' 浊度超阈值' : ''), 14, 20);
    }
  }
}

// ---------- 声音:潮水随水位起伏,鸟鸣随天气变化 ----------
let audioCtx = null, tideGain = null, tideFilter = null, soundOn = false;

function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // 白噪声 → 低通 → 潮汐增益
  const len = audioCtx.sampleRate * 2;
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf; src.loop = true;
  tideFilter = audioCtx.createBiquadFilter();
  tideFilter.type = 'lowpass'; tideFilter.frequency.value = 400;
  tideGain = audioCtx.createGain(); tideGain.gain.value = 0;
  src.connect(tideFilter).connect(tideGain).connect(audioCtx.destination);
  src.start();
}

function birdChirp() {
  if (!audioCtx || !soundOn) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  const f = 2200 + Math.random() * 1200;
  osc.frequency.setValueAtTime(f, t0);
  osc.frequency.exponentialRampToValueAtTime(f * 0.7, t0 + 0.12);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.06, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0 + 0.2);
}

let birdTimer = 0;
function updateAudio() {
  if (!audioCtx || !soundOn || !sim) return;
  const s = sim.getState();
  // 潮水音量与滤波随水位连续变化
  const target = 0.02 + s.waterActual * 0.06;
  tideGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.2);
  tideFilter.frequency.setTargetAtTime(250 + s.waterActual * 400 + s.wind * 30,
    audioCtx.currentTime, 0.3);
  // 鸟鸣:平静天气频繁,风暴时沉寂
  birdTimer -= 1 / 60;
  if (birdTimer <= 0) {
    if (s.phase !== 'storm' && Math.random() < 0.5) birdChirp();
    birdTimer = s.phase === 'storm' ? 6 : 1.5 + Math.random() * 4;
  }
}

// ---------- 控件 ----------
$('runBtn').addEventListener('click', () => {
  running = !running;
  $('runBtn').textContent = running ? '⏸ 暂停' : '▶ 连续运行';
});
$('resetBtn').addEventListener('click', () => { reset(); });
$('speedSel').addEventListener('change', e => { speed = +e.target.value; });
$('soundBtn').addEventListener('click', () => {
  if (!audioCtx) initAudio();
  soundOn = !soundOn;
  if (soundOn) audioCtx.resume();
  $('soundBtn').textContent = soundOn ? '🔊 声音开' : '🔇 声音关';
});
document.querySelectorAll('.interventions button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (sim) { sim.applyIntervention(btn.dataset.iv); updatePanel(); }
  });
});

reset();
requestAnimationFrame(frame);
