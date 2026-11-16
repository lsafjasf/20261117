// 确定性随机:同一 seed 必复现
(function (global) {
  'use strict';
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seedNum) { return mulberry32(seedNum >>> 0); }
  const api = { hashSeed, makeRng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.RNG = api;
})(typeof window !== 'undefined' ? window : globalThis);
