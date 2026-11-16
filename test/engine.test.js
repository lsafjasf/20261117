import { test, before } from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../js/engine.js";
import { DEFAULT_PARAMS } from "../js/params.js";
import { MockAudioContext } from "./mock-audio.js";

before(() => {});

test("音频图节点全部登记，teardown 后无残留", () => {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(ctx, DEFAULT_PARAMS);
  const count = engine.activeNodeCount();
  assert.ok(count >= 16, `应登记固定图节点，实际 ${count}`);
  engine.teardown();
  assert.equal(engine.nodes.size, 0);
  return ctx.close();
});

test("三种试听状态切换到对应增益", () => {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(ctx, DEFAULT_PARAMS);
  engine.setMode("mute");
  assert.equal(engine.mode, "mute");
  assert.equal(engine.muteGain.gain.value, 0);
  engine.setMode("bypass");
  assert.equal(engine.mode, "bypass");
  assert.ok(engine.bypassBus.gain.value > 0.9);
  assert.equal(engine.mainBus.gain.value, 0);
  engine.setMode("main");
  assert.ok(engine.mainBus.gain.value > 0.9);
  engine.teardown();
  return ctx.close();
});

test("播放->暂停后调度队列清空且无残留音符节点", async () => {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(ctx, { ...DEFAULT_PARAMS, bpm: 240 });
  engine.play();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(engine.scheduled.length > 0 || engine.stepIndex > 0);
  engine.pause();
  assert.equal(engine.running, false);
  assert.equal(engine.scheduled.length, 0);
  assert.equal(engine.timer, null);
  const oscNodes = [...engine.nodes].filter((n) => n.detune !== undefined && n.frequency !== undefined);
  assert.equal(oscNodes.length, 0);
  engine.teardown();
  return ctx.close();
});

test("重播将节拍位置归零，单步只推进一个音符", async () => {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(ctx, DEFAULT_PARAMS);
  engine.play();
  await new Promise((r) => setTimeout(r, 120));
  engine.pause();
  engine.replay();
  assert.equal(engine.stepIndex, 0);
  assert.equal(engine.running, true);
  engine.pause();
  engine.step();
  assert.equal(engine.stepIndex, 1);
  engine.pause();
  assert.equal(engine.scheduled.length, 0);
  engine.teardown();
  return ctx.close();
});
