/* 浏览器主控：游戏循环、输入、HUD、暂停/重开/检查点、存档与调试场景 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const SAVE_KEY = 'lunar-rover-save-v1';
  const DEFAULT_SEED = 20261117;

  let state = LunarEngine.createGame(DEFAULT_SEED);
  let input = { throttle: 0, brake: 0, left: 0, right: 0 };
  const keys = {};
  let tracks = [];
  let autoDemo = null; // null | 'route' | 'crash'
  let demoWp = 1;
  let last = performance.now();
  let prevStatus = state.status;
  let prevDelivered = 0;
  let prevCpCount = 1;

  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  function currentInput() {
    if (autoDemo) return demoInput();
    return {
      throttle: keys['ArrowUp'] || keys['KeyW'] ? 1 : 0,
      brake: keys['Space'] || keys['ArrowDown'] || keys['KeyS'] ? 1 : 0,
      left: keys['ArrowLeft'] || keys['KeyA'] ? 1 : 0,
      right: keys['ArrowRight'] || keys['KeyD'] ? 1 : 0
    };
  }

  function demoInput() {
    if (autoDemo === 'crash') return { throttle: 1, brake: 0, left: 0, right: 0 };
    const wp = state.world.waypoints[demoWp];
    if (Math.hypot(state.rover.x - wp.x, state.rover.y - wp.y) < 40 && demoWp < 7) demoWp++;
    return LunarEngine.autopilotInput(state, demoWp, 1);
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const inp = currentInput();
    LunarEngine.step(state, dt, inp);
    LunarAudio.update(LunarEngine.speed(state), inp.throttle, state.paused);
    handleEvents();
    recordTrack();
    render();
    updateHud();
    requestAnimationFrame(loop);
  }

  function handleEvents() {
    if (state.status !== prevStatus) {
      if (state.status === 'failed') LunarAudio.fail();
      if (state.status === 'won') LunarAudio.win();
      prevStatus = state.status;
    }
    const deliveredNow = state.stats.deliveries;
    if (deliveredNow > prevDelivered) { LunarAudio.delivery(); prevDelivered = deliveredNow; }
    const cpNow = state.checkpoints.filter(c => c.visited).length;
    if (cpNow > prevCpCount) { LunarAudio.checkpoint(); prevCpCount = cpNow; }
  }

  function recordTrack() {
    const r = state.rover;
    const tail = tracks[tracks.length - 1];
    if (!tail || Math.hypot(tail.x - r.x, tail.y - r.y) > 9) {
      tracks.push({ x: r.x, y: r.y });
      if (tracks.length > 600) tracks.shift();
    }
  }

  function camera() {
    const vw = canvas.width, vh = canvas.height;
    const x = Math.max(0, Math.min(state.world.config.w - vw, state.rover.x - vw / 2));
    const y = Math.max(0, Math.min(state.world.config.h - vh, state.rover.y - vh / 2));
    return { x, y };
  }

  function render() {
    const cam = camera();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    LunarRender.drawDust(ctx, state.world);
    LunarRender.drawTracks(ctx, tracks);
    LunarRender.drawRoute(ctx, state.world);
    LunarRender.drawCraters(ctx, state.world);
    LunarRender.drawRocks(ctx, state.world);
    LunarRender.drawCheckpoints(ctx, state.world);
    LunarRender.drawLander(ctx, state.world);
    LunarRender.drawPods(ctx, state.world);
    LunarRender.drawRover(ctx, state.rover);
    const wind = LunarWorld.windAt(state.world, state.time);
    LunarRender.drawWind(ctx, wind, state.rover.x + 44, state.rover.y - 44);
    ctx.restore();
    drawOverlay(cam);
  }

  function drawOverlay(cam) {
    if (!$('debug').classList.contains('on')) return;
    const r = state.rover;
    const v = LunarEngine.speed(state);
    const lines = [
      'seed=' + state.seed + '  t=' + state.time.toFixed(1) + 's',
      'pos=(' + r.x.toFixed(0) + ',' + r.y.toFixed(0) + ')  v=' + v.toFixed(1) + ' u/s',
      '质量=' + LunarEngine.roverMass(state).toFixed(0) + ' kg  制动距离='
        + LunarEngine.brakingDistance(state, v).toFixed(0) + ' u',
      '检查点=' + state.lastCheckpointId + '  弹跳=' + state.stats.bounces
    ];
    ctx.font = '13px monospace';
    lines.forEach((line, i) => {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(10, 10 + i * 20, ctx.measureText(line).width + 14, 18);
      ctx.fillStyle = '#8fe3a0';
      ctx.fillText(line, 17, 24 + i * 20);
    });
  }

  function updateHud() {
    updateBanner();
    const pods = state.world.pods;
    $('goal').textContent = pods.filter(p => p.delivered).length + ' / 3 舱已补给';
    $('podlist').textContent = pods.map(p => p.id + (p.delivered ? '✓' : '…')).join('  ');
    $('cargo').textContent = '水箱 ' + state.cargo.water + '/3   种子 ' + state.cargo.seeds + '/3';
    $('battery').textContent = state.battery.toFixed(1) + ' / ' + state.world.config.batteryMax;
    $('batteryBar').style.width = (100 * state.battery / state.world.config.batteryMax) + '%';
    const wind = LunarWorld.windAt(state.world, state.time);
    const deg = ((wind.angle * 180 / Math.PI) % 360 + 360).toFixed(0);
    $('wind').textContent = wind.strength.toFixed(1) + ' u/s，方向 ' + deg + '°';
    $('mass').textContent = LunarEngine.roverMass(state).toFixed(0) + ' kg';
    $('brake').textContent = LunarEngine.brakingDistance(state, LunarEngine.speed(state)).toFixed(0) + ' u';
    $('status').textContent = state.paused ? '已暂停'
      : state.status === 'won' ? '任务成功'
      : state.status === 'failed' ? '任务失败' : '行驶中';
    $('failure').textContent = state.lastFailure
      ? state.lastFailure.reason + '（' + state.lastFailure.t.toFixed(1) + 's）' : '无';
    $('log').innerHTML = state.log.slice(-6).reverse()
      .map(e => '<li>[' + e.t.toFixed(1) + 's] ' + e.msg + '</li>').join('');
  }

  function updateBanner() {
    const banner = $('banner');
    if (state.paused) {
      banner.className = '';
      banner.innerHTML = '已暂停<small>按 P 继续</small>';
    } else if (state.status === 'won') {
      banner.className = '';
      banner.innerHTML = '任务成功<small>三舱补给完成并返回着陆器，按 R 重开</small>';
    } else if (state.status === 'failed') {
      banner.className = 'fail';
      banner.innerHTML = '任务失败：' + state.lastFailure.reason
        + '<small>按 C 从最近检查点「' + state.lastCheckpointId + '」继续，或 R 重开</small>';
    } else {
      banner.className = 'hidden';
      banner.innerHTML = '';
    }
  }

  window.addEventListener('keydown', e => onKey(e, true));
  window.addEventListener('keyup', e => onKey(e, false));

  function onKey(e, down) {
    keys[e.code] = down;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'KeyF5', 'KeyF9'].includes(e.code)) e.preventDefault();
    if (!down) return;
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    if (e.code === 'KeyR') restartGame();
    if (e.code === 'KeyC') recover();
    if (e.code === 'KeyF5') quickSave();
    if (e.code === 'KeyF9') quickLoad();
  }

  function togglePause() {
    if (state.status !== 'playing') return;
    state.paused = !state.paused;
  }

  function restartGame() {
    const seed = $('seedInput').value || DEFAULT_SEED;
    state = LunarEngine.createGame(seed);
    prevStatus = state.status; prevDelivered = 0; prevCpCount = 1;
    tracks = []; autoDemo = null; demoWp = 1;
  }

  function recover() {
    if (state.status !== 'failed') return;
    if (LunarEngine.continueFromCheckpoint(state)) {
      prevStatus = 'playing';
      tracks = tracks.slice(-120);
      autoDemo = null;
      demoWp = 1;
    }
  }

  function quickSave() {
    localStorage.setItem(SAVE_KEY, LunarEngine.saveState(state));
    $('saveMsg').textContent = '已保存 ' + new Date().toLocaleTimeString();
  }

  function quickLoad() {
    const json = localStorage.getItem(SAVE_KEY);
    if (!json) { $('saveMsg').textContent = '没有可载入的存档'; return; }
    state = LunarEngine.loadState(json);
    prevStatus = state.status;
    prevDelivered = state.stats.deliveries;
    prevCpCount = state.checkpoints.filter(c => c.visited).length;
    autoDemo = null;
    $('saveMsg').textContent = '已载入存档';
  }

  function startDemo(kind) {
    restartGame();
    autoDemo = kind;
    demoWp = 1;
    if (kind === 'crash') {
      const rock = state.world.rocks[0];
      state.rover.heading = Math.atan2(rock.y - state.rover.y, rock.x - state.rover.x);
    }
  }

  $('btnPause').onclick = togglePause;
  $('btnRestart').onclick = restartGame;
  $('btnRecover').onclick = recover;
  $('btnSave').onclick = quickSave;
  $('btnLoad').onclick = quickLoad;
  $('btnRoute').onclick = () => startDemo('route');
  $('btnCrash').onclick = () => startDemo('crash');
  $('btnSeed').onclick = () => { $('seedInput').value = DEFAULT_SEED; restartGame(); };
  $('debug').onclick = () => {
    const btn = $('debug');
    btn.classList.toggle('on');
    btn.textContent = '调试覆盖层：' + (btn.classList.contains('on') ? '开' : '关');
  };
  $('btnMute').onclick = () => {
    LunarAudio.init();
    const on = LunarAudio.toggle();
    $('btnMute').textContent = on ? '静音' : '取消静音';
  };
  document.addEventListener('pointerdown', () => LunarAudio.init(), { once: true });

  requestAnimationFrame(loop);
})();
