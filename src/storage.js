// 回放存档：浏览器使用 localStorage，无 DOM 环境使用内存兜底

const KEY = 'mine-vent-replays-v1';
const MAX_REPLAYS = 5;

function hasStorage() {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
}

const memory = new Map();

export const ReplayStore = {
  save(entry) {
    const list = this.list();
    list.unshift(entry);
    while (list.length > MAX_REPLAYS) list.pop();
    this._write(list);
    return entry.id;
  },

  list() {
    if (hasStorage()) {
      try {
        return JSON.parse(localStorage.getItem(KEY) || '[]');
      } catch {
        return [];
      }
    }
    return memory.get(KEY) || [];
  },

  get(id) {
    return this.list().find((e) => e.id === id) || null;
  },

  remove(id) {
    this._write(this.list().filter((e) => e.id !== id));
  },

  clear() {
    this._write([]);
  },

  _write(list) {
    if (hasStorage()) {
      localStorage.setItem(KEY, JSON.stringify(list));
    } else {
      memory.set(KEY, list);
    }
  },
};

export function makeReplayEntry(recorder, finalState, label = '') {
  const conflicts = recorder.events.filter((e) => e.type === 'conflict').length;
  const protections = recorder.events.filter((e) => e.type === 'protection').length;
  return {
    id: `r${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    label,
    savedAt: new Date(hasStorage() ? Date.now() : 0).toISOString(),
    finalStatus: finalState.status,
    safeElapsed: finalState.safeElapsed,
    simTime: finalState.simTime,
    conflicts,
    protections,
    data: recorder.serialize(),
  };
}
