import { Timeline } from './timeline.js';
import { EVENT_TYPES } from './constants.js';

// Replays timeline mutations onto a fresh Timeline so a saved event log alone
// reconstructs clips, splits, trims and transitions.
export function reduceTimeline(timeline, event) {
  const { type, targetId, t, payload } = event;
  switch (type) {
    case EVENT_TYPES.CLIP_ADD:
      timeline.addClip({ ...payload, id: payload.id });
      break;
    case EVENT_TYPES.CLIP_MOVE:
      timeline.moveClip(targetId, payload.start, payload.trackId);
      break;
    case EVENT_TYPES.CLIP_SPLIT:
      timeline.splitClip(targetId, payload.at, payload.newClipId);
      break;
    case EVENT_TYPES.CLIP_TRIM:
      timeline.trimClip(targetId, { start: payload.start, end: payload.end });
      break;
    case EVENT_TYPES.TRANSITION_ADD:
      timeline.addTransition(payload.clipAId, payload.clipBId,
        payload.durationMs, payload.transitionId);
      break;
    default:
      break;
  }
  // Time is accepted to keep every reducer signature uniform.
  void t;
  return timeline;
}

export function timelineFromEvents(events) {
  const timeline = new Timeline();
  // Strict seq order preserves id generation and every later reference.
  const ordered = [...events].sort((a, b) =>
    (a.opSeq ?? a.seq) - (b.opSeq ?? b.seq));
  for (const event of ordered) {
    reduceTimeline(timeline, event);
  }
  return timeline;
}
