// Canvas scene state and the single reducer used by both interactive editing
// and event-log replay. Because every mutation goes through this reducer, a
// replayed log rebuilds the exact same shapes, playhead and audio triggers.

import { EVENT_TYPES } from './constants.js';

let shapeCounter = 0;

export function createShape(partial = {}) {
  shapeCounter += 1;
  return {
    id: partial.id || `shape_${shapeCounter}`,
    type: partial.type || 'rect',
    x: partial.x ?? 80,
    y: partial.y ?? 60,
    w: partial.w ?? 120,
    h: partial.h ?? 80,
    color: partial.color || '#4cc2ff',
    text: partial.text ?? '',
    // A short visual pulse tied to an audio trigger so A/V alignment can be
    // verified frame by frame instead of by ear.
    pulseUntil: partial.pulseUntil ?? -1
  };
}

export function createSceneState() {
  return {
    shapes: {},
    shapeOrder: [],
    playhead: 0,
    // Redundant view over audio trigger events, rebuilt deterministically.
    audioPulses: []
  };
}

export function reduceScene(state, event) {
  const { type, targetId, t, payload } = event;
  switch (type) {
    case EVENT_TYPES.SHAPE_ADD: {
      const shape = createShape({ id: targetId || undefined, ...payload });
      if (state.shapes[shape.id]) break;
      state.shapes[shape.id] = shape;
      state.shapeOrder.push(shape.id);
      break;
    }
    case EVENT_TYPES.SHAPE_DRAG: {
      const shape = requireShape(state, targetId);
      shape.x = Math.round(payload.x);
      shape.y = Math.round(payload.y);
      break;
    }
    case EVENT_TYPES.SHAPE_INPUT: {
      const shape = requireShape(state, targetId);
      shape.text = String(payload.text ?? '');
      if (payload.color) shape.color = payload.color;
      break;
    }
    case EVENT_TYPES.PLAYHEAD_SEEK: {
      state.playhead = Math.round(t);
      break;
    }
    case EVENT_TYPES.AUDIO_TRIGGER: {
      state.audioPulses.push({
        id: event.id,
        t: event.t,
        note: payload.note ?? 0,
        durationMs: payload.durationMs ?? 180,
        targetId
      });
      const shape = targetId ? state.shapes[targetId] : null;
      if (shape) {
        shape.pulseUntil = Math.max(shape.pulseUntil,
          event.t + (payload.durationMs ?? 180));
      }
      break;
    }
    default:
      // Timeline-specific events are handled by the project reducer.
      break;
  }
  return state;
}

function requireShape(state, shapeId) {
  const shape = state.shapes[shapeId];
  if (!shape) throw new Error(`Unknown shape ${shapeId}`);
  return shape;
}
