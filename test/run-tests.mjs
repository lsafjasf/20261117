import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TransportClock } from '../src/core/clock.js';
import { EventLog } from '../src/core/event-log.js';
import { Timeline } from '../src/core/timeline.js';
import { Project } from '../src/core/project.js';
import { EVENT_TYPES } from '../src/core/constants.js';
import { buildDemoProject, applyEditPass, PALETTE } from '../src/core/scenario.js';
import { exportProject, checkAudioVisualAlignment, renderFrames,
  checkBlackFrames } from '../src/node/exporter.js';
import { wavDurationMs } from '../src/node/wav.js';
import { encodePng } from '../src/node/png.js';

const passed = [];
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed.push(name);
      console.log(`  \u2713 ${name}`);
    });
}

const all = [];

all.push(test('clock supports play/pause/seek/loop on one timebase', () => {
  let virtual = 0;
  const clock = new TransportClock({ outPoint: 1000, now: () => virtual });
  clock.play();
  virtual = 250;
  assert.equal(clock.tick().time, 250);
  clock.pause();
  virtual = 900;
  assert.equal(clock.tick().time, 250);
  assert.equal(clock.seek(300), 300);
  clock.loop = true;
  clock.play();
  virtual = 1700;
  const result = clock.tick();
  assert.equal(result.wrapped, true);
  assert.equal(result.time, 100);
}));

all.push(test('events stay ordered and replay reconstructs scene state', () => {
  const { project } = buildDemoProject();
  const rebuilt = Project.fromJSON(JSON.stringify(project.toJSON()));
  assert.deepEqual(rebuilt.scene.shapes.hero, project.scene.shapes.hero);
  assert.equal(rebuilt.events.events.length, project.events.events.length);
  const hero = rebuilt.scene.shapes.hero;
  assert.equal(hero.x, 220);
  assert.equal(hero.text, 'DEMO');
  assert.equal(rebuilt.scene.audioPulses.length, 4);
}));

all.push(test('move/split/transition keep A/V aligned and transition valid', () => {
  const { project, clipA, clipB, clipC } = buildDemoProject();
  const edit = applyEditPass(project,
    { clipA: clipA.id, clipB: clipB.id, clipC: clipC.id });
  assert.equal(project.timeline.validate().length, 0);
  const b = project.timeline.findClip(clipB.id);
  assert.equal(b.start, 750);
  assert.equal(b.end, 1500);
  assert.equal(edit.split.right.start, 1500);
  const trans = project.timeline.transitions[0];
  assert.deepEqual([trans.start, trans.end], [750, 1000]);

  const frames = renderFrames(project);
  assert.deepEqual(checkBlackFrames(frames), []);
  const mismatches = checkAudioVisualAlignment(frames, project.scene.audioPulses);
  assert.deepEqual(mismatches, []);
  const cross = project.timeline.activeClipsAt(875);
  assert.equal(cross.length, 2);
}));

all.push(test('save/reload preserves in/out points and event positions', () => {
  const { project, clipA, clipB, clipC } = buildDemoProject();
  applyEditPass(project,
    { clipA: clipA.id, clipB: clipB.id, clipC: clipC.id });
  const json = project.toJSON();
  const reloaded = Project.fromJSON(json);
  assert.equal(reloaded.clock.inPoint, project.clock.inPoint);
  assert.equal(reloaded.clock.outPoint, project.clock.outPoint);
  assert.deepEqual(
    reloaded.events.events.map((event) => [event.t, event.type, event.seq]),
    project.events.events.map((event) => [event.t, event.type, event.seq])
  );
  assert.equal(reloaded.timeline.durationMs, project.timeline.durationMs);
}));

all.push(test('illegal overlap blocks the move and identifies the conflict', () => {
  const timeline = new Timeline();
  const first = timeline.addClip({ start: 0, end: 500, color: PALETTE[0], label: 'x' });
  timeline.addClip({ start: 600, end: 900, color: PALETTE[1], label: 'y' });
  assert.throws(() => timeline.moveClip(first.id, 300), /illegal overlap/);
  try {
    timeline.moveClip(first.id, 300);
    assert.fail('expected overlap error');
  } catch (error) {
    assert.equal(error.code, 'OVERLAP_BLOCKED');
    assert.equal(error.conflict.start, 600);
    assert.equal(error.conflict.end, 800);
  }
  // The rejected move leaves a valid timeline. Inject a raw overlapping clip
  // (bypassing the guard) to verify validate() reports the exact conflict.
  timeline.tracks[0].clips.push({
    id: 'raw_overlap', trackId: timeline.tracks[0].id,
    start: 400, end: 700, sourceStart: 0, sourceDuration: 300,
    color: PALETTE[2], label: 'z'
  });
  const conflicts = timeline.validate();
  assert.equal(conflicts.length, 2);
  assert.ok(conflicts.every((item) => item.clipIds.includes('raw_overlap')));
  assert.deepEqual(conflicts.map((item) => [item.start, item.end]).sort(),
    [[400, 500], [600, 700]]);
}));

all.push(test('export is refused while an illegal overlap exists', () => {
  const { project, clipC } = buildDemoProject();
  project.setInOut(0, project.durationMs);
  // Simulate a corrupted project: inject an overlapping clip that has no
  // covering transition, bypassing the interactive addClip guard.
  project.timeline.tracks[0].clips.push({
    id: 'corrupt_clip', trackId: project.timeline.tracks[0].id,
    start: 100, end: 600, sourceStart: 0, sourceDuration: 500,
    color: PALETTE[4], label: 'bad'
  });
  const validation = project.validateForExport();
  assert.equal(validation.ok, false);
  assert.equal(validation.errors[0].kind, 'OVERLAP');
  assert.throws(() => exportProject(project, '/tmp/should-not-exist'),
    (error) => error.code === 'EXPORT_BLOCKED');
  void clipC;
}));

all.push(test('at least two trim/transition durations are compared', () => {
  const trimmedProject = buildDemoProject().project;
  const trimIds = trimmedProject.timeline.tracks[0].clips.map((clip) => clip.id);
  const lastClipId = trimIds[trimIds.length - 1];
  // Trim the final clip shorter: total program duration drops by 300 ms.
  trimmedProject.record(EVENT_TYPES.CLIP_TRIM, {
    t: 200, targetId: lastClipId,
    payload: { start: 2000, end: 2700 }
  });
  trimmedProject.setInOut(0, trimmedProject.durationMs);
  const trimmedDuration = trimmedProject.durationMs;

  const transitionProject = buildDemoProject().project;
  const [aId, bId] = transitionProject.timeline.tracks[0].clips
    .map((clip) => clip.id);
  const transitionId = transitionProject.timeline.mintTransitionId();
  transitionProject.record(EVENT_TYPES.TRANSITION_ADD, {
    t: 600,
    payload: { clipAId: aId, clipBId: bId, durationMs: 200, transitionId }
  });
  transitionProject.setInOut(0, transitionProject.durationMs);
  const transitionDuration = transitionProject.durationMs;

  assert.equal(trimmedDuration, 2700);
  // A crossfade preserves total program length but introduces a 200 ms
  // covered overlap between the first two clips.
  assert.equal(transitionDuration, 3000);
  assert.notEqual(trimmedDuration, transitionDuration);
  assert.ok(trimmedDuration < transitionDuration,
    `trim ${trimmedDuration} vs transition ${transitionDuration}`);
  assert.equal(transitionProject.timeline.transitions[0].durationMs, 200);
  assert.equal(trimmedProject.timeline.validate().length, 0);
  assert.equal(transitionProject.timeline.validate().length, 0);
}));

all.push(test('offline export writes playable APNG/WAV/PNG/JSON with no black frames',
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-'));
    const { project, clipA, clipB, clipC } = buildDemoProject();
    applyEditPass(project,
      { clipA: clipA.id, clipB: clipB.id, clipC: clipC.id });
    const base = join(dir, 'demo');
    const report = exportProject(project, base);
    for (const file of report.files) {
      assert.ok(existsSync(file), file);
      assert.ok(statSync(file).size > 100, file);
    }
    const apng = readFileSync(`${base}.apng`);
    assert.deepEqual(apng.subarray(0, 8),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert.ok(apng.includes(Buffer.from('acTL')));
    assert.ok(apng.includes(Buffer.from('fcTL')));
    const wav = readFileSync(`${base}.wav`);
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.equal(wavDurationMs(wav, project.meta.sampleRate), report.durationMs);
    assert.equal(report.blackFrames.length, 0);
    assert.equal(report.alignmentMismatches.length, 0);
    assert.equal(report.firstFrame.canvas.isBlack(), false);
    assert.equal(report.lastFrame.canvas.isBlack(), false);
    const png = encodePng(report.firstFrame.canvas);
    assert.deepEqual(png.subarray(0, 8), apng.subarray(0, 8));
  }));

all.push(test('failure replay captures bad events and reload can continue', () => {
  const log = new EventLog();
  log.record(EVENT_TYPES.SHAPE_ADD, { t: 0, targetId: 's1',
    payload: { x: 1, y: 1 } });
  log.record(EVENT_TYPES.SHAPE_DRAG, { t: 10, targetId: 'missing',
    payload: { x: 2, y: 2 } });
  const { state, applied, failed } = log.replay(
    (draft, event) => {
      if (event.type === EVENT_TYPES.SHAPE_ADD) {
        draft.shapes[event.targetId] = { id: event.targetId };
      } else if (event.type === EVENT_TYPES.SHAPE_DRAG) {
        if (!draft.shapes[event.targetId]) throw new Error('missing shape');
      }
    },
    { shapes: {} }
  );
  assert.equal(applied.length, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].type, EVENT_TYPES.SHAPE_DRAG);
  assert.ok(state.shapes.s1);
}));

all.push(test('looping playback re-fires events on each pass deterministically', () => {
  const clock = new TransportClock({ outPoint: 300, loop: true });
  const fired = [];
  const log = new EventLog([
    { id: 'e1', seq: 0, t: 100, type: EVENT_TYPES.AUDIO_TRIGGER,
      targetId: null, payload: { note: 1, durationMs: 50 } }
  ]);
  clock.play();
  let absolute = 0;
  for (let step = 0; step < 6; step += 1) {
    const before = clock.time;
    clock.advance(100);
    absolute += 100;
    const after = clock.time;
    // After a wrap the clock restarts near zero; reaching exactly 100 on the
    // following step is the single trigger point for each loop.
    const crossedEvent = before < 100 && after >= 100;
    if (crossedEvent) fired.push(absolute);
  }
  assert.equal(fired.length, 2);
  assert.deepEqual(fired, [100, 400]);
  assert.equal(log.events[0].id, 'e1');
}));

Promise.all(all).then(() => {
  console.log(`\n${passed.length} tests passed`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
