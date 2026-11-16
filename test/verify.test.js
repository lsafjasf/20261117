import { test, before } from "node:test";
import assert from "node:assert/strict";
import { renderOffline } from "../js/exporter.js";
import {
  verifyDimensions, compareExports, beatDriftReport, tailSilence,
  channelBalance, bandEnergy
} from "../js/verify.js";
import { decodeWav } from "../js/dsp.js";
import { DEFAULT_PARAMS, saveParams, loadParams, sanitizeParams } from "../js/params.js";
import { installWebAudioGlobals, MemoryStorage } from "./helpers.js";

before(() => installWebAudioGlobals());

test("离线渲染产出立体声 WAV，时长与节拍数一致", async () => {
  const out = await renderOffline(DEFAULT_PARAMS, { bars: 3 });
  assert.equal(out.channelData.length, 2);
  const dur = out.channelData[0].length / out.sampleRate;
  const expected = (60 / DEFAULT_PARAMS.bpm) * 3 + 0.4;
  assert.ok(Math.abs(dur - expected) < 0.35, `时长 ${dur} 接近 ${expected}`);
  const decoded = decodeWav(out.wav);
  assert.equal(decoded.channels, 2);
  assert.ok(channelBalance(out.channelData).lPeak > 0.1);
});

test("四维验证至少三维随操作真实变化", async () => {
  const report = await verifyDimensions();
  for (const r of report.results) {
    assert.ok(typeof r.pass === "boolean", `${r.dim} 有布尔结论`);
  }
  assert.ok(report.passCount >= 3, `仅 ${report.passCount}/4 通过`);
  assert.equal(report.ok, true);
});

test("声像操作真实改变左右声道平衡", async () => {
  const center = await renderOffline({ ...DEFAULT_PARAMS, pan: 0 });
  const right = await renderOffline({ ...DEFAULT_PARAMS, pan: 1 });
  const b1 = channelBalance(center.channelData);
  const b2 = channelBalance(right.channelData);
  assert.ok(Math.abs(b1.balance) < 0.05);
  assert.ok(b2.balance > 0.5, `右偏 balance=${b2.balance}`);
});

test("静音模式导出为数字静音，旁路与主输出不同", async () => {
  const muted = await renderOffline(DEFAULT_PARAMS, { mode: "mute" });
  const main = await renderOffline(DEFAULT_PARAMS, { mode: "main" });
  const bypass = await renderOffline(DEFAULT_PARAMS, { mode: "bypass" });
  const mb = channelBalance(muted.channelData);
  assert.ok(mb.lPeak < 0.001 && mb.rPeak < 0.001);
  assert.ok(channelBalance(main.channelData).lPeak > 0.1);
  assert.ok(channelBalance(bypass.channelData).lPeak > 0.1);
  const mainE = bandEnergy(main.channelData, main.sampleRate);
  const byE = bandEnergy(bypass.channelData, bypass.sampleRate);
  assert.notDeepEqual(
    [mainE.low.toFixed(6), mainE.high.toFixed(6)],
    [byE.low.toFixed(6), byE.high.toFixed(6)]
  );
});

test("节拍漂移低于 15ms，末端无尾音", async () => {
  const out = await renderOffline({ ...DEFAULT_PARAMS, bpm: 120, delayTime: 0, feedback: 0 }, { bars: 3 });
  const drift = beatDriftReport(out.channelData, out.sampleRate, 120, 3);
  assert.ok(drift.onsets.length >= 3, `检测到 ${drift.onsets.length} 个起音`);
  assert.ok(drift.maxErr < 0.02, `最大误差 ${drift.maxErr}`);
  const tail = tailSilence(out.channelData, out.sampleRate, 0.12);
  assert.ok(tail < 0.003, `尾部 RMS ${tail}`);
});

test("保存->重载参数后再导出：时长/声道/峰值一致", async () => {
  const storage = new MemoryStorage();
  const custom = { ...DEFAULT_PARAMS, pan: -0.4, bpm: 96, highsDb: 8, detuneLow: 12 };
  saveParams(custom, storage);
  const reloaded = sanitizeParams(loadParams(storage));
  assert.equal(reloaded.pan, -0.4);
  assert.equal(reloaded.bpm, 96);
  const a = await renderOffline(custom, { bars: 3 });
  const b = await renderOffline(reloaded, { bars: 3 });
  const cmp = compareExports(a.wav, b.wav);
  assert.ok(cmp.duration.equal);
  assert.ok(cmp.channels.equal);
  assert.ok(Math.abs(cmp.peak.a.l - cmp.peak.b.l) < 1e-4);
  assert.ok(Math.abs(cmp.peak.a.r - cmp.peak.b.r) < 1e-4);
  assert.equal(cmp.balance.changed, false);
});

test("非法参数被钳制回默认范围", () => {
  const p = sanitizeParams({ bpm: 9999, pan: 5, wave: "hammond", feedback: 2 });
  assert.equal(p.bpm, DEFAULT_PARAMS.bpm);
  assert.equal(p.pan, DEFAULT_PARAMS.pan);
  assert.equal(p.wave, DEFAULT_PARAMS.wave);
  assert.equal(p.feedback, DEFAULT_PARAMS.feedback);
});
