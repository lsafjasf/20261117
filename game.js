// 浏览器端：输入采集、Canvas 渲染、HUD、回放播放
(function () {
  'use strict';
  var S = window.KiteSim;
  var C = S.CONST;
  var KM = S.KEYMAP;

  var canvas = document.getElementById('main');
  var ctx = canvas.getContext('2d');
  var vf = document.getElementById('viewfinder').getContext('2d');

  var state = S.createState((Math.random() * 1e9) >>> 0);
  var paused = false;
  var debugMode = false;   // 单人调试：允许逐帧步进
  var playback = null;     // 回放播放句柄
  var recordedInputs = []; // 本局输入记录（用于回放与保存）
  var lastReplay = null;   // 上一局回放数据
  var keysDown = {};

  function roleOfKey(code) {
    for (var k in KM.line) if (KM.line[k] === code) return 'line';
    for (var g in KM.gimbal) if (KM.gimbal[g] === code) return 'gimbal';
    return null;
  }

  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (e.repeat) return;
    keysDown[e.code] = true;
    var role = roleOfKey(e.code);
    if (role && !paused && !playback) S.noteActivity(state, role);
    if (e.code === KM.system.pause) togglePause();
    if (e.code === KM.system.restart) doRestart();
    if (e.code === KM.system.debug) toggleDebug();
    if (e.code === KM.system.replay) startPlayback();
    if (e.code === KM.system.step && debugMode && paused) stepOnce();
  });
  document.addEventListener('keyup', function (e) { keysDown[e.code] = false; });

  // 从当前按键集合构建本帧输入；两侧键位互不相交
  function buildInput() {
    var input = { reel: 0, aimX: 0, aimY: 0, shoot: false };
    if (keysDown[KM.line.reelIn]) input.reel += 1;
    if (keysDown[KM.line.reelOut]) input.reel -= 1;
    if (keysDown[KM.gimbal.left]) input.aimX -= 1;
    if (keysDown[KM.gimbal.right]) input.aimX += 1;
    if (keysDown[KM.gimbal.up]) input.aimY += 1;
    if (keysDown[KM.gimbal.down]) input.aimY -= 1;
    if (keysDown[KM.gimbal.shoot]) { input.shoot = true; keysDown[KM.gimbal.shoot] = false; flash(); }
    return input;
  }

  function stepOnce() {
    var input = buildInput();
    recordedInputs.push(input);
    S.step(state, input, S.DT);
    if (state.status !== 'running') finishGame();
  }

  function togglePause() {
    if (playback) return;
    paused = !paused;
    showOverlay(paused ? '已暂停' : '', paused ? '按 P 继续' + (debugMode ? '，按 N 逐帧步进' : '') : '');
  }

  function toggleDebug() {
    debugMode = !debugMode;
    document.getElementById('mode').textContent = debugMode ? '单人调试模式' : '双人模式';
  }

  function doRestart() {
    if (state.log.length || state.events.length) {
      lastReplay = { seed: state.seed, inputs: recordedInputs, events: state.events };
    }
    state = S.restart(state);
    recordedInputs = [];
    paused = false;
    playback = null;
    showOverlay('', '');
  }

  function finishGame() {
    lastReplay = { seed: state.seed, inputs: recordedInputs, events: state.events };
    if (state.status === 'won') showOverlay('任务成功！', '三个测点照片合格，风筝安全收回。按 R 再来一局，按 B 回放。');
    else showOverlay('任务失败', failText(state.failReason) + '。按 R 重开，按 B 回放复盘。');
  }

  function failText(reason) {
    return { timeout: '倒计时结束', stall: '风筝失速坠落', snap: '风筝线崩断', shots: '快门耗尽' }[reason] || reason;
  }

  function showOverlay(title, text) {
    var ov = document.getElementById('overlay');
    document.getElementById('ovTitle').textContent = title;
    document.getElementById('ovText').textContent = text;
    ov.className = title ? 'on' : '';
  }

  function flash() {
    var f = document.getElementById('flash');
    f.style.transition = 'none'; f.style.opacity = 0.7;
    setTimeout(function () { f.style.transition = 'opacity .3s'; f.style.opacity = 0; }, 30);
  }

  // 回放播放：同种子重放记录的输入，锁定实时操作
  function startPlayback() {
    if (!lastReplay || playback) return;
    playback = { seed: lastReplay.seed, inputs: lastReplay.inputs, i: 0 };
    state = S.createState(playback.seed);
    paused = false;
    showOverlay('回放中…', '正在重现双方输入、资源变化与冲突时刻');
  }

  function stepPlayback() {
    if (playback.i >= playback.inputs.length || state.status !== 'running') {
      playback = null;
      showOverlay('回放结束', '按 R 重开新局');
      return;
    }
    var input = playback.inputs[playback.i++];
    if (input.reel) S.noteActivity(state, 'line');
    if (input.aimX || input.aimY || input.shoot) S.noteActivity(state, 'gimbal');
    S.step(state, input, S.DT);
  }

  function saveReplay() {
    var data = lastReplay || { seed: state.seed, inputs: recordedInputs, events: state.events };
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kite-replay-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.getElementById('btnPause').onclick = togglePause;
  document.getElementById('btnRestart').onclick = doRestart;
  document.getElementById('btnDebug').onclick = toggleDebug;
  document.getElementById('btnReplay').onclick = startPlayback;
  document.getElementById('btnSave').onclick = saveReplay;
  document.getElementById('btnDcLine').onclick = function () {
    S.setDisconnected(state, 'line', !state.roles.line.disconnected);
    this.textContent = state.roles.line.disconnected ? '恢复线手连接' : '模拟线手断开';
  };
  document.getElementById('btnDcGimbal').onclick = function () {
    S.setDisconnected(state, 'gimbal', !state.roles.gimbal.disconnected);
    this.textContent = state.roles.gimbal.disconnected ? '恢复云台连接' : '模拟云台断开';
  };

  // 世界坐标 -> 画布坐标
  function wx(x) { return 40 + (x / 560) * 560; }
  function wy(alt) { return 470 - (alt / 130) * 420; }

  function drawScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 天空与风
    var grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#0b1a2b'); grad.addColorStop(1, '#16324a');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(143,211,255,.25)';
    for (var i = 0; i < 5; i++) {
      var wyLine = 60 + i * 70 + Math.sin(state.t * 0.8 + i) * 8;
      ctx.beginPath(); ctx.moveTo(30, wyLine);
      ctx.quadraticCurveTo(300, wyLine - 14 * state.windNorm, 590, wyLine);
      ctx.stroke();
    }
    // 地形
    ctx.fillStyle = '#1d3325';
    ctx.beginPath(); ctx.moveTo(0, 500);
    for (var x = 0; x <= 620; x += 20) ctx.lineTo(x, 470 + Math.sin(x * 0.02) * 12);
    ctx.lineTo(620, 520); ctx.lineTo(0, 520); ctx.fill();
    // 测点
    state.points.forEach(function (p) {
      var px = wx(p.x);
      ctx.fillStyle = p.photographed ? '#7ee2a8' : '#ffd166';
      ctx.beginPath(); ctx.arc(px, 478, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0d141f';
      ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.photographed ? '✓' : p.name.slice(-1), px, 482);
      ctx.fillStyle = '#9fb0c8';
      ctx.fillText(p.alt[0] + '-' + p.alt[1] + 'm', px, 505);
    });
    // 风筝线（带垂坠曲线）
    var anchorX = wx(150), anchorY = 478;
    var kx = wx(state.kite.x), ky = wy(state.kite.alt);
    var sag = 30 * (1 - Math.min(1, state.line.tension));
    ctx.strokeStyle = state._warnSlack ? '#ff8a7a' : (state._warnStrain ? '#ffd166' : '#c8d6e8');
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(anchorX, anchorY);
    ctx.quadraticCurveTo((anchorX + kx) / 2, (anchorY + ky) / 2 + sag, kx, ky);
    ctx.stroke();
    ctx.lineWidth = 1;
    // 风筝
    ctx.save(); ctx.translate(kx, ky); ctx.rotate(Math.sin(state.t * 2) * 0.08);
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(13, 0); ctx.lineTo(0, 16); ctx.lineTo(-13, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffd9d9'; ctx.stroke();
    ctx.restore();
    // 云台朝向指示
    ctx.strokeStyle = 'rgba(255,178,107,.8)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(kx, ky);
    ctx.lineTo(kx + Math.sin(state.gimbal.pan) * 60, ky + Math.cos(state.gimbal.pan) * 60 * Math.sin(state.gimbal.tilt));
    ctx.stroke(); ctx.setLineDash([]);
    // 高度标尺与当前目标高度带
    var target = state.points.find(function (p) { return !p.photographed; });
    if (target) {
      ctx.fillStyle = 'rgba(126,226,168,.18)';
      ctx.fillRect(4, wy(target.alt[1]), 10, wy(target.alt[0]) - wy(target.alt[1]));
    }
    ctx.fillStyle = '#9fb0c8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('高度', 2, 20);
  }

  // 云台取景器：角坐标系中显示测点与当前准星
  function drawViewfinder() {
    var w = 188, h = 150;
    vf.clearRect(0, 0, w, h);
    vf.fillStyle = '#0d141f'; vf.fillRect(0, 0, w, h);
    function vx(pan) { return w / 2 + (pan / C.panLimit) * (w / 2 - 8); }
    function vy(tilt) { return h - 8 - ((tilt - C.tiltMin) / (C.tiltMax - C.tiltMin)) * (h - 16); }
    state.points.forEach(function (p) {
      var ang = S.aimAngles(state, p);
      vf.fillStyle = p.photographed ? '#7ee2a8' : '#ffd166';
      vf.beginPath(); vf.arc(vx(ang.pan), vy(ang.tilt), 5, 0, Math.PI * 2); vf.fill();
    });
    // 合格容差圈
    var target = state.points.find(function (p) { return !p.photographed; });
    if (target) {
      var ang = S.aimAngles(state, target);
      vf.strokeStyle = 'rgba(255,209,102,.5)';
      vf.beginPath(); vf.arc(vx(ang.pan), vy(ang.tilt), 12, 0, Math.PI * 2); vf.stroke();
    }
    // 准星（模糊越高越发散）
    var cx = vx(state.gimbal.pan), cy = vy(state.gimbal.tilt);
    var spread = 4 + state.gimbal.blur * 14;
    vf.strokeStyle = state.gimbal.blur >= C.blurThreshold ? '#ff8a7a' : '#ffb26b';
    vf.beginPath();
    vf.moveTo(cx - spread, cy); vf.lineTo(cx + spread, cy);
    vf.moveTo(cx, cy - spread); vf.lineTo(cx, cy + spread);
    vf.stroke();
  }

  function setBar(id, frac) { document.getElementById(id).style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; }

  // HUD：左右面板与顶栏全部来自同一 hudSnapshot，保证两侧同步
  function updateHud() {
    var snap = S.hudSnapshot(state);
    document.getElementById('countdown').textContent = snap.countdown;
    document.getElementById('phase').textContent = '阶段：' + (snap.phase === 'survey' ? '航拍测点' : '安全收线');
    document.getElementById('progress').textContent = '测点 ' + snap.pointsDone + '/3';
    document.getElementById('vLineL').textContent = snap.lineL + ' m';
    document.getElementById('vTension').textContent = snap.tension.toFixed(2);
    document.getElementById('vWind').textContent = snap.wind + ' m/s';
    document.getElementById('vBlur').textContent = snap.blur.toFixed(2);
    document.getElementById('vShots').textContent = snap.shotsLeft;
    setBar('barLine', (state.line.L - C.lineMin) / (C.lineMax - C.lineMin));
    setBar('barTension', state.line.tension / 1.2);
    setBar('barWind', state.windNorm);
    setBar('barBlur', state.gimbal.blur);
    var band = document.getElementById('tensionBand');
    band.style.left = (C.slackWarn / 1.2) * 100 + '%';
    band.style.width = ((C.strainWarn - C.slackWarn) / 1.2) * 100 + '%';
    document.getElementById('blurMark').style.left = C.blurThreshold * 100 + '%';
    var target = state.points.find(function (p) { return !p.photographed; });
    document.getElementById('vTarget').textContent = target ? target.name + '（需 ' + target.alt[0] + '-' + target.alt[1] + 'm）' : '已全部拍齐';
    document.getElementById('protLine').className = 'protect' + (snap.lineProtected ? ' on' : '');
    document.getElementById('protGimbal').className = 'protect' + (snap.gimbalProtected ? ' on' : '');
    renderLog();
  }

  var renderedLogs = 0;
  function renderLog() {
    var el = document.getElementById('log');
    if (state.log.length < renderedLogs) { el.innerHTML = ''; renderedLogs = 0; }
    for (; renderedLogs < state.log.length; renderedLogs++) {
      var e = state.log[renderedLogs];
      var div = document.createElement('div');
      div.className = e.side + '-side';
      div.textContent = '[' + e.t.toFixed(1) + 's] ' + e.msg;
      el.appendChild(div);
    }
    el.scrollTop = el.scrollHeight;
  }

  function loop() {
    if (playback) stepPlayback();
    else if (!paused && state.status === 'running') stepOnce();
    drawScene();
    drawViewfinder();
    updateHud();
    requestAnimationFrame(loop);
  }
  loop();
})();
