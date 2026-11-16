import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, analyzeBuffer, compareMetrics, makeFakeBuffer } from '../js/wav.js';

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

test('编码出的 WAV 头声明正确的声道数、采样率与数据长度', async () => {
  const buffer = makeFakeBuffer(2, 8000, new Float32Array(8000 * 2).fill(0.25));
  const blob = encodeWav(buffer);
  const bytes = await blobBytes(blob);
  const view = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(40, true), 8000 * 2 * 2);
  assert.equal(bytes.length, 44 + 8000 * 2 * 2);
});

test('四声道 WAV 的 blockAlign 与声道字段正确', async () => {
  const buffer = makeFakeBuffer(4, 48000, new Float32Array(4800 * 4).fill(0.1));
  const view = new DataView((await blobBytes(encodeWav(buffer))).buffer);
  assert.equal(view.getUint16(22, true), 4);
  assert.equal(view.getUint16(32, true), 8);
});

test('analyzeBuffer 提取时长、峰值与左右差异', () => {
  const interleaved = new Float32Array(1000 * 2);
  for (let i = 0; i < 1000; i++) {
    interleaved[i * 2] = 0.8;
    interleaved[i * 2 + 1] = 0.2;
  }
  const metrics = analyzeBuffer(makeFakeBuffer(2, 1000, interleaved));
  assert.equal(metrics.durationMs, 1000);
  assert.equal(metrics.channels, 2);
  assert.ok(Math.abs(metrics.perChannel[0].peak - 0.8) < 1e-6);
  assert.ok(Math.abs(metrics.perChannel[1].peak - 0.2) < 1e-6);
  assert.ok(metrics.leftRightPeakDelta > 0.59);
});

test('相同渲染结果的对比全部通过，改动后峰值行失败', () => {
  const buf = makeFakeBuffer(2, 1000, new Float32Array(2000).fill(0.3));
  const a = analyzeBuffer(buf);
  const same = compareMetrics(a, structuredClone(a));
  assert.ok(same.allPass);

  const other = structuredClone(a);
  other.perChannel[0].peak = 0.95;
  const diff = compareMetrics(a, other);
  assert.equal(diff.allPass, false);
  assert.ok(diff.rows.find((r) => r.metric.includes('CH1')).pass === false);
});

test('时长或声道不一致时对比判失败', () => {
  const a = analyzeBuffer(makeFakeBuffer(2, 1000, new Float32Array(2000)));
  const b = analyzeBuffer(makeFakeBuffer(4, 1000, new Float32Array(4000)));
  const result = compareMetrics(a, b);
  assert.equal(result.allPass, false);
  assert.ok(result.rows.find((r) => r.metric === '声道数').pass === false);
});
