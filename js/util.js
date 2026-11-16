/* 工具函数：确定性 RNG、时间/数值格式化、全局常量 */
(function (root) {
  'use strict';

  // FNV-1a 字符串哈希，保证任意 seed 文本都能转成稳定的 32 位整数
  function hashSeed(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32：轻量确定性 PRNG，同 seed 序列完全一致
  function makeRng(seedInt) {
    let a = seedInt >>> 0;
    return function rng() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 为不同用途派生子流，互不干扰且同样确定
  function subRng(seedInt, salt) {
    return makeRng((hashSeed(salt) ^ seedInt) >>> 0);
  }

  const HOURS_PER_DAY = 24;
  const DAYS_PER_YEAR = 360; // 12 月 × 30 天的简化历法
  const HOURS_PER_YEAR = DAYS_PER_YEAR * HOURS_PER_DAY;
  const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月'];

  function simDate(hour) {
    const day = Math.floor(hour / 24);
    const month = Math.floor(day / 30) + 1;
    const dom = (day % 30) + 1;
    const hh = hour % 24;
    return {
      day,
      month,
      text: 'D' + String(day).padStart(3, '0') + ' ' +
        MONTH_NAMES[month - 1] + dom + '日 ' + String(hh).padStart(2, '0') + ':00',
      short: 'D' + String(day).padStart(3, '0'),
    };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function fmt(v, digits) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return Number(v).toFixed(digits === undefined ? 1 : digits);
  }

  // 全局物理与目标常量（单位见注释）
  const CFG = {
    HOURS_PER_YEAR: HOURS_PER_YEAR,
    DAYS_PER_YEAR: DAYS_PER_YEAR,
    LEVEL_MIN: -30,          // cm，干土下限
    LEVEL_MAX: 90,           // cm，漫水上限
    LEVEL_IDEAL_LOW: 5,      // cm，鸟类浅水区理想下限
    LEVEL_IDEAL_HIGH: 35,    // cm，鸟类浅水区理想上限
    LEVEL_WARN_LOW: 0,       // 低水位预警
    LEVEL_CRIT_LOW: -12,     // 低水位临界（干旱）
    LEVEL_WARN_HIGH: 45,     // 高水位预警
    LEVEL_CRIT_HIGH: 60,     // 高水位临界（淹没）
    POLLUTION_WARN: 40,
    POLLUTION_CRIT: 60,
    BIRDS_WARN: 60,
    BIRDS_CRIT: 40,
    CARBON_WARN: 80,         // t/ha
    CARBON_CRIT: 72,
    TARGET_BIRDS: 80,        // 年末达标：鸟 ≥ 80
    TARGET_SPECIES: 6,       // 物种 ≥ 6
    TARGET_CARBON: 94,       // t/ha
    SITE_COUNT: 6,
  };

  const api = {
    hashSeed: hashSeed,
    makeRng: makeRng,
    subRng: subRng,
    simDate: simDate,
    clamp: clamp,
    lerp: lerp,
    fmt: fmt,
    CFG: CFG,
    MONTH_NAMES: MONTH_NAMES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.WetlandUtil = api;
})(typeof self !== 'undefined' ? self : this);
