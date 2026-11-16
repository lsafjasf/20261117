import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOp, sortedClips } from "../src/core/project.mjs";
import {
  saveProject,
  loadProject,
  parseSave,
  serializeSave,
  diffPositions
} from "../src/core/persistence.mjs";
import { buildDemoProject } from "../src/core/demo.mjs";
import { Journal } from "../src/core/journal.mjs";
import { verifyExport } from "../src/core/exporter.mjs";

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, value); }
}

test("保存后重载：入点、出点、字幕与音频事件位置完全不变", () => {
  const { project, journal } = buildDemoProject();
  const storage = new MemoryStorage();
  saveProject(storage, project, journal);
  const loaded = loadProject(storage);
  assert.ok(loaded);
  const diff = diffPositions(project, loaded.project);
  assert.equal(diff.identical, true);
  assert.equal(loaded.validation.exportable, true);
});

test("经历移动、分割、转场后再保存重载，点位保持不变且仍可导出", () => {
  let { project, journal } = buildDemoProject();
  const ops = [
    { type: "moveClip", id: sortedClips(project)[1].id, start: 5 },
    { type: "splitClip", id: sortedClips(project)[0].id, at: 2 }
  ];
  for (const op of ops) {
    const result = applyOp(project, op);
    assert.equal(result.ok, true, result.error);
    journal.record(op, result);
    project = result.project;
  }
  // 转场设在分割后新切点的下一个片段上（时长足够，0.4s 短叠化）
  const transitionTarget = sortedClips(project).find((c) => c.start >= 2 && c.start < 5);
  const transitionOp = {
    type: "setTransition",
    id: transitionTarget.id,
    transition: "dissolve",
    duration: 0.4
  };
  const transitionResult = applyOp(project, transitionOp);
  assert.equal(transitionResult.ok, true, transitionResult.error);
  journal.record(transitionOp, transitionResult);
  project = transitionResult.project;
  const storage = new MemoryStorage();
  saveProject(storage, project, journal);
  const loaded = loadProject(storage);
  assert.equal(diffPositions(project, loaded.project).identical, true);
  assert.equal(verifyExport(loaded.project).exportable, true);
});

test("失败操作写入日志并可完整回放，失败后工程状态不损坏", () => {
  const { project, journal } = buildDemoProject();
  const lastId = sortedClips(project).at(-1).id;
  const badOp = { type: "overlapClip", id: lastId, start: 3 };
  const result = applyOp(project, badOp);
  assert.equal(result.ok, false);
  journal.record(badOp, result);
  assert.equal(journal.failed().length, 1);

  const replay = journal.replay();
  const failedEntries = replay.trace.filter((t) => !t.ok);
  assert.equal(failedEntries.length, 1);
  assert.match(failedEntries[0].error, /非法重叠|片段不存在/);
  // 回放终点与当前工程的片段数、点位一致
  assert.equal(replay.project.clips.length, project.clips.length);
  assert.equal(diffPositions(project, replay.project).identical, true);
});

test("损坏的工程文件被拒绝", () => {
  assert.throws(() => parseSave("{\"kind\":\"nope\"}"), /不是本程序生成/);
  assert.throws(() => parseSave("{"), { name: "SyntaxError" });
});

test("空存储返回 null，Journal 可序列化往返", () => {
  assert.equal(loadProject(new MemoryStorage()), null);
  const journal = new Journal();
  const { project } = buildDemoProject();
  journal.record({ type: "noop" }, applyOp(project, {
    type: "moveClip",
    id: sortedClips(project)[0].id,
    start: 0
  }));
  const text = JSON.stringify(journal.toJSON());
  const restored = new Journal();
  restored.entries = JSON.parse(text);
  assert.equal(restored.entries.length, 1);
});
