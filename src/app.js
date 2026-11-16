// UI 胶水层：控件绑定、Canvas 渲染、随挤出机变化的声音。
(function () {
  'use strict';
  var S = window.WireSim;
  var m = S.createMachine();
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), ctx = cv.getContext('2d');
  var lastLogCount = 0;

  // ---- 声音：电机嗡鸣随挤出速度、加热噪声随功率 ----
  var audio = { ctx: null, osc: null, gain: null, noise: null, noiseGain: null };
  function ensureAudio() {
    if (audio.ctx || !$('inSound').checked) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio.ctx = new AC();
    audio.osc = audio.ctx.createOscillator();
    audio.osc.type = 'sawtooth';
    audio.gain = audio.ctx.createGain();
    audio.gain.gain.value = 0;
    audio.osc.connect(audio.gain).connect(audio.ctx.destination);
    audio.osc.start();
    var len = audio.ctx.sampleRate;
    var buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    audio.noise = audio.ctx.createBufferSource();
    audio.noise.buffer = buf; audio.noise.loop = true;
    var filt = audio.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 400;
    audio.noiseGain = audio.ctx.createGain();
    audio.noiseGain.gain.value = 0;
    audio.noise.connect(filt).connect(audio.noiseGain).connect(audio.ctx.destination);
    audio.noise.start();
  }
  function updateAudio() {
    if (!audio.ctx) return;
    var on = $('inSound').checked && m.running && !m.paused && !m.shutdown;
    var t = audio.ctx.currentTime;
    audio.osc.frequency.setTargetAtTime(40 + (m.speed / 120) * 160, t, 0.05);
    audio.gain.gain.setTargetAtTime(on ? 0.015 + (m.speed / 120) * 0.05 : 0, t, 0.1);
    audio.noiseGain.gain.setTargetAtTime(on && m.temp < m.tempTarget ? 0.02 : 0, t, 0.2);
  }
  document.addEventListener('pointerdown', ensureAudio, { once: true });

  // ---- 控件绑定 ----
  $('inSpeed').addEventListener('input', function () { S.setSpeed(m, +this.value); });
  $('inTemp').addEventListener('input', function () { S.setTempTarget(m, +this.value); });
  $('inTension').addEventListener('input', function () { S.setTension(m, +this.value); });
  document.querySelectorAll('[data-spec]').forEach(function (b) {
    b.addEventListener('click', function () { S.selectSpec(m, b.dataset.spec); });
  });
  $('btnPurge').addEventListener('click', function () { S.purge(m); });
  $('btnStart').addEventListener('click', function () { S.start(m); });
  $('btnStop').addEventListener('click', function () { S.stop(m, '手动停机'); });
  $('btnResetFault').addEventListener('click', function () { S.clearShutdown(m); });
  $('btnPause').addEventListener('click', function () {
    if (m.paused) S.resume(m); else S.pause(m);
    this.textContent = m.paused ? '恢复' : '暂停';
  });
  $('btnStep').addEventListener('click', function () {
    if (!m.paused) { S.pause(m); $('btnPause').textContent = '恢复'; }
    S.stepOnce(m);
  });
  $('btnReset').addEventListener('click', function () {
    S.resetBatch(m);
    $('btnPause').textContent = '暂停';
    syncInputs();
  });
  $('btnInspect').addEventListener('click', function () { S.inspect(m); });
  $('btnExport').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(S.exportReport(m), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'batch-report.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  function syncInputs() {
    $('inSpeed').value = m.speed; $('inTemp').value = m.tempTarget; $('inTension').value = m.tension;
  }

  // ---- Canvas 渲染：模头、线材、收线轴、缓存罐 ----
  var reelAngle = 0;
  function draw() {
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    var wireY = H * 0.52;

    // 缓存罐（左）
    ctx.strokeStyle = '#4a5a70'; ctx.lineWidth = 2;
    ctx.strokeRect(30, 60, 70, 200);
    var ph = (m.pool / S.CFG.poolCapacity) * 196;
    ctx.fillStyle = m.pool > 90 ? '#c0453e' : '#d98a3b';
    ctx.fillRect(32, 60 + 198 - ph, 66, ph);
    ctx.fillStyle = '#9fb0c3'; ctx.font = '12px sans-serif';
    ctx.fillText('熔料缓存', 38, 52);
    ctx.fillText(m.pool.toFixed(0) + '/' + S.CFG.poolCapacity, 38, 278);

    // 挤出机螺杆筒
    ctx.fillStyle = '#2c3646';
    ctx.fillRect(110, wireY - 46, 150, 92);
    ctx.strokeStyle = '#4a5a70'; ctx.strokeRect(110, wireY - 46, 150, 92);
    ctx.fillStyle = '#9fb0c3';
    ctx.fillText('挤出机 ' + m.speed + 'rpm', 130, wireY - 54);
    // 螺杆螺线
    ctx.strokeStyle = m.running && m.speed > 0 ? '#7fb5ff' : '#55637a';
    ctx.beginPath();
    for (var x = 0; x < 140; x += 4) {
      var y = wireY + Math.sin(x * 0.25 + m.clock * (m.running ? m.speed * 0.1 : 0)) * 26;
      if (x === 0) ctx.moveTo(115 + x, y); else ctx.lineTo(115 + x, y);
    }
    ctx.stroke();

    // 模头（温度着色）
    var hot = Math.min(1, Math.max(0, (m.temp - 25) / 235));
    ctx.fillStyle = 'rgb(' + Math.round(60 + hot * 195) + ',' + Math.round(70 + (1 - hot) * 60) + ',60)';
    ctx.beginPath();
    ctx.moveTo(260, wireY - 40); ctx.lineTo(310, wireY - 12);
    ctx.lineTo(310, wireY + 12); ctx.lineTo(260, wireY + 40);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9fb0c3';
    ctx.fillText('模头 ' + m.temp.toFixed(0) + '°C (目标' + m.tempTarget + ')', 236, wireY + 62);
    if (m.purging > 0) { ctx.fillStyle = '#d9a13b'; ctx.fillText('清料中…', 268, wireY - 52); }
    if (m.contaminated) { ctx.fillStyle = '#e05252'; ctx.fillText('含旧料!', 268, wireY - 66); }

    // 线材：外径按比例，缺陷段闪烁
    var defective = Object.keys(m.activeDefects).length > 0;
    var odPx = Math.max(2, m.od * 14);
    ctx.lineWidth = odPx;
    ctx.strokeStyle = defective ? (Math.floor(m.clock * 6) % 2 ? '#e05252' : '#d9a13b') : '#e8e4da';
    ctx.beginPath(); ctx.moveTo(310, wireY); ctx.lineTo(760, wireY); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#9fb0c3';
    ctx.fillText('外径 ' + (m.od > 0 ? m.od.toFixed(2) : '--') + 'mm / 目标 ' + m.spec.od + 'mm', 420, wireY - 30);
    if (defective) {
      ctx.fillStyle = '#e05252';
      ctx.fillText('缺陷: ' + Object.keys(m.activeDefects).join('、'), 420, wireY + 44);
    }

    // 收线轴（右）
    var cx = 820, cy = wireY, r = 56;
    reelAngle += m.running && m.speed > 0 && !m.paused ? (m.speed / 120) * 0.3 : 0;
    ctx.strokeStyle = '#4a5a70'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.stroke();
    for (var i = 0; i < 3; i++) {
      var a = reelAngle + i * Math.PI * 2 / 3;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
    }
    ctx.fillStyle = '#9fb0c3'; ctx.font = '12px sans-serif';
    ctx.fillText('收线轴 张力' + m.tension + '%', cx - 46, cy + r + 20);

    // 停机遮罩
    if (m.shutdown) {
      ctx.fillStyle = 'rgba(160,30,30,0.25)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff8a8a'; ctx.font = 'bold 20px sans-serif';
      ctx.fillText('设备停机：' + m.shutdown, W / 2 - 160, 40);
    } else if (m.paused) {
      ctx.fillStyle = '#8fd0ff'; ctx.font = 'bold 16px sans-serif';
      ctx.fillText('已暂停（可检查，按“恢复”继续当前批次）', W / 2 - 170, 30);
    }
    if (m.inspected) {
      ctx.fillStyle = m.success ? '#6fe08a' : '#ff8a8a';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(m.success ? '批次成功：三段全部合格' : '批次失败：存在不良段', W / 2 - 160, H - 20);
    }
  }

  // ---- 状态栏 / 统计 / 日志刷新 ----
  function refreshHud() {
    $('stClock').textContent = m.clock.toFixed(1) + 's';
    $('stSpec').textContent = m.spec.id + ' (' + m.spec.od + 'mm)';
    $('stSeg').textContent = m.segments.length + '/3 段, 当前 ' + m.segLength.toFixed(0) + 'm';
    $('stGood').textContent = m.segments.filter(function (s) { return s.good; }).length;
    $('stEnergy').textContent = m.energy.toFixed(3) + ' kWh';
    $('stPool').textContent = m.pool.toFixed(0);
    var run = $('stRun');
    if (m.shutdown) { run.textContent = '故障停机'; run.className = 'badge bad'; }
    else if (m.paused) { run.textContent = '已暂停'; run.className = 'badge idle'; }
    else if (m.running) { run.textContent = '运行中'; run.className = 'badge ok'; }
    else { run.textContent = '待机'; run.className = 'badge idle'; }
    $('outSpeed').textContent = m.speed + ' rpm';
    $('outTemp').textContent = m.tempTarget + ' °C (实际 ' + m.temp.toFixed(0) + ')';
    $('outTension').textContent = m.tension + ' %';
    $('stats').innerHTML =
      '<span>峰值温度 <b>' + m.peaks.temp + '°C</b></span>' +
      '<span>峰值速度 <b>' + m.peaks.speed + 'rpm</b></span>' +
      '<span>峰值张力 <b>' + m.peaks.tension + '%</b></span>' +
      '<span>峰值功率 <b>' + m.peaks.power + 'kW</b></span>' +
      '<span>外径偏差峰值 <b>' + m.peaks.odDev + 'mm</b></span>' +
      '<span>异常记录 <b>' + m.anomalies.length + '</b></span>';
    var logEl = $('log');
    for (var i = lastLogCount; i < m.events.length; i++) {
      var e = m.events[i];
      var div = document.createElement('div');
      div.className = e.type;
      div.textContent = '[' + e.t.toFixed(1) + 's] ' + e.msg;
      logEl.appendChild(div);
    }
    if (lastLogCount === 0 || m.events.length < lastLogCount) { logEl.innerHTML = ''; lastLogCount = 0; return; }
    lastLogCount = m.events.length;
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---- 主循环：按倍速推进共享仿真时钟 ----
  var acc = 0, last = performance.now();
  function loop(nowMs) {
    var real = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    acc += real * (+$('inWarp').value);
    while (acc >= S.CFG.dt) { S.step(m); acc -= S.CFG.dt; }
    draw();
    refreshHud();
    updateAudio();
    requestAnimationFrame(loop);
  }
  syncInputs();
  requestAnimationFrame(loop);
})();
