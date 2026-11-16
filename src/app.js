import { TICK_MS, BURN_TEMP, CRACK_LIMIT, ROUGH_GOOD, ENERGY } from './config.js';
import {
  createSim, start, pause, step, restart, resetBatch, setParam, snapshot, advance,
} from './engine.js';
import { SCENARIO_ACTIONS, SCENARIOS } from './scenario.js';
import { Renderer } from './renderer.js';
import { AudioEngine } from './audio.js';
import { exportJson, exportCsv, disablePersistentStorage } from './exporter.js';

disablePersistentStorage();

const sim = createSim();
const renderer = new Renderer(document.getElementById('stage'));
const audio = new AudioEngine();
const $ = (id) => document.getElementById(id);

const PARAM_KEYS = { pressure: 'pressure', feed: 'feed', coolant: 'coolant' };
let lastTickAt = performance.now();
let scenarioRunning = false;
let rafHandle = null;

// 唯一的仿真时钟循环：累积真实时间，每 100ms 推进一个确定性 tick
function loop(now) {
  const elapsed = now - lastTickAt;
  if (elapsed >= TICK_MS) {
    lastTickAt = now - (elapsed % TICK_MS);
    if (sim.status === 'running' && !scenarioRunning) {
      advance(sim);
    }
    refresh();
  }
  renderer.draw(sim);
  const glass = sim.glasses[sim.currentIndex];
  audio.update(sim.status === 'running', sim.params, glass ? glass.heat : 25);
  rafHandle = requestAnimationFrame(loop);
}

export function destroy() {
  if (rafHandle != null) cancelAnimationFrame(rafHandle);
  rafHandle = null;
}

function refresh() {
  const s = snapshot(sim);
  $('clockBadge').textContent = `仿真时钟 ${s.clock.toFixed(1)}s · ${statusText(s.status)} · 批次 ${s.batchId}`;
  $('pressureVal').textContent = s.params.pressure;
  $('feedVal').textContent = s.params.feed;
  $('coolantVal').textContent = s.params.coolant;
  $('pressure').value = s.params.pressure;
  $('feed').value = s.params.feed;
  $('coolant').value = s.params.coolant;

  $('btnStart').disabled = s.status === 'running' || s.status === 'shutdown' || s.status === 'completed';
  $('btnPause').disabled = s.status !== 'running';
  $('btnStep').disabled = s.status === 'running' || s.status === 'completed';
  $('btnRestart').disabled = s.status !== 'shutdown';

  renderTelemetry(s);
  renderStats(s);
  renderCache(s);
  renderLog();
}

function statusText(status) {
  return { idle: '空闲', running: '研磨中', paused: '暂停', shutdown: '停机', completed: '完成' }[status] || status;
}

function levelClass(value, warnAt, dangerAt) {
  if (value >= dangerAt) return 'danger-text';
  if (value >= warnAt) return 'warn-text';
  return 'ok-text';
}

function renderTelemetry(s) {
  const g = s.glasses[s.currentIndex] || s.glasses[2];
  const cells = [
    ['当前玻璃', g ? g.id : '—', ''],
    ['温度 °C', g ? g.heat.toFixed(1) : '—', levelClass(g ? g.heat : 0, BURN_TEMP, 150)],
    ['裂纹', g ? g.crack.toFixed(2) : '—', levelClass(g ? g.crack : 0, CRACK_LIMIT * 0.6, CRACK_LIMIT)],
    ['粗糙度 µm', g ? g.roughness.toFixed(2) : '—', g && g.roughness > ROUGH_GOOD ? 'warn-text' : 'ok-text'],
    ['进度 %', g ? Math.min(100, (g.work / g.workRequired) * 100).toFixed(0) : '—', ''],
    ['功率 kW', (ENERGY.wheelBase + ENERGY.pressureGain * s.params.pressure
      + ENERGY.coolantPump * s.params.coolant).toFixed(2), ''],
    ['累计能耗 kWh', s.energyKwh.toFixed(4), ''],
    ['峰值 kW', s.peakKw.toFixed(2), ''],
  ];
  $('telemetry').innerHTML = cells.map(([k, v, cls]) =>
    `<div class="cell">${k}<b class="${cls}">${v}</b></div>`).join('');
}

function renderStats(s) {
  const total = s.good + s.scrap;
  const yieldRate = total ? ((s.good / total) * 100).toFixed(1) : '0.0';
  const items = [
    ['良品 / 不良', `${s.good} / ${s.scrap}`],
    ['良品率', `${yieldRate}%`],
    ['停机原因', s.shutdownReason || '无'],
    ['越限状态', s.limitState],
    ['环形缓存', `${s.cacheSize} 条`],
    ['tick 数', s.tickCount],
  ];
  $('batchStats').innerHTML = items.map(([k, v]) =>
    `<div class="stat">${k}<b>${v}</b></div>`).join('');
}

function renderCache(s) {
  const head = s.cacheHead === null ? '空' : `${s.cacheHead.toFixed(1)}s`;
  $('cacheMeta').textContent = `容量 300 条 · 当前 ${s.cacheSize} 条 · 最旧样本时钟 ${head}（重置即清空）`;
}

const BAD_EVENTS = new Set(['SHUTDOWN', 'DEFECT_BURN', 'DEFECT_CRACK', 'RESTART_BLOCKED', 'PARAM_CLAMP']);
const WARN_EVENTS = new Set(['PARAM_LIMIT', 'GLASS_FAIL']);
function renderLog() {
  const rows = sim.events.slice(-120).map((e) => {
    const cls = BAD_EVENTS.has(e.type) ? 'bad' : WARN_EVENTS.has(e.type) ? 'warn'
      : (e.type === 'GLASS_PASS' || e.type === 'BATCH_RESULT') ? 'good' : '';
    return `<tr><td>${e.clock.toFixed(1)}</td><td><span class="tag ${cls}">${e.type}</span></td>
      <td>${e.message}</td><td>${e.params.pressure}</td><td>${e.params.feed}</td><td>${e.params.coolant}</td></tr>`;
  });
  const tbody = $('eventLog').querySelector('tbody');
  tbody.innerHTML = rows.join('');
  const wrap = document.querySelector('.log-wrap');
  wrap.scrollTop = wrap.scrollHeight;
}

// ---- 控件绑定 ----
Object.entries(PARAM_KEYS).forEach(([key]) => {
  $(key).addEventListener('input', (e) => {
    audio.resume();
    setParam(sim, key, Number(e.target.value));
    refresh();
  });
});

$('btnStart').addEventListener('click', () => { audio.resume(); start(sim); refresh(); });
$('btnPause').addEventListener('click', () => { pause(sim); refresh(); });
$('btnStep').addEventListener('click', () => { step(sim); refresh(); });
$('btnRestart').addEventListener('click', () => { restart(sim); refresh(); });
$('btnReset').addEventListener('click', () => {
  if (sim.status === 'running') pause(sim);
  resetBatch(sim);
  scenarioRunning = false;
  $('scenarioStatus').textContent = '';
  refresh();
});
$('btnMute').addEventListener('click', (e) => {
  audio.resume();
  audio.setMuted(!audio.muted);
  e.target.textContent = audio.muted ? '取消静音' : '静音';
});
$('btnExportJson').addEventListener('click', () => exportJson(sim));
$('btnExportCsv').addEventListener('click', () => exportCsv(sim));

// ---- 场景脚本：逐 tick 驱动，保持界面可观察 ----
document.querySelectorAll('[data-scenario]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (scenarioRunning) return;
    audio.resume();
    resetBatch(sim);
    scenarioRunning = true;
    document.querySelectorAll('[data-scenario]').forEach((b) => { b.disabled = true; });
    const name = btn.dataset.scenario;
    $('scenarioStatus').textContent = `执行场景：${name} …`;
    await runScenarioAnimated(name);
    scenarioRunning = false;
    document.querySelectorAll('[data-scenario]').forEach((b) => { b.disabled = false; });
    const s = snapshot(sim);
    $('scenarioStatus').textContent =
      `场景 ${name} 结束：状态 ${s.status}，良品 ${s.good}，不良 ${s.scrap}，事件 ${sim.events.length} 条`;
    refresh();
  });
});

async function runScenarioAnimated(name) {
  const actions = SCENARIO_ACTIONS[name];
  for (const action of actions) {
    applyAction(action);
    await frame();
  }
}

function frame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function applyAction(action) {
  if (action.op === 'set') setParam(sim, action.key, action.value);
  else if (action.op === 'start') start(sim);
  else if (action.op === 'pause') pause(sim);
  else if (action.op === 'step') step(sim);
  else if (action.op === 'restart') restart(sim);
  else if (action.op === 'reset') resetBatch(sim);
  else if (action.op === 'wait') for (let i = 0; i < action.ticks; i += 1) advance(sim);
  else if (action.op === 'waitUntil') {
    let n = 0;
    while (!action.predicate(snapshot(sim)) && n < (action.maxTicks || 20000) && sim.status !== 'shutdown') {
      advance(sim); n += 1;
    }
  } else if (action.op === 'waitBatch') {
    let n = 0;
    while (sim.status !== 'completed' && sim.status !== 'shutdown' && n < (action.maxTicks || 20000)) {
      advance(sim); n += 1;
    }
  }
  if (action.capture) refresh();
}

// 保留对场景模块的引用，方便控制台复核动作一致性
window.__SCENARIOS__ = SCENARIOS;
refresh();
rafHandle = requestAnimationFrame((t) => { lastTickAt = t; rafHandle = requestAnimationFrame(loop); });
if (typeof window !== 'undefined') window.__destroyApp = destroy;
