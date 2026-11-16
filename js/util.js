/* 通用工具：时间、格式化、哈希、几何、确定性随机数 */
(function (root) {
  'use strict';

  var HOURS = 168; // 7 * 24
  // 数据周固定从该时刻起，保证导出与屏幕的时间口径完全一致
  var BASE_TIME = Date.UTC(2026, 10, 9, 0, 0, 0); // 2026-11-09 00:00 UTC

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function hourToISO(h) {
    var t = new Date(BASE_TIME + h * 3600000);
    return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' +
      pad2(t.getUTCDate()) + ' ' + pad2(t.getUTCHours()) + ':00';
  }

  function hourToShort(h) {
    var t = new Date(BASE_TIME + h * 3600000);
    return (t.getUTCDay() === 1 ? '周一 ' : t.getUTCDay() === 2 ? '周二 ' :
      t.getUTCDay() === 3 ? '周三 ' : t.getUTCDay() === 4 ? '周四 ' :
      t.getUTCDay() === 5 ? '周五 ' : t.getUTCDay() === 6 ? '周六 ' : '周日 ') +
      pad2(t.getUTCHours()) + '时';
  }

  function hourToDayHour(h) {
    return { day: Math.floor(h / 24), hour: h % 24 };
  }

  function fmt(v, digits) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return Number(v).toFixed(digits === undefined ? 1 : digits);
  }

  function pct(v, digits) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return (v * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function rectContains(r, x, y) {
    return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  }

  function pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  // FNV-1a 32 位哈希：为“同一数据版本”生成稳定标识
  function hash32(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // mulberry32 确定性 PRNG，保证三组数据可复现
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rand) {
    var u = 1 - rand(), v = 1 - rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  var RF = root.RF || (root.RF = {});

  // 适配 devicePixelRatio，返回 CSS 像素尺寸的绘图上下文
  function setupCanvas(canvas, cssHeight) {
    var dpr = root.devicePixelRatio || 1;
    var w = canvas.clientWidth || canvas.parentElement.clientWidth;
    var h = cssHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function eventPos(canvas, ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }
  RF.util = {
    HOURS: HOURS,
    BASE_TIME: BASE_TIME,
    pad2: pad2,
    hourToISO: hourToISO,
    hourToShort: hourToShort,
    hourToDayHour: hourToDayHour,
    fmt: fmt,
    pct: pct,
    clamp: clamp,
    rectContains: rectContains,
    pointInRect: pointInRect,
    hash32: hash32,
    rng: rng,
    gaussian: gaussian,
    setupCanvas: setupCanvas,
    eventPos: eventPos
  };
})(typeof window !== 'undefined' ? window : globalThis);
