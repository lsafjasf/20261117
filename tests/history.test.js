import test from "node:test";
import assert from "node:assert/strict";
import { History } from "../src/history.js";

test("撤销与重做恢复完整设计状态", () => {
  const history = new History();
  const first = { title: "A", nested: { size: 1 } };
  const second = { title: "B", nested: { size: 2 } };

  history.record(first, { label: "修改标题", coalesceKey: "title", now: 1000 });
  const undone = history.undo(second);
  assert.deepEqual(undone.state, first);
  assert.equal(history.canRedo, true);

  const redone = history.redo(first);
  assert.deepEqual(redone.state, second);
  assert.equal(history.canUndo, true);
});

test("连续输入在窗口内合并成一次撤销节点", () => {
  const history = new History();
  history.record({ title: "" }, { coalesceKey: "title", now: 1000 });
  history.record({ title: "长" }, { coalesceKey: "title", now: 1200 });
  history.record({ title: "长标" }, { coalesceKey: "title", now: 1400 });

  assert.equal(history.past.length, 1);
  const result = history.undo({ title: "长标题" });
  assert.deepEqual(result.state, { title: "" });
});

test("新编辑会清空重做分支", () => {
  const history = new History();
  history.record({ title: "A" }, { now: 1000 });
  history.undo({ title: "B" });
  assert.equal(history.canRedo, true);

  history.record({ title: "C" }, { now: 3000 });
  assert.equal(history.canRedo, false);
});
