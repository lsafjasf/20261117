import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { performance as nodePerformance } from 'node:perf_hooks';
import { createCanvas } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function bootDom() {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  // 为 jsdom 的 canvas 元素挂载真实 2D 上下文
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__ctx2d) this.__ctx2d = createCanvas(this.width, this.height).getContext('2d');
    return this.__ctx2d;
  };
  // Web Audio 最小桩件
  window.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.sampleRate = 8000;
      this.destination = {};
    }
    createGain() {
      const node = { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} } };
      node.connect = (target) => target;
      return node;
    }
    createOscillator() {
      const node = { type: '', frequency: { value: 0, setTargetAtTime() {} },
        detune: { setTargetAtTime() {} }, start() {}, stop() {} };
      node.connect = (target) => target;
      return node;
    }
    createBiquadFilter() {
      const node = { type: '', frequency: { value: 0 } };
      node.connect = (target) => target;
      return node;
    }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() {
      const node = { buffer: null, loop: false, start() {} };
      node.connect = (target) => target;
      return node;
    }
    connect(target) { return target; }
    resume() {}
  };
  // Blob 下载桩件
  window.Blob = class { constructor(parts) { this.parts = parts; } };
  let downloaded = [];
  window.URL.createObjectURL = () => 'blob:fake';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() {
    downloaded.push({ filename: this.download, href: this.href });
  };
  // ESM 模块在当前 Node 进程执行，但共享 window/document 全局
  global.window = window;
  global.document = window.document;
  global.performance = nodePerformance;
  global.requestAnimationFrame = (fn) => setTimeout(() => fn(nodePerformance.now()), 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  await import(`../src/app.js?${Date.now()}`);
  await new Promise((r) => setTimeout(r, 30));
  return {
    window, dom,
    getDownloads: () => downloaded,
    cleanup: async () => {
      window.__destroyApp && window.__destroyApp();
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

test('界面冒烟：初始渲染、滑块改参写入事件日志', async (t) => {
  const { window, cleanup } = await bootDom();
  t.after(cleanup);
  const doc = window.document;
  assert.ok(doc.getElementById('clockBadge').textContent.includes('0.0s'));
  assert.equal(doc.querySelectorAll('#eventLog tbody tr').length, 0);

  const slider = doc.getElementById('pressure');
  slider.value = '70';
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(doc.getElementById('pressureVal').textContent, '70');
  const logText = doc.getElementById('eventLog').textContent;
  assert.ok(logText.includes('PARAM_CHANGE'));
});

test('界面冒烟：正常生产场景按钮跑完三块并产生批次结果', async (t) => {
  const { window, cleanup } = await bootDom();
  t.after(cleanup);
  const doc = window.document;
  doc.querySelector('[data-scenario="normal"]').click();
  // 场景以 rAF+setTimeout 逐帧驱动，等待完成
  await new Promise((r) => setTimeout(r, 800));
  const stats = doc.getElementById('batchStats').textContent;
  assert.ok(stats.includes('3 / 0'));
  assert.ok(doc.getElementById('eventLog').textContent.includes('BATCH_RESULT'));
  assert.ok(doc.getElementById('scenarioStatus').textContent.includes('场景 normal 结束'));
});

test('界面冒烟：停机场景记录 SHUTDOWN，故障恢复按钮可用', async (t) => {
  const { window, cleanup } = await bootDom();
  t.after(cleanup);
  const doc = window.document;
  doc.querySelector('[data-scenario="shutdown"]').click();
  await new Promise((r) => setTimeout(r, 800));
  const log = doc.getElementById('eventLog').textContent;
  assert.ok(log.includes('SHUTDOWN'));
  assert.ok(log.includes('DEVICE_RESTART'));
  assert.ok(log.includes('过载停机'));
  // 恢复后批次跑完，良品统计出现
  assert.ok(doc.getElementById('batchStats').textContent.includes('停机原因'));
});

test('界面冒烟：JSON/CSV 导出触发下载且报告含良品率与异常位置', async (t) => {
  const { window, getDownloads, cleanup } = await bootDom();
  t.after(cleanup);
  const doc = window.document;
  doc.querySelector('[data-scenario="limit"]').click();
  await new Promise((r) => setTimeout(r, 800));
  const before = getDownloads().length;
  doc.getElementById('btnExportJson').click();
  doc.getElementById('btnExportCsv').click();
  assert.equal(getDownloads().length, before + 2);
  assert.ok(getDownloads().some((d) => d.filename.endsWith('.json')));
  assert.ok(getDownloads().some((d) => d.filename.endsWith('.csv')));
});

test('界面冒烟：禁用持久化存储，setItem 直接抛错', async (t) => {
  const { window, cleanup } = await bootDom();
  t.after(cleanup);
  assert.throws(() => window.localStorage.setItem('x', 'y'), /禁用持久化/);
});
