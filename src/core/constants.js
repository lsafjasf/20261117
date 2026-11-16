// All time values are integer milliseconds. Every module (program timeline,
// canvas playhead, audio events, exporters) reads this one timebase.

export const MS = 1;
export const DEFAULT_FPS = 30;
export const FRAME_MS = 1000 / DEFAULT_FPS;
export const DEFAULT_SAMPLE_RATE = 44100;

export const EVENT_TYPES = Object.freeze({
  CLIP_ADD: 'clip/add',
  SHAPE_ADD: 'shape/add',
  SHAPE_DRAG: 'shape/drag',
  SHAPE_INPUT: 'shape/input',
  PLAYHEAD_SEEK: 'playhead/seek',
  AUDIO_TRIGGER: 'audio/trigger',
  CLIP_MOVE: 'clip/move',
  CLIP_SPLIT: 'clip/split',
  CLIP_TRIM: 'clip/trim',
  TRANSITION_ADD: 'transition/add'
});

export const BACKGROUND = { r: 16, g: 24, b: 38 };

export function nowMs(clock) {
  return clock.time;
}

export function frameCount(durationMs, fps = DEFAULT_FPS) {
  return Math.round((durationMs * fps) / 1000);
}

export function frameToMs(frame, fps = DEFAULT_FPS) {
  return Math.round((frame * 1000) / fps);
}
