import { generateWorld } from './world.js';
import {
  createInitialState,
  step,
  restart,
  resumeFromCheckpoint,
  togglePause,
  serialize,
  validateSavedState,
  getHud,
  FIXED_DT,
} from './engine.js';
import { createView, render } from './render.js';
import { createAudio } from './audio.js';
import { runAutopilot } from './autopilot.js';

const SAVE_KEY = 'mailboat.save.v1';

const $ = (id) => document.getElementById(id);

function boot(seed, savedState = null) {
  const world = generateWorld(seed);
  let state = savedState ?? createInitialState(world);
  const canvas = $('game');
  const view = createView(canvas);
  const audio = createAudio();
  return { world, state, view, audio };
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const seed = params.get('seed') || 'postal-2026';
  $('seedInput').value = seed;

  let session = boot(seed);
  const keys = new Set();
  let debugOn = params.get('debug') === '1';
  let autopilot = debugOn;
  let lastEventKey = '';

  const input = {
    forward: false,
    backward: false,
    throttle: 1,
    lampToggle: false,
  };

  function readKeyboard() {
    input.forward = keys.has('ArrowUp') || keys.has('KeyW');
    input.backward = keys.has('ArrowDown') || keys.has('KeyS');
    input.reverse = input.backward;
    if (autopilot) {
      const ai = runAutopilot(session.world, session.state);
      input.propel = ai.propel;
      input.steer = ai.steer;
      input.throttle = ai.throttle;
      input.reverse = ai.reverse;
    } else {
      delete input.propel;
      delete input.steer;
      input.throttle = 1;
    }
  }

  function playEventSound() {
    const ev = session.state.events[session.state.events.length - 1];
    if (!ev) return;
    const key = `${ev.frame}:${ev.text}`;
    if (key === lastEventKey) return;
    lastEventKey = key;
    if (ev.kind === 'damage') session.audio.collision();
    else if (ev.kind === 'delivery') session.audio.delivery();
    else if (ev.kind === 'checkpoint') session.audio.checkpoint();
    else if (ev.kind === 'fail') session.audio.fail();
    else if (ev.kind === 'win') session.audio.win();
  }

  function updateHud() {
    const hud = getHud(session.world, session.state);
    $('hudGoals').textContent = `${hud.delivered}/${hud.total} 封信已送达`;
    $('hudHull').textContent = `船体 ${hud.hull.toFixed(0)}/${hud.hullMax}`;
    $('hudFuel').textContent = `燃料 ${hud.fuel.toFixed(1)}/${hud.fuelMax}`;
    $('hudLoad').textContent = `载货 ${hud.carriedWeight}kg`;
    $('hudCheckpoints').textContent =
      `检查点 ${hud.checkpointsVisited}/${hud.checkpointsTotal}`;
    $('hudFail').textContent = hud.lastFailReason
      ? `最近失败：${hud.lastFailReason}`
      : '最近失败：无';
    $('hudEvent').textContent = `事件：${hud.lastEvent}`;
    $('hudStatus').textContent =
      `状态：${hud.status}　恢复次数：${hud.recoveryCount}`;
    $('hudSeed').textContent = `seed：${session.world.seed}`;
  }

  let acc = 0;
  let last = performance.now();
  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    readKeyboard();
    while (acc >= FIXED_DT) {
      step(session.world, session.state, input);
      input.lampToggle = false;
      acc -= FIXED_DT;
    }
    playEventSound();
    const speed = Math.hypot(session.state.boat.vx, session.state.boat.vy);
    session.audio.updateEngine(speed / 150, session.state.status === 'running');
    render(session.view, session.world, session.state, debugOn);
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('keydown', (e) => {
    session.audio.unlock();
    if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'KeyP' || e.code === 'Space') togglePause(session.state);
    if (e.code === 'KeyL') input.lampToggle = true;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  $('btnPause').addEventListener('click', () => {
    session.audio.unlock();
    togglePause(session.state);
  });
  $('btnRestart').addEventListener('click', () => {
    session.state = restart(session.world);
    lastEventKey = '';
  });
  $('btnResumeCp').addEventListener('click', () => {
    session.state = resumeFromCheckpoint(session.world, session.state);
    lastEventKey = '';
  });
  $('btnSave').addEventListener('click', () => {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ seed: session.world.seed, data: serialize(session.world, session.state) })
    );
    $('saveMsg').textContent = `已保存 ${new Date().toLocaleTimeString()}`;
  });
  $('btnLoad').addEventListener('click', () => {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      $('saveMsg').textContent = '没有可载入的存档';
      return;
    }
    const parsed = JSON.parse(raw);
    const loaded = validateSavedState(session.world, parsed.data);
    if (!loaded) {
      $('saveMsg').textContent = '存档无效或 seed 不匹配';
      return;
    }
    session.state = loaded;
    $('saveMsg').textContent = '存档已载入';
  });
  $('btnDebug').addEventListener('click', () => {
    debugOn = !debugOn;
    autopilot = debugOn;
    $('debugMsg').textContent = debugOn
      ? '调试模式：显示路径/载重顶高/风向，自动驾驶已开启'
      : '调试模式关闭';
  });
  $('btnNewSeed').addEventListener('click', () => {
    const seed = $('seedInput').value.trim() || 'postal-2026';
    const url = new URL(window.location.href);
    url.searchParams.set('seed', seed);
    window.location.href = url.toString();
  });
  $('btnMute').addEventListener('click', () => {
    const next = !session.audio.isMuted();
    session.audio.setMuted(next);
    $('btnMute').textContent = next ? '取消静音' : '静音';
  });
}

document.addEventListener('DOMContentLoaded', init);
