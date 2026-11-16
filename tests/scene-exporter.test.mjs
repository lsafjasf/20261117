import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneState } from "../src/core/scene.mjs";
import { composeFrame, resolveClipsAt } from "../src/core/composer.mjs";
import { verifyExport, createRecordingCtx, toCSV } from "../src/core/exporter.mjs";
import { applyOp, sortedClips } from "../src/core/project.mjs";
import { buildDemoProject } from "../src/core/demo.mjs";

test("切镜不重置场景：跨切点的世界状态只随节目时间连续变化", () => {
  const before = sceneState(3.99);
  const after = sceneState(4.01);
  assert.ok(Math.abs(after.hue - before.hue) < 1);
  assert.ok(after.frame >= before.frame, "帧号单调推进，没有跳回 0");
  assert.deepEqual(
    before.orbs.map((o) => o.id),
    after.orbs.map((o) => o.id)
  );
  const jump = sceneState(0.01);
  assert.ok(Math.abs(jump.hue - after.hue) > 1, "回到 0 才是真正的重置");
});

test("叠化区间内两层画面同时参与合成且均不透明覆盖", () => {
  const { project } = buildDemoProject();
  const resolution = resolveClipsAt(project, 4.1);
  assert.equal(resolution.covered, true);
  assert.equal(resolution.layers.length, 2);
  assert.ok(resolution.layers[0].alpha > 0.5);
  assert.ok(resolution.layers[1].alpha < 0.5);
});

test("完整导出逐帧校验：可导出、无黑帧、首尾不黑", () => {
  const { project } = buildDemoProject();
  const report = verifyExport(project);
  assert.equal(report.exportable, true);
  assert.equal(report.blackFrames.length, 0);
  assert.equal(report.uncoveredFrames.length, 0);
  assert.equal(report.headBlack.length, 0);
  assert.equal(report.tailBlack.length, 0);
  assert.equal(report.frameCount, 360); // 12s * 30fps
  assert.equal(report.shots.length, 4);
});

test("非法重叠工程导出被阻止，报告带冲突定位", () => {
  const { project } = buildDemoProject();
  const last = sortedClips(project).at(-1);
  const moved = applyOp(project, { type: "overlapClip", id: last.id, start: 8.5 });
  assert.equal(moved.ok, false);
  // 直接构造一个有重叠的工程用于导出校验
  // 保留原切点 10，但把片段强行前移到 8.5，形成超出允许范围的重叠
  const broken = {
    ...project,
    clips: project.clips.map((c) =>
      c.id === last.id ? { ...c, start: 8.5, transition: { ...c.transition } } : c
    )
  };
  const report = verifyExport(broken);
  assert.equal(report.exportable, false);
  assert.ok(report.conflicts.some((c) => c.type === "illegal_overlap" && c.at === 8.5));
});

test("空隙会被逐帧扫描识别为黑帧并记录帧号", () => {
  const { project } = buildDemoProject();
  const middle = sortedClips(project)[1];
  const gapped = { ...project, clips: project.clips.filter((c) => c.id !== middle.id) };
  const report = verifyExport(gapped);
  assert.equal(report.exportable, false);
  assert.ok(report.blackFrames.length > 0);
  assert.ok(report.uncoveredFrames.some((f) => Math.abs(f.time - 4) < 0.1));
});

test("桩上下文记录到每帧的全屏不透明背景填充", () => {
  const { project } = buildDemoProject();
  const ctx = createRecordingCtx(640, 360);
  const result = composeFrame(ctx, project, 0);
  assert.equal(result.covered, true);
  const fullFill = ctx.fills.find((f) => f.w === 640 && f.h === 360 && f.alpha === 1);
  assert.ok(fullFill);
  assert.notEqual(fullFill.style, "#000000");
});

test("镜头表 CSV 可生成并含表头", () => {
  const { project } = buildDemoProject();
  const csv = toCSV(verifyExport(project).shots);
  assert.ok(csv.startsWith("shot,camera,inPoint"));
  assert.equal(csv.trim().split("\n").length, 5);
});
