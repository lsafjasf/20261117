'use strict';
/* global AudioLib, Engine */

const engine = new Engine();
const $ = (id) => document.getElementById(id);

// 听诊点:每台机器 3 个 + 机器间 2 个混合区点
const POINTS = [];
MACHINE_X.forEach((mx, m) => {
  POINTS.push({ x: mx, y: MACHINE_Y - 0.12, m });
  POINTS.push({ x: mx - 0.05, y: MACHINE_Y - 0.05, m });
  POINTS.push({ x: mx + 0.05, y: MACHINE_Y - 0.05, m });
});
POINTS.push({ x: (MACHINE_X[0] + MACHINE_X[1]) / 2, y: MACHINE_Y - 0.08, m: -1 });
POINTS.push({ x: (MACHINE_X[1] + MACHINE_X[2]) / 2, y: MACHINE_Y - 0.08, m: -1 });
let selPoint = 0;

function log(msg) {
  const el = $('log');
  el.textContent += (el.textContent ? '\n' : '') + msg;
  el.scrollTop = el.scrollHeight;
}

/* ---------- 设备图 ---------- */
const cvM = $('cvMachines'), ctxM = cvM.getContext('2d');
let revealed = false;

function drawMachines() {
  const W = cvM.width, H = cvM.height;
  ctxM.clearRect(0, 0, W, H);
  ctxM.fillStyle = '#0b0f15';
  ctxM.fillRect(0, 0, W, H);
  const assign = AudioLib.assignmentFromSeed(engine.params.seed);
  for (let m = 0; m < 3; m++) {
    const x = MACHINE_X[m] * W, y = MACHINE_Y * H;
    ctxM.fillStyle = '#243446';
    ctxM.strokeStyle = '#3d5470';
    ctxM.beginPath(); ctxM.roundRect(x - 70, y - 40, 140, 90, 10);
    ctxM.fill(); ctxM.stroke();
    ctxM.fillStyle = '#9fb8d4';
    ctxM.font = '14px sans-serif';
    ctxM.textAlign = 'center';
    ctxM.fillText('机器 ' + (m + 1), x, y + 70);
    if (revealed) {
      ctxM.fillStyle = '#e8b04a';
      ctxM.fillText(AudioLib.FAULTS[assign[m]], x, y + 5);
    }
  }
  POINTS.forEach((p, i) => {
    const x = p.x * W, y = p.y * H;
    ctxM.beginPath();
    ctxM.arc(x, y, i === selPoint ? 11 : 8, 0, Math.PI * 2);
    ctxM.fillStyle = i === selPoint ? '#e8b04a' : '#31507a';
    ctxM.fill();
    ctxM.strokeStyle = '#0b0f15'; ctxM.stroke();
  });
  // 听诊器图标
  const sp = POINTS[selPoint];
  const sx = sp.x * W, sy = sp.y * H;
  ctxM.strokeStyle = '#e8b04a'; ctxM.lineWidth = 2;
  ctxM.beginPath(); ctxM.moveTo(sx, sy - 11);
  ctxM.quadraticCurveTo(sx + 26, sy - 44, sx + 52, sy - 30);
  ctxM.stroke(); ctxM.lineWidth = 1;
}

cvM.addEventListener('click', (ev) => {
  const r = cvM.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
  let best = 0, bd = 1e9;
  POINTS.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = i; }
  });
  selPoint = best;
  engine.setPoint(POINTS[best]);
  drawMachines();
  log('听诊点 → ' + (POINTS[best].m >= 0 ? '机器 ' + (POINTS[best].m + 1) : '机器间混合区'));
});

/* ---------- 波形与电平 ---------- */
const cvW = $('cvWave'), ctxW = cvW.getContext('2d');
const cvL = $('cvL').getContext('2d'), cvR = $('cvR').getContext('2d');

function drawBar(c, v) {
  c.clearRect(0, 0, 160, 14);
  c.fillStyle = '#1a2432'; c.fillRect(0, 0, 160, 14);
  const w = Math.min(1, v * 3) * 160;
  c.fillStyle = v > 0.3 ? '#d06a4a' : '#4aa06a';
  c.fillRect(0, 0, w, 14);
}

function tick() {
  requestAnimationFrame(tick);
  if (engine.ctx && engine.analyser) {
    const data = new Uint8Array(engine.analyser.fftSize);
    engine.analyser.getByteTimeDomainData(data);
    const W = cvW.width, H = cvW.height;
    ctxW.fillStyle = '#0b0f15'; ctxW.fillRect(0, 0, W, H);
    ctxW.strokeStyle = '#4aa0d0'; ctxW.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * W;
      const y = (data[i] / 255) * H;
      i ? ctxW.lineTo(x, y) : ctxW.moveTo(x, y);
    }
    ctxW.stroke();
    const lv = engine.levels();
    drawBar(cvL, lv.l); drawBar(cvR, lv.r);
    $('txtNodes').textContent = '活动节点: ' + engine.activeNodes();
  } else {
    drawBar(cvL, 0); drawBar(cvR, 0);
  }
}
requestAnimationFrame(tick);

/* ---------- 传输控制 ---------- */
function refreshState() {
  const st = engine.playing ? '播放中' : '已停止';
  const mon = { main: '主输出', bypass: '旁路', mute: '静音' }[engine.params.monitor];
  $('txtState').textContent = '状态: ' + st + ' / ' + mon +
    ' / 单步计数 ' + engine.stepCount;
  const d = $('txtDistort');
  d.textContent = engine.distorted ? '失真中(增益过高)' : '未失真';
  d.className = 'badge ' + (engine.distorted ? 'bad' : 'ok');
}

$('btnPlay').onclick = () => { engine.play(); refreshState(); log('播放'); };
$('btnPause').onclick = () => {
  engine.pause(); refreshState();
  log('暂停:全部声源已停止并断开,活动节点 ' + engine.activeNodes());
};
$('btnReplay').onclick = () => { engine.replay(); refreshState(); log('重播:从头开始'); };
$('btnStep').onclick = () => {
  engine.step(); refreshState();
  log('单步:触发 1 次敲击节拍(累计 ' + engine.stepCount + ')');
};
$('selMonitor').onchange = (e) => {
  engine.setParams({ monitor: e.target.value });
  refreshState();
  log('试听状态 → ' + e.target.selectedOptions[0].text);
};
$('rngLoad').oninput = (e) => {
  const v = parseFloat(e.target.value);
  $('txtLoad').textContent = v.toFixed(2);
  engine.setParams({ load: v });
  if (engine.playing) engine.play(); // 负载改变背景声与节拍,重建声源
  refreshState();
};
$('rngGain').oninput = (e) => {
  const v = parseFloat(e.target.value);
  $('txtGain').textContent = v.toFixed(2);
  engine.setParams({ gain: v });
  refreshState();
};

/* ---------- 诊断 ---------- */
document.querySelectorAll('.diagSel').forEach((sel) => {
  sel.innerHTML = '<option value="-1">未判断</option>' +
    AudioLib.FAULTS.map((f, i) => '<option value="' + i + '">' + f + '</option>').join('');
});

$('btnDiagnose').onclick = () => {
  const assign = AudioLib.assignmentFromSeed(engine.params.seed);
  const sels = [...document.querySelectorAll('.diagSel')];
  const ok = sels.every((s, m) => parseInt(s.value, 10) === assign[m]);
  const v = $('txtVerdict');
  if (ok) {
    v.textContent = '三组诊断全部正确,成功!';
    v.className = 'badge ok';
    revealed = true; drawMachines();
    log('诊断成功:故障分布已揭示');
  } else {
    v.textContent = '诊断有误,继续听诊';
    v.className = 'badge bad';
    log('诊断未全部正确');
  }
};

$('btnNewGame').onclick = () => {
  const seed = Math.floor(Math.random() * 1e9) + 1;
  engine.setParams({ seed });
  document.querySelectorAll('.diagSel').forEach((s) => { s.value = '-1'; });
  $('txtVerdict').textContent = '未提交';
  $('txtVerdict').className = 'badge';
  revealed = false;
  if (engine.playing) engine.play();
  drawMachines();
  log('新一局:故障分布已重新随机(seed=' + seed + ')');
};

/* ---------- 参数保存 / 重载 ---------- */
const LS_KEY = 'stetho.params.v1';

function collectParams() {
  return {
    load: engine.params.load,
    gain: engine.params.gain,
    monitor: engine.params.monitor,
    seed: engine.params.seed,
    point: selPoint,
    diag: [...document.querySelectorAll('.diagSel')].map((s) => s.value),
  };
}

function applyParams(p) {
  engine.setParams({ load: p.load, gain: p.gain, monitor: p.monitor, seed: p.seed });
  selPoint = p.point;
  engine.setPoint(POINTS[selPoint]);
  $('rngLoad').value = p.load; $('txtLoad').textContent = p.load.toFixed(2);
  $('rngGain').value = p.gain; $('txtGain').textContent = p.gain.toFixed(2);
  $('selMonitor').value = p.monitor;
  document.querySelectorAll('.diagSel').forEach((s, i) => { s.value = p.diag[i]; });
  revealed = false;
  drawMachines(); refreshState();
}

$('btnSave').onclick = () => {
  const p = collectParams();
  localStorage.setItem(LS_KEY, JSON.stringify(p));
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'params.json');
  log('参数已保存(localStorage + params.json)');
};

$('btnLoad').onclick = () => {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) { log('无已保存参数'); return; }
  applyParams(JSON.parse(raw));
  log('参数已重载');
};

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- WAV 导出与对比 ---------- */
let lastExport = null;

function fmtA(a) {
  return '时长 ' + a.duration.toFixed(3) + 's / ' + a.channels + 'ch / ' +
    a.sampleRate + 'Hz | 峰值 L ' + a.peakL.toFixed(4) + '@' + a.peakTimeL.toFixed(3) +
    's R ' + a.peakR.toFixed(4) + '@' + a.peakTimeR.toFixed(3) +
    's | 敲击间隔 ' + (a.knockInterval ? a.knockInterval.toFixed(3) + 's' : '无');
}

function compareExport(prev, cur) {
  const eps = 1e-4;
  const rows = [
    ['时长一致', Math.abs(prev.duration - cur.duration) < eps],
    ['声道数一致', prev.channels === cur.channels],
    ['左声道峰值一致', Math.abs(prev.peakL - cur.peakL) < eps],
    ['右声道峰值一致', Math.abs(prev.peakR - cur.peakR) < eps],
    ['左峰时刻一致', Math.abs(prev.peakTimeL - cur.peakTimeL) < 1 / 44100],
    ['右峰时刻一致', Math.abs(prev.peakTimeR - cur.peakTimeR) < 1 / 44100],
  ];
  rows.forEach(([name, ok]) => log('  ' + (ok ? 'PASS' : 'FAIL') + ' ' + name));
  return rows.every((r) => r[1]);
}

$('btnExport').onclick = async () => {
  log('离线渲染 4s WAV...');
  const { wav, analysis } = await engine.exportWav(4);
  downloadBlob(new Blob([wav], { type: 'audio/wav' }), 'diagnosis.wav');
  log('导出完成:' + fmtA(analysis));
  if (lastExport) {
    log('与上次导出对比(重载参数后应全部 PASS):');
    log(compareExport(lastExport, analysis) ? '对比通过' : '对比存在差异');
  }
  lastExport = analysis;
};

/* ---------- 维度自检:左右声道 / 频段 / 节拍 ---------- */
async function renderWith(params, pointIdx, dur = 2, freqs) {
  const savedP = { ...engine.params }, savedPt = engine.point;
  engine.setParams(params);
  engine.setPoint(POINTS[pointIdx]);
  const r = await engine.exportWav(dur, freqs);
  engine.setParams(savedP);
  engine.setPoint(savedPt);
  return r.analysis;
}

$('btnSelfTest').onclick = async () => {
  log('--- 维度自检(离线渲染,确定性) ---');
  // 1) 左右声道:听诊点从机器1移到机器3
  const left = await renderWith({}, 0);
  const right = await renderWith({}, 8);
  const lrL = left.peakL / Math.max(1e-9, left.peakR);
  const lrR = right.peakL / Math.max(1e-9, right.peakR);
  log((lrL > lrR * 1.2 ? 'PASS' : 'FAIL') +
    ' 左右声道:机器1 L/R=' + lrL.toFixed(2) + ' → 机器3 L/R=' + lrR.toFixed(2));
  // 2) 频段:负载改变嗡声频率(52→88Hz 迁移)
  const fLo = AudioLib.humFreq(0.05), fHi = AudioLib.humFreq(0.95);
  const lo = await renderWith({ load: 0.05 }, 0, 2, [fLo, fHi]);
  const hi = await renderWith({ load: 0.95 }, 0, 2, [fLo, fHi]);
  const bandOk = lo.bands[fLo] > lo.bands[fHi] * 1.5 &&
    hi.bands[fHi] > hi.bands[fLo] * 1.5 &&
    hi.bands[fHi] > lo.bands[fHi] * 2;
  log((bandOk ? 'PASS' : 'FAIL') +
    ' 频段:' + fLo + 'Hz带 ' + lo.bands[fLo].toFixed(4) + '→' + hi.bands[fLo].toFixed(4) +
    ',' + fHi + 'Hz带 ' + lo.bands[fHi].toFixed(4) + '→' + hi.bands[fHi].toFixed(4));
  // 3) 节拍:负载改变敲击间隔(在敲击机自身听诊点测量)
  const assign = AudioLib.assignmentFromSeed(engine.params.seed);
  const knockPt = assign.indexOf(1) * 3;
  const kLo = await renderWith({ load: 0.05 }, knockPt, 3);
  const kHi = await renderWith({ load: 0.95 }, knockPt, 3);
  const ivLo = kLo.knockInterval, ivHi = kHi.knockInterval;
  log((ivLo > 0 && ivHi > 0 && Math.abs(ivLo - ivHi) > 0.2 ? 'PASS' : 'FAIL') +
    ' 节拍:敲击间隔 ' + ivLo.toFixed(3) + 's → ' + ivHi.toFixed(3) + 's');
  // 4) 确定性:同参数两次渲染应完全一致(无漂移)
  const a1 = await renderWith({}, 0);
  const a2 = await renderWith({}, 0);
  log((Math.abs(a1.peakL - a2.peakL) < 1e-6 && Math.abs(a1.peakTimeL - a2.peakTimeL) < 1e-6
    ? 'PASS' : 'FAIL') + ' 确定性:两次渲染峰值差 ' +
    Math.abs(a1.peakL - a2.peakL).toExponential(2));
  log('--- 自检结束 ---');
};

/* ---------- 初始化 ---------- */
engine.setPoint(POINTS[selPoint]);
drawMachines();
refreshState();
window.__engine = engine;
log('就绪。点击设备图上的听诊点开始听诊。');
