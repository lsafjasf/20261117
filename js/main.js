// 入口:输入、主循环、暂停/重开/存档/检查点
import { createGame, step, restart, continueFromCheckpoint, saveState, loadState, setPaused } from './sim.js';
import { hashSeed } from './rng.js';
import { render } from './render.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const audio = createAudio();
const SAVE_KEY = 'reefer-save-v1';

const params = new URLSearchParams(location.search);
const seedNum = params.has('seed') ? hashSeed(params.get('seed')) : 20261117;
let state = createGame(seedNum);
let debug = params.has('debug');
let pendingAction = null;
const keys = {};

const KEY_ACTIONS = {
  KeyL: 'load', KeyC: 'compressor', KeyR: 'recover', KeyF: 'repair',
  Equal: 'powerUp', Minus: 'powerDown',
};

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.code === 'KeyP') { setPaused(state, !state.paused); return; }
  if (e.code === 'KeyN') { state = restart(state); return; }
  if (e.code === 'KeyG' && state.status === 'failed') { state = continueFromCheckpoint(state); return; }
  if (e.code === 'KeyK') { localStorage.setItem(SAVE_KEY, saveState(state)); flash('已保存'); return; }
  if (e.code === 'KeyO') {
    const j = localStorage.getItem(SAVE_KEY);
    if (j) { state = loadState(j); flash('已载入存档'); }
    return;
  }
  if (e.code === 'KeyD') { debug = !debug; return; }
  if (KEY_ACTIONS[e.code]) pendingAction = KEY_ACTIONS[e.code];
  keys[e.code] = true;
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

let flashMsg = null, flashUntil = 0;
function flash(msg) { flashMsg = msg; flashUntil = performance.now() + 1500; }

function frame() {
  const input = {
    up: keys.ArrowUp || keys.KeyW,
    down: keys.ArrowDown || keys.KeyS,
    left: keys.ArrowLeft || keys.KeyA,   // D 键保留给调试开关
    right: keys.ArrowRight,
    action: pendingAction,
  };
  pendingAction = null;
  step(state, input);
  audio.update(state);
  render(ctx, state, debug);
  if (flashMsg && performance.now() < flashUntil) {
    ctx.fillStyle = '#2ecc71';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(flashMsg, 400, 30);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
