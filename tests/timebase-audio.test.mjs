import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TimelineClock,
  PLAYBACK,
  nearestBeat,
  beatEvents,
  snapTimeToFrame,
  BEAT_INTERVAL
} from "../src/core/timebase.mjs";
import { buildAudioEvents, checkCutBeatSync } from "../src/core/audio.mjs";
import { buildDemoProject } from "../src/core/demo.mjs";

test("时钟在播放/暂停/拖动/循环间保持单一时间基准", () => {
  let now = 0;
  const clock = new TimelineClock({ duration: 4, loop: true, perfNow: () => now });
  clock.play();
  now += 500;
  assert.ok(Math.abs(clock.tick() - 0.5) < 1e-9);
  clock.pause();
  now += 5000;
  assert.ok(Math.abs(clock.time - 0.5) < 1e-9, "暂停后时间不再前进");
  clock.seek(2.25);
  assert.equal(clock.time, 2.25);
  clock.play();
  now += 2000;
  const loops = [];
  clock.onLoop = (n) => loops.push(n);
  const t = clock.tick();
  assert.ok(t < 4 && t > 0, "循环播放回到时间线内部");
  assert.equal(loops.length, 1);
});

test("非循环模式播放到结尾自动暂停并触发 onEnd", () => {
  let now = 0;
  const clock = new TimelineClock({ duration: 2, loop: false, perfNow: () => now });
  let ended = 0;
  clock.onEnd = () => { ended += 1; };
  clock.play();
  now = 2500;
  clock.tick();
  assert.equal(clock.state, PLAYBACK.PAUSED);
  assert.equal(clock.time, 2);
  assert.equal(ended, 1);
});

test("节拍网格吸附与帧吸附", () => {
  assert.equal(nearestBeat(0.73), 0.5);
  assert.equal(nearestBeat(1.26), 1.5);
  assert.equal(snapTimeToFrame(1 / 3), snapTimeToFrame(1 / 3));
  assert.equal(beatEvents(2).at(-1), 2);
  assert.equal(BEAT_INTERVAL, 0.5);
});

test("音频事件与切点使用同一张节拍表", () => {
  const events = buildAudioEvents(4, [1, 3]);
  const cues = events.filter((e) => e.kind === "cue").map((e) => e.time);
  assert.deepEqual(cues, [1, 3]);
  assert.ok(events.some((e) => e.time === 1 && e.kind === "kick"));
  assert.ok(events.some((e) => e.time === 0.75 && e.kind === "hat"));
});

test("示例工程所有切点与音频 cue 完全同步、漂移为 0", () => {
  const { project } = buildDemoProject();
  const sync = checkCutBeatSync(project);
  assert.equal(sync.synced, true);
  assert.equal(sync.maxDrift, 0);
  assert.equal(sync.rows.length, 3);
});
