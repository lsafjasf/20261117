import test from "node:test";
import assert from "node:assert/strict";
import {
  auditionEditPass,
  clipDuration,
  clipEnd,
  createDemoProject,
  deserializeProject,
  moveClip,
  projectDuration,
  serializeProject,
  setTransition,
  shortTime,
  splitTimelineClip,
  timecode,
  validateProject,
  validateReload
} from "../src/project.js";

test("demo project is valid and contains two related scenes", () => {
  const project = createDemoProject();
  const result = validateProject(project);
  assert.equal(result.ok, true, result.errors.map((error) => error.message).join(", "));
  assert.equal(project.timeline.clips.length, 2);
  assert.equal(project.timeline.subtitles.length, 2);
  assert.ok(project.timeline.events.length >= 18);
  assert.equal(projectDuration(project), 9.25);
});

test("transitions compare clip durations using the shared frame clock", () => {
  const project = createDemoProject();
  const [first, second] = project.timeline.clips;
  assert.equal(clipDuration(first), 5);
  assert.equal(clipDuration(second), 4.5);
  assert.equal(first.transitionOut.duration, 0.25);
  assert.equal(shortTime(clipDuration(first) + clipDuration(second) - 0.25), "9.25s");
  assert.equal(timecode(4.75, 24), "00:00:04:18");
});

test("illegal overlaps are reported with a concrete conflict range", () => {
  const project = createDemoProject();
  project.timeline.clips[1].start = 4.2;
  const result = validateProject(project);
  assert.equal(result.ok, false);
  const overlap = result.errors.find((error) => error.kind === "overlap");
  assert.ok(overlap);
  assert.ok(overlap.end > overlap.start);
  assert.deepEqual(new Set(result.conflictIds), new Set(["clip-platform", "clip-window"]));
});

test("moving and splitting preserve source duration and event time", () => {
  const project = createDemoProject();
  const moved = moveClip(project.timeline.clips[1], 5);
  assert.equal(clipDuration(moved), 4.5);
  const split = splitTimelineClip({ ...project, timeline: { ...project.timeline, clips: [project.timeline.clips[0], moved] } }, moved.id, 6.3);
  assert.ok(split);
  const halves = split.timeline.clips.slice(1);
  assert.equal(halves.length, 2);
  assert.ok(Math.abs(clipDuration(halves[0]) + clipDuration(halves[1]) - 4.5) < 1e-6);
  assert.equal(split.timeline.events[5].time, project.timeline.events[5].time);
});

test("changing crossfade to cut exposes the overlap as a conflict", () => {
  const project = setTransition(createDemoProject(), "clip-platform", "cut");
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /非法重叠/);
});

test("saved in/out points, traces and events survive a reload", () => {
  const project = createDemoProject();
  const raw = serializeProject(project);
  const loaded = deserializeProject(raw);
  const check = validateReload(project, loaded);
  assert.equal(check.ok, true);
  assert.deepEqual(loaded.timeline.clips[0].sourceIn, project.timeline.clips[0].sourceIn);
  assert.deepEqual(loaded.timeline.clips[0].sourceOut, project.timeline.clips[0].sourceOut);
  assert.deepEqual(loaded.timeline.events.map((event) => event.time), project.timeline.events.map((event) => event.time));
  assert.deepEqual(loaded.frames[3].traceA, project.frames[3].traceA);
});

test("edit audit reports zero audio/clock drift", () => {
  const audit = auditionEditPass(createDemoProject());
  assert.equal(audit.passed, true, audit.message);
  assert.equal(audit.clockOffsetMs, 0);
  assert.ok(audit.overlap > 0);
});

test("trims enforce the minimum one-frame duration", () => {
  const project = createDemoProject();
  const clip = project.timeline.clips[0];
  const trimmed = { ...clip, sourceOut: clip.sourceIn + 1 / project.fps };
  assert.ok(Math.abs(clipDuration(trimmed) - 1 / 24) < 1e-12);
  const invalid = { ...clip, sourceOut: clip.sourceIn };
  project.timeline.clips[0] = invalid;
  assert.equal(validateProject(project).ok, false);
});
