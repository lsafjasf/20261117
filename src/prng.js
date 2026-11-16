/* 确定性伪随机数：mulberry32，状态可序列化，保证同 seed 完全复现 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LunarPRNG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
    const api = {
      next() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      range(min, max) {
        return min + api.next() * (max - min);
      },
      int(min, max) {
        return Math.floor(api.range(min, max + 1));
      },
      getState() {
        return a >>> 0;
      },
      setState(s) {
        a = s >>> 0;
      }
    };
    return api;
  }

  return { mulberry32, hashSeed };
});
