// 极简可订阅 store：浏览器 UI 与 Node 测试共用同一份状态容器。
export function createStore(reducer, initialState) {
  let state = initialState;
  const listeners = new Set();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reducer(state, action);
      if (next !== state) {
        state = next;
        for (const listener of listeners) listener(state, action);
      }
      return action;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
