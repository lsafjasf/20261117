/* UI:Canvas 渲染 + 声音 + 控制面板 */
(function () {
'use strict';
var BS = window.BottleSim;
var sim = new BS.Sim();
var cv = document.getElementById('cv');
var ctx = cv.getContext('2d');
var FILL_X = BS.FILL_X, FILL_HALF = BS.FILL_HALF, BELT_Y = BS.BELT_Y;

/* ================= 渲染 ================= */
function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  var spec = sim.spec();
  var dev = sim.devices;

  // 振动盘
  var bx = 130, by = 120, br = 70;
  ctx.strokeStyle = dev.vib.on ? '#3fa66f' : '#46566a';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#1a2230';
  ctx.beginPath(); ctx.arc(bx, by, br - 3, 0, Math.PI * 2); ctx.fill();
  var nPills = Math.min(36, Math.floor(sim.cache / 4));
  ctx.fillStyle = '#e8c56a';
  for (var i = 0; i < nPills; i++) {
    var a = i * 2.399 + (dev.vib.on && !sim.paused ? sim.time * (1 + dev.vib.level / 40) : 0);
    var rr = 12 + (i * 37 % (br - 22));
    var jx = dev.vib.on && !sim.paused ? Math.sin(sim.time * 30 + i) * dev.vib.level / 40 : 0;
    ctx.beginPath();
    ctx.arc(bx + Math.cos(a) * rr + jx, by + Math.sin(a) * rr, spec.pillR, 0, Math.PI * 2);
    ctx.fill();
  }
  label(bx, by + br + 16, '振动盘 ' + (dev.vib.on ? 'ON ' + dev.vib.level : 'OFF'), dev.vib.on ? '#3fa66f' : '#8a97a5');

  // 缓存槽
  var cx = 235, cy0 = 55, cy1 = 185;
  ctx.strokeStyle = '#46566a'; ctx.lineWidth = 2;
  ctx.strokeRect(cx, cy0, 26, cy1 - cy0);
  var ch = (cy1 - cy0 - 4) * Math.min(1, sim.cache / BS.CACHE_CAP);
  ctx.fillStyle = sim.cache < 15 ? '#c05050' : '#7fd4a8';
  ctx.fillRect(cx + 2, cy1 - 2 - ch, 22, ch);
  label(cx + 13, cy1 + 16, '缓存 ' + Math.floor(sim.cache), '#8fb8d8');

  // 供料管(缓存 -> 落料闸)
  ctx.strokeStyle = '#2c3846'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(cx + 26, 90); ctx.lineTo(FILL_X, 150); ctx.stroke();
  if (dev.vib.on && !sim.paused && !sim.fault) {
    ctx.fillStyle = '#e8c56a';
    for (var f = 0; f < 5; f++) {
      var t = (sim.time * 0.7 + f / 5) % 1;
      ctx.beginPath();
      ctx.arc(cx + 26 + (FILL_X - cx - 26) * t, 90 + 60 * t, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 落料闸
  var gy = 168;
  ctx.fillStyle = dev.gate.on ? '#3fa66f' : '#5a6a7a';
  var gap = dev.gate.on ? 6 + dev.gate.level / 8 : 2;
  ctx.fillRect(FILL_X - 26, gy, 26 - gap, 10);
  ctx.fillRect(FILL_X + gap, gy, 26 - gap, 10);
  label(FILL_X, gy - 8, '落料闸 ' + (dev.gate.on ? 'ON ' + dev.gate.level : 'OFF'), dev.gate.on ? '#3fa66f' : '#8a97a5');

  // 下落通道
  ctx.strokeStyle = '#22303f'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(FILL_X - 14, 180); ctx.lineTo(FILL_X - 14, BELT_Y - 30);
  ctx.moveTo(FILL_X + 14, 180); ctx.lineTo(FILL_X + 14, BELT_Y - 30); ctx.stroke();

  // 下落药片
  ctx.fillStyle = '#e8c56a';
  for (var p = 0; p < sim.falling.length; p++) {
    ctx.beginPath();
    ctx.arc(FILL_X, sim.falling[p].y, spec.pillR, 0, Math.PI * 2);
    ctx.fill();
  }
  drawBeltAndBottles(spec, dev);
  drawGauges(spec);
  if (sim.fault) {
    ctx.fillStyle = 'rgba(122,35,35,0.85)';
    ctx.fillRect(220, 8, 480, 34);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('故障停机 [' + sim.fault.pos + '] ' + sim.fault.detail, 460, 30);
  }
}

function label(x, y, text, color) {
  ctx.fillStyle = color; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

function drawBeltAndBottles(spec, dev) {
  // 灌装窗口
  ctx.strokeStyle = '#3d5a80'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(FILL_X - FILL_HALF, BELT_Y - 60); ctx.lineTo(FILL_X - FILL_HALF, BELT_Y);
  ctx.moveTo(FILL_X + FILL_HALF, BELT_Y - 60); ctx.lineTo(FILL_X + FILL_HALF, BELT_Y);
  ctx.stroke(); ctx.setLineDash([]);
  label(FILL_X, BELT_Y - 64, '灌装头/计数', '#8fb8d8');

  // 传送带
  ctx.fillStyle = '#1c2530';
  ctx.fillRect(0, BELT_Y, cv.width, 22);
  ctx.strokeStyle = '#2c3846';
  ctx.strokeRect(0, BELT_Y, cv.width, 22);
  ctx.fillStyle = '#46566a';
  var off = sim.convDist % 24;
  for (var sx = -off; sx < cv.width; sx += 24) ctx.fillRect(sx, BELT_Y + 9, 12, 3);
  label(60, BELT_Y + 40, '瓶体传送 ' + (dev.conv.on ? 'ON ' + dev.conv.level : 'OFF'), dev.conv.on ? '#3fa66f' : '#8a97a5');

  // 剔除机构
  ctx.strokeStyle = '#8a5a5a'; ctx.lineWidth = 3;
  var armLen = sim.rejectTimer > 0 ? 34 : 12;
  ctx.beginPath(); ctx.moveTo(720, BELT_Y - 66); ctx.lineTo(720, BELT_Y - 66 + armLen); ctx.stroke();
  label(720, BELT_Y - 72, '剔除', '#c05050');

  // 瓶子与瓶内药片
  for (var i = 0; i < sim.bottles.length; i++) {
    var b = sim.bottles[i];
    var top = BELT_Y - 50 + b.y;
    ctx.globalAlpha = b.alpha;
    ctx.fillStyle = b.judged ? (b.good ? '#1f5c3d' : '#5c2a2a') : '#22303f';
    ctx.strokeStyle = '#6a8caf';
    ctx.lineWidth = 1.5;
    roundRect(b.x - 22, top, 44, 50, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8c56a';
    var shown = Math.min(b.count, spec.target + 3);
    for (var d = 0; d < shown; d++) {
      var col = d % 4, row = Math.floor(d / 4);
      ctx.beginPath();
      ctx.arc(b.x - 13 + col * 9, BELT_Y - 8 + b.y - row * 7, spec.pillR - 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#d7dde4'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText((b.index + 1) + ':' + b.count + '/' + spec.target, b.x, top - 5);
    ctx.globalAlpha = 1;
  }

  // 当前瓶计数
  var cur = sim.currentBottleIndex();
  if (cur >= 0) {
    var cb = null;
    for (var j = 0; j < sim.bottles.length; j++) if (sim.bottles[j].index === cur) cb = sim.bottles[j];
    if (cb) label(FILL_X, BELT_Y + 40, '计数 ' + cb.count + '/' + spec.target, '#e8c56a');
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGauges(spec) {
  var gx = 700, gy = 14;
  bar(gx, gy, '功率 ' + Math.round(sim.power) + 'W', sim.power / 200, '#8fc3e0');
  bar(gx, gy + 24, '卡料 ' + Math.round(sim.jamLevel), sim.jamLevel / BS.JAM_LIMIT, sim.jamLevel > 70 ? '#c05050' : '#e8c56a');
  bar(gx, gy + 48, '缓存 ' + Math.floor(sim.cache), sim.cache / BS.CACHE_CAP, '#7fd4a8');
  ctx.fillStyle = '#9fb3c8'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('能耗 ' + Math.round(sim.energy) + ' J   峰值功率 ' + Math.round(sim.peakPower) + ' W', gx, gy + 88);
  // 批次进度:12 瓶位
  ctx.fillText('批次 ' + sim.judgedCount + '/' + BS.BATCH_SIZE + ' 良品 ' + sim.goodCount, gx, gy + 106);
  for (var i = 0; i < BS.BATCH_SIZE; i++) {
    var b = null;
    for (var j = 0; j < sim.bottles.length; j++) if (sim.bottles[j].index === i) b = sim.bottles[j];
    var color = '#2c3846';
    if (b && b.judged) color = b.good ? '#3fa66f' : '#c05050';
    else if (b) color = '#8fc3e0';
    ctx.fillStyle = color;
    ctx.fillRect(gx + i * 18, gy + 112, 14, 14);
  }
}

function bar(x, y, text, ratio, color) {
  ctx.fillStyle = '#1c2530';
  ctx.fillRect(x, y, 200, 14);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 200 * Math.max(0, Math.min(1, ratio)), 14);
  ctx.strokeStyle = '#46566a'; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, 200, 14);
  ctx.fillStyle = '#d7dde4'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(text, x + 4, y + 11);
}

/* ================= 声音 ================= */
var audio = {
  on: false, ctx: null,
  init: function () {
    if (this.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this.vibOsc = this.ctx.createOscillator();
    this.vibOsc.type = 'sawtooth';
    this.vibGain = this.ctx.createGain();
    this.vibGain.gain.value = 0;
    this.vibOsc.connect(this.vibGain).connect(this.master);
    this.vibOsc.start();
    var len = this.ctx.sampleRate;
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.convSrc = this.ctx.createBufferSource();
    this.convSrc.buffer = buf; this.convSrc.loop = true;
    var lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320;
    this.convGain = this.ctx.createGain();
    this.convGain.gain.value = 0;
    this.convSrc.connect(lp).connect(this.convGain).connect(this.master);
    this.convSrc.start();
  },
  update: function () {
    if (!this.ctx || !this.on) return;
    var dev = sim.devices;
    var running = !sim.paused && !sim.fault;
    var t = this.ctx.currentTime;
    var vibTarget = dev.vib.on && running ? 0.012 + dev.vib.level * 0.00035 : 0;
    this.vibOsc.frequency.setTargetAtTime(42 + dev.vib.level * 1.3, t, 0.05);
    this.vibGain.gain.setTargetAtTime(vibTarget, t, 0.08);
    var convTarget = dev.conv.on && running ? 0.015 + dev.conv.level * 0.0003 : 0;
    this.convGain.gain.setTargetAtTime(convTarget, t, 0.1);
  },
  clack: function () {
    if (!this.ctx || !this.on) return;
    var t = this.ctx.currentTime;
    var osc = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    osc.type = 'square'; osc.frequency.value = 180;
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.13);
  },
  alarm: function () {
    if (!this.ctx || !this.on) return;
    for (var i = 0; i < 2; i++) this.beep(660 - i * 180, 0.16, i * 0.2, 0.2);
  },
  chime: function () {
    if (!this.ctx || !this.on) return;
    this.beep(520, 0.12, 0, 0.15); this.beep(780, 0.18, 0.12, 0.15);
  },
  beep: function (freq, dur, delay, vol) {
    var t = this.ctx.currentTime + delay;
    var osc = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
};

function drainEvents() {
  for (var i = 0; i < sim.events.length; i++) {
    var e = sim.events[i];
    if (e.type === 'reject') audio.clack();
    else if (e.type === 'fault') audio.alarm();
    else if (e.type === 'recover') audio.chime();
    else if (e.type === 'batch') audio.chime();
    if (e.msg) appendLog(e);
  }
  sim.events.length = 0;
}

/* ================= 控制面板 ================= */
var logEl = document.getElementById('log');
var clockEl = document.getElementById('clock');
var stateEl = document.getElementById('simState');
var faultEl = document.getElementById('faultInfo');

function appendLog(e) {
  var li = document.createElement('li');
  li.className = e.type;
  li.textContent = '[' + e.t.toFixed(2) + 's] ' + e.msg;
  logEl.appendChild(li);
  while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

// 规格按钮
var specBtnsEl = document.getElementById('specBtns');
Object.keys(BS.SPECS).forEach(function (key) {
  var b = document.createElement('button');
  b.textContent = BS.SPECS[key].label;
  b.dataset.spec = key;
  b.onclick = function () { sim.setSpec(key); refreshSpecUI(); };
  specBtnsEl.appendChild(b);
});
function refreshSpecUI() {
  var btns = specBtnsEl.querySelectorAll('button');
  btns.forEach(function (b) { b.classList.toggle('active', b.dataset.spec === sim.specKey); });
  var s = sim.spec();
  document.getElementById('specInfo').textContent =
    '目标 ' + s.target + ' 粒/瓶,共 ' + BS.BATCH_SIZE + ' 瓶;切换规格会清空缓存与在制瓶';
}

// 设备开关与滑块
['vib', 'gate', 'conv'].forEach(function (key) {
  var row = document.getElementById('dev-' + key);
  var toggle = row.querySelector('.toggle');
  var slider = row.querySelector('input[type=range]');
  var val = row.querySelector('.val');
  toggle.onclick = function () {
    if (sim.devices[key].on) sim.stopDevice(key, '手动');
    else sim.startDevice(key);
  };
  slider.oninput = function () { sim.setLevel(key, +slider.value); };
  row.dataset.key = key;
});

function refreshDeviceUI() {
  ['vib', 'gate', 'conv'].forEach(function (key) {
    var row = document.getElementById('dev-' + key);
    var d = sim.devices[key];
    var toggle = row.querySelector('.toggle');
    toggle.textContent = d.on ? '停止' : '启动';
    toggle.classList.toggle('on', d.on);
    row.querySelector('.val').textContent = d.level;
    var slider = row.querySelector('input[type=range]');
    if (+slider.value !== d.level) slider.value = d.level;
  });
}

// 顶部按钮
document.getElementById('btnPause').onclick = function () {
  sim.paused = !sim.paused;
  sim.log('device', sim.paused ? '暂停(可检查当前批次)' : '恢复运行,批次继续');
};
document.getElementById('btnStep').onclick = function () { sim.stepOnce(); };
document.getElementById('btnReset').onclick = function () { sim.resetBatch('手动'); };
document.getElementById('btnSound').onclick = function () {
  audio.init();
  audio.on = !audio.on;
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  this.textContent = '声音:' + (audio.on ? '开' : '关');
};
document.getElementById('btnClearFault').onclick = function () { sim.clearFault(); };

// 验证场景
document.querySelectorAll('[data-scn]').forEach(function (btn) {
  btn.onclick = function () { runScenarios([btn.dataset.scn]); };
});
document.getElementById('btnAllScn').onclick = function () {
  runScenarios(['normal', 'overlimit', 'shutdown']);
};
function runScenarios(names) {
  var wasSound = audio.on;
  names.forEach(function (n) { sim.runScenario(n); });
  audio.on = wasSound;
  renderReport();
  drainEvents();
}

// 报告
function renderReport() {
  var names = Object.keys(sim.reports);
  var el = document.getElementById('report');
  if (!names.length) { el.textContent = '尚未运行验证。'; return; }
  var html = '<table><tr><th>流程</th><th>良品</th><th>良品率</th><th>峰值功率</th><th>峰值缓存</th>' +
    '<th>停机原因/触发时刻</th><th>恢复结果</th><th>异常位置</th></tr>';
  names.forEach(function (n) {
    var r = sim.reports[n];
    var faults = r.faults.length ? r.faults.map(function (f) {
      return f.detail + ' @' + f.t + 's(振动' + f.values.vib + '/闸门' + f.values.gate +
        '/传送' + f.values.conv + '/缓存' + f.values.cache + ')';
    }).join('<br>') : '无';
    var rec = r.recoveries.length ? r.recoveries.map(function (x) {
      return x.detail + ' @' + x.t + 's';
    }).join('<br>') : '—';
    var anom = r.anomalies.length ? r.anomalies.map(function (a) {
      return '[' + a.pos + '] 瓶' + (a.bottle + 1) + ' @' + a.t + 's';
    }).join('<br>') : '无';
    html += '<tr><td>' + r.label + '</td><td>' + r.good + '/' + r.total + '</td><td>' +
      r.yieldRate + '%</td><td>' + r.peakPower + 'W</td><td>' + r.peakCache + '</td><td>' +
      faults + '</td><td>' + rec + '</td><td>' + anom + '</td></tr>';
  });
  el.innerHTML = html + '</table>';
}

// 导出
document.getElementById('btnExport').onclick = function () {
  var data = JSON.stringify(sim.buildReport(), null, 2);
  var blob = new Blob([data], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'verification-report.json';
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ================= 主循环 ================= */
var last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= BS.DT) { sim.step(); acc -= BS.DT; }
  drainEvents();
  audio.update();
  clockEl.textContent = sim.time.toFixed(2) + ' s';
  var st = sim.fault ? '故障停机' : sim.paused ? '已暂停' : sim.batchDone ? '批次完成' : '运行中';
  stateEl.textContent = st;
  stateEl.className = 'state' + (sim.fault ? ' fault' : sim.paused ? ' paused' : '');
  faultEl.textContent = sim.fault
    ? sim.fault.detail + ' @' + sim.fault.t + 's(排除后需重新启动设备)'
    : '无故障';
  document.getElementById('btnClearFault').disabled = !sim.fault;
  document.getElementById('btnPause').textContent = sim.paused ? '继续' : '暂停';
  refreshDeviceUI();
  draw();
  requestAnimationFrame(frame);
}
refreshSpecUI();
requestAnimationFrame(frame);
})();
