import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKeyframeExport,
  cameraAt,
  clone,
  createDefaultProject,
  durationReport,
  findPathViolations,
  hydrateProject,
  moveGroup,
  runEditSelfTest,
  serializeProject,
  splitGroupAt,
  validateProject,
} from "../src/model.js";

test("default project is an exportable 8 second A/V program", () => {
  const project = createDefaultProject();
  const validation = validateProject(project);
  const report = durationReport(project);
  assert.equal(validation.exportable, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(report.programDuration, 8);
  assert.equal(report.assembledVideoDuration, 8);
  assert.equal(report.aligned, true);
  assert.equal(report.transitionDuration, 0.4);
});

test("camera samples hit the four authored keyframes and stay in stage", () => {
  const project = createDefaultProject();
  for (const frame of project.camera.keyframes) {
    const sampled = cameraAt(project, frame.time);
    assert.ok(Math.abs(sampled.x - frame.x) < 0.001);
    assert.ok(Math.abs(sampled.y - frame.y) < 0.001);
    assert.ok(Math.abs(sampled.zoom - frame.zoom) < 0.001);
  }
  assert.deepEqual(findPathViolations(project), []);
});

test("moving a linked group keeps audio and video ranges aligned", () => {
  const project = createDefaultProject();
  moveGroup(project, "shot-a", 0.12);
  const report = durationReport(project);
  const validation = validateProject(project);
  assert.equal(report.aligned, true);
  assert.equal(report.videoStart, 0.12);
  assert.equal(report.audioStart, 0.12);
  assert.equal(validation.exportable, true);
  assert.ok(Math.abs(validation.conflicts.length) === 0);
});

test("splitting a linked group preserves A/V ranges, events and transition", () => {
  const project = createDefaultProject();
  const eventBefore = project.timeline.audioEvents.map(({ id, at }) => ({ id, at }));
  splitGroupAt(project, "shot-b", 6.25);
  const validation = validateProject(project);
  const report = durationReport(project);
  assert.equal(project.timeline.videoClips.length, 3);
  assert.equal(project.timeline.audioClips.length, 3);
  assert.equal(report.aligned, true);
  assert.equal(validation.exportable, true);
  assert.equal(project.timeline.transitions.length, 1);
  assert.equal(project.timeline.transitions[0].fromGroup, "shot-a");
  assert.deepEqual(
    project.timeline.audioEvents.map(({ id, at }) => ({ id, at })),
    eventBefore,
  );
});

test("duration arithmetic matches two cuts plus transition overlap", () => {
  const project = createDefaultProject();
  splitGroupAt(project, "shot-a", 2.1);
  splitGroupAt(project, "shot-b", 6.25);
  const report = durationReport(project);
  assert.equal(report.clips.length, 4);
  assert.equal(report.aligned, true);
  assert.ok(Math.abs(report.assembledVideoDuration - report.contentDuration) < 0.001);
  assert.ok(Math.abs(report.contentDuration - 8) < 0.001);
});

test("illegal overlap blocks export and carries conflict time range", () => {
  const project = createDefaultProject();
  project.timeline.transitions = [];
  const validation = validateProject(project);
  assert.equal(validation.exportable, false);
  assert.ok(validation.errors.some((item) => item.track === "video"));
  assert.ok(validation.errors.some((item) => item.track === "audio"));
  const conflict = validation.errors.find((item) => item.track === "video");
  assert.equal(conflict.start, 3.8);
  assert.equal(conflict.end, 4.2);
});

test("split inside a transition is rejected", () => {
  const project = createDefaultProject();
  assert.throws(
    () => splitGroupAt(project, "shot-a", 4.0),
    /转场区间/,
  );
});

test("out of stage camera path produces a non-blocking warning", () => {
  const project = createDefaultProject();
  project.camera.keyframes[0].x = -600;
  project.camera.keyframes[0].y = 1400;
  const validation = validateProject(project);
  assert.equal(validation.exportable, true);
  assert.ok(validation.warnings.some((item) => item.id === "path-out-of-stage"));
});

test("saved project reload preserves in/out, event time and keyframes", () => {
  const project = createDefaultProject();
  project.timeline.inPoint = 0.1;
  project.timeline.outPoint = 8.1;
  project.timeline.audioEvents[0].at = 0.712345;
  project.camera.keyframes[1].x = 543.25;
  const restored = hydrateProject(serializeProject(project));
  assert.equal(restored.timeline.inPoint, 0.1);
  assert.equal(restored.timeline.outPoint, 8.1);
  assert.equal(restored.timeline.audioEvents[0].at, 0.712345);
  assert.equal(restored.camera.keyframes[1].x, 543.25);
});

test("keyframe JSON shares the timeline timebase", () => {
  const project = createDefaultProject();
  const payload = buildKeyframeExport(project);
  assert.equal(payload.timebase.inPoint, project.timeline.inPoint);
  assert.equal(payload.timebase.outPoint, project.timeline.outPoint);
  assert.equal(payload.timebase.fps, 30);
  assert.deepEqual(payload.camera.keyframes, project.camera.keyframes);
  assert.deepEqual(payload.tracks.audioEvents, project.timeline.audioEvents);
});

test("edit regression covers move, split, transition and event anchoring", () => {
  const result = runEditSelfTest(createDefaultProject());
  assert.equal(result.pass, true);
  assert.equal(result.results.length, 5);
  assert.ok(result.results.every((item) => item.pass));
});

test("cloning a project keeps model functions isolated", () => {
  const project = createDefaultProject();
  const copy = clone(project);
  moveGroup(copy, "shot-a", 0.1);
  assert.equal(project.timeline.videoClips[0].start, 0);
  assert.equal(copy.timeline.videoClips[0].start, 0.1);
});
