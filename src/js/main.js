import { PaperStreetApp } from './app.js';
import { PARAM_SCHEMA } from './params.js';

const canvas = document.getElementById('scene');
const errorBanner = document.getElementById('errorBanner');
const pauseBadge = document.getElementById('pauseBadge');
const statusLine = document.getElementById('statusLine');
const statsList = document.getElementById('statsList');
const form = document.getElementById('paramForm');
const jsonInput = document.getElementById('jsonInput');

const app = new PaperStreetApp({
  canvas,
  onStatus: (status) => {
    statusLine.textContent = status.text;
    statusLine.classList.toggle('error', status.type === 'error');
    if (status.type === 'error') {
      errorBanner.textContent = status.text;
      errorBanner.hidden = false;
    } else {
      errorBanner.hidden = true;
    }
  },
  onStats: (stats) => {
    statsList.innerHTML = '';
    for (const [key, value] of Object.entries(stats)) {
      const li = document.createElement('li');
      li.textContent = `${key}: ${value}`;
      statsList.appendChild(li);
    }
  },
});

function fillForm(params) {
  for (const [key, spec] of Object.entries(PARAM_SCHEMA)) {
    const input = form.elements[key];
    if (!input) continue;
    if (spec.type === 'boolean') input.checked = Boolean(params[key]);
    else input.value = params[key];
  }
  syncOutputs();
}

function syncOutputs() {
  form.querySelectorAll('input[type="range"]').forEach((input) => {
    const output = input.parentElement.querySelector('output');
    if (output) output.textContent = input.value;
  });
}

function readForm() {
  const patch = {};
  for (const [key, spec] of Object.entries(PARAM_SCHEMA)) {
    const input = form.elements[key];
    if (!input) continue;
    patch[key] = spec.type === 'boolean' ? input.checked : input.value;
  }
  return patch;
}

const initErrors = app.init();
fillForm(app.params);
if (initErrors.length === 0) {
  statusLine.textContent = '已就绪：参数已从本地恢复或使用默认值';
}

form.querySelectorAll('input').forEach((input) => {
  input.addEventListener('input', syncOutputs);
});

document.getElementById('applyBtn').addEventListener('click', () => {
  const result = app.applyParams(readForm());
  if (result.ok) fillForm(result.params);
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const result = app.applyParams(readForm(), { persist: true });
  if (result.ok) fillForm(result.params);
});

document.getElementById('resetViewBtn').addEventListener('click', () => app.resetView());

const pauseBtn = document.getElementById('pauseBtn');
pauseBtn.addEventListener('click', () => {
  app.setPaused(!app.paused);
  pauseBtn.textContent = app.paused ? '继续' : '暂停';
  pauseBadge.hidden = !app.paused;
});

const audioBtn = document.getElementById('audioBtn');
audioBtn.addEventListener('click', async () => {
  const state = await app.toggleAudio();
  audioBtn.textContent = `环境声：${state.playing ? '开' : '关'}`;
});

document.getElementById('shotBtn').addEventListener('click', () => {
  app.capturePNG(true);
  statusLine.textContent = 'PNG 已导出';
  statusLine.classList.remove('error');
});

document.getElementById('jsonFillBtn').addEventListener('click', () => {
  jsonInput.value = JSON.stringify(app.lastGoodParams, null, 2);
});

document.getElementById('jsonApplyBtn').addEventListener('click', () => {
  let parsed;
  try {
    parsed = JSON.parse(jsonInput.value);
  } catch (error) {
    app.showError(`JSON 解析失败：${error.message}`);
    return;
  }
  const result = app.applyParams(parsed);
  if (result.ok) fillForm(result.params);
});

globalThis.__paperStreet = app;
