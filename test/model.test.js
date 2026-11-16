/*
 * model.test.js — 模型层验证（Node 直接运行：node test/model.test.js）
 * 覆盖用户需求：
 *  1. 片段移动/分割/转场后，音频事件与画面仍共用时间轴、保持对齐；
 *  2. 保存→重新载入后，入点/出点与事件位置不变；
 *  3. 非法重叠被校验捕获并给出冲突位置（用于阻止导出）；
 *  4. 至少两段片段在裁切/转场后的时长比较一致；
 *  5. 字幕停留段：滚动在停留线冻结、之后恢复。
 */
"use strict";

const assert = require("node:assert");
const M = require("../js/model.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("✓", name);
}

/* 1. 移动片段（联动音频）后音画对齐 */
test("移动片段后联动音频事件保持对齐", () => {
  const p = M.createDefaultProject();
  const before = p.audioEvents.find((a) => a.id === "au_2"); // start=4 在 clip_b 域内
  M.moveClip(p, "clip_b", 6, true);
  const clip = p.clips.find((c) => c.id === "clip_b");
  assert.strictEqual(clip.start, 6);
  assert.strictEqual(before.start, 6); // 音频事件同步平移 2s
  // 同一时刻：画面活动片段与音频事件指向同一时间轴位置
  const active = M.activeClipAt(p, 6.1);
  assert.strictEqual(active.clip.id, "clip_b");
  assert.ok(before.start <= 6.1 && before.start + before.duration > 6.1);
});

/* 2. 分割后源入出点连续、音频事件不受影响（共用时间轴） */
test("分割片段后源入出点连续且音频事件位置不变", () => {
  const p = M.createDefaultProject();
  const audioSnapshot = p.audioEvents.map((a) => ({ ...a }));
  const { first, second } = M.splitClip(p, "clip_b", 7);
  assert.strictEqual(first.outPoint, second.inPoint); // 源素材连续
  assert.strictEqual(first.start + first.duration, second.start); // 时间线连续
  assert.deepStrictEqual(
    p.audioEvents.map((a) => [a.start, a.duration]),
    audioSnapshot.map((a) => [a.start, a.duration])
  );
  // 原 clip_b 的转场不受影响（tr_1 挂在 clip_a 上）
  assert.ok(p.transitions.find((t) => t.id === "tr_1"));
});

/* 3. 转场混合区间落在源片段末尾 */
test("转场在正确时刻产生交叉淡化", () => {
  const p = M.createDefaultProject();
  const a = p.clips.find((c) => c.id === "clip_a"); // 0–4，转场 1s
  const at = M.activeClipAt(p, a.start + a.duration - 0.5);
  assert.ok(at.blend, "转场窗口内应有混合");
  assert.ok(Math.abs(at.blend.progress - 0.5) < 1e-6);
  assert.strictEqual(at.blend.next.id, "clip_b");
});

/* 4. 保存→载入：入点/出点与事件位置完全恢复 */
test("保存后重新载入，入点/出点与事件位置不变", () => {
  const p = M.createDefaultProject();
  M.trimClip(p, "clip_a", 0.5, 3.5);
  M.splitClip(p, "clip_b", 6);
  M.moveClip(p, "clip_c", 12, true);
  const restored = JSON.parse(JSON.stringify(p)); // 模拟 localStorage 往返
  for (const c of p.clips) {
    const r = restored.clips.find((x) => x.id === c.id);
    assert.strictEqual(r.inPoint, c.inPoint);
    assert.strictEqual(r.outPoint, c.outPoint);
    assert.strictEqual(r.start, c.start);
  }
  for (const a of p.audioEvents) {
    const r = restored.audioEvents.find((x) => x.id === a.id);
    assert.strictEqual(r.start, a.start);
    assert.strictEqual(r.duration, a.duration);
  }
});

/* 5. 非法重叠被捕获并给出冲突区间 */
test("片段重叠产生冲突位置并阻止导出", () => {
  const p = M.createDefaultProject();
  M.moveClip(p, "clip_b", 3, false); // 与 clip_a(0–4) 重叠
  const issues = M.validateProject(p);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].type, "overlap");
  assert.strictEqual(issues[0].start, 3); // 冲突起点
  assert.strictEqual(issues[0].end, 4);   // 冲突终点
  assert.deepStrictEqual(issues[0].ids.sort(), ["clip_a", "clip_b"]);
});

/* 6. 至少两段片段裁切/转场后的时长比较 */
test("裁切与转场后多段时长一致（时间线时长 == 源区间长度）", () => {
  const p = M.createDefaultProject();
  M.trimClip(p, "clip_a", 0.5, 3.0);  // 裁切
  M.trimClip(p, "clip_c", 1.0, 3.0);  // 裁切
  M.addTransition(p, "clip_b", "clip_c", 1.5); // 转场不改变时长
  const compared = p.clips.map((c) => ({
    name: c.name,
    timeline: c.duration,
    source: c.outPoint - c.inPoint,
  }));
  assert.ok(compared.length >= 2, "至少比较两段");
  for (const c of compared) {
    assert.ok(Math.abs(c.timeline - c.source) < 1e-6, `${c.name} 时长不一致`);
  }
  assert.strictEqual(p.clips.find((c) => c.id === "clip_a").duration, 2.5);
  assert.strictEqual(p.clips.find((c) => c.id === "clip_c").duration, 2.0);
});

/* 7. 字幕停留段：到达停留线冻结，停留结束恢复滚动 */
test("字幕停留段冻结并恢复", () => {
  const p = M.createDefaultProject();
  const layout = M.creditsLayout(p);
  const pause = layout.pauses[0];
  const t0 = p.credits.startTime + pause.triggerTime;
  const y1 = M.creditsPositionsAt(p, t0 + 0.1)[pause.lineIndex].screenY;
  const y2 = M.creditsPositionsAt(p, t0 + pause.dwell - 0.1)[pause.lineIndex].screenY;
  assert.ok(Math.abs(y1 - y2) < 1e-6, "停留期间位置应冻结");
  assert.ok(Math.abs(y1 - layout.dwellLine) < 1e-6, "应冻结在停留线");
  const y3 = M.creditsPositionsAt(p, t0 + pause.dwell + 0.5)[pause.lineIndex].screenY;
  assert.ok(y3 < y1, "停留结束后应继续滚动");
});

/* 8. 字幕越界阻止导出 */
test("字幕越界被判定并阻止导出", () => {
  const p = M.createDefaultProject();
  assert.strictEqual(M.creditsOverflow(p), false);
  p.settings.scrollSpeed = 0; // 非法速度 → 越界
  assert.strictEqual(M.creditsOverflow(p), true);
  p.settings.scrollSpeed = 60;
  p.settings.lineHeight = -5;
  assert.strictEqual(M.creditsOverflow(p), true);
});

/* 9. 非法停留段与超长字幕行被标出 */
test("停留段指向不存在的行 / 字幕行越界被标出", () => {
  const p = M.createDefaultProject();
  p.credits.pauses = [{ lineIndex: 99, dwell: 1 }];
  let issues = M.validateProject(p);
  assert.ok(issues.some((i) => i.type === "credits" && i.message.includes("不存在")));
  // 超长行 → 越界并阻止导出
  const p2 = M.createDefaultProject();
  p2.credits.lines[3] = "这是一个特别特别特别特别特别特别特别特别特别特别特别特别特别特别特别长的字幕行";
  assert.strictEqual(M.creditsOverflow(p2), true);
  issues = M.validateProject(p2);
  assert.ok(issues.some((i) => i.type === "credits" && i.message.includes("越界")));
});

console.log(`\n全部 ${passed} 项测试通过`);
