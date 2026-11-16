// Builds the reference demo entirely through recorded events. Since the
// project is the event log, the same scenario proves recording, replay,
// save/reload and export with identical results.

import { Project } from './project.js';
import { EVENT_TYPES } from './constants.js';

export const PALETTE = ['#4cc2ff', '#9d7bff', '#3ddc97', '#ff8fab', '#ffb454'];

export function buildDemoProject(options = {}) {
  const project = new Project({
    name: options.name || 'demo',
    width: options.width || 640,
    height: options.height || 360,
    fps: options.fps || 30,
    sampleRate: options.sampleRate || 44100
  });

  // Three adjacent 1000 ms clips on the single program track.
  const clipA = addClip(project, 0, 1000, PALETTE[0], 'A');
  const clipB = addClip(project, 1000, 2000, PALETTE[1], 'B');
  const clipC = addClip(project, 2000, 3000, PALETTE[2], 'C');

  // Editable shapes on the canvas plus drag and text input events.
  project.record(EVENT_TYPES.SHAPE_ADD, {
    t: 0, targetId: 'hero',
    payload: { type: 'rect', x: 120, y: 110, w: 160, h: 110,
      color: PALETTE[3], text: '' }
  });
  project.record(EVENT_TYPES.SHAPE_DRAG, {
    t: 350, targetId: 'hero', payload: { x: 220, y: 130 }
  });
  project.record(EVENT_TYPES.SHAPE_INPUT, {
    t: 700, targetId: 'hero', payload: { text: 'DEMO' }
  });
  project.record(EVENT_TYPES.PLAYHEAD_SEEK, { t: 0 });

  // Sound triggers are stored as events and pulse the linked shape.
  [400, 1250, 2100, 2600].forEach((time, index) => {
    project.record(EVENT_TYPES.AUDIO_TRIGGER, {
      t: time, targetId: 'hero',
      payload: { note: index, durationMs: 200 }
    });
  });

  return { project, clipA, clipB, clipC };
}

export function addClip(project, start, end, color, label) {
  const id = project.timeline.mintClipId();
  project.record(EVENT_TYPES.CLIP_ADD, {
    t: start,
    payload: { id, start, end, sourceStart: 0,
      sourceDuration: end - start, color, label }
  });
  return project.timeline.findClip(id);
}

// Apply the required edit pass: move, split and a 250 ms crossfade.
export function applyEditPass(project, ids) {
  const result = {};
  // Move C forward to free headroom after B.
  result.moved = project.record(EVENT_TYPES.CLIP_MOVE, {
    t: 800, targetId: ids.clipC, payload: { start: 2300 }
  });
  // Split B into two contiguous halves at 1500.
  const newClipId = project.timeline.mintClipId();
  project.record(EVENT_TYPES.CLIP_SPLIT, {
    t: 900, targetId: ids.clipB, payload: { at: 1500, newClipId }
  });
  const splitClip = project.timeline.findClip(ids.clipB);
  result.split = { left: splitClip,
    right: project.timeline.findClip(newClipId) };
  // Crossfade A into the left half of B (250 ms overlap, transition covered).
  const transitionId = project.timeline.mintTransitionId();
  result.transition = project.record(EVENT_TYPES.TRANSITION_ADD, {
    t: 1000,
    payload: { clipAId: ids.clipA, clipBId: ids.clipB,
      durationMs: 250, transitionId }
  });
  const durationBefore = project.durationMs;
  project.setInOut(0, project.durationMs);
  result.durationBefore = durationBefore;
  return result;
}
