// 主控：UI 绑定、参数存取、验证流程、状态刷新
import { Engine, EVENT_TYPES, EVENT_META, defaultParams } from './engine.js';
import { Sequencer } from './sequencer.js';
import { Visualizer } from './visual.js';
import { analyzeParams, compareMetrics, exportAndVerifyWAV } from './verify.js';
const $ = (id) => document.getElementById(id);
const engine = new Engine();
const pattern = ['success', null, 'warning', null, 'error', null, 'warning', null];
const seq = new Sequencer(engine, pattern);
const vis = new Visualizer($('timelineCanvas'), $('stereoCanvas'), seq, engine);
const STORAGE_KEY = 'uid835.soundParams.v1';
let baseline = null;
let lastExportCheck = null;
// ---------- 事件参数控件 ----------
function buildEventControls() {
  const host = $('eventControls');
  host.innerHTML = '';
  for (const type of EVENT_TYPES) {
    const meta = EVENT_META[type];
    const p = engine.params[type];
    const row = document.createElement('div');
    row.className = 'eventRow';
    row.innerHTML =
      `<span class="name" style="color:${meta.color}">${meta.label} (声像 ${p.pan})</span>` +
      `<label>音高 <input type="range" data-type="${type}" data-key="pitch" min="80" max="2000" step="1" value="${p.pitch}"><span>${p.pitch} Hz</span></label>` +
      `<label>衰减 <input type="range" data-type="${type}" data-key="decay" min="0.05" max="1.5" step="0.01" value="${p.decay}"><span>${p.decay.toFixed(2)} s</span></label>` +
      `<label>声像 <input type="range" data-type="${type}" data-key="pan" min="-1" max="1" step="0.05" value="${p.pan}"><span>${p.pan.toFixed(2)}</span></label>`;
    host.appendChild(row);
  }
  host.querySelectorAll('input[type=range]').forEach((el) => {
    el.addEventListener('input', () => {
      const { type, key } = el.dataset;
      engine.params[type][key] = parseFloat(el.value);
      const unit = key === 'pitch' ? ' Hz' : key === 'decay' ? ' s' : '';
      el.nextElementSibling.textContent = engine.params[type][key].toFixed(key === 'pitch' ? 0 : 2) + unit;
      if (key === 'pan') {
        row.querySelector('.name').textContent = `${EVENT_META[type].label} (声像 ${engine.params[type].pan.toFixed(2)})`;
      }
    });
  });
}
// ---------- 参数保存 / 载入 ----------
function collectParams() {
  return JSON.parse(JSON.stringify(engine.params));
}
function applyParams(p) {
  engine.params = JSON.parse(JSON.stringify(p));
  engine.setMasterVolume(engine.params.masterVolume);
  $('masterVolume').value = engine.params.masterVolume;
  $('masterVolumeVal').textContent = engine.params.masterVolume.toFixed(2);
  $('stepInterval').value = engine.params.stepInterval;
  $('stepIntervalVal').textContent = `${engine.params.stepInterval} ms`;
  buildEventControls();
}
function log(el, msg) {
  const time = new Date().toLocaleTimeString();
  el.textContent = `[${time}] ${msg}\n` + el.textContent;
}
function saveParams() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collectParams()));
  log($('paramLog'), '参数已保存到 localStorage');
}
function loadParams() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { log($('paramLog'), '未找到已保存参数'); return false; }
  applyParams(JSON.parse(raw));
  log($('paramLog'), '参数已重载并应用');
  return true;
}
// ---------- 验证 ----------
function renderVerifyTable(rows) {
  const tbody = $('verifyTable').querySelector('tbody');
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.name}</td><td>${r.baseline}</td><td>${r.current}</td>` +
      `<td class="${r.changed ? 'changed' : 'same'}">${r.changed ? '✓ 已变化' : '— 不变'}</td>`;
    tbody.appendChild(tr);
  }
}
async function captureBaseline() {
  baseline = await analyzeParams(collectParams(), pattern);
  log($('verifyLog'), `基线已采集: 主频 ${baseline.dominantFreq.toFixed(1)}Hz, L/R 峰值 ${baseline.peakL.toFixed(3)}/${baseline.peakR.toFixed(3)}, 间隔 ${baseline.avgInterval.toFixed(3)}s`);
}
async function compareNow() {
  if (!baseline) { log($('verifyLog'), '请先采集基线'); return; }
  const current = await analyzeParams(collectParams(), pattern);
  const rows = compareMetrics(baseline, current);
  renderVerifyTable(rows);
  const changedCount = rows.filter((r) => r.changed).length;
  const ok = changedCount >= 3;
  log($('verifyLog'), `对比完成: ${changedCount} 个维度发生变化 — ${ok ? '通过(≥3)' : '不足(需≥3)'}`);
}
async function exportWav() {
  const { wavBytes, check } = await exportAndVerifyWAV(collectParams(), pattern);
  lastExportCheck = check;
  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ui-sounds.wav';
  a.click();
  URL.revokeObjectURL(a.href);
  const pk = check.peaks.map((p) =>
    `ch${p.channel}: 峰值 ${p.srcPeak.toFixed(4)}→${p.dstPeak.toFixed(4)} (误差 ${p.peakErr.toFixed(5)}), 峰位 ${p.srcPeakPos.toFixed(3)}s→${p.dstPeakPos.toFixed(3)}s`
  ).join('\n');
  log($('verifyLog'),
    `WAV 校验: 时长 ${check.durationSrc.toFixed(3)}s→${check.durationWav.toFixed(3)}s ${check.durationOk ? 'OK' : 'FAIL'}, ` +
    `声道 ${check.channelsSrc}→${check.channelsWav} ${check.channelsOk ? 'OK' : 'FAIL'}\n${pk}\n` +
    `关键峰值: ${check.peaksOk ? 'OK' : 'FAIL'}`);
}
async function saveReloadVerify() {
  const before = await analyzeParams(collectParams(), pattern);
  saveParams();
  loadParams();
  const after = await analyzeParams(collectParams(), pattern);
  const rows = compareMetrics(before, after);
  renderVerifyTable(rows);
  const drift = rows.filter((r) => r.changed);
  const nodesOk = engine.activeNodes === 0 || seq.playing;
  log($('paramLog'),
    `保存→重载→复验: ${drift.length === 0 ? '所有维度一致，无节拍漂移' : '存在偏差: ' + drift.map((d) => d.name).join(', ')}; ` +
    `活动节点 ${engine.activeNodes} ${nodesOk ? '(无泄漏)' : '(异常)'}`);
  if (lastExportCheck) {
    log($('paramLog'), `上次 WAV 校验: 时长 ${lastExportCheck.durationOk ? 'OK' : 'FAIL'}, 声道 ${lastExportCheck.channelsOk ? 'OK' : 'FAIL'}, 峰值 ${lastExportCheck.peaksOk ? 'OK' : 'FAIL'}`);
  }
}
// ---------- 走带 ----------
function refreshTransport() {
  $('stTransport').textContent = `状态: ${seq.playing ? '播放中' : '停止'}`;
  $('btnPlay').classList.toggle('active', seq.playing);
}
$('btnPlay').addEventListener('click', () => { seq.start(); refreshTransport(); });
$('btnPause').addEventListener('click', () => { seq.pause(); refreshTransport(); });
$('btnReplay').addEventListener('click', () => { seq.replay(); refreshTransport(); });
$('btnStep').addEventListener('click', () => seq.stepOnce());
$('btnShutdown').addEventListener('click', async () => {
  seq.stop();
  await engine.shutdown();
  refreshTransport();
  log($('paramLog'), `系统已关闭: 活动节点 ${engine.activeNodes}，无尾音残留`);
});
// ---------- 监听状态 ----------
document.querySelectorAll('input[name=monitor]').forEach((el) => {
  el.addEventListener('change', () => {
    engine.ensure();
    engine.setMonitor(el.value);
    const label = { master: '主输出', bypass: '旁路', mute: '静音' }[el.value];
    $('stMonitor').textContent = `监听: ${label}`;
  });
});
// ---------- 全局参数 ----------
$('masterVolume').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  engine.ensure();
  engine.setMasterVolume(v);
  $('masterVolumeVal').textContent = v.toFixed(2);
});
$('stepInterval').addEventListener('input', (e) => {
  engine.params.stepInterval = parseInt(e.target.value, 10);
  $('stepIntervalVal').textContent = `${e.target.value} ms`;
});
// ---------- 参数按钮 ----------
$('btnSave').addEventListener('click', saveParams);
$('btnLoad').addEventListener('click', loadParams);
$('btnDownload').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(collectParams(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sound-params.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
$('fileParams').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  applyParams(JSON.parse(await f.text()));
  log($('paramLog'), `已从文件载入参数: ${f.name}`);
});
$('btnImport').addEventListener('click', () => $('fileParams').click());
$('btnSaveReloadVerify').addEventListener('click', saveReloadVerify);
// ---------- 验证按钮 ----------
$('btnBaseline').addEventListener('click', captureBaseline);
$('btnCompare').addEventListener('click', compareNow);
$('btnExportWav').addEventListener('click', exportWav);
// ---------- 时间线点击编辑 ----------
$('timelineCanvas').addEventListener('click', (e) => {
  const rect = e.target.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * e.target.width;
  vis.handleTimelineClick(x, e.target);
});
// ---------- 状态刷新循环 ----------
engine.onVoiceChange = () => {
  $('stNodes').textContent = `活动节点: ${engine.activeNodes}`;
};
function tick() {
  vis.draw();
  const lv = engine.getLevels();
  const db = (v) => (v > 1e-6 ? (20 * Math.log10(v)).toFixed(1) : '-∞');
  $('stLevelL').textContent = `L: ${db(lv.l)} dB`;
  $('stLevelR').textContent = `R: ${db(lv.r)} dB`;
  $('stNodes').textContent = `活动节点: ${engine.activeNodes}`;
  requestAnimationFrame(tick);
}
buildEventControls();
tick();
