import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moveClip,
  splitClip,
  setTrim,
  setTransitionDuration,
  validateProject,
  trackDuration,
  clipDuration,
  serializeProject,
  deserializeProject,
  absoluteAudioEvents,
} from '../src/engine.js';
import { createDefaultProject } from '../src/default-project.js';

test('default 12s program: 7+7 clips with 2s transition span 12s', () => {
  const project = createDefaultProject();
  const clips = project.tracks.video;
  assert.equal(clips.length, 2);
  assert.equal(clipDuration(clips[0]), 7);
  assert.equal(trackDuration(clips), 12);
  assert.equal(validateProject(project).valid, true);
});

test('moving a clip keeps duration and events rebased on absolute time', () => {
  const project = createDefaultProject();
  const moved = moveClip(project, 'clip-b', 0.4);
  const clipB = moved.tracks.video.find((c) => c.id === 'clip-b');
  assert.equal(clipB.start, 5.4);
  assert.equal(clipDuration(clipB), 7);
  const events = absoluteAudioEvents(moved);
  const firstB = events.find((e) => e.clipId === 'clip-b');
  assert.ok(Math.abs(firstB.time - 5.4) < 1e-9);
  // Clip A untouched.
  assert.equal(absoluteAudioEvents(moved).filter((e) => e.clipId === 'clip-a')[0].time, 0);
});

test('split divides events and preserves every event on the program timeline', () => {
  const project = createDefaultProject();
  const beforeEvents = absoluteAudioEvents(project);
  const { project: split, newClipId } = splitClip(project, 'clip-a', 3);
  const parts = split.tracks.video.filter((c) => c.id === 'clip-a' || c.id === newClipId);
  assert.equal(parts.length, 2);
  assert.equal(clipDuration(parts[0]), 3);
  assert.equal(clipDuration(parts[1]), 4);
  const afterEvents = absoluteAudioEvents(split)
    .filter((e) => e.clipId === 'clip-a' || e.clipId === newClipId)
    .map((e) => Number(e.time.toFixed(3)));
  const expected = beforeEvents
    .filter((e) => e.clipId === 'clip-a')
    .map((e) => e.time);
  assert.deepEqual(afterEvents, expected);
});

test('trim and transition changes produce comparable shorter durations', () => {
  const project = createDefaultProject();
  const baseline = trackDuration(project.tracks.video);
  assert.equal(baseline, 12);
  const trimmed = setTrim(project, 'clip-b', 0, 5);
  const afterTrim = trackDuration(trimmed.tracks.video);
  assert.ok(afterTrim < baseline, `trim should shorten program: ${afterTrim} < ${baseline}`);
  assert.equal(afterTrim, 10); // clip-b trimmed 7->5, overlap still 2s

  // Compare two different transition overlaps by actually moving clip-b.
  const longFade = moveClip(setTransitionDuration(project, 'clip-b', 3), 'clip-b', -1);
  const afterLongFade = trackDuration(longFade.tracks.video);
  assert.equal(afterLongFade, 11); // 7 + 7 - 3
  assert.ok(afterLongFade < baseline);

  const shortFade = moveClip(setTransitionDuration(project, 'clip-b', 1), 'clip-b', 1);
  assert.equal(trackDuration(shortFade.tracks.video), 13); // 7 + 7 - 1
});

test('illegal overlap without matching transition is rejected with location', () => {
  const project = createDefaultProject();
  const illegal = moveClip(project, 'clip-b', -1); // start=4: 1s overlap, transition declares 2s
  const result = validateProject(illegal);
  assert.equal(result.valid, false);
  assert.match(result.conflicts[0].reason, /illegal overlap/);
  assert.equal(result.conflicts[0].at, 4);
  assert.match(result.conflicts[0].clipId, /clip-a <-> clip-b/);

  const trimmed = setTrim(setTransitionDuration(project, 'clip-b', 0), 'clip-b', 0, 4);
  const gapOk = moveClip(trimmed, 'clip-b', 3); // start=8, 4s long, legal 1s gap
  assert.equal(validateProject(gapOk).valid, true);
  assert.equal(trackDuration(gapOk.tracks.video), 12);
});

test('save and reload keeps in/out points and event positions', () => {
  const project = setTrim(createDefaultProject(), 'clip-a', 1, 4);
  const text = serializeProject(project);
  const { project: restored, validation } = deserializeProject(text);
  assert.equal(validation.valid, true);
  const clip = restored.tracks.video.find((c) => c.id === 'clip-a');
  assert.equal(clip.sourceIn, 1);
  assert.equal(clip.sourceOut, 4);
  assert.deepEqual(
    absoluteAudioEvents(restored).map((e) => [e.clipId, e.time]),
    absoluteAudioEvents(project).map((e) => [e.clipId, e.time]),
  );
});

test('subtitles share the same timeline and gaps stay valid', () => {
  const project = createDefaultProject();
  const subs = project.tracks.subtitle;
  assert.equal(subs[0].start, 0);
  assert.equal(subs[1].start, 5);
  assert.equal(validateProject(project).valid, true);
});
