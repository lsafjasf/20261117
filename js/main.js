/* 浏览器端主程序:键盘输入、Canvas 渲染、HUD 同步、回放播放。 */
(function () {
  'use strict';
  var Sim = window.GreenhouseSim;
  var Replay = window.GreenhouseReplay;
  var C = Sim.CONFIG;

  // 键位映射:两名玩家键位集合互斥,系统键独立
  var KEYMAP = {
    q: { player: 'A', control: 'winL', delta: +1 },
    a: { player: 'A', control: 'winL', delta: -1 },
    e: { player: 'A', control: 'winR', delta: +1 },
    d: { player: 'A', control: 'winR', delta: -1 },
    u: { player: 'B', control: 'heatL', delta: +1 },
    j: { player: 'B', control: 'heatL', delta: -1 },
    o: { player: 'B', control: 'heatR', delta: +1 },
    l: { player: 'B', control: 'heatR', delta: -1 }
  };

  var state, recorder, lastReplay = null;
  var pressed = {};          // 当前按住的键,支持两人同时输入
  var paused = false;
  var debugMode = false;     // 单人调试:一人可操作两侧,且暂停超时保护
  var replayPlayback = null; // 回放播放状态
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var seenEvents = 0;

  function newGame() {
    restoreConfig();
    state = Sim.createState();
    recorder = Replay.createRecorder();
    seenEvents = 0;
    paused = false;
    replayPlayback = null;
    document.getElementById('task-log').innerHTML = '';
    document.getElementById('banner').className = 'hidden';
    document.getElementById('btn-pause').textContent = '⏸ 暂停';
    // 重开即同时复位:仪表、目标温度、倒计时、能源、任务记录全部来自新 state
    syncHud();
  }

  // ---- 输入 ----
  document.addEventListener('keydown', function (ev) {
    var k = ev.key.toLowerCase();
    if (k === 'p') { togglePause(); return; }
    if (k === 'r') { newGame(); return; }
    if (k === 't') { toggleDebug(); return; }
    if (replayPlayback) return;
    if (KEYMAP[k]) { pressed[k] = true; ev.preventDefault(); }
  });
  document.addEventListener('keyup', function (ev) {
    delete pressed[ev.key.toLowerCase()];
  });

  // 每帧把按住的键转成控制意图;职责隔离由 Sim.applyControl 强制
  function applyHeldKeys() {
    for (var k in pressed) {
      var m = KEYMAP[k];
      if (!m) continue;
      if (!debugMode && state.players[m.player].protected) {
        // 保护状态下该玩家的首个输入会解除保护(在 applyControl 内处理)
      }
      var before = state.controls[m.control];
      if (Sim.applyControl(state, m.player, m.control, m.delta)) {
        Replay.recordInput(recorder, state, m.player, m.control, m.delta);
      }
    }
  }

  function togglePause() {
    if (state.status !== 'running') return;
    paused = !paused;
    document.getElementById('btn-pause').textContent = paused ? '▶ 继续' : '⏸ 暂停';
    showBanner(paused ? '已暂停\n按 P 继续' : '', 'pause');
  }

  function toggleDebug() {
    debugMode = !debugMode;
    document.getElementById('btn-debug').textContent =
      '🛠 单人调试: ' + (debugMode ? '开' : '关');
    document.getElementById('btn-debug').classList.toggle('active', debugMode);
    document.getElementById('panel-a').classList.toggle('debug-controlled', debugMode);
    document.getElementById('panel-b').classList.toggle('debug-controlled', debugMode);
    logLine('system', debugMode ? '进入单人调试:一人可操作两侧,超时保护已停用'
                                : '退出单人调试:恢复双人职责与超时保护');
  }

  function showBanner(text, cls) {
    var b = document.getElementById('banner');
    if (!text) { b.className = 'hidden'; return; }
    b.textContent = text;
    b.className = cls || '';
  }

  // ---- 任务记录(双方共享同一份日志) ----
  function logLine(cls, text, t) {
    var ul = document.getElementById('task-log');
    var li = document.createElement('li');
    if (cls) li.className = cls;
    var stamp = document.createElement('span');
    stamp.className = 't';
    stamp.textContent = '[' + (t !== undefined ? t : state.t).toFixed(1) + 's]';
    li.appendChild(stamp);
    li.appendChild(document.createTextNode(text));
    ul.appendChild(li);
    ul.scrollTop = ul.scrollHeight;
  }

  function drainEvents() {
    while (seenEvents < state.events.length) {
      var ev = state.events[seenEvents++];
      if (ev.type === 'conflict') {
        logLine('conflict', '⚡ 冲突: ' + ev.detail +
          ' (窗' + ev.win + '% / 加热' + ev.heat + '%)', ev.t);
      } else if (ev.type === 'protect') {
        logLine('protect', '🛡 玩家 ' + ev.player + ' 超时无输入,进入保护状态', ev.t);
      } else if (ev.type === 'resume') {
        logLine('protect', '✔ 玩家 ' + ev.player + ' 恢复操作', ev.t);
      } else if (ev.type === 'result') {
        if (ev.outcome === 'win') logLine('result', '🏆 成功:三个分区全程安全!', ev.t);
        else logLine('result', '💥 失败: ' + ev.reason, ev.t);
      }
    }
  }

  // ---- HUD 同步:两名玩家读取同一份 state,天然一致 ----
  function fmt(v, d) { return v.toFixed(d === undefined ? 1 : d); }

  function setBar(id, ratio) {
    document.getElementById(id).style.width =
      Math.round(Math.min(1, Math.max(0, ratio)) * 100) + '%';
  }

  function syncHud() {
    document.getElementById('hud-countdown').textContent = fmt(state.countdown) + 's';
    document.getElementById('hud-energy-num').textContent = fmt(state.energy, 0);
    setBar('hud-energy', state.energy / C.energyMax);
    document.getElementById('hud-outdoor').textContent = fmt(state.outdoor) + '°C';
    document.getElementById('hud-weather').textContent = state.weather;

    setBar('hud-winl', state.controls.winL);
    setBar('hud-winr', state.controls.winR);
    setBar('hud-heatl', state.controls.heatL);
    setBar('hud-heatr', state.controls.heatR);
    document.getElementById('hud-winl-num').textContent = Math.round(state.controls.winL * 100) + '%';
    document.getElementById('hud-winr-num').textContent = Math.round(state.controls.winR * 100) + '%';
    document.getElementById('hud-heatl-num').textContent = Math.round(state.controls.heatL * 100) + '%';
    document.getElementById('hud-heatr-num').textContent = Math.round(state.controls.heatR * 100) + '%';

    updatePlayerStatus('a', state.players.A);
    updatePlayerStatus('b', state.players.B);
    renderZoneGauges();
  }

  function updatePlayerStatus(key, p) {
    var el = document.getElementById('status-' + key);
    if (p.protected) {
      el.textContent = '保护中(自动代管)';
      el.className = 'status protected';
    } else {
      el.textContent = '在线';
      el.className = 'status ok';
    }
  }

  function renderZoneGauges() {
    var host = document.getElementById('zone-gauges');
    if (!host.children.length) {
      for (var i = 0; i < 3; i++) {
        var div = document.createElement('div');
        div.className = 'zone';
        div.innerHTML = '<div class="name"><span></span><b></b></div>' +
          '<div class="bar"><div class="fill stress"></div></div>';
        host.appendChild(div);
      }
    }
    for (var z = 0; z < 3; z++) {
      var row = host.children[z];
      var remain = Math.max(0, C.tolerance[z] - state.stress[z]);
      row.querySelector('.name span').textContent =
        C.zoneNames[z] + ' ' + fmt(state.temps[z]) + '°C (安全 ' +
        C.safeMin + '-' + C.safeMax + '°C)';
      row.querySelector('.name b').textContent =
        state.zoneFailed[z] ? '绝收' : '耐受余量 ' + fmt(remain) + 's';
      row.querySelector('.fill').style.width =
        Math.round((state.stress[z] / C.tolerance[z]) * 100) + '%';
    }
  }

  // ---- Canvas 渲染:温室剖面 + 热区 ----
  function tempColor(t) {
    // 冷蓝 -> 安全绿 -> 热红
    var lo = C.safeMin, hi = C.safeMax;
    if (t < lo) {
      var c = Math.min(1, (lo - t) / 8);
      return 'rgb(' + Math.round(40 + 30 * c) + ',' + Math.round(90 - 40 * c) +
        ',' + Math.round(180 + 60 * c) + ')';
    }
    if (t > hi) {
      var h = Math.min(1, (t - hi) / 8);
      return 'rgb(' + Math.round(180 + 70 * h) + ',' + Math.round(90 - 40 * h) +
        ',' + Math.round(50 - 20 * h) + ')';
    }
    var g = (t - lo) / (hi - lo);
    return 'rgb(' + Math.round(46 + 60 * g) + ',' + Math.round(150 + 20 * (1 - Math.abs(g - 0.5) * 2)) +
      ',' + Math.round(80 + 30 * (1 - g)) + ')';
  }

  function draw() {
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    var ground = H - 70, roofTop = 70, wallL = 60, wallR = W - 60;
    var zoneW = (wallR - wallL) / 3;

    // 室外背景色随室外温度
    ctx.fillStyle = tempColor(state.outdoor);
    ctx.globalAlpha = 0.18;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    // 三个分区热区填充
    for (var i = 0; i < 3; i++) {
      var x = wallL + i * zoneW;
      var grad = ctx.createLinearGradient(0, roofTop, 0, ground);
      grad.addColorStop(0, tempColor(state.temps[i]));
      grad.addColorStop(1, shade(tempColor(state.temps[i]), 0.7));
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, roofTop, zoneW, ground - roofTop);
      ctx.globalAlpha = 1;
      // 分区温度与状态文字
      ctx.fillStyle = '#eaf2fa';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.temps[i].toFixed(1) + '°C', x + zoneW / 2, roofTop + 40);
      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#cfe0f0';
      var remain = Math.max(0, C.tolerance[i] - state.stress[i]);
      ctx.fillText(C.zoneNames[i] + ' · 耐受余量 ' + remain.toFixed(1) + 's',
        x + zoneW / 2, roofTop + 62);
      drawPlants(x + zoneW / 2, ground - 14, i);
    }

    // 分区隔墙
    ctx.strokeStyle = 'rgba(220,235,250,0.35)';
    ctx.lineWidth = 2;
    for (var d = 1; d < 3; d++) {
      ctx.beginPath();
      ctx.moveTo(wallL + d * zoneW, roofTop);
      ctx.lineTo(wallL + d * zoneW, ground);
      ctx.stroke();
    }

    drawStructure(wallL, wallR, roofTop, ground, zoneW);
    drawWindow(wallL, roofTop, ground, state.controls.winL, -1, 'A');
    drawWindow(wallR, roofTop, ground, state.controls.winR, +1, 'A');
    drawHeater(wallL + zoneW * 0.5, ground, state.controls.heatL, 'B');
    drawHeater(wallL + zoneW * 2.5, ground, state.controls.heatR, 'B');
    drawOutdoorLabel(wallL, wallR, roofTop);
  }

  function shade(rgb, f) {
    var m = rgb.match(/\d+/g);
    return 'rgb(' + m.slice(0, 3).map(function (v) {
      return Math.round(v * f);
    }).join(',') + ')';
  }

  function drawStructure(wallL, wallR, roofTop, ground, zoneW) {
    var apex = roofTop - 46;
    ctx.strokeStyle = '#8fa6bd';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(wallL, ground);
    ctx.lineTo(wallL, roofTop);
    ctx.lineTo((wallL + wallR) / 2, apex);
    ctx.lineTo(wallR, roofTop);
    ctx.lineTo(wallR, ground);
    ctx.stroke();
    // 地面
    ctx.fillStyle = '#233044';
    ctx.fillRect(wallL - 20, ground, (wallR - wallL) + 40, 12);
  }

  function drawWindow(x, roofTop, ground, open, side, owner) {
    // 侧墙上的通风窗,开度越大窗扇张开越宽
    var wy = roofTop + 30, wh = 90;
    ctx.strokeStyle = '#6fc3f5';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 6, wy, 12, wh);
    var swing = open * 46;
    ctx.beginPath();
    ctx.moveTo(x, wy);
    ctx.lineTo(x + side * swing, wy + wh * 0.5);
    ctx.lineTo(x, wy + wh);
    ctx.closePath();
    ctx.fillStyle = 'rgba(111,195,245,' + (0.15 + open * 0.5) + ')';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#9fd4f5';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('玩家' + owner + ' 窗 ' + Math.round(open * 100) + '%',
      x + side * 34, wy + wh + 18);
  }

  function drawHeater(cx, ground, power, owner) {
    var w = 90, h = 10;
    ctx.fillStyle = '#3a2a24';
    ctx.fillRect(cx - w / 2, ground - h, w, h);
    if (power > 0.02) {
      var glow = ctx.createLinearGradient(0, ground - h - 60 * power, 0, ground);
      glow.addColorStop(0, 'rgba(245,138,90,0)');
      glow.addColorStop(1, 'rgba(245,138,90,' + (0.55 * power) + ')');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - w / 2, ground - h - 60 * power, w, 60 * power);
      ctx.fillStyle = 'rgb(' + Math.round(150 + 105 * power) + ',' +
        Math.round(70 + 60 * power) + ',40)';
      ctx.fillRect(cx - w / 2, ground - h, w, h);
    }
    ctx.fillStyle = '#f5b58a';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('玩家' + owner + ' 加热 ' + Math.round(power * 100) + '%',
      cx, ground + 26);
  }

  function drawPlants(cx, baseY, zone) {
    var health = 1 - state.stress[zone] / C.tolerance[zone];
    for (var i = -1; i <= 1; i++) {
      var x = cx + i * 34;
      ctx.strokeStyle = state.zoneFailed[zone] ? '#5a4a3a' :
        'rgb(' + Math.round(120 - 60 * health) + ',' +
        Math.round(120 + 100 * health) + ',60)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x - 6, baseY - 16, x, baseY - 26 * (0.5 + health * 0.5));
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + 6, baseY - 14, x + 3, baseY - 22 * (0.5 + health * 0.5));
      ctx.stroke();
    }
  }

  function drawOutdoorLabel(wallL, wallR, roofTop) {
    ctx.fillStyle = '#8ba0b6';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('室外 ' + state.outdoor.toFixed(1) + '°C · ' + state.weather,
      wallL, roofTop - 56);
    ctx.textAlign = 'right';
    ctx.fillText('倒计时 ' + state.countdown.toFixed(1) + 's · 能源 ' +
      Math.round(state.energy), wallR, roofTop - 56);
  }

  // ---- 主循环 ----
  var acc = 0, lastTs = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    var elapsed = Math.min(0.25, (ts - lastTs) / 1000);
    lastTs = ts;

    if (replayPlayback) { tickPlayback(elapsed); return; }
    if (paused || state.status !== 'running') { draw(); return; }

    acc += elapsed;
    while (acc >= C.dt) {
      acc -= C.dt;
      applyHeldKeys();
      if (debugMode) {
        // 单人调试:停用超时保护,方便一人测试两侧
        state.players.A.lastInput = state.t;
        state.players.B.lastInput = state.t;
      }
      Sim.step(state);
      Replay.collect(recorder, state);
    }
    drainEvents();
    syncHud();
    draw();

    if (state.status === 'win') {
      Replay.finalize(recorder, state);
      lastReplay = recorder;
      showBanner('🏆 成功!\n三个分区全程安全\n按 R 重新开始', 'win');
    } else if (state.status === 'lose') {
      Replay.finalize(recorder, state);
      lastReplay = recorder;
      showBanner('💥 失败\n' + state.failReason + '\n按 R 重新开始', 'lose');
    }
  }

  // ---- 回放播放 ----
  function tickPlayback(elapsed) {
    var pb = replayPlayback;
    pb.acc += elapsed;
    while (pb.acc >= C.dt && pb.state.status === 'running') {
      pb.acc -= C.dt;
      while (pb.cursor < pb.rec.inputs.length &&
             pb.rec.inputs[pb.cursor].t <= pb.state.t + 1e-9) {
        var inp = pb.rec.inputs[pb.cursor++];
        Sim.applyControl(pb.state, inp.player, inp.control, inp.delta);
      }
      Sim.step(pb.state);
    }
    state = pb.state; // HUD 与画布统一从当前 state 读取
    drainEvents();
    syncHud();
    draw();
    if (pb.state.status !== 'running') {
      showBanner('▶ 回放结束\n' + (pb.state.status === 'win' ? '🏆 成功' : '💥 ' + pb.state.failReason) +
        '\n按 R 开始新局', pb.state.status === 'win' ? 'win' : 'lose');
      replayPlayback = null;
      restoreConfig();
    }
  }

  function startPlayback() {
    if (!lastReplay) {
      showBanner('暂无可回放的记录\n先完成一局', 'pause');
      setTimeout(function () {
        if (state.status === 'running' && !paused) showBanner('');
      }, 1500);
      return;
    }
    document.getElementById('task-log').innerHTML = '';
    // 按录制时的配置重放,保证与实录一致
    replaySavedConfig = JSON.parse(JSON.stringify(Sim.CONFIG));
    if (lastReplay.config) {
      for (var k in lastReplay.config) Sim.CONFIG[k] = lastReplay.config[k];
    }
    replayPlayback = {
      rec: lastReplay,
      state: Sim.createState(),
      cursor: 0,
      acc: 0
    };
    seenEvents = 0;
    logLine('system', '▶ 开始回放 (' + lastReplay.inputs.length + ' 条输入, ' +
      lastReplay.events.length + ' 条事件)', 0);
    showBanner('');
  }

  var replaySavedConfig = null;

  function restoreConfig() {
    if (replaySavedConfig) {
      for (var k in replaySavedConfig) Sim.CONFIG[k] = replaySavedConfig[k];
      replaySavedConfig = null;
    }
  }

  function exportReplay() {
    if (!lastReplay) return;
    var blob = new Blob([JSON.stringify(lastReplay, null, 2)],
      { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'greenhouse-replay-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.getElementById('btn-pause').addEventListener('click', togglePause);
  document.getElementById('btn-restart').addEventListener('click', newGame);
  document.getElementById('btn-debug').addEventListener('click', toggleDebug);
  document.getElementById('btn-replay').addEventListener('click', startPlayback);
  document.getElementById('btn-export').addEventListener('click', exportReplay);

  newGame();
  requestAnimationFrame(loop);
})();
