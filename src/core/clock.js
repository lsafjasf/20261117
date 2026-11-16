// 传输控制：节目时间线、画面播放头与音频事件都读取 store.clock.time，
// 因此只有一个时间基准，拖动/播放/循环天然同步。

export const setPlayhead = (time) => ({ type: "SET_PLAYHEAD", time });
export const play = () => ({ type: "SET_PLAYING", playing: true });
export const pause = () => ({ type: "SET_PLAYING", playing: false });
export const setLoop = (loop) => ({ type: "SET_LOOP", loop });

// 平台无关的滴答驱动器：浏览器传 rAF 风格的调度器，Node 测试传定时器。
export function createTicker(store, scheduler = globalThis.requestAnimationFrame) {
  let handle = null;
  let last = 0;
  const frame = (nowMs) => {
    const now = nowMs / 1000;
    const delta = last ? now - last : 0;
    last = now;
    store.dispatch({ type: "TICK", delta });
    if (store.getState().clock.playing) handle = scheduler(frame);
  };
  return {
    start() {
      if (handle != null) return;
      last = 0;
      handle = scheduler(frame);
    },
    stop() {
      handle = null;
    },
    // 测试用：手动推进，秒为单位。
    advance(deltaSeconds) {
      store.dispatch({ type: "TICK", delta: deltaSeconds });
    }
  };
}
