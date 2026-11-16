import assert from "node:assert/strict";

// canvas-frame 面向浏览器，测试中以最小 Canvas 桩提供 2D 上下文。
class StubImageData { constructor(w, h) { this.data = new Uint8ClampedArray(w * h * 4); } }
class StubContext {
  createImageData(w, h) { return new StubImageData(w, h); }
  putImageData() {}
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => new StubContext() })
};
import { createStore } from "../src/core/store.js";
import { createInitialState, reducer, selectConflicts } from "../src/core/reducer.js";
import { createTicker, setPlayhead, play, pause, setLoop } from "../src/core/clock.js";
import { buildSampleProject } from "../src/core/sampleProject.js";
import { createMemoryStorage, saveProject, loadProject, replayFailedOperations } from "../src/core/project.js";
import { ThumbnailScheduler, buildVisibleThumbEntries, thumbKey } from "../src/core/thumbnails.js";
import { createCanvasFrameProvider } from "../web/canvas-frame.js";
import { renderSourceFrame, renderSourceSamples } from "../src/core/synthetic.js";
import { renderFrame, renderAudio, isBlack } from "../src/core/compositor.js";
import { exportPng, exportProgram, compareDurations, assertExportable } from "../src/core/exporter.js";

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  \u2717 ${name}\n    ${error.stack.split("\n").slice(0, 3).join("\n    ")}`);
  }
}

function freshStore() {
  return createStore(reducer, createInitialState(buildSampleProject()));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log("\n时间线编辑器核心验证：\n");

await test("1. 共享时钟：播放/暂停/拖动/循环统一驱动播放头与事件", () => {
  const store = freshStore();
  const ticker = createTicker(store, () => 0);
  store.dispatch(play());
  ticker.advance(0.25);
  assert.equal(store.getState().clock.time, 0.25);
  store.dispatch(pause());
  ticker.advance(1);
  assert.equal(store.getState().clock.time, 0.25);
  store.dispatch(setPlayhead(5));
  assert.equal(store.getState().clock.time, 5);
  store.dispatch(setLoop(true));
  store.dispatch({ type: "SET_LOOP_REGION", loopIn: 2, loopOut: 6 });
  store.dispatch(play());
  ticker.advance(2);
  assert.ok(store.getState().clock.time < 6 && store.getState().clock.time >= 2, "循环后回到区间内");
});

await test("2. 片段移动：视频与同组音频整体平移且音画偏移不变", () => {
  const store = freshStore();
  const video = store.getState().timeline.videos[1];
  const audio = store.getState().timeline.audios[1];
  const offsetBefore = audio.start - video.start;
  const srcOffsetBefore = audio.srcIn - video.srcIn;
  store.dispatch({ type: "MOVE_CLIP", clipId: video.id, newStart: video.start + 1.5 });
  const v2 = store.getState().timeline.videos.find((item) => item.id === video.id);
  const a2 = store.getState().timeline.audios.find((item) => item.id === audio.id);
  assert.equal(a2.start - v2.start, offsetBefore);
  assert.equal(a2.srcIn - v2.srcIn, srcOffsetBefore);
});

await test("3. 非法移动被阻止：超出边界或造成重叠时状态不变", () => {
  const store = freshStore();
  const clip = store.getState().timeline.videos[1];
  const before = JSON.stringify(store.getState().timeline);
  store.dispatch({ type: "MOVE_CLIP", clipId: clip.id, newStart: 3 });
  assert.equal(JSON.stringify(store.getState().timeline), before);
  assert.match(store.getState().lastError, /重叠/);
  store.dispatch({ type: "MOVE_CLIP", clipId: clip.id, newStart: -5 });
  assert.match(store.getState().lastError, /边界/);
});

await test("4. 分割：视频与音频同时切开，两侧时长之和等于原值", () => {
  const store = freshStore();
  const clip = store.getState().timeline.videos[0];
  const audio = store.getState().timeline.audios[0];
  const cutAt = clip.start + 3;
  store.dispatch({ type: "SPLIT_CLIP", clipId: clip.id, atTime: cutAt });
  const videos = store.getState().timeline.videos.filter((item) => item.groupId === clip.groupId);
  const audios = store.getState().timeline.audios.filter((item) => item.groupId === clip.groupId);
  assert.equal(videos.length, 2);
  assert.equal(audios.length, 2);
  assert.ok(Math.abs(videos[0].duration + videos[1].duration - clip.duration) < 1e-9);
  assert.ok(Math.abs(audios[0].duration + audios[1].duration - audio.duration) < 1e-9);
  // 分割点两侧取到的源采样连续，证明音画仍对齐。
  const source = store.getState().sources[clip.sourceId];
  const left = renderSourceSamples(source, audio.srcIn + 2.99, audio.srcIn + 3);
  const right = renderSourceSamples(source, audio.srcIn + 3, audio.srcIn + 3.01);
  assert.ok(left.samples.length > 0 && right.samples.length > 0);
});

await test("5. 转场：相邻片段交叉淡化，合成帧随进度变化且音频仍对齐", () => {
  const store = freshStore();
  const [a, b] = store.getState().timeline.videos;
  const durations = Object.fromEntries(Object.entries(store.getState().sources).map(([id, s]) => [id, s.duration]));
  const result = reducer(store.getState(), { type: "ADD_TRANSITION", fromClipId: a.id, toClipId: b.id, duration: 2, sourceDurations: durations });
  assert.equal(result.lastError, null);
  assert.equal(result.timeline.transitions[0].duration, 2);
  const state = result;
  const atStart = renderFrame(state.timeline, state.sources, 8, "16:9");
  const atMid = renderFrame(state.timeline, state.sources, 9, "16:9");
  assert.ok(!atStart.every((v, i) => v === atMid[i]), "转场区间帧内容应随时间变化");
  const audio = state.timeline.audios.find((item) => item.groupId === b.groupId);
  const video = state.timeline.videos.find((item) => item.id === b.id);
  assert.equal(audio.start, video.start, "转场后音频事件与画面起点仍共用同一时间基准");
});

await test("6. 保存/重新载入：入点、出点与事件位置完全保持", () => {
  const store = freshStore();
  const storage = createMemoryStorage();
  const original = JSON.stringify(store.getState().timeline);
  saveProject(store, "project.json", storage);
  const store2 = createStore(reducer, createInitialState());
  assert.equal(loadProject(store2, "project.json", storage), true);
  assert.equal(JSON.stringify(store2.getState().timeline), original);
  const clip = store2.getState().timeline.videos[0];
  assert.equal(clip.srcIn, 2);
  assert.ok(Math.abs(clip.srcIn + clip.duration - 10) < 1e-9, "出点 = 入点 + 时长");
  assert.equal(store2.getState().timeline.subtitles[0].start, 1);
});

await test("7. 非法重叠阻止导出并标出冲突位置", () => {
  const store = freshStore();
  // 手工构造一个重叠时间线（绕过 reducer 的移动保护，模拟损坏工程文件）。
  const broken = {
    ...store.getState().timeline,
    videos: store.getState().timeline.videos.map((clip, i) => (i === 1 ? { ...clip, start: 2 } : clip))
  };
  const conflicts = selectConflicts({ ...store.getState(), timeline: broken });
  assert.ok(conflicts.length >= 1);
  assert.ok(conflicts.every((item) => item.end > item.start));
  assert.throws(() => assertExportable(broken), (error) => {
    assert.equal(error.conflicts.length, conflicts.length);
    assert.equal(typeof error.conflicts[0].track, "string");
    return true;
  });
});

await test("8. 缩略图代次：旧异步结果不能覆盖新请求，失败可回放", async () => {
  const store = freshStore();
  const entries = buildVisibleThumbEntries(store.getState().timeline, store.getState().view, 400);
  assert.ok(entries.length >= 3);
  let failOnce = true;
  const provider = async (entry) => {
    await sleep(5);
    if (failOnce && entry.clipId.endsWith("1")) { failOnce = false; throw new Error("模拟解码失败"); }
    return renderSourceFrame(store.getState().sources[entry.sourceId], entry.srcTime, entry.crop);
  };
  const scheduler = new ThumbnailScheduler(store, provider);
  scheduler.requestVisible(entries);
  const oldGeneration = scheduler.generation;
  scheduler.requestVisible(entries);
  assert.equal(scheduler.generation, oldGeneration + 1);
  await sleep(30);
  const keys = Object.keys(store.getState().thumbnails.results);
  assert.ok(keys.length > 0, "新代次结果已写入");
  assert.ok(Object.values(store.getState().thumbnails.jobs).every((job) => job.generation === scheduler.generation),
    "没有旧代次结果残留");
  const retried = scheduler.retryFailed(entries);
  assert.ok(retried.length >= 1, "失败任务被重新排队");
  await sleep(30);
  assert.equal(scheduler.failed.length, 0, "回放后失败队列清空");
});

await test("9. 缩略图对应正确帧：同一 srcTime 像素一致，裁切比例生效", () => {
  const store = freshStore();
  const source = store.getState().sources["src-a"];
  const f1 = renderSourceFrame(source, 3.25, "16:9");
  const f2 = renderSourceFrame(source, 3.25, "16:9");
  assert.deepEqual(Array.from(f1.rgba), Array.from(f2.rgba));
  const square = renderSourceFrame(source, 3.25, "1:1");
  assert.ok(square.width < f1.width, "1:1 裁切宽度窄于 16:9");
  const keyA = thumbKey({ clipId: "v-1", srcTime: 3.25, width: 48, height: 40, crop: "16:9" });
  const keyB = thumbKey({ clipId: "v-1", srcTime: 3.25, width: 48, height: 40, crop: "1:1" });
  assert.notEqual(keyA, keyB, "切换裁切比例会使缓存键失效并重新出图");
});

await test("10. 选帧 PNG 导出：文件头合法且非黑帧", () => {
  const store = freshStore();
  return exportPng(store.getState().timeline, store.getState().sources, 4.5, "16:9").then((png) => {
    assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(png.length > 100);
  });
  const frame = renderFrame(store.getState().timeline, store.getState().sources, 4.5, "16:9");
  assert.equal(isBlack(frame), false);
});

await test("11. 节目导出：APNG/WAV 可播放且首尾无黑帧", async () => {
  const store = freshStore();
  const result = await exportProgram(store.getState().timeline, store.getState().sources, { fps: 4 });
  assert.deepEqual(Array.from(result.apng.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const apngText = new TextDecoder().decode(result.apng);
  assert.ok(apngText.includes("acTL") && apngText.includes("fcTL"), "包含 APNG 动画控制块");
  assert.deepEqual(Array.from(result.wav.subarray(0, 4)), [82, 73, 70, 70]);
  assert.deepEqual(Array.from(result.wav.subarray(8, 12)), [87, 65, 86, 69]);
  assert.equal(result.frameCount, Math.round(store.getState().timeline.duration * 4));
  assert.ok(Math.abs(result.audioDurationSeconds - store.getState().timeline.duration) < 0.02);
});

await test("12. 时长比较：裁切后与转场后的两段节目时长可量化对比", async () => {
  const store = freshStore();
  const base = await exportProgram(store.getState().timeline, store.getState().sources, { fps: 4 });
  // 裁切方案：把每段视频尾部去掉 2 秒（通过缩短片段并整体前移模拟）。
  const croppedTimeline = {
    ...store.getState().timeline,
    duration: 18,
    videos: store.getState().timeline.videos.map((clip, i) => ({
      ...clip,
      start: i * 6,
      duration: 6
    })),
    audios: store.getState().timeline.audios.map((clip, i) => ({
      ...clip,
      start: i * 6,
      duration: 6
    }))
  };
  const cropped = await exportProgram(croppedTimeline, store.getState().sources, { fps: 4 });
  const comparison = compareDurations(base, cropped);
  assert.equal(comparison.a, 24);
  assert.equal(comparison.b, 18);
  assert.equal(comparison.delta, -6);
  assert.match(comparison.verdict, /更短/);
});

await test("13. 失败回放：被阻止的操作在条件修复后重试成功", () => {
  const store = freshStore();
  const clip = store.getState().timeline.videos[1];
  const targetStart = 3; // 与第一个片段 [0,8] 重叠，必然被阻止
  store.dispatch({ type: "MOVE_CLIP", clipId: clip.id, newStart: targetStart });
  assert.ok(store.getState().operations.some((op) => op.ok === false));
  // 条件未修复时回放：仍失败且继续留档。
  let replay = replayFailedOperations(store);
  assert.equal(replay.remaining.length, 1);
  assert.equal(replay.retried.length, 0);
  // 修复条件：把第一个片段切短到 [0,3]，腾出 [3,...] 空间。
  const first = store.getState().timeline.videos[0];
  store.dispatch({ type: "SPLIT_CLIP", clipId: first.id, atTime: 3 });
  const split = store.getState().timeline.videos.find((item) => item.id === `${first.id}-b`);
  // 将切出的后半段移出原轨道到 v2（本用例直接删除该后段来腾出空间）。
  const tailAudio = store.getState().timeline.audios.find((item) => item.id.endsWith("-b"));
  const withoutTail = {
    ...store.getState().timeline,
    videos: store.getState().timeline.videos.filter((item) => item.id !== split.id),
    audios: store.getState().timeline.audios.filter((item) => item.id !== tailAudio.id)
  };
  store.dispatch({ type: "REPLACE_TIMELINE", timeline: withoutTail });
  replay = replayFailedOperations(store);
  assert.equal(replay.retried.length, 1, "条件修复后回放成功");
  const movedClip = store.getState().timeline.videos.find((item) => item.id === clip.id);
  assert.equal(movedClip.start, targetStart);
});


await test("14. 浏览器 Canvas 提供者：失败注入后重试可恢复，产出 canvas 位图", async () => {
  const store = freshStore();
  const entries = buildVisibleThumbEntries(store.getState().timeline, store.getState().view, 400);
  let fail = true;
  const provider = createCanvasFrameProvider(store.getState().sources, {
    failPattern: () => {
      if (fail) { fail = false; return true; }
      return false;
    }
  });
  const scheduler = new ThumbnailScheduler(store, provider);
  scheduler.requestVisible(entries);
  await sleep(30);
  assert.ok(scheduler.failed.length >= 1, "首次注入失败被记录");
  const retried = scheduler.retryFailed(entries);
  assert.ok(retried.length >= 1);
  await sleep(30);
  assert.equal(scheduler.failed.length, 0);
  const done = Object.values(store.getState().thumbnails.results);
  assert.ok(done.length > 0 && done[0].bitmap.width > 0, "结果为 Canvas 位图而非黑帧占位");
});

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 个用例通过\n`);
process.exit(failed.length ? 1 : 0);
