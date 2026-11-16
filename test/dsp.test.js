import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectPitch, centsOffset, encodeWav, decodeWav, rms, peak, magnitudeSpectrum
} from "../js/dsp.js";
import { sineWave, noisySine, SR } from "./helpers.js";

test("自相关检测可识别 110/220/440 Hz，抗背景噪声", () => {
  for (const f of [110, 220, 440]) {
    const buf = noisySine(f, 0.5, 0.004, SR);
    const r = detectPitch(buf, SR, { noiseFloor: 0.01 });
    assert.ok(r.freq > 0, `${f}Hz 应检出频率`);
    assert.ok(Math.abs(r.freq - f) / f < 0.01, `检出 ${r.freq} 偏离 ${f}`);
    const cents = centsOffset(r.freq, f);
    assert.ok(Math.abs(cents) < 12);
  }
});

test("低于噪声门限返回零频率", () => {
  const buf = noisySine(220, 0.3, 0.0005, SR).map((v) => v * 0.02);
  const r = detectPitch(buf, SR, { noiseFloor: 0.05 });
  assert.equal(r.freq, 0);
});

test("FFT 频谱在正弦频率附近出现峰值", () => {
  const buf = sineWave(440, 1, SR);
  const size = 1 << Math.floor(Math.log2(buf.length));
  const mag = magnitudeSpectrum(buf.slice(0, size));
  const binHz = SR / size;
  let peakBin = 0;
  for (let i = 1; i < mag.length; i++) if (mag[i] > mag[peakBin]) peakBin = i;
  assert.ok(Math.abs(peakBin * binHz - 440) < binHz * 2);
});

test("WAV 编码后再解码保持时长、声道与峰值", () => {
  const frames = SR * 0.5;
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    l[i] = 0.6 * Math.sin(2 * Math.PI * 220 * i / SR);
    r[i] = 0.3 * Math.sin(2 * Math.PI * 330 * i / SR);
  }
  const wav = encodeWav([l, r], SR);
  assert.ok(wav.byteLength === 44 + frames * 4);
  const decoded = decodeWav(wav);
  assert.equal(decoded.channels, 2);
  assert.equal(decoded.sampleRate, SR);
  assert.equal(decoded.channelData[0].length, frames);
  assert.ok(Math.abs(peak(decoded.channelData[0]) - 0.6) < 0.01);
  assert.ok(Math.abs(peak(decoded.channelData[1]) - 0.3) < 0.01);
  assert.ok(rms(decoded.channelData[0]) > rms(decoded.channelData[1]));
});

test("削波信号峰值被钳制在 1", () => {
  const buf = sineWave(110, 0.2, SR).map((v) => v * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.max(-1, Math.min(1, buf[i]));
  assert.ok(peak(buf) <= 1);
});
