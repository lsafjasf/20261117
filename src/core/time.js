// 全局统一时间基准：所有轨道（视频/字幕/音频）共用同一秒级时间 t。
// 时间以毫秒存储（整数友好），渲染时再换算。
export const TIMEBASE = 'milliseconds';
export const FPS = 30;
export const FRAME_MS = 1000 / FPS;

export const msToSec = (ms) => ms / 1000;
export const secToMs = (sec) => Math.round(sec * 1000);
export const msToFrame = (ms) => Math.floor(ms / FRAME_MS);
export const frameToMs = (frame) => Math.round(frame * FRAME_MS);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const approxEqual = (a, b, eps = FRAME_MS / 2) => Math.abs(a - b) <= eps;
