import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOp,
  validateProject,
  projectDuration,
  buildShotList,
  clipEnd,
  sortedClips
} from "../src/core/project.mjs";
import { buildDemoProject } from "../src/core/demo.mjs";
import { checkCutBeatSync } from "../src/core/audio.mjs";

function fresh() {
  return buildDemoProject().project;
}

test("移动片段到拍点后音画仍对齐", () => {
  const project = fresh();
  const middle = sortedClips(project)[1];
  const result = applyOp(project, { type: "moveClip", id: middle.id, start: 5 });
  assert.equal(result.ok, true);
  assert.equal(checkCutBeatSync(result.project).synced, true);
  assert.equal(result.project.clips.find((c) => c.id === middle.id).start, 5);
});

test("移动造成非法重叠时操作被拒绝，原工程不被修改", () => {
  const project = fresh();
  const last = sortedClips(project).at(-1);
  const result = applyOp(project, { type: "overlapClip", id: last.id, start: 3 });
  assert.equal(result.ok, false);
  assert.match(result.error, /非法重叠/);
  const conflict = result.conflicts[0];
  assert.equal(conflict.type, "illegal_overlap");
  assert.equal(conflict.at, 3);
  // 原工程保持原样（不可变更新）
  assert.equal(sortedClips(project).at(-1).start, 10);
  assert.equal(validateProject(project).exportable, true);
});

test("分割片段产生两个总时长相等的子片段，且新切点在拍上", () => {
  const project = fresh();
  const first = sortedClips(project)[0];
  const before = first.duration;
  const result = applyOp(project, { type: "splitClip", id: first.id, at: 2 });
  assert.equal(result.ok, true);
  const pieces = result.project.clips.filter((c) => c.start < 4);
  assert.equal(pieces.length, 2);
  const total = pieces.reduce((sum, c) => sum + c.duration, 0);
  assert.ok(Math.abs(total - before) < 1e-9);
  assert.equal(pieces[1].sourceIn, 2);
  assert.equal(checkCutBeatSync(result.project).synced, true);
});

test("非拍点分割只给警告，不阻止导出；同步检查能发现漂移", () => {
  const project = fresh();
  const first = sortedClips(project)[0];
  const result = applyOp(project, { type: "splitClip", id: first.id, at: 2.2 });
  assert.equal(result.ok, true);
  const validation = validateProject(result.project);
  assert.equal(validation.exportable, true);
  assert.ok(validation.conflicts.some((c) => c.type === "off_beat_cut" && c.at === 2.2));
  const sync = checkCutBeatSync(result.project);
  assert.equal(sync.synced, false);
  assert.ok(sync.rows.some((r) => Math.abs(r.drift - 0.2) < 1e-9));
});

test("转场重叠在允许范围内通过，超过片段时长被拒绝", () => {
  const project = fresh();
  const second = sortedClips(project)[1];
  const ok = applyOp(project, {
    type: "setTransition",
    id: second.id,
    transition: "dissolve",
    duration: 0.8
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.project.clips.find((c) => c.id === second.id).transition.duration, 0.8);

  const tooLong = applyOp(project, {
    type: "setTransition",
    id: second.id,
    transition: "dissolve",
    duration: 4.5
  });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error, /超过相邻片段/);
});

test("删除片段会产生空隙，操作被阻止并标出冲突位置", () => {
  const project = fresh();
  const middle = sortedClips(project)[1];
  const result = applyOp(project, { type: "removeClip", id: middle.id });
  assert.equal(result.ok, false);
  const gap = result.conflicts.find((c) => c.type === "uncovered_gap");
  assert.equal(gap.at, 4);
  assert.equal(validateProject(project).exportable, true, "原工程仍可导出");
});

test("裁切前后时长对比：缩短与拉长都可量化", () => {
  // 第一组：缩短第二段入点（向前段借空间，不会产生空隙）
  const projectA = fresh();
  const second = sortedClips(projectA)[1]; // [4,8]，入点带叠化
  const originalA = second.duration;
  const trimmedA = applyOp(projectA, {
    type: "trimClip",
    id: second.id,
    start: 5,
    end: 8
  });
  assert.equal(trimmedA.ok, true);
  const durationA = sortedClips(trimmedA.project)[1].duration;
  assert.ok(Math.abs(durationA - (originalA - 1)) < 1e-9, "第一段裁切：4s -> 3s");

  // 第二组：对另一个工程裁最后一段的尾部（缩短 1.5s）
  const projectB = fresh();
  const last = sortedClips(projectB).at(-1);
  const originalB = last.duration;
  const trimmedB = applyOp(projectB, {
    type: "trimClip",
    id: last.id,
    start: last.start,
    end: clipEnd(last) - 1.5
  });
  assert.equal(trimmedB.ok, true);
  const durationB = sortedClips(trimmedB.project).at(-1).duration;
  assert.ok(Math.abs(durationB - (originalB - 1.5)) < 1e-9, "第二段裁切：2s -> 0.5s");

  // 第一组裁切后把入点补回，时长恢复
  const restored = applyOp(trimmedA.project, {
    type: "trimClip",
    id: second.id,
    start: 4,
    end: 8
  });
  assert.equal(restored.ok, true);
  assert.equal(
    sortedClips(restored.project)[1].duration,
    originalA
  );

  assert.ok(durationA !== durationB, "两次裁切后的时长可区分比较");
});

test("镜头表与工程片段一一对应并包含转场信息", () => {
  const project = fresh();
  const shots = buildShotList(project);
  assert.equal(shots.length, 4);
  assert.equal(shots[0].inPoint, 0);
  assert.equal(shots.at(-1).outPoint, projectDuration(project));
  assert.equal(shots[1].transition, "dissolve");
});
