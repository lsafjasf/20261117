// 工程保存/载入与失败回放。保存的是确定性的源时间描述（入点 srcIn、
// 出点 srcIn+duration、事件 start），因此重新载入后位置完全一致。

export function serializeProject(state) {
  const { timeline, sources } = state;
  return {
    version: 1,
    savedAt: new Date(0).toISOString(),
    duration: timeline.duration,
    sources,
    videos: timeline.videos,
    audios: timeline.audios,
    subtitles: timeline.subtitles,
    animations: timeline.animations,
    transitions: timeline.transitions
  };
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

export function saveProject(store, key, storage = globalThis.localStorage) {
  const payload = JSON.stringify(serializeProject(store.getState()));
  storage.setItem(key, payload);
  return payload;
}

export function loadProject(store, key, storage = globalThis.localStorage) {
  const raw = storage.getItem(key);
  if (!raw) return false;
  const project = JSON.parse(raw);
  store.dispatch({ type: "LOAD_PROJECT", project });
  return true;
}

// 失败回放：取出被阻止的操作并按顺序重试，仍失败的保留下来继续等待下一轮。
export function replayFailedOperations(store) {
  const failed = store.getState().operations.filter((operation) => !operation.ok);
  const remaining = [];
  const retried = [];
  store.dispatch({ type: "RESET_OPERATIONS" });
  for (const operation of failed) {
    const before = store.getState().timeline;
    store.dispatch(operation);
    const after = store.getState().timeline;
    const nowOk = after !== before && store.getState().lastError === null;
    if (nowOk) retried.push(operation);
    else remaining.push(operation);
  }
  return { retried, remaining };
}
