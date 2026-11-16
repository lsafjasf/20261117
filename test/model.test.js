import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineModel, createClip, localTime } from '../src/core/model.js';
import { buildDemoProject, measureDurations, diffDurations } from '../src/core/factory.js';
import { ActionJournal } from '../src/core/journal.js';

function twoClips() {
  const m = new TimelineModel();
  m.addClip(createClip({ id: 'a', kind: 'scene', source: 'sceneA', inPoint: 0, outPoint: 4000, srcIn: 0, srcOut: 4000 }));
  m.addClip(createClip({ id: 'b', kind: 'scene', source: 'sceneB', inPoint: 4000, outPoint: 8000, srcIn: 0, srcOut: 4000 }));
  return m;
}

test('localTime 映射到片段自身时间，切点处第二场景从 0 开始', () => {
  const m = twoClips();
  const [a, b] = m.clips;
  assert.equal(localTime(a, 0), 0);
  assert.equal(localTime(a, 2000), 2000);
  assert.equal(localTime(b, 4000), 0);
  assert.equal(localTime(b, 6000), 2000);
});

test('移动片段保持时长与源映射，且不允许负时间', () => {
  const m = twoClips();
  const moved = m.moveClip('b', 5000);
  assert.equal(moved.inPoint, 5000);
  assert.equal(moved.outPoint, 9000);
  assert.equal(moved.srcIn, 0);
  m.moveClip('a', -999);
  assert.equal(m.clips.find((c) => c.id === 'a').inPoint, 0);
});

test('分割产生两段相切片段且源时间按比例切开', () => {
  const m = twoClips();
  const [left, right] = m.splitClip('a', 2500);
  assert.equal(left.outPoint, 2500);
  assert.equal(left.srcOut, 2500);
  assert.equal(right.inPoint, 2500);
  assert.equal(right.srcIn, 2500);
  assert.equal(m.findOverlaps().length, 0);
});

test('三种转场均缩短节目时长且第二场景从自身起点继续', () => {
  for (const type of ['push', 'dissolve', 'mask']) {
    const m = twoClips();
    const before = measureDurations(m);
    const tr = m.addTransition('a', 'b', type, 1200);
    const after = measureDurations(m);
    assert.equal(tr.durationMs, 1200);
    assert.equal(after.programMs, 6800);
    assert.equal(diffDurations(before, after).programDeltaMs, -1200);
    const b = m.clips.find((c) => c.id === 'b');
    assert.equal(b.inPoint, 2800);
    assert.equal(localTime(b, b.inPoint), 0); // 不继承旧时间
    assert.equal(m.validate().ok, true);       // 转场重叠合法
  }
});

test('非转场的非法重叠被检测并阻止校验通过', () => {
  const m = twoClips();
  m.moveClip('b', 3000); // 与 a 重叠 1000ms
  const conflicts = m.findOverlaps();
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].clipIds, ['a', 'b']);
  assert.equal(conflicts[0].startMs, 3000);
  const result = m.validate();
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /非法重叠/);
});

test('保存后重新载入，入点出点与事件位置保持不变', () => {
  const m = buildDemoProject();
  m.addTransition('clipA', 'clipB', 'dissolve', 1000);
  const json = JSON.stringify(m.toJSON());
  const restored = TimelineModel.fromJSON(JSON.parse(json));
  assert.deepEqual(restored.clips.map((c) => [c.id, c.inPoint, c.outPoint]),
    m.clips.map((c) => [c.id, c.inPoint, c.outPoint]));
  assert.deepEqual(restored.audioEvents.map((e) => [e.id, e.atMs]),
    m.audioEvents.map((e) => [e.id, e.atMs]));
  assert.equal(restored.transitions[0].type, 'dissolve');
  assert.equal(restored.validate().ok, true);
});

test('操作日志记录失败并可在新模型上重放成功操作', () => {
  const journal = new ActionJournal();
  const m = twoClips();
  journal.apply('move', { id: 'b', to: 5000 }, () => m.moveClip('b', 5000));
  assert.throws(() => journal.apply('bad-split', { id: 'a', at: 99999 },
    () => m.splitClip('a', 99999)));
  assert.equal(journal.failures.length, 1);
  const { model, reapplied } = journal.replay(
    () => twoClips(),
    { move: (mm, args) => mm.moveClip(args.id, args.to) });
  assert.deepEqual(reapplied, [0]);
  assert.equal(model.clips.find((c) => c.id === 'b').inPoint, 5000);
});

test('裁切后时长对比给出正确差值', () => {
  const m = twoClips();
  const before = measureDurations(m);
  m.splitClip('a', 3000);
  const report = diffDurations(before, measureDurations(m));
  const aChange = report.clips.find((c) => c.id === 'a');
  assert.equal(aChange.beforeMs, 4000);
  assert.equal(aChange.afterMs, 3000);
});
