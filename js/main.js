import { defaultState, serializeParams, applyParams, computeSpatial, STEP_COUNT } from './acoustics.js';
import { AudioEngine } from './audio-engine.js';
import { RoomView, SOURCE_COLORS } from './room-view.js';
import { encodeWav, analyzeBuffer, compareMetrics } from './wav.js';
import { collectSnapshot, diffSnapshots, cleanCheck, beatDriftCheck } from './verify.js';

const state = defaultState();
let engine = null;
let room = null;
let exportHistory = [];
let snapshotBefore = null;
const stepTimestamps = [];

const $ = (id) => document.getElementById(id);

function log(msg, level = '') {
  const line = document.createElement('div');
  if (level) line.className = level;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  $('logPanel').appendChild(line);
  $('logPanel').scrollTop = $('logPanel').scrollHeight;
}

function ensureEngine() {
  if (!engine) {
    engine = new AudioEngine(state);
    engine.meterCallback = renderMeters;
    log('AudioContext 已创建（首次用户手势后激活）', 'ok');
  }
  return engine;
}

function renderSourceEditor() {
  const host = $('sourceEditor');
  host.innerHTML = '';
  state.sources.forEach((source, i) => {
    const card = document.createElement('div');
    card.className = 'source-card';
    card.style.borderLeft = `4px solid ${SOURCE_COLORS[i]}`;
    card.innerHTML = `
      <h3>${source.name}</h3>
      <div class="row">
        波形
        <select data-id="${i}" data-key="type">
          ${['sine', 'triangle', 'sawtooth', 'square', 'noise']
            .map((t) => `<option ${t === source.type ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        频率 <input type="number" min="20" max="12000" step="10"
          data-id="${i}" data-key="freq" value="${source.freq}" /> Hz
      </div>
      <div class="row">步进模式
        ${source.pattern.map((on, step) =>
          `<button class="pat" data-id="${i}" data-step="${step}"
             style="min-width:30px;padding:4px 6px;${on ? 'background:#2f6df6;color:#fff' : ''}">
             ${step + 1}</button>`).join('')}
      </div>`;
    host.appendChild(card);
  });
  host.querySelectorAll('select, input').forEach((el) => {
    el.addEventListener('change', (e) => {
      const src = state.sources[Number(e.target.dataset.id)];
      const key = e.target.dataset.key;
      src[key] = key === 'freq' ? Number(e.target.value) : e.target.value;
      log(`${src.name} ${key} 变更为 ${src[key]}`);
      room.draw(engine?.currentStep ?? -1);
    });
  });
  host.querySelectorAll('button.pat').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = state.sources[Number(btn.dataset.id)];
      const step = Number(btn.dataset.step);
      src.pattern[step] = src.pattern[step] ? 0 : 1;
      renderSourceEditor();
    });
  });
}

function renderRoomReadout() {
  const lines = state.sources.map((s) => {
    const sp = computeSpatial(state.mode, s, state.listener);
    return `${s.name}: ${sp.distanceM}m, ${sp.delayMs}ms, 增益${sp.gain}`;
  });
  $('roomReadout').textContent = lines.join(' ｜ ');
}

function renderMeters(readings) {
  const host = $('meters');
  const labels = state.mode === 'surround' ? ['FL', 'FR', 'BL', 'BR'] : ['左声道', '右声道'];
  if (host.children.length !== readings.length) {
    host.innerHTML = readings.map((_, i) => `
      <div class="meter-block">
        <div class="name"><span>${labels[i] ?? 'CH' + i}</span>
          <span class="val${i}">- dB</span></div>
        <div class="bar"><i class="level"></i></div>
        <div class="bands">
          <div class="band"><div class="bar"><i class="low"></i></div><small>低</small></div>
          <div class="band"><div class="bar"><i class="mid"></i></div><small>中</small></div>
          <div class="band"><div class="bar"><i class="high"></i></div><small>高</small></div>
        </div>
      </div>`).join('');
  }
  readings.forEach((r, i) => {
    const block = host.children[i];
    const db = 20 * Math.log10(Math.max(r.rms, 1e-5));
    block.querySelector('.val' + i).textContent = `${db.toFixed(1)} dB`;
    block.querySelector('.level').style.width = `${Math.min(100, r.rms * 220)}%`;
    block.querySelector('.low').style.width = `${r.bands.low * 100}%`;
    block.querySelector('.mid').style.width = `${r.bands.mid * 100}%`;
    block.querySelector('.high').style.width = `${r.bands.high * 100}%`;
  });
}

function updateTransportUi() {
  if (!engine) {
    $('stateReadout').textContent = '已停止';
    $('nodeReadout').textContent = '活动节点 0';
    $('stepReadout').textContent = '节拍 0/8';
    return;
  }
  $('stateReadout').textContent = engine.playing
    ? `播放中 · ${state.audition === 'mute' ? '静音' : state.audition === 'bypass' ? '旁路' : '主输出'}`
    : '已暂停（声音已停止）';
  $('nodeReadout').textContent = `活动节点 ${engine.activeNodeCount}`;
  $('stepReadout').textContent = `节拍 ${engine.currentStep + (engine.playing ? 0 : 1)}/${STEP_COUNT}`;
  $('playBtn').textContent = engine.playing ? '⏸ 暂停' : '▶ 播放';
}

async function togglePlay() {
  const eng = ensureEngine();
  if (eng.playing) {
    eng.pause();
    const result = cleanCheck(eng);
    log(`暂停：${result.note}，活动节点=${result.activeNodes}`, result.pass ? 'ok' : 'err');
    updateTransportUi();
    room.draw(-1);
  } else {
    await eng.play();
    log(`开始播放：模式=${state.mode}，试听=${state.audition}，BPM=${state.bpm}`, 'ok');
  }
  updateTransportUi();
  room.draw(eng.currentStep);
}

function replay() {
  const eng = ensureEngine();
  stepTimestamps.length = 0;
  eng.replay();
  log('重播：步进序列从头开始，调度时间基线已重置', 'ok');
  updateTransportUi();
}

async function singleStep() {
  const eng = ensureEngine();
  await eng.singleStep();
  stepTimestamps.push(performance.now());
  log(`单步触发，下一指针=${eng.currentStep + 1}/${STEP_COUNT}`);
  updateTransportUi();
  room.draw(eng.currentStep - 1 < 0 ? STEP_COUNT - 1 : eng.currentStep - 1);
}

function setMode(mode) {
  if (state.mode === mode) return;
  const previousPositions = state.sources.map((s) => ({ x: s.x, y: s.y }));
  state.mode = mode;
  document.querySelectorAll('#modeSeg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));
  // 声源与监听点位置完全保留，仅重建音频图。
  const preserved = state.sources.every((s, i) =>
    s.x === previousPositions[i].x && s.y === previousPositions[i].y);
  if (engine) engine.rebuildIfPlaying();
  log(`切换到 ${mode} 模式；声源位置保留=${preserved}`, preserved ? 'ok' : 'err');
  $('meters').innerHTML = '';
  room.draw(engine?.currentStep ?? -1);
  renderRoomReadout();
}

function setAudition(audition) {
  state.audition = audition;
  document.querySelectorAll('#auditionSeg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.audition === audition));
  if (engine) engine.setAudition(audition);
  log(`试听状态 → ${audition === 'main' ? '主输出（空间化+混响）'
    : audition === 'bypass' ? '旁路（干声）' : '静音（图保留、输出为零）'}`);
  updateTransportUi();
}

function bindTransport() {
  $('playBtn').addEventListener('click', togglePlay);
  $('replayBtn').addEventListener('click', replay);
  $('stepBtn').addEventListener('click', singleStep);
  $('bpmInput').value = state.bpm;
  $('bpmInput').addEventListener('change', (e) => {
    state.bpm = Number(e.target.value);
    log(`BPM → ${state.bpm}（下一节拍生效，无累计漂移）`);
  });
  document.querySelectorAll('#modeSeg button').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#auditionSeg button').forEach((b) =>
    b.addEventListener('click', () => setAudition(b.dataset.audition)));

  $('reverbMix').addEventListener('input', (e) => {
    state.reverbMix = Number(e.target.value);
    $('reverbMixVal').textContent = state.reverbMix.toFixed(2);
  });
  $('reverbDecay').addEventListener('input', (e) => {
    state.reverbDecay = Number(e.target.value);
    $('reverbDecayVal').textContent = state.reverbDecay.toFixed(1) + 's';
  });

  setInterval(() => {
    if (engine) {
      updateTransportUi();
      room.draw(engine.playing ? engine.currentStep : -1);
      renderRoomReadout();
    }
  }, 120);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportWav(tag = '') {
  const eng = ensureEngine();
  const buffer = await eng.renderOffline(2);
  const blob = encodeWav(buffer);
  const metrics = analyzeBuffer(buffer);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `room-${state.mode}-${tag || stamp}.wav`;
  download(blob, filename);
  const record = { filename, metrics, at: stamp, params: serializeParams(state) };
  exportHistory.push(record);
  log(`WAV 导出：${filename}，${metrics.channels} 声道，${metrics.durationMs}ms`, 'ok');
  renderCompareTable();
  return record;
}

function renderCompareTable() {
  const host = $('comparePanel');
  if (exportHistory.length < 2) {
    host.innerHTML = `<p class="readout">已导出 ${exportHistory.length} 个 WAV，再导出一次即可自动对比时长、声道与关键峰值。</p>`;
    return;
  }
  const latest = exportHistory[exportHistory.length - 1];
  const previous = exportHistory[exportHistory.length - 2];
  const result = compareMetrics(previous.metrics, latest.metrics);
  host.innerHTML = `
    <table>
      <thead><tr><th>指标</th><th>${previous.filename.slice(0, 18)}</th>
      <th>${latest.filename.slice(0, 18)}</th><th>判定</th></tr></thead>
      <tbody>${result.rows.map((r) => `<tr>
        <td>${r.metric}</td><td>${r.a}</td><td>${r.b}</td>
        <td class="${r.pass ? 'pass' : 'fail'}">${r.pass ? '一致' : '变化'}</td></tr>`).join('')}
      </tbody></table>
    <p class="${result.allPass ? 'pass' : 'warn'}">${result.allPass
      ? '两次导出在容差内完全一致（参数重载场景）。'
      : '指标存在预期内差异（参数变化场景），详见各行。'}</p>`;
}

function saveParams() {
  const json = serializeParams(state);
  const blob = new Blob([json], { type: 'application/json' });
  download(blob, `room-params-${Date.now()}.json`);
  log('参数已保存为 JSON（含声源位置、模式、BPM、混响与步进模式）', 'ok');
}

function loadParamsFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const params = JSON.parse(reader.result);
      const wasPlaying = engine?.playing;
      if (wasPlaying) engine.pause();
      applyParams(state, params);
      document.querySelectorAll('#modeSeg button').forEach((b) =>
        b.classList.toggle('active', b.dataset.mode === state.mode));
      document.querySelectorAll('#auditionSeg button').forEach((b) =>
        b.classList.toggle('active', b.dataset.audition === state.audition));
      $('bpmInput').value = state.bpm;
      $('reverbMix').value = state.reverbMix;
      $('reverbMixVal').textContent = Number(state.reverbMix).toFixed(2);
      $('reverbDecay').value = state.reverbDecay;
      $('reverbDecayVal').textContent = Number(state.reverbDecay).toFixed(1) + 's';
      renderSourceEditor();
      room.draw();
      renderRoomReadout();
      log('参数已重载，声源位置与模式按文件恢复', 'ok');
    } catch (err) {
      log(`参数载入失败：${err.message}`, 'err');
    }
  };
  reader.readAsText(file);
}

function snapshotVerify() {
  if (!snapshotBefore) {
    snapshotBefore = collectSnapshot(state);
    log('已采集验证快照 A：请移动监听点/声源、改频率或 BPM 后再次点击。', 'warn');
    return;
  }
  const after = collectSnapshot(state);
  const result = diffSnapshots(snapshotBefore, after);
  const host = $('verifyPanel');
  host.innerHTML = `
    <table><thead><tr><th>维度</th><th>是否变化</th><th>证据</th></tr></thead>
    <tbody>${result.dims.map((d) => `<tr>
      <td>${d.dimension}</td>
      <td class="${d.changed ? 'pass' : 'fail'}">${d.changed ? '真实变化' : '未变化'}</td>
      <td style="text-align:left;font-size:11px">${d.detail}</td></tr>`).join('')}</tbody></table>
    <p class="${result.pass ? 'pass' : 'fail'}">
      ${result.changedCount}/4 个维度发生真实变化，${result.pass ? '满足至少三维要求 ✓' : '未达到三维要求 ✗'}</p>`;
  log(`四维验证：${result.changedCount}/4 变化，判定=${result.pass ? '通过' : '失败'}`,
    result.pass ? 'ok' : 'err');
  snapshotBefore = null;
}

function runCleanCheck() {
  if (!engine) { log('引擎尚未创建', 'warn'); return; }
  const result = cleanCheck(engine);
  log(`清洁自检：活动节点=${result.activeNodes}，播放=${result.playing}，会话开启=${result.sessionOpen}`,
    result.pass ? 'ok' : 'err');
  const drift = beatDriftCheck(stepTimestamps, state.bpm);
  if (stepTimestamps.length >= 2) {
    log(`节拍漂移：${drift.note}`, drift.pass ? 'ok' : 'err');
  }
}

function bindExport() {
  $('exportWavBtn').addEventListener('click', () => exportWav());
  $('saveParamsBtn').addEventListener('click', saveParams);
  $('loadParamsBtn').addEventListener('click', () => $('paramFile').click());
  $('paramFile').addEventListener('change', (e) => {
    if (e.target.files[0]) loadParamsFile(e.target.files[0]);
    e.target.value = '';
  });
  $('snapshotBtn').addEventListener('click', snapshotVerify);
  $('cleanCheckBtn').addEventListener('click', runCleanCheck);
}

async function fullRegression() {
  // 端到端自检：保存 → 重载 → 再导出 → 对比 → 再播放 → 暂停清洁。
  const first = await exportWav('regress-a');
  const params = JSON.parse(serializeParams(state));
  applyParams(state, params);
  const second = await exportWav('regress-b');
  const result = compareMetrics(first.metrics, second.metrics);
  log(`回归对比：${result.allPass ? '全部一致 ✓' : '存在差异 ✗'}`, result.allPass ? 'ok' : 'err');
  renderCompareTable();
  const eng = ensureEngine();
  await eng.play();
  setTimeout(() => {
    eng.pause();
    const clean = cleanCheck(eng);
    log(`重载后播放→暂停：${clean.note}`, clean.pass ? 'ok' : 'err');
    updateTransportUi();
  }, 600);
}

function init() {
  room = new RoomView($('roomCanvas'), state, () => renderRoomReadout());
  room.draw();
  renderSourceEditor();
  renderRoomReadout();
  bindTransport();
  bindExport();
  window.__regression = fullRegression;
  window.__getState = () => state;
  log('就绪：拖动画布上的声源或监听点，点击播放开始实时渲染。');
}

init();
