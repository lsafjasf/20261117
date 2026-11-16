import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Minimal PNG IHDR decoder — no extra dependency needed.
function pngHeader(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '必须是 PNG 签名');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function loadPng(file) {
  const require = createRequire(import.meta.url);
  const { PNG } = require('pngjs');
  const buf = await readFile(join(process.cwd(), 'artifacts', file));
  const header = pngHeader(buf);
  const png = PNG.sync.read(buf);
  return { buf, header, png };
}

test('导出核查：三张 PNG 均为 1280x720 且非空白', async () => {
  for (const file of ['paper-street-default.png', 'paper-street-extreme.png', 'paper-street-minimal.png']) {
    const { header, png } = await loadPng(file);
    assert.equal(header.width, 1280);
    assert.equal(header.height, 720);
    const colors = new Set();
    for (let i = 0; i < png.data.length; i += 4000) {
      colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
    }
    assert.ok(colors.size > 50, `${file} 颜色过于单一，疑似空白`);
  }
});

test('导出核查：四角均不透明，缩放缩小后无白边', async () => {
  const { png } = await loadPng('paper-street-minimal.png');
  const { width, height, data } = png;
  const corners = [
    [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
  ];
  for (const [x, y] of corners) {
    const i = (y * width + x) * 4;
    assert.equal(data[i + 3], 255, '角点 alpha 必须不透明');
    const isWhite = data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245;
    assert.equal(isWhite, false, '缩放 0.5 时角点不应是白色');
  }
});

test('导出核查：上半部天空暖色、底部地面暗色，遮挡顺序成立', async () => {
  const { png } = await loadPng('paper-street-default.png');
  const { width, data } = png;
  const brightness = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  assert.ok(brightness(640, 30) > brightness(640, 700), '天空应亮于地面');
  // Warm sky: red channel dominates blue at the top.
  const topIdx = (30 * width + 640) * 4;
  assert.ok(data[topIdx] > data[topIdx + 2], '日落天空应偏暖');
});

test('导出核查：极端图放大 2.5 后中心区域仍被建筑纸张覆盖', async () => {
  const { png } = await loadPng('paper-street-extreme.png');
  const { width, height, data } = png;
  const i = (Math.floor(height * 0.6) * width + Math.floor(width * 0.5)) * 4;
  const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  assert.ok(lum < 110, '近景建筑应为深纸色');
});
