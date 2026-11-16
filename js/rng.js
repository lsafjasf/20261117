/* 确定性随机数与哈希。世界生成只使用这里的 PRNG。 */
(function (G) {
  'use strict';

  function mulberry32(seed) {
    let state = seed >>> 0;
    function next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    next.getState = function () { return state >>> 0; };
    next.setState = function (value) { state = value >>> 0; };
    return next;
  }

  function hashString(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function hashSeed(seed, salt) {
    return hashString(String(seed) + ':' + String(salt || ''));
  }

  G.TowRNG = { mulberry32, hashString, hashSeed };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.TowRNG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
