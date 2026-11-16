import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Wav = require('../js/wav-encoder.js');
const Metrics = require('../js/metrics.js');
const Params = require('../js/params.js');

function makeTone(sr, sec, freqL, freqR, withBeat) {
  const n = Math.floor(sr * sec);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beatEnv = withBeat ? (0.4 + 0.6 * Math.pow(Math.max(0,
      Math.sin(t * Math.PI * 2 * 2)), 2)) : 1;
    l[i] = Math.sin(t * Math.PI * 2 * freqL) * 0.5 * beatEnv;
    r[i] = Math.sin(t * Math.PI * 2 * freqR) * 0.4 * beatEnv;
  }
  return [l, r];
}

const sr = 48000;
const channels = makeTone(sr, 2, 440, 660, true);

const wav = Wav.encodeWav(channels, sr);
assert.ok(wav.byteLength === 44 + channels[0].length * 2 * 2, 'wav size');
const decoded = Wav.decodeWav(wav);
assert.equal(decoded.sampleRate, sr, 'sample rate roundtrip');
assert.equal(decoded.channels.length, 2, 'stereo roundtrip');
assert.equal(decoded.channels[0].length, channels[0].length, 'frame count');
let maxErr = 0;
for (let i = 0; i < channels[0].length; i++) {
  maxErr = Math.max(maxErr,
    Math.abs(decoded.channels[0][i] - channels[0][i]));
}
assert.ok(maxErr < 1 / 32768 * 1.5, '16-bit quant error within LSB');

const summary = Metrics.summarize(channels, sr, {
  low: [60, 250], mid: [400, 1600], high: [5000, 10000],
});
assert.equal(summary.channels, 2, 'summary channels');
assert.ok(Math.abs(summary.durationSec - 2) < 0.001, 'duration');
assert.ok(summary.peaks[0] > 0.49 && summary.peaks[0] <= 0.501, 'L peak');
assert.ok(summary.peaks[1] > 0.39 && summary.peaks[1] <= 0.401, 'R peak');
assert.equal(summary.clippedSamples, 0, 'no clipping');
assert.ok(summary.balance.diff > 0.01, 'L/R differ');
assert.ok(summary.beat.count >= 3, 'beats detected: ' + summary.beat.count);
assert.ok(summary.beat.maxDriftSec < 0.02, 'steady beat');

const clipped = [new Float32Array([1, -1, 0.5]), new Float32Array([0.9, 0, -1])];
const clipInfo = Metrics.peakAndClip(clipped);
assert.ok(clipInfo.clipped >= 3, 'clipped samples counted');

const clean = Params.sanitize({
  speed: 99, notchFreq: -5, gateEnabled: false, mode: 'bypass', junk: 1,
});
assert.equal(clean.speed, 2, 'clamped to max');
assert.equal(clean.notchFreq, 500, 'clamped to min');
assert.equal(clean.gateEnabled, false, 'bool kept');
assert.equal(clean.mode, 'bypass', 'mode kept');
assert.equal(clean.junk, undefined, 'unknown key dropped');
const def = Params.sanitize(null);
assert.equal(def.speed, Params.DEFAULTS.speed, 'null -> defaults');

const bands = Metrics.bandEnergy(
  [new Float32Array(sr).map((_, i) => Math.sin(i / sr * 2 * Math.PI * 3000))],
  sr, { low: [60, 250], notch: [2800, 3800] });
assert.ok(bands.notch > bands.low * 100, 'band energy localizes tone');

console.log('node-test: all assertions passed');
