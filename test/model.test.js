import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  moveClip,
  splitClip,
  setTransition,
  setInOut,
  setAudioOffset,
  sourceToTimeline,
  timelineToSource,
  mappedAudioEvents,
  validateProject,
  compareVariants,
  programDuration,
  getVideoTrack,
  SOURCE_DURATION,
} from '../src/model.js';
import { serializeProject, deserializeProject, verifyReload } from '../src/persist.js';

test('默认工程包含十二次闪光事件且横跨二十秒', () => {
  const project = createProject();
  const events = mappedAudioEvents(project);
  assert.equal(events.length, 12);
  assert.equal(events[0].sourceTime, 0);
  assert.ok(Math.abs(events.at(-1).sourceTime - 18.333) < 0.01);
  assert.equal(programDuration(project), SOURCE_DURATION);
});

test('音频整体偏移后每个事件差值一致，归零后重新对齐', () => {
  const project = createProject();
  setAudioOffset(project, 0.08);
  for (const event of mappedAudioEvents(project)) {
    assert.equal(event.delta, 0.08);
    assert.equal(event.audioTime, Math.round((event.visualTime + 0.08) * 1000) / 1000);
  }
  setAudioOffset(project, 0);
  for (const event of mappedAudioEvents(project)) {
    assert.equal(event.delta, 0);
  }
});

test('移动片段保持源到时间线映射，非法重叠被阻止', () => {
  const project = createProject();
  splitClip(project, getVideoTrack(project).clips[0].id, 8);
  const [, rightClip] = getVideoTrack(project).clips;
  const allowed = moveClip(project, rightClip.id, rightClip.timelineStart - 1);
  assert.equal(allowed.ok, false);
  assert.match(allowed.reason, /重叠/);

  const leftClip = getVideoTrack(project).clips[0];
  const movedLeft = moveClip(project, leftClip.id, leftClip.timelineStart - 0);
  assert.equal(movedLeft.ok, true);
  assert.equal(timelineToSource(project, 8), 8);
});

test('分割后每个事件仍能映射，且接缝两侧源时间连续', () => {
  const project = createProject();
  const clipId = getVideoTrack(project).clips[0].id;
  const result = splitClip(project, clipId, 10);
  assert.equal(result.ok, true);
  assert.equal(getVideoTrack(project).clips.length, 2);
  assert.equal(timelineToSource(project, 9.999), 9.999);
  assert.equal(timelineToSource(project, 10), 10);
  assert.equal(sourceToTimeline(project, 10), 10);
  for (const event of mappedAudioEvents(project)) {
    assert.equal(event.audioTime, event.visualTime);
  }
});

test('转场只写元数据，不改变时长与事件对齐', () => {
  const project = createProject();
  splitClip(project, getVideoTrack(project).clips[0].id, 7);
  const before = mappedAudioEvents(project).map((e) => e.audioTime);
  const transition = setTransition(project, getVideoTrack(project).clips[0].id, 0.5);
  assert.equal(transition.ok, true);
  const after = mappedAudioEvents(project).map((e) => e.audioTime);
  assert.deepEqual(before, after);
  assert.equal(programDuration(project), SOURCE_DURATION);
});

test('冲突工程无法通过校验并返回冲突区间', () => {
  const project = createProject();
  splitClip(project, getVideoTrack(project).clips[0].id, 5);
  const [left] = getVideoTrack(project).clips;
  left.timelineEnd = 6.2; // 手动制造重叠
  const report = validateProject(project);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].type, 'overlap');
  assert.equal(report.errors[0].end, 6.2);
});

test('保存并重载后入点、出点、事件与片段位置完全一致', () => {
  const project = createProject();
  splitClip(project, getVideoTrack(project).clips[0].id, 6.5);
  setInOut(project, 1.233, 17.8);
  setAudioOffset(project, -0.05);
  const text = serializeProject(project);
  const loaded = deserializeProject(text);
  assert.equal(loaded.ok, true);
  const verification = verifyReload(project, loaded.project);
  assert.equal(verification.ok, true, JSON.stringify(verification.mismatches));
});

test('损坏的工程文件被校验和拒绝', () => {
  const project = createProject();
  const text = serializeProject(project);
  const corrupted = text.replace('"inPoint": 0', '"inPoint": 1');
  const result = deserializeProject(corrupted);
  assert.equal(result.ok, false);
  assert.match(result.reason, /校验和/);
});

test('至少比较两段裁切/转场后的时长', () => {
  const base = createProject();
  const cutA = createProject();
  setInOut(cutA, 2, 14);
  const cutB = createProject();
  splitClip(cutB, getVideoTrack(cutB).clips[0].id, 9);
  setTransition(cutB, getVideoTrack(cutB).clips[0].id, 0.8);
  setInOut(cutB, 0, 12);
  const comparison = compareVariants(base, [
    { name: '裁切 2-14', project: cutA },
    { name: '转场 + 裁切 0-12', project: cutB },
  ]);
  assert.equal(comparison.rows.length, 2);
  assert.equal(comparison.rows[0].duration, 12);
  assert.equal(comparison.rows[0].durationDelta, -8);
  assert.equal(comparison.rows[1].clips, 2);
  assert.equal(comparison.rows[1].duration, 12);
});
