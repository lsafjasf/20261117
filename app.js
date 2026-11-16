/* app.js - 游戏主循环、输入、HUD、暂停/重开/检查点与存档 */
(function () {
  'use strict';

  var E = window.WindmillEngine;
  var SAVE_KEY = 'windmill-gondola-save-v1';
  var DEFAULT_SEED = 20261117;

  var canvas = document.getElementById('canvas');
  var renderer = new window.WindmillRenderer(canvas, E);
  var audio = new window.WindAudio();

  var state = null;
  var input = { throttle: 0, brake: false, inspect: false };
  var keys = {};
  var autoMode = false;
  var debugMode = true;
  var accumulator = 0;
  var lastFrame = performance.now();

  function $(id) { return document.getElementById(id); }

  function currentSeed() {
    var v = parseInt($('seedInput').value, 10);
    return Number.isFinite(v) ? v >>> 0 : DEFAULT_SEED;
  }

  function currentScenario() {
    return $('scenarioSelect').value;
  }

  function newGame() {
    var seed = currentSeed();
    var scenario = currentScenario();
    state = E.createDebugGame(seed, scenario);
    accumulator = 0;
    autoMode = false;
    prevStatus = 'running';
    prevInspected = 0;
    input = { throttle: 0, brake: false, inspect: false };
    keys = {};
    $('autoBtn').textContent = '自动驾驶';
    addLog('info', '新局开始 seed=' + seed + ' 场景=' + scenario);
    hideOverlay();
    syncHud();
  }

  function addLog(kind, text) {
    var li = document.createElement('li');
    li.className = kind;
    li.textContent = 't=' + (state ? state.t.toFixed(1) : '0.0') + '  ' + text;
    var log = $('log');
    log.prepend(li);
    while (log.children.length > 30) log.removeChild(log.lastChild);
  }

  function showOverlay(title, sub, actions) {
    var ov = $('overlay');
    ov.innerHTML = '';
    var big = document.createElement('div');
    big.className = 'big';
    big.textContent = title;
    var small = document.createElement('div');
    small.className = 'sub';
    small.textContent = sub;
    ov.appendChild(big);
    ov.appendChild(small);
    (actions || []).forEach(function (act) {
      var btn = document.createElement('button');
      btn.textContent = act.label;
      btn.className = act.cls || '';
      btn.addEventListener('click', act.onClick);
      ov.appendChild(btn);
    });
    ov.classList.remove('hidden');
  }

  function hideOverlay() {
    $('overlay').classList.add('hidden');
  }

  window.WindmillApp = {
    newGame: newGame,
    getState: function () { return state; },
    isAuto: function () { return autoMode; },
    autopilot: function (s) { return autopilotInput(s); }
  };

  newGame();

  function frame(now) {
    var elapsed = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!state.paused && state.status === 'running') {
      accumulator += elapsed;
      var guard = 0;
      while (accumulator >= E.DT && guard++ < 8) {
        tick();
        accumulator -= E.DT;
      }
    }
    render();
    audio.update(state, E, currentInput());
    syncHud();
    requestAnimationFrame(frame);
  }

  function currentInput() {
    if (autoMode) return autopilotInput(state);
    return {
      throttle: input.throttle,
      brake: input.brake,
      inspect: input.inspect,
      loadKit: !!keys.load,
      unloadKit: !!keys.unload
    };
  }

  var prevStatus = 'running';
  var prevInspected = 0;

  function tick() {
    var wasLocked = state.iceLocked;
    var inp = currentInput();
    E.step(state, inp);

    if (state.iceLocked && !wasLocked) {
      addLog('info', '轨道结冰，启动延迟 ' + E.constants.ICE_DELAY.toFixed(1) + ' 秒');
    }
    detectTransition();
    syncHud();
  }

  function detectTransition() {
    var doneCount = state.inspected.filter(Boolean).length;
    if (doneCount > prevInspected) {
      prevInspected = doneCount;
      addLog('good', '完成第 ' + doneCount + ' 处叶片根部检修，检查点已更新');
      audio.blip(660);
    }
    if (state.status === 'failed' && prevStatus === 'running') {
      addLog('bad', '失败：' + E.FAILURE_TEXT[state.failure]);
      audio.blip(140);
      showFailureOverlay();
    }
    if (state.status === 'won' && prevStatus === 'running') {
      addLog('good', '三处检修完成并安全下降，任务成功');
      audio.blip(880);
      showOverlay('任务成功', '全部叶片根部检修完毕，吊篮已安全返回地面。', [
        { label: '再开一局', cls: 'primary', onClick: newGame }
      ]);
    }
    prevStatus = state.status;
  }

  function showFailureOverlay() {
    var actions = [];
    if (state.checkpoint) {
      actions.push({ label: '从最近检查点继续 (C)', cls: 'primary', onClick: resumeCheckpoint });
    }
    actions.push({ label: '重新开始 (R)', cls: 'warn', onClick: newGame });
    showOverlay('任务失败', E.FAILURE_TEXT[state.failure] +
      (state.checkpoint ? ' 已保留检查点前的目标与资源。' : ' 尚无检查点，只能重开。'),
      actions);
  }

  function resumeCheckpoint() {
    var resumed = E.resumeFromCheckpoint(state);
    if (!resumed) {
      addLog('info', '还没有检查点，无法继续');
      return;
    }
    state = resumed;
    prevStatus = state.status;
    prevInspected = state.inspected.filter(Boolean).length;
    hideOverlay();
    addLog('info', '已从最近检查点继续，保留检修进度与资源');
    audio.blip(440);
    syncHud();
  }

  function togglePause() {
    if (state.status !== 'running') return;
    state.paused = !state.paused;
    addLog('info', state.paused ? '已暂停' : '继续运行');
    if (state.paused) {
      showOverlay('已暂停', '模拟冻结，所有物理与计时停止。', [
        { label: '继续 (P)', cls: 'primary', onClick: togglePause }
      ]);
    } else {
      hideOverlay();
      lastFrame = performance.now();
    }
    syncHud();
  }

  function saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, E.serialize(state));
      addLog('good', '状态已保存到浏览器本地存档');
    } catch (err) {
      addLog('bad', '保存失败：' + err.message);
    }
  }

  function loadGame() {
    try {
      var text = localStorage.getItem(SAVE_KEY);
      if (!text) throw new Error('没有找到存档');
      state = E.deserialize(text);
      prevStatus = state.status;
      prevInspected = state.inspected.filter(Boolean).length;
      accumulator = 0;
      autoMode = false;
      $('autoBtn').textContent = '自动驾驶';
      hideOverlay();
      addLog('good', '存档已载入，地图与对象位置保持不变');
      if (state.status === 'failed') showFailureOverlay();
      if (state.status === 'won') {
        showOverlay('任务成功', '载入的是已通关存档。', [
          { label: '再开一局', cls: 'primary', onClick: newGame }
        ]);
      }
      if (state.paused) {
        showOverlay('已暂停', '模拟冻结，所有物理与计时停止。', [
          { label: '继续 (P)', cls: 'primary', onClick: togglePause }
        ]);
      }
      syncHud();
    } catch (err) {
      addLog('bad', '载入失败：' + err.message);
    }
  }

  function bar(label, value, cls) {
    return '<div class="bar-row"><div class="bar-label"><span>' + label +
      '</span><span>' + value.toFixed(1) + '%</span></div>' +
      '<div class="bar ' + cls + '"><span style="width:' + value + '%"></span></div></div>';
  }

  function syncHud() {
    detectTransition();
    var progress = $('progress');
    progress.innerHTML = state.map.blades.map(function (b, i) {
      return '<div class="target ' + (state.inspected[i] ? 'done' : '') + '">' +
        (i + 1) + '号叶片根部 @ ' + b.toFixed(1) + 'm</div>';
    }).join('');

    $('resources').innerHTML =
      bar('电量', state.battery, 'battery') +
      bar('制动余量', state.brake, 'brake') +
      '<div class="bar-row"><div class="bar-label"><span>工具包（载重 ' +
      (E.constants.GONDOLA_KG + state.kits * E.constants.KIT_KG) + ' kg）</span>' +
      '<span>' + state.kits + ' 携带 / ' + state.spareKits + ' 地面</span></div></div>';

    var wind = E.windAt(state.map, state.t, state.y);
    var load = E.loadFactor(state);
    $('physics').innerHTML =
      '<div>高度 <b>' + state.y.toFixed(1) + ' m</b> / ' + E.TOWER_H +
      '　速度 <b>' + state.vy.toFixed(2) + ' m/s</b></div>' +
      '<div>横向偏移 <b>' + state.x.toFixed(2) + ' m</b>（碰撞线 ±' +
      E.constants.COLLISION_X + '）</div>' +
      '<div>当前风向 <b>' + (wind >= 0 ? '→ 右' : '← 左') +
      '</b>　风速 <b>' + Math.abs(wind).toFixed(2) + ' m/s</b></div>' +
      '<div>载重系数 <b>' + load.toFixed(2) +
      '</b>　冰上锁定 <b>' + (state.iceLocked ? state.iceTimer.toFixed(1) + ' s' : '无') +
      '</b></div>' +
      '<div>状态 <b>' + statusText() + '</b>　模拟时间 <b>' + state.t.toFixed(1) + ' s</b></div>';

    var failBox = $('failureBox');
    if (state.lastFailure) {
      failBox.classList.remove('hidden');
      failBox.innerHTML = '<div class="title">最近一次失败原因</div>' +
        E.FAILURE_TEXT[state.lastFailure];
    } else {
      failBox.classList.add('hidden');
    }

    $('pauseBtn').textContent = state.paused ? '继续 (P)' : '暂停 (P)';
    $('resumeBtn').disabled = !state.checkpoint || state.status === 'won';
  }

  function statusText() {
    if (state.paused) return '暂停';
    if (state.status === 'won') return '成功';
    if (state.status === 'failed') return '失败：' + state.failure;
    return state.inspecting ? '检修中' : '运行中';
  }

  function plannedTarget() {
    for (var i = 0; i < state.map.blades.length; i++) {
      if (!state.inspected[i]) return state.map.blades[i];
    }
    return 0;
  }

  function autopilotInput(s) {
    var remaining = s.map.blades
      .map(function (b, i) { return s.inspected[i] ? null : b; })
      .filter(function (b) { return b !== null; });
    var target = remaining.length ? Math.min.apply(null, remaining) : 0;
    var wind = E.windAt(s.map, s.t, s.y);
    var d = target - s.y;
    var nearTarget = Math.abs(d) < 1.0 && remaining.length;
    if (nearTarget && Math.abs(s.x) <= 0.5 && Math.abs(s.vy) < 0.3) {
      return { inspect: true, brake: true };
    }
    if (s.iceLocked) return { throttle: 1 };
    var gustSoon = s.map.gusts.some(function (g) {
      return s.t >= g.t - 3.0 && s.t <= g.t + g.dur + 1.0;
    });
    var hazardClose = remaining.length && d > -2.2 && d < 4;
    if (hazardClose && (gustSoon || Math.abs(s.x) > 0.35 || Math.abs(s.vy) > 0.5)) {
      return { brake: true };
    }
    if (nearTarget || s.y >= E.TOWER_H - 0.5) return { brake: true };
    return { throttle: s.y < target ? 1 : -1 };
  }

  function render() {
    renderer.draw(state, {
      debug: debugMode,
      pathTarget: debugMode ? plannedTarget() : undefined
    });
  }

  function refreshInput() {
    input.throttle = (keys.up ? 1 : 0) + (keys.down ? -1 : 0);
    input.brake = !!keys.brake;
    input.inspect = !!keys.inspect;
  }

  var keyMap = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    Space: 'brake', KeyE: 'inspect',
    KeyQ: 'load', KeyZ: 'unload'
  };

  window.addEventListener('keydown', function (ev) {
    audio.ensure();
    if (ev.code === 'KeyP') { togglePause(); return; }
    if (ev.code === 'KeyR') { newGame(); return; }
    if (ev.code === 'KeyC') { resumeCheckpoint(); return; }
    var mapped = keyMap[ev.code];
    if (mapped) {
      ev.preventDefault();
      keys[mapped] = true;
      refreshInput();
    }
  });

  window.addEventListener('keyup', function (ev) {
    var mapped = keyMap[ev.code];
    if (mapped) {
      ev.preventDefault();
      keys[mapped] = false;
      refreshInput();
    }
  });

  $('newGameBtn').addEventListener('click', function () { audio.ensure(); newGame(); });
  $('pauseBtn').addEventListener('click', function () { audio.ensure(); togglePause(); });
  $('restartBtn').addEventListener('click', function () { audio.ensure(); newGame(); });
  $('resumeBtn').addEventListener('click', function () { audio.ensure(); resumeCheckpoint(); });
  $('saveBtn').addEventListener('click', saveGame);
  $('loadBtn').addEventListener('click', loadGame);
  $('autoBtn').addEventListener('click', function () {
    audio.ensure();
    autoMode = !autoMode;
    $('autoBtn').textContent = autoMode ? '停止自动驾驶' : '自动驾驶';
    addLog('info', autoMode ? '自动驾驶已开启（确定性策略）' : '自动驾驶已关闭');
  });
  $('soundBtn').addEventListener('click', function () {
    audio.ensure();
    audio.setEnabled(!audio.enabled);
    $('soundBtn').textContent = '声音：' + (audio.enabled ? '开' : '关');
  });

  requestAnimationFrame(frame);
})();
