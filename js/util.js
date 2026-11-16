/* 通用工具：确定性随机数、哈希与格式化。浏览器与 Node 共用。 */
(function (global) {
  const App = (global.App = global.App || {});

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function hourLabel(h) {
    return pad2(h) + ':00';
  }

  function formatTime(d) {
    d = d || new Date();
    return (
      d.getFullYear() +
      '-' +
      pad2(d.getMonth() + 1) +
      '-' +
      pad2(d.getDate()) +
      ' ' +
      pad2(d.getHours()) +
      ':' +
      pad2(d.getMinutes()) +
      ':' +
      pad2(d.getSeconds())
    );
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  App.util = { mulberry32, hashString, pad2, hourLabel, formatTime, clamp, deepEqual };
})(typeof window !== 'undefined' ? window : globalThis);
