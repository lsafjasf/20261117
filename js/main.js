/* 主控:项目模型、参数保存/重载、按钮绑定、播放头与电平表刷新。 */
const STORAGE_KEY = 'uid834-timeline-project-v1';

function defaultProject() {
  return {
    version: 1,
    clips: [
      { id: 1, type: 'footsteps',  name: '脚步', start: 0.5, duration: 6,  gain: 0.7,  pan: 0, fadeIn: 0.3, fadeOut: 0.5, volumePoints: [{ t: 2, v: 1.2 }, { t: 4, v: 0.7 }], params: { tempo: 2 } },
      { id: 2, type: 'rain',       name: '雨',   start: 0,   duration: 12, gain: 0.5,  pan: 0, fadeIn: 1,   fadeOut: 2,   volumePoints: [], params: { bright: 1 } },
      { id: 3, type: 'wind',       name: '风',   start: 6,   duration: 10, gain: 0.55, pan: 0, fadeIn: 2,   fadeOut: 2,   volumePoints: [{ t: 5, v: 1.3 }], params: { rate: 0.15, depth: 1 } },
      { id: 4, type: 'mechanical', name: '机械', start: 10,  duration: 8,  gain: 0.6,  pan: 0, fadeIn: 0.2, fadeOut: 1,   volumePoints: [], params: { bpm: 120 } },
    ],
  };
}

let project = defaultProject();
const engine = new Engine();
const $ = id => document.getElementById(id);

function saveProject() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  log(`参数已保存 (${project.clips.length} 个片段)。`);
}
function reloadProject() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { log('没有找到已保存的参数。'); return false; }
  engine.stop();
  project = JSON.parse(raw);
  Timeline.select(null);
  buildClipPanel(null);
  Timeline.draw();
  refreshWaveform();
  log('参数已重载,片段位置已恢复。');
  return true;
}

function log(msg, cls = 'info') {
  const el = $('verifyOut');
  el.innerHTML += `<span class="${cls}">${msg}</span>\n`;
  el.scrollTop = el.scrollHeight;
}

/* ---------- 片段属性面板 ---------- */
const PARAM_DEFS = {
  footsteps:  [{ k: 'tempo',  label: '步频(步/秒)', min: 0.5, max: 4,   step: 0.1 }],
  rain:       [{ k: 'bright', label: '明亮度',       min: 0.4, max: 2.5, step: 0.05 }],
  wind:       [{ k: 'rate',   label: 'LFO 速率',     min: 0.05, max: 1,  step: 0.01 },
               { k: 'depth',  label: 'LFO 深度',     min: 0,   max: 2,   step: 0.05 }],
  mechanical: [{ k: 'bpm',    label: 'BPM',          min: 60,  max: 200, step: 1 }],
};

function buildClipPanel(clip) {
  const p = $('clipPanel');
  if (!clip) { p.innerHTML = '<span class="info">点击片段查看参数;拖动移动;拖上角调交叉淡化;双击添加音量点,Alt+点击删除。</span>'; return; }
  p.innerHTML = '';
  const mk = (label, min, max, step, val, fn) => {
    const d = document.createElement('div'); d.className = 'fld';
    d.innerHTML = `<label>${label} <b>${val}</b></label>`;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    inp.oninput = () => { fn(parseFloat(inp.value)); d.querySelector('b').textContent = inp.value; onProjectChanged(); };
    d.appendChild(inp); p.appendChild(d);
  };
  const title = document.createElement('b'); title.textContent = clip.name; p.appendChild(title);
  mk('增益', 0, 1.5, 0.01, clip.gain, v => clip.gain = v);
  mk('声像', -1, 1, 0.01, clip.pan, v => clip.pan = v);
  mk('淡入(s)', 0, 5, 0.05, clip.fadeIn, v => clip.fadeIn = Math.min(v, clip.duration - clip.fadeOut));
  mk('淡出(s)', 0, 5, 0.05, clip.fadeOut, v => clip.fadeOut = Math.min(v, clip.duration - clip.fadeIn));
  mk('时长(s)', 1, 20, 0.5, clip.duration, v => { clip.duration = v; clip.start = Math.min(clip.start, TIMELINE_LEN - v); });
  for (const pd of PARAM_DEFS[clip.type])
    mk(pd.label, pd.min, pd.max, pd.step, clip.params[pd.k], v => clip.params[pd.k] = v);
}

/* ---------- 波形预览(低采样率离线渲染) ---------- */
let waveTimer = null;
function refreshWaveform() {
  clearTimeout(waveTimer);
  waveTimer = setTimeout(async () => {
    try {
      const { buffer } = await Exporter.renderOffline(project, engine.masterGainValue, 8000);
      const L = buffer.getChannelData(0), n = L.length, cols = 600;
      const peaks = new Float32Array(cols);
      for (let i = 0; i < n; i++) {
        const c = Math.floor(i / n * cols);
        const a = Math.abs(L[i]);
        if (a > peaks[c]) peaks[c] = a;
      }
      Timeline.setWaveform(peaks);
    } catch (e) { log('波形预览失败: ' + e.message, 'fail'); }
  }, 250);
}

function onProjectChanged() { Timeline.draw(); refreshWaveform(); }

/* ---------- 电平表与播放头循环 ---------- */
function drawMeter(cv, db) {
  const c = cv.getContext('2d');
  const w = cv.width = cv.clientWidth, h = cv.height = cv.clientHeight;
  c.fillStyle = '#0c0f14'; c.fillRect(0, 0, w, h);
  const frac = isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
  c.fillStyle = frac > 0.9 ? '#ff6b6b' : frac > 0.7 ? '#e0a458' : '#5fd68a';
  c.fillRect(0, 0, w * frac, h);
}

function uiLoop() {
  const t = engine.playhead();
  Timeline.setPlayhead(t);
  $('stPlayhead').textContent = t.toFixed(2) + 's';
  $('stState').textContent = { playing: '播放中', paused: '已暂停', stopped: '停止' }[engine.state];
  $('stNodes').textContent = engine.activeNodeCount();
  const lv = engine.levels();
  drawMeter($('meterL'), lv.l); drawMeter($('meterR'), lv.r);
  const mx = Math.max(lv.l, lv.r);
  $('stLevel').textContent = isFinite(mx) ? mx.toFixed(1) + ' dB' : '-∞ dB';
  if (engine.state === 'playing' && t >= TIMELINE_LEN) engine.stop();
  requestAnimationFrame(uiLoop);
}

/* ---------- 绑定 ---------- */
window.addEventListener('DOMContentLoaded', () => {
  Timeline.init($('timeline'), project, {
    onClipChanged: () => onProjectChanged(),
    onSelect: c => buildClipPanel(c),
    onSeek: t => {
      if (engine.state === 'playing') engine.play(project, t);
      else { engine.offset = t; Timeline.setPlayhead(t); }
    },
  });
  $('btnPlay').onclick = () => engine.play(project);
  $('btnPause').onclick = () => engine.pause();
  $('btnReplay').onclick = () => engine.replay(project);
  $('btnStop').onclick = () => engine.stop();
  $('btnStep').onclick = () => engine.step(project, parseFloat($('stepSize').value));
  $('masterGain').oninput = e => engine.setMasterGain(parseFloat(e.target.value));
  const monBtns = { main: $('monMain'), bypass: $('monBypass'), mute: $('monMute') };
  for (const [mode, btn] of Object.entries(monBtns))
    btn.onclick = () => {
      engine.setMonitor(mode);
      for (const [m, b] of Object.entries(monBtns)) b.classList.toggle('active', m === mode);
      log('试听状态切换到: ' + btn.textContent);
    };
  $('btnSave').onclick = saveProject;
  $('btnReload').onclick = reloadProject;
  $('btnExport').onclick = () => exportWAV();
  $('btnVerify').onclick = () => runVerify();
  refreshWaveform();
  uiLoop();
});
