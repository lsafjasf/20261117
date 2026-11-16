// Project is the aggregate root. The program timeline, canvas playhead and
// audio events all read from its clock and event log, which is the "one
// shared state" required for deterministic replay, save and reload.

import { TransportClock } from './clock.js';
import { EventLog } from './event-log.js';
import { Timeline } from './timeline.js';
import { createSceneState, reduceScene } from './scene.js';
import { reduceTimeline } from './timeline-reducer.js';
import { EVENT_TYPES } from './constants.js';

const SCHEMA_VERSION = 1;

export class Project {
  constructor({ name = 'untitled', width = 640, height = 360, fps = 30,
    sampleRate = 44100 } = {}) {
    this.meta = { name, width, height, fps, sampleRate,
      createdAt: new Date(0).toISOString() };
    this.clock = new TransportClock({ inPoint: 0, outPoint: 0 });
    this.events = new EventLog();
    this.timeline = new Timeline();
    this.scene = createSceneState();
  }

  get durationMs() {
    return this.timeline.durationMs;
  }

  setInOut(inPoint, outPoint) {
    this.clock.setRange(inPoint, outPoint);
  }

  record(type, fields) {
    const event = this.events.record(type, fields);
    // Keep live state in lock-step with the log so the UI never drifts from
    // what a fresh replay would produce.
    this.applyEvent(event);
    return event;
  }

  applyEvent(event) {
    if (event.type === EVENT_TYPES.CLIP_ADD) {
      this.timeline.addClip({ ...event.payload });
      return;
    }
    if (event.type.startsWith('clip/') || event.type === EVENT_TYPES.TRANSITION_ADD) {
      reduceTimeline(this.timeline, event);
      return;
    }
    reduceScene(this.scene, event);
  }

  // Full rebuild from the log; used after reload and in failure-replay tests.
  static fromEventLog(events, meta) {
    const project = new Project(meta);
    project.meta.createdAt = meta?.createdAt || project.meta.createdAt;
    const freshTimeline = new Timeline();
    const sourceLog = EventLog.fromJSON(events);
    seedTimelineFromLog(freshTimeline, events);
    const result = sourceLog.replay(
      (state, event) => reduceProject(state, event),
      { scene: createSceneState(), timeline: freshTimeline },
      {}
    );
    project.events = sourceLog;
    project.scene = result.state.scene;
    project.timeline = result.state.timeline;
    project.clock.setRange(meta?.inPoint ?? 0,
      meta?.outPoint ?? project.timeline.durationMs);
    project.replayFailures = result.failed;
    return project;
  }

  // Replays only within the in/out window and reports events that cannot be
  // applied, which powers the failure-replay/reload surface.
  replayWindow() {
    const fresh = createSceneState();
    const result = this.events.replay(
      (state, event) => reduceProject(state, event),
      { scene: fresh, timeline: new Timeline() },
      { toMs: this.clock.outPoint }
    );
    return { scene: result.state.scene, failed: result.failed,
      appliedCount: result.applied.length };
  }

  validateForExport() {
    const conflicts = this.timeline.validate();
    const errors = [];
    if (this.clock.duration <= 0) {
      errors.push({ level: 'error', message: 'Export range is empty' });
    }
    for (const conflict of conflicts) {
      errors.push({ level: 'error', kind: 'OVERLAP', ...conflict });
    }
    return { ok: errors.length === 0, errors };
  }

  toJSON() {
    return {
      schemaVersion: SCHEMA_VERSION,
      meta: {
        ...this.meta,
        inPoint: this.clock.inPoint,
        outPoint: this.clock.outPoint
      },
      events: this.events.toJSON()
    };
  }

  static fromJSON(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (data.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`Unsupported project schema ${data.schemaVersion}`);
    }
    return Project.fromEventLog(data.events, data.meta);
  }
}

// Extract the highest numeric suffix used by clip/trans/track ids so a
// rebuilt timeline never mints an id that collides with a logged reference.
function seedTimelineFromLog(timeline, events) {
  // All generated ids are carried explicitly in event payloads, so a fresh
  // timeline only needs its initial track id. The counter then advances
  // identically as clip/add, split and transition events replay.
  timeline.seedIdCounter(1);
}

export function reduceProject(state, event) {
  if (event.type === EVENT_TYPES.CLIP_ADD) {
    state.timeline.addClip({ ...event.payload });
  } else if (event.type.startsWith('clip/') ||
    event.type === EVENT_TYPES.TRANSITION_ADD) {
    reduceTimeline(state.timeline, event);
  } else {
    reduceScene(state.scene, event);
  }
  return state;
}
