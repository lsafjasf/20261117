/* UI glue: controls, HUD, pause/restart, seed, save-load and demo mode. */
(function () {
  'use strict';
  const { Game, CONFIG } = window.BuoyGame;
  const { Renderer } = window.BuoyRender;
  const { DemoRunner, GroundingRunner } = window.BuoyDemo;
  const { SoundBoard } = window.BuoyAudio;

  const STORAGE_KEY = 'buoy-game-save-v1';
  const els = {};
  const state = {
    game: null,
    renderer: null,
    sound: new SoundBoard(),
    paused: false,
    debug: true,
    demo: null,
    demoSpeed: 1,
    keys: Object.create(null),
    last: 0,
    acc: 0
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function init() {
    [
      'canvas', 'hud-progress', 'hud-resources', 'hud-wind',
      'hud-failure', 'hud-status', 'hud-checkpoint', 'event-log', 'seed-input',
      'btn-start', 'btn-pause', 'btn-restart', 'btn-drop', 'btn-recover',
      'btn-save', 'btn-load', 'btn-export', 'btn-import', 'btn-demo',
      'btn-ground', 'btn-mute', 'debug-toggle', 'speed-select', 'file-import',
      'hud-seed', 'hud-time', 'hud-load', 'hud-current', 'hud-phase'
    ].forEach((id) => {
      const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      els[key] = document.getElementById(id);
    });

    state.renderer = new Renderer(els.canvas);
    bindEvents();
    const seed = parseSeed(new URLSearchParams(location.search).get('seed')) ||
      parseSeed(localStorage.getItem('buoy-game-seed')) || 20261117;
    els.seedInput.value = seed;
    start(seed);
    requestAnimationFrame(loop);
  }

  function parseSeed(v) {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? (n >>> 0) : null;
  }

  function start(seed) {
    state.game = new Game(seed >>> 0);
    state.demo = null;
    state.paused = false;
    state.acc = 0;
    state.renderer.clearTrail();
    localStorage.setItem('buoy-game-seed', String(seed >>> 0));
    syncPauseButton();
    refreshHud();
  }

  function bindEvents() {
    els.btnStart.addEventListener('click', () => {
      const seed = parseSeed(els.seedInput.value);
      if (seed === null) {
        flashFailure('seed 必须是整数，已忽略本次输入');
        return;
      }
      start(seed);
    });
    els.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') els.btnStart.click();
    });
    els.btnPause.addEventListener('click', togglePause);
    els.btnRestart.addEventListener('click', () => start(state.game.world.seed));
    els.btnDrop.addEventListener('click', dropMarker);
    els.btnRecover.addEventListener('click', recover);
    els.btnSave.addEventListener('click', saveGame);
    els.btnLoad.addEventListener('click', loadGame);
    els.btnExport.addEventListener('click', exportSave);
    els.btnImport.addEventListener('click', () => els.fileImport.click());
    els.fileImport.addEventListener('change', importSave);
    els.btnDemo.addEventListener('click', runDemo);
    els.btnGround.addEventListener('click', runGrounding);
    els.btnMute.addEventListener('click', () => {
      state.sound.resume();
      els.btnMute.textContent = state.sound.toggleMute() ? '🔇 已静音' : '🔊 声音';
    });
    els.debugToggle.addEventListener('change', () => {
      state.debug = els.debugToggle.checked;
    });
    els.speedSelect.addEventListener('change', () => {
      state.demoSpeed = Number(els.speedSelect.value);
    });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      state.keys[e.key.toLowerCase()] = true;
      if (e.key === ' ') {
        e.preventDefault();
        dropMarker();
      }
      if (e.key.toLowerCase() === 'p') togglePause();
      if (e.key.toLowerCase() === 'r') els.btnRestart.click();
      if (e.key.toLowerCase() === 'c') recover();
    });
    window.addEventListener('keyup', (e) => {
      state.keys[e.key.toLowerCase()] = false;
    });
  }

  function togglePause() {
    state.paused = !state.paused;
    syncPauseButton();
    addEventLine(state.paused ? 'info' : 'info',
      state.paused ? '已暂停（固定时间步，恢复后状态不变）' : '继续航行');
  }

  function syncPauseButton() {
    els.btnPause.textContent = state.paused ? '▶ 继续' : '⏸ 暂停';
  }

  function manualControl() {
    const g = state.game;
    const b = g.boat;
    const k = state.keys;
    if (k['arrowleft'] || k['a']) b.heading -= CONFIG.BOAT.turnRate * CONFIG.DT;
    if (k['arrowright'] || k['d']) b.heading += CONFIG.BOAT.turnRate * CONFIG.DT;
    let thrust = 0;
    if (k['arrowup'] || k['w']) thrust = k['shift'] ? 1 : 0.85;
    return thrust;
  }

  function fixedStep() {
    const g = state.game;
    if (g.status !== 'running') return;
    let thrust;
    if (state.demo) {
      const before = g.status;
      const action = state.demo.step();
      if (action.type === 'drop') {
        if (action.ok) state.sound.markerOk();
        else state.sound.markerBad();
      }
      if (before === 'running' && g.status === 'failed') state.sound.crash();
      return;
    }
    thrust = manualControl();
    const before = g.status;
    const cpCount = g.checkpoints.length;
    g.step(thrust);
    if (cpCount !== g.checkpoints.length) state.sound.checkpoint();
    if (before === 'running' && g.status === 'failed') state.sound.crash();
    state.renderer.pushTrail(g.boat.x, g.boat.y);
  }

  function loop(ts) {
    if (!state.last) state.last = ts;
    const frame = Math.min(0.1, (ts - state.last) / 1000);
    state.last = ts;
    const g = state.game;
    if (!state.paused) {
      state.acc += frame * (state.demo ? state.demoSpeed : 1);
      let guard = 0;
      while (state.acc >= CONFIG.DT && guard < 8) {
        fixedStep();
        state.acc -= CONFIG.DT;
        guard += 1;
      }
      const flow = Math.hypot(g.current.fx, g.current.fy);
      state.sound.update(g.boat.thrust, flow, g.inShallow);
    }
    state.renderer.draw(g, { debug: state.debug });
    refreshHud();
    requestAnimationFrame(loop);
  }

  function dropMarker() {
    state.sound.resume();
    if (state.game.status !== 'running') {
      flashFailure('当前状态不可投放标记');
      return;
    }
    const r = state.game.dropMarker();
    if (r.ok) state.sound.markerOk();
    else state.sound.markerBad();
    refreshHud();
  }

  function recover() {
    const g = state.game;
    if (g.status !== 'failed') {
      flashFailure('仅在失败后可从最近检查点继续');
      return;
    }
    const r = g.recover();
    if (!r.ok) flashFailure(r.reason);
    else state.sound.checkpoint();
    refreshHud();
  }

  function saveGame() {
    try {
      localStorage.setItem(STORAGE_KEY, state.game.serialize());
      addEventLine('success', '状态已保存到浏览器本地存档');
    } catch (err) {
      flashFailure(`保存失败：${err.message}`);
    }
  }

  function loadGame() {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) {
      flashFailure('没有找到本地存档');
      return;
    }
    applyLoaded(text);
  }

  function exportSave() {
    const blob = new Blob([state.game.serialize()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `buoy-save-${state.game.world.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importSave(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => applyLoaded(reader.result);
    reader.readAsText(file);
    e.target.value = '';
  }

  function applyLoaded(text) {
    try {
      const g = Game.deserialize(text);
      state.game = g;
      state.demo = null;
      state.paused = false;
      state.renderer.clearTrail();
      els.seedInput.value = g.world.seed;
      syncPauseButton();
      state.acc = 0;
      addEventLine('success', `存档已载入（seed ${g.world.seed}，状态 ${g.status}）`);
      refreshHud();
    } catch (err) {
      flashFailure(`读档失败：${err.message}`);
    }
  }

  function runDemo() {
    state.sound.resume();
    start(state.game.world.seed);
    state.demo = new DemoRunner(state.game);
    addEventLine('info', '自动演示启动：正常路线 → 碰撞 → 检查点恢复 → 回港');
    refreshHud();
  }

  function runGrounding() {
    state.sound.resume();
    start(state.game.world.seed);
    state.demo = new GroundingRunner(state.game);
    addEventLine('info', '搁浅调试启动：船将驶向浅水核心');
    refreshHud();
  }

  function statusText(s) {
    return {
      running: '航行中',
      paused: '已暂停',
      failed: '失败（可从检查点继续）',
      won: '任务成功'
    }[s] || s;
  }

  function refreshHud() {
    const g = state.game;
    const wind = g.wind;
    const cur = g.current;
    const flow = Math.hypot(cur.fx, cur.fy);
    els.hudSeed.textContent = g.world.seed;
    els.hudTime.textContent = g.time.toFixed(1);
    els.hudProgress.textContent = `${g.cablesMarked} / ${g.world.cables.length}`;
    els.hudResources.textContent =
      `标记 ${g.markersLeft}/${CONFIG.MAX_MARKERS} · 燃料 ${g.fuel.toFixed(1)}/${CONFIG.FUEL_MAX}`;
    els.hudLoad.textContent =
      `载重 ${(g.loadFactor * 100).toFixed(0)}%（投放物越少回程越快）`;
    els.hudWind.textContent =
      `风向 ${(wind.angle * 180 / Math.PI).toFixed(0)}° · 风力 ${Math.hypot(wind.fx, wind.fy).toFixed(1)}`;
    els.hudCurrent.textContent =
      `流速 ${flow.toFixed(1)} · 水深 ${g.depth.toFixed(1)}m${g.inShallow ? '（浅水限推 35%）' : ''}`;
    els.hudStatus.textContent =
      state.paused ? '已暂停' : statusText(g.status);
    els.hudStatus.className =
      g.status === 'won' ? 'ok' : g.status === 'failed' ? 'bad' : '';
    const cp = g.checkpoints[g.checkpoints.length - 1];
    els.hudCheckpoint.textContent =
      `#${cp.id} ${cp.label}（共 ${g.checkpoints.length} 个，恢复 ${g.recoveryCount} 次）`;
    els.hudFailure.textContent = g.lastFailure
      ? `${g.lastFailure.reason}${g.lastFailure.recovered ? '（已恢复）' : ''}`
      : '无';
    els.hudPhase.textContent = state.demo
      ? (state.demo.phaseLabel ? state.demo.phaseLabel() : '搁浅调试')
      : '手动操控';
    renderEventLog();
  }

  function renderEventLog() {
    const g = state.game;
    const lines = g.events.slice(-8).reverse()
      .map((e) => `<li class="${e.level}">[${e.t.toFixed(1)}s] ${e.message}</li>`)
      .join('');
    els.eventLog.innerHTML = lines;
  }

  function addEventLine(level, message) {
    state.game._log(level, message);
    renderEventLog();
  }

  function flashFailure(message) {
    const g = state.game;
    g.lastFailure = { code: 'ui', reason: message, time: g.time, recovered: false };
    refreshHud();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
