import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOp,
  sortedClips,
  projectDuration,
  buildShotList
} from "../src/core/project.mjs";
import { buildDemoProject } from "../src/core/demo.mjs";
import { checkCutBeatSync } from "../src/core/audio.mjs";
import { verifyExport } from "../src/core/exporter.mjs";
import { TimelineClock, PLAYBACK } from "../src/core/timebase.mjs";
import { saveProject, loadProject, diffPositions } from "../src/core/persistence.mjs";
import { composeFrame } from "../src/core/composer.mjs";
import { createRecordingCtx } from "../src/core/exporter.mjs";

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, v); }
}

test("端到端：移动→分割→转场全程音画对齐，重载点位不变，非法重叠阻止导出", () => {
  const initial = buildDemoProject();
  let project = initial.project;
  const journal = initial.journal;
  const durationBefore = projectDuration(project);

  // 1) 波纹移动一个片段到相邻拍点
  const moved = applyOp(project, {
    type: "moveClip",
    id: sortedClips(project)[1].id,
    start: 5
  });
  assert.equal(moved.ok, true, moved.error);
  journal.record(moved.project.lastOp, moved);
  project = moved.project;

  // 2) 在拍点分割首段
  const split = applyOp(project, {
    type: "splitClip",
    id: sortedClips(project)[0].id,
    at: 2
  });
  assert.equal(split.ok, true, split.error);
  journal.record(split.project.lastOp, split);
  project = split.project;

  // 3) 给新切点设置短叠化
  const target = sortedClips(project).find((c) => c.start === 2);
  const transition = applyOp(project, {
    type: "setTransition",
    id: target.id,
    transition: "dissolve",
    duration: 0.4
  });
  assert.equal(transition.ok, true, transition.error);
  journal.record(transition.project.lastOp, transition);
  project = transition.project;

  // 4) 全程音画同步
  const sync = checkCutBeatSync(project);
  assert.equal(sync.synced, true);
  assert.equal(sync.maxDrift, 0);

  // 5) 时长对比：移动后总时长与初始不同，镜头表记录每次时长
  const durationAfter = projectDuration(project);
  assert.ok(durationAfter !== durationBefore);
  const shotDurations = buildShotList(project).map((s) => s.duration);
  assert.ok(shotDurations.length >= buildShotList(initial.project).length);

  // 6) 保存并从存储重载，点位完全一致
  const storage = new MemoryStorage();
  saveProject(storage, project, journal);
  const reloaded = loadProject(storage);
  assert.equal(diffPositions(project, reloaded.project).identical, true);

  // 7) 重载后的工程仍可通过逐帧导出校验，首尾无黑帧
  const report = verifyExport(reloaded.project);
  assert.equal(report.exportable, true);
  assert.equal(report.headBlack.length, 0);
  assert.equal(report.tailBlack.length, 0);
  assert.equal(report.blackFrames.length, 0);

  // 8) 制造非法重叠：导出必须被阻止且带冲突坐标
  const last = sortedClips(project).at(-1);
  const illegal = applyOp(project, { type: "overlapClip", id: last.id, start: last.start - 1.5 });
  assert.equal(illegal.ok, false);
  journal.record(illegal.project?.lastOp ?? { type: "overlapClip" }, illegal);
  assert.ok(illegal.conflicts.some((c) => c.type === "illegal_overlap"));

  // 9) 失败回放：日志中包含被拦截的操作，重放终点仍可导出
  const replay = journal.replay();
  assert.ok(replay.trace.some((t) => !t.ok));
  assert.equal(verifyExport(replay.project).exportable, true);
});

test("端到端：循环播放期间时间线、画面与音频事件共用同一时间", () => {
  let now = 0;
  const { project } = buildDemoProject();
  const duration = projectDuration(project);
  const clock = new TimelineClock({ duration, loop: true, perfNow: () => now });
  const seenTimes = [];
  clock.onBeat = (t) => seenTimes.push(t);
  clock.play();
  now = 4900;
  const wrappedTime = clock.tick();
  assert.ok(wrappedTime < duration && wrappedTime > 0);

  // 同一时刻：合成画面、音频事件、时间线读到的时间完全一致
  const ctx = createRecordingCtx(320, 180);
  const frame = composeFrame(ctx, project, wrappedTime, { width: 320, height: 180 });
  assert.equal(frame.covered, true);
  const beatNear = seenTimes.some((t) => Math.abs(t - Math.round(wrappedTime * 2) / 2) < 0.51);
  assert.ok(beatNear);

  clock.pause();
  now += 10_000;
  assert.equal(clock.state, PLAYBACK.PAUSED);
  assert.equal(clock.time, wrappedTime);
});
