import { HISTORY_LIMIT } from "./constants.js";

function snapshot(state) {
  return structuredClone(state);
}

export class History {
  constructor(limit = HISTORY_LIMIT) {
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.lastKey = null;
    this.lastRecordedAt = 0;
  }

  record(previous, {
    label = "编辑",
    coalesceKey = null,
    now = Date.now(),
    coalesceMs = 900,
  } = {}) {
    const coalesced =
      coalesceKey &&
      coalesceKey === this.lastKey &&
      now - this.lastRecordedAt <= coalesceMs;

    if (coalesced) {
      this.lastRecordedAt = now;
      return false;
    }

    this.past.push({ state: snapshot(previous), label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.lastKey = coalesceKey;
    this.lastRecordedAt = now;
    return true;
  }

  undo(current) {
    if (!this.past.length) return null;
    const entry = this.past.pop();
    this.future.push({ state: snapshot(current), label: entry.label });
    this.lastKey = null;
    this.lastRecordedAt = 0;
    return {
      state: snapshot(entry.state),
      label: entry.label,
    };
  }

  redo(current) {
    if (!this.future.length) return null;
    const entry = this.future.pop();
    this.past.push({ state: snapshot(current), label: entry.label });
    if (this.past.length > this.limit) this.past.shift();
    this.lastKey = null;
    this.lastRecordedAt = 0;
    return {
      state: snapshot(entry.state),
      label: entry.label,
    };
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  clear() {
    this.past = [];
    this.future = [];
    this.lastKey = null;
    this.lastRecordedAt = 0;
  }
}
