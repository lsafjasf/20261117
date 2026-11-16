import { test } from "node:test";
import assert from "node:assert/strict";
import { Tuner } from "../js/tuner.js";
import { DEFAULT_PARAMS } from "../js/params.js";
import { noisySine, SR } from "./helpers.js";

test("三个音区连续稳定后判定调音完成", () => {
  const tuner = new Tuner({ ...DEFAULT_PARAMS, holdRounds: 2, centsTolerance: 8 });
  const targets = [110, 220, 440];
  for (const f of targets) {
    const buf = noisySine(f, 0.4, 0.003, SR);
    tuner.processFrame(buf, SR);
    assert.equal(tuner.snapshot().complete, false);
    tuner.processFrame(noisySine(f, 0.4, 0.003, SR), SR);
  }
  const snap = tuner.snapshot();
  assert.equal(snap.complete, true);
  assert.ok(snap.registers.every((r) => r.ok));
});

test("偏差超出容差不会误判为校准", () => {
  const tuner = new Tuner({ ...DEFAULT_PARAMS, centsTolerance: 8, holdRounds: 1 });
  // 约 +35 音分
  const off = 110 * Math.pow(2, 35 / 1200);
  tuner.processFrame(noisySine(off, 0.4, 0.002, SR), SR);
  assert.equal(tuner.states.get("low").ok, false);
});

test("削波（增益过高）时不计为有效校准", () => {
  const tuner = new Tuner({ ...DEFAULT_PARAMS, centsTolerance: 8, holdRounds: 1, inputGain: 3 });
  const buf = noisySine(220, 0.4, 0.002, SR).map((v) => Math.max(-1, Math.min(1, v * 3)));
  tuner.processFrame(buf, SR, true);
  assert.equal(tuner.overload, true);
  assert.equal(tuner.states.get("mid").ok, false);
});

test("模拟麦克风注入背景噪声后仍能通过门限识别", () => {
  const clean = noisySine(440, 0.4, 0.001, SR);
  const sim = Tuner.simulateMicInput(clean, SR, 1, 0.004);
  const tuner = new Tuner({ ...DEFAULT_PARAMS, holdRounds: 1 });
  const r = tuner.processFrame(sim.buffer, SR);
  assert.equal(r.regId, "high");
  assert.ok(Math.abs(r.cents) < 10);
});
