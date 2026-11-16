import { test } from "node:test";
import assert from "node:assert/strict";
import { Tuner } from "../js/tuner.js";
import { AudioEngine } from "../js/engine.js";
import { renderOffline } from "../js/exporter.js";
import { compareExports, channelBalance } from "../js/verify.js";
import { DEFAULT_PARAMS, REGISTERS, sanitizeParams, saveParams, loadParams } from "../js/params.js";
import { noisySine, installWebAudioGlobals, MemoryStorage, SR } from "./helpers.js";
import { MockAudioContext } from "./mock-audio.js";

test("端到端：初始偏差 -> 微调归零 -> 三音区保持 -> 调音完成", () => {
  installWebAudioGlobals();
  const params = sanitizeParams(DEFAULT_PARAMS);
  const tuner = new Tuner(params);
  // 初始状态：各音区带偏差，应无法通过
  for (const reg of REGISTERS) {
    const key = `detune${reg.id[0].toUpperCase()}${reg.id.slice(1)}`;
    const f = reg.target * Math.pow(2, params[key] / 1200);
    tuner.processFrame(noisySine(f, 0.4, 0.003, SR), SR);
  }
  assert.equal(tuner.isComplete(), false);

  // 用户把三个音区微调到 0
  params.detuneLow = 0;
  params.detuneMid = 0;
  params.detuneHigh = 0;
  tuner.updateParams(params);
  for (let round = 0; round < params.holdRounds; round++) {
    for (const reg of REGISTERS) {
      tuner.processFrame(noisySine(reg.target, 0.4, 0.003, SR), SR);
    }
  }
  const snap = tuner.snapshot();
  assert.equal(snap.complete, true);
  assert.ok(snap.registers.every((r) => r.ok && Math.abs(r.lastCents) <= params.centsTolerance));
});

test("端到端：保存重载后再导出，结果与首次一致，模拟再播放无节点泄漏", async () => {
  installWebAudioGlobals();
  const storage = new MemoryStorage();
  const params = sanitizeParams({ ...DEFAULT_PARAMS, pan: 0.35, bpm: 100, delayTime: 0.22 });
  const first = await renderOffline(params, { bars: 3 });
  saveParams(params, storage);
  const reloaded = sanitizeParams(loadParams(storage));
  const second = await renderOffline(reloaded, { bars: 3 });
  const cmp = compareExports(first.wav, second.wav);
  assert.ok(cmp.duration.equal && cmp.channels.equal);
  assert.ok(Math.abs(cmp.peak.a.l - cmp.peak.b.l) < 1e-4);
  assert.ok(Math.abs(cmp.peak.a.r - cmp.peak.b.r) < 1e-4);

  // 模拟“重载参数后再播放一次”，随后暂停，确认无残留。
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(ctx, reloaded);
  engine.play();
  await new Promise((r) => setTimeout(r, 120));
  engine.pause();
  assert.equal(engine.scheduled.length, 0);
  const osc = [...engine.nodes].filter((n) => n.detune !== undefined && n.frequency !== undefined);
  assert.equal(osc.length, 0);
  engine.teardown();
  assert.equal(engine.nodes.size, 0);
  return ctx.close();
});

test("端到端：主输出/旁路/静音三态电平符合预期", async () => {
  installWebAudioGlobals();
  const main = await renderOffline(DEFAULT_PARAMS, { mode: "main" });
  const bypass = await renderOffline(DEFAULT_PARAMS, { mode: "bypass" });
  const mute = await renderOffline(DEFAULT_PARAMS, { mode: "mute" });
  assert.ok(channelBalance(main.channelData).lPeak > 0.1);
  assert.ok(channelBalance(bypass.channelData).lPeak > 0.1);
  assert.ok(channelBalance(mute.channelData).lPeak < 0.001);
});
