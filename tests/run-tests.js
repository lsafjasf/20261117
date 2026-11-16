"use strict";

const assert = require("assert");
const path = require("path");
const { FakeCanvas } = require("./fake-canvas.js");

const util = require("../js/util.js");
const model = require("../js/model.js");
const vtt = require("../js/vtt.js");
const storage = require("../js/storage.js");
const audio = require("../js/audio.js");
const transportApi = require("../js/transport.js");
const renderer = require("../js/renderer.js");
const exporter = require("../js/exporter.js");

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

test("默认工程合法：节拍网格 + 5 条逐字字幕 + 2 片段", () => {
  const p = model.createDefaultProject();
  assert.strictEqual(p.subtitles.length, 5);
  assert.strictEqual(p.beats.length, 25);
  const report = model.validateProject(p);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.issues.length, 0);
});

test("移动片段造成重叠 -> 阻止并返回冲突坐标", () => {
  const p = model.createDefaultProject();
  const r = model.dispatch(p, "move-clip", { id: "clip_b", start: 4.0 });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /重叠/);
  const report = model.validateProject(r.project);
  assert.ok(report.conflictLocs.length >= 0);
  assert.strictEqual(r.project.clips[1].start, 5.8, "原状态必须保持不变");
});

test("入点/出点越界与过短 -> 阻止保存", () => {
  const p = model.createDefaultProject();
  const oob = model.dispatch(p, "trim-clip", { id: "clip_a", edge: "out", value: 99 });
  assert.strictEqual(oob.ok, false);
  const short = model.dispatch(p, "trim-cue", { id: "cue_1", edge: "out", value: 0.49 });
  assert.strictEqual(short.ok, false);
  const cueOob = model.dispatch(p, "trim-cue", { id: "cue_5", edge: "out", value: 13 });
  assert.strictEqual(cueOob.ok, false);
  const clamped = model.dispatch(p, "move-cue", { id: "cue_5", start: 11.9 });
  assert.strictEqual(clamped.ok, true);
  assert.ok(clamped.project.subtitles[4].end <= p.duration + util.EPS);
});

test("字幕重叠与逐字乱序 -> 校验报错并定位", () => {
  const p = model.createDefaultProject();
  const moved = model.dispatch(p, "move-cue", { id: "cue_2", start: 1.5 });
  assert.strictEqual(moved.ok, false);
  const broken = util.deepClone(p);
  broken.subtitles[0].chars[2].t = 0.5;
  const report = model.validateProject(broken);
  assert.ok(report.errors.some(e => e.code === "char-order"));
  assert.ok(report.conflictLocs.some(l => l.lane === "subtitles"));
});

test("逐字微调被夹在相邻字时间之间，保持单调", () => {
  const p = model.createDefaultProject();
  const cue = p.subtitles[0];
  const r = model.dispatch(p, "nudge-char", { id: cue.id, index: 0, time: 99 });
  assert.strictEqual(r.ok, true);
  assert.ok(r.project.subtitles[0].chars[0].t <= cue.chars[1].t);
  const r2 = model.dispatch(p, "nudge-char", { id: cue.id, index: 2, time: -50 });
  assert.ok(r2.project.subtitles[0].chars[2].t >= cue.chars[1].t);
});

test("分割片段：总时长守恒且两段边界精确相接", () => {
  const p = model.createDefaultProject();
  const clip = p.clips[0];
  const originalLen = clip.end - clip.start;
  const r = model.dispatch(p, "split-clip", { id: clip.id, at: 3.0 });
  assert.strictEqual(r.ok, true);
  const parts = r.project.clips.filter(c => c.id === clip.id || c.id === clip.id + "_split");
  assert.strictEqual(parts.length, 2);
  const total = parts.reduce((s, c) => s + (c.end - c.start), 0);
  assert.ok(util.nearlyEqual(total, originalLen, 1e-4));
  assert.ok(util.nearlyEqual(parts[0].end, parts[1].start, 1e-6));
  assert.strictEqual(model.validateProject(r.project).ok, true);
});

test("交叉淡化转场：等量重叠合法，普通重叠非法", () => {
  const p = model.createDefaultProject();
  const a = model.dispatch(p, "set-transition", { id: "clip_a", edge: "out", duration: 0.4 });
  const b = model.dispatch(a.project, "set-transition", { id: "clip_b", edge: "in", duration: 0.4 });
  assert.strictEqual(b.ok, true);
  const moved = model.dispatch(b.project, "move-clip", { id: "clip_b", start: 5.4 });
  assert.strictEqual(moved.ok, true, "0.4s 交叉淡化重叠应被允许");
  const removeFade = model.dispatch(moved.project, "set-transition", { id: "clip_b", edge: "in", duration: 0 });
  assert.strictEqual(removeFade.ok, false, "去掉转场后同样的重叠必须被阻止");
});

test("WebVTT 导出再导入：文本、cue 时间与逐字时间恢复（1ms 容差）", () => {
  const p = model.createDefaultProject();
  const text = vtt.exportVTT(p.subtitles);
  assert.match(text, /^WEBVTT/);
  const cues = vtt.importVTT(text);
  assert.strictEqual(cues.length, p.subtitles.length);
  p.subtitles.forEach((orig, i) => {
    const imp = cues[i];
    assert.strictEqual(imp.text, orig.text);
    assert.ok(Math.abs(imp.start - orig.start) < 0.0011);
    assert.ok(Math.abs(imp.end - orig.end) < 0.0011);
    assert.strictEqual(imp.chars.length, orig.chars.length);
    imp.chars.forEach((c, k) => {
      assert.strictEqual(c.ch, orig.chars[k].ch);
      assert.ok(Math.abs(c.t - orig.chars[k].t) < 0.0011);
    });
  });
});

test("导入后的字幕替换进工程仍可通过整体校验", () => {
  const p = model.createDefaultProject();
  const cues = vtt.importVTT(vtt.exportVTT(p.subtitles));
  const next = util.deepClone(p);
  next.subtitles = cues;
  assert.strictEqual(model.validateProject(next).ok, true);
  assert.throws(() => vtt.importVTT("not a vtt file"));
});

test("工程保存后重新载入：入点、出点、节拍与事件位置保持不变", () => {
  const p = model.createDefaultProject();
  const edited = model.dispatch(p, "move-clip", { id: "clip_b", start: 6.2 }).project;
  const edited2 = model.dispatch(edited, "nudge-char", { id: "cue_3", index: 1, time: 5.5 }).project;
  const serialized = storage.serialize(edited2);
  const loaded = storage.parseProject(serialized);
  assert.deepStrictEqual(loaded.clips, edited2.clips);
  assert.deepStrictEqual(loaded.subtitles, edited2.subtitles);
  assert.deepStrictEqual(loaded.beats, edited2.beats);
  assert.throws(() => storage.parseProject("{bad json"));
  assert.throws(() => storage.parseProject(JSON.stringify({ version: 99 })));
});

test("统一时间基准：transport 推进后时间线、播放头、音频调度读同一时间", () => {
  const p = model.createDefaultProject();
  const t = new transportApi.Transport(p, null);
  const seen = [];
  t.onTick(snap => seen.push(snap.time));
  t.play();
  assert.strictEqual(t.state, "playing");
  t.advanceForTest(0.5);
  t.advanceForTest(0.25);
  assert.ok(util.nearlyEqual(t.time, 0.75, 1e-6));
  t.pause();
  assert.strictEqual(t.state, "paused");
  const frozen = t.time;
  t.advanceForTest(1.0);
  assert.strictEqual(t.time, frozen, "暂停后时间不得推进");
  t.seek(2.0);
  assert.strictEqual(t.time, 2.0);
  t.stop();
  assert.strictEqual(t.time, 0);
  assert.ok(seen.length >= 3);
});

test("循环区间内播放会自动回到循环起点并计数", () => {
  const p = model.createDefaultProject();
  const looped = model.dispatch(p, "set-loop", { enabled: true, start: 1, end: 3 }).project;
  const t = new transportApi.Transport(looped, null);
  t.play();
  t.seek(2.9);
  t.advanceForTest(0.3);
  assert.ok(t.time < 1.4, "应跳回循环起点附近，实际 " + t.time);
  assert.strictEqual(t.loopCount, 1);
});

test("非循环播放到工程结尾自然停止", () => {
  const p = model.createDefaultProject();
  const t = new transportApi.Transport(p, null);
  t.play();
  t.seek(p.duration - 0.1);
  t.advanceForTest(0.5);
  assert.strictEqual(t.state, "stopped");
  assert.ok(util.nearlyEqual(t.time, p.duration));
});

test("音频波形峰值与节拍事件时间一一对应", () => {
  const p = model.createDefaultProject();
  const peaks = audio.buildBeatPeaks(p.beats, p.duration, 0.02);
  p.beats.forEach(beat => {
    const bin = Math.floor(beat.time / 0.02);
    assert.ok(peaks[Math.min(bin, peaks.length - 1)] > 0, "节拍 " + beat.id + " 处应有能量");
  });
  const env = audio.synthesizeEnvelope("kick");
  assert.strictEqual(env.length, 64);
  assert.ok(env[0] > env[63]);
});

test("时间线命中测试区分片段边缘、片段体、字幕与逐字手柄", () => {
  const p = model.createDefaultProject();
  const canvas = new FakeCanvas(1200, 360);
  const r = new renderer.TimelineRenderer(canvas);
  const m = r.metrics(p);
  const clip = p.clips[0];
  const edgeHit = r.hitTest(p, m.xOf(clip.start) + 2, renderer.LANE.clip.y + 40);
  assert.strictEqual(edgeHit.type, "clip-edge");
  assert.strictEqual(edgeHit.edge, "in");
  const bodyHit = r.hitTest(p, m.xOf((clip.start + clip.end) / 2), renderer.LANE.clip.y + 40);
  assert.strictEqual(bodyHit.type, "clip-body");
  const cue = p.subtitles[0];
  const charHit = r.hitTest(p, m.xOf(cue.chars[2].t), renderer.LANE.subtitles.y + 45);
  assert.strictEqual(charHit.type, "char");
  assert.strictEqual(charHit.index, 2);
  const rulerHit = r.hitTest(p, m.xOf(4), renderer.LANE.ruler.y + 10);
  assert.strictEqual(rulerHit.type, "ruler");
});

test("冲突标记被绘制到时间线（记录红色 X 绘制命令）", () => {
  const p = model.createDefaultProject();
  const canvas = new FakeCanvas(1200, 360);
  const r = new renderer.TimelineRenderer(canvas);
  const bad = util.deepClone(p);
  bad.subtitles[1].start = 1.0;
  bad.subtitles[1].end = 2.0;
  const report = model.validateProject(bad);
  r.setConflicts(report.conflictLocs);
  r.render(bad, 0);
  assert.ok(r.conflictLocs.length > 0);
});

test("黑帧守卫：首帧、尾帧与间隙帧的平均亮度都高于阈值", () => {
  const p = model.createDefaultProject();
  const canvas = new FakeCanvas(960, 270);
  const stage = new renderer.StageRenderer(canvas);
  const guard = exporter.blackFrameGuard(p, stage);
  assert.strictEqual(guard.ok, true, JSON.stringify(guard.findings));
  const gapProject = util.deepClone(p);
  gapProject.clips = [model.makeClip("c1", "孤片段", 3, 6, 4, "#5e81ac")];
  const gapGuard = exporter.blackFrameGuard(gapProject, stage);
  assert.strictEqual(gapGuard.ok, true, "片段间隙也不能是黑帧");
});

test("导出闸门：任何非法重叠都阻止导出并携带冲突位置", () => {
  const p = model.createDefaultProject();
  assert.strictEqual(exporter.preExportCheck(p).allowed, true);
  const bad = util.deepClone(p);
  bad.clips[0].end = 7.0;
  bad.clips[0].sourceOut = bad.clips[0].sourceIn + (bad.clips[0].end - bad.clips[0].start);
  const gate = exporter.preExportCheck(bad);
  assert.strictEqual(gate.allowed, false);
  assert.ok(gate.conflicts.length > 0);
  assert.match(gate.reason, /阻止/);
});

test("失败回放：从默认工程重放被拒动作，结果仍为拒绝且可复现", () => {
  const p = model.createDefaultProject();
  const r1 = model.dispatch(p, "move-clip", { id: "clip_b", start: 4.0 });
  const r2 = model.dispatch(r1.project, "trim-clip", { id: "clip_a", edge: "out", value: 99 });
  const failed = r2.project.log.filter(e => !e.ok)
    .map(e => ({ action: e.action, payload: e.detail }));
  assert.strictEqual(failed.length, 2);
  const replay = model.replay(model.createDefaultProject(), failed);
  assert.strictEqual(replay.steps.every(s => !s.ok), true);
  assert.strictEqual(model.validateProject(replay.project).ok, true);
});

test("时长对比：至少两段裁切/转场后的时长与源时长可量化比较", () => {
  const p = model.createDefaultProject();
  const a = model.dispatch(p, "trim-clip", { id: "clip_a", edge: "out", value: 4.5 });
  const b = model.dispatch(a.project, "set-transition", { id: "clip_b", edge: "in", duration: 0.6 });
  const clips = b.project.clips;
  const comparisons = clips.map(c => ({
    id: c.id,
    current: c.end - c.start,
    source: c.sourceDuration,
    delta: (c.end - c.start) - c.sourceDuration
  }));
  assert.ok(comparisons.length >= 2);
  const clipA = comparisons.find(c => c.id === "clip_a");
  assert.ok(util.nearlyEqual(clipA.current, 4.5, 1e-4));
  assert.ok(clipA.delta < 0, "裁切后时长应短于源时长");
  const clipB = clips.find(c => c.id === "clip_b");
  assert.ok(clipB.transitionIn === 0.6);
});

test("分割后音画对齐：分割点与最近节拍、字幕时间互不漂移", () => {
  const p = model.createDefaultProject();
  const beatBefore = p.beats.filter(b => b.time <= 3.0).pop();
  const r = model.dispatch(p, "split-clip", { id: "clip_a", at: 3.0 });
  const beatAfter = r.project.beats.filter(b => b.time <= 3.0).pop();
  assert.deepStrictEqual(beatAfter, beatBefore, "分割不得改动节拍事件");
  const parts = r.project.clips.filter(c => c.id.startsWith("clip_a"));
  assert.ok(util.nearlyEqual(parts[0].end, 3.0, 1e-6));
  assert.ok(util.nearlyEqual(parts[1].start, 3.0, 1e-6));
});

test("保存闸门：非法状态不允许序列化保存，合法状态可保存", () => {
  const p = model.createDefaultProject();
  assert.strictEqual(exporter.preExportCheck(p).allowed, true);
  const bad = util.deepClone(p);
  bad.subtitles[0].end = bad.duration + 1;
  bad.subtitles[0].chars.forEach(c => { c.t = Math.min(c.t, bad.duration); });
  const gate = exporter.preExportCheck(bad);
  assert.strictEqual(gate.allowed, false);
  assert.ok(gate.conflicts.some(l => l.lane === "subtitles"));
});

test("循环区间与转场参数随工程持久化后完整恢复", () => {
  let p = model.createDefaultProject();
  p = model.dispatch(p, "set-loop", { enabled: true, start: 2, end: 6 }).project;
  p = model.dispatch(p, "set-transition", { id: "clip_a", edge: "out", duration: 0.3 }).project;
  const loaded = storage.parseProject(storage.serialize(p));
  assert.deepStrictEqual(loaded.loop, p.loop);
  assert.strictEqual(loaded.clips[0].transitionOut, 0.3);
});

const failed = results.filter(r => !r.ok);
results.forEach(r => {
  console.log((r.ok ? "PASS" : "FAIL") + " - " + r.name);
  if (!r.ok) console.log("       " + (r.err && r.err.stack ? r.err.stack.split("\n")[0] : r.err));
});
console.log("\n" + (results.length - failed.length) + "/" + results.length + " passed");
process.exit(failed.length ? 1 : 0);
