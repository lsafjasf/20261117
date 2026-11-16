// Append-only, time-ordered log of user operations. The same log drives live
// playback, offline export and project save/reload, so replaying it always
// reconstructs the identical state.

let globalSeq = 0;

export class EventLog {
  constructor(events = []) {
    this.events = events.slice();
    this._maxSeq = this.events.reduce((max, event) => Math.max(max, event.seq), -1);
    this._opSeq = this.events.reduce((max, event) =>
      Math.max(max, event.opSeq ?? event.seq), -1) + 1;
  }

  record(type, { t, targetId = null, payload = {} } = {}) {
    if (typeof t !== 'number' || Number.isNaN(t) || t < 0) {
      throw new Error(`Event time must be a non-negative number, got ${t}`);
    }
    const event = {
      id: `evt_${++globalSeq}`,
      seq: ++this._maxSeq,
      // Replay order. Events are stored sorted by media time, but structural
      // edits (an add followed by a move) must always replay in operation
      // order even when their media timestamps are not monotonic.
      opSeq: this._opSeq++,
      t: Math.round(t),
      type,
      targetId,
      payload
    };
    this._insertOrdered(event);
    return event;
  }

  _insertOrdered(event) {
    let low = 0;
    let high = this.events.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const candidate = this.events[mid];
      if (candidate.t < event.t ||
        (candidate.t === event.t && candidate.seq < event.seq)) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    this.events.splice(low, 0, event);
  }

  at(timeMs) {
    return this.events.filter((event) => event.t <= timeMs);
  }

  // Events strictly after `fromMs` and up to `toMs`. Equal timestamps follow
  // insertion order via seq, which preserves the original operation order.
  due(fromMs, toMs) {
    return this.events
      .filter((event) => event.t > fromMs && event.t <= toMs)
      .sort((a, b) => a.t - b.t || (a.opSeq ?? a.seq) - (b.opSeq ?? b.seq));
  }

  // Deterministic full replay against a reducer. A throwing event is captured
  // as a failure instead of aborting, enabling failure replay/reload reports.
  replay(reducer, initialState, { toMs = Infinity, onFailure } = {}) {
    const state = cloneContainer(initialState);
    const applied = [];
    const failed = [];
    const ordered = [...this.events]
      .sort((a, b) => (a.opSeq ?? a.seq) - (b.opSeq ?? b.seq));
    for (const event of ordered) {
      if (event.t > toMs) break;
      try {
        reducer(state, event);
        applied.push(event.id);
      } catch (error) {
        const failure = {
          eventId: event.id,
          seq: event.seq,
          t: event.t,
          type: event.type,
          targetId: event.targetId,
          error: error.message
        };
        failed.push(failure);
        if (onFailure) onFailure(failure, event);
      }
    }
    return { state, applied, failed };
  }

  toJSON() {
    return this.events;
  }

  static fromJSON(events) {
    return new EventLog(events.map((event) => ({ ...event, payload: { ...event.payload } })));
  }
}

// Clone plain data containers while preserving class instances (Timeline etc.)
// and their methods. Nested plain objects are cloned recursively so reducers
// never mutate caller-owned data.
function cloneContainer(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    value.forEach((item, index) => { copy[index] = cloneContainer(item, seen); });
    return copy;
  }
  const copy = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    copy[key] = cloneContainer(item, seen);
  }
  return copy;
}
