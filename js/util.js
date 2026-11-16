/* 通用时间工具：全工程时间单位均为秒，浮点比较使用 EPS 容差。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.TC = root.TC || {};
  root.TC.util = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EPS = 1e-6;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function nearlyEqual(a, b, eps) {
    return Math.abs(a - b) <= (eps || EPS);
  }

  /* 区间相交（带容差），端点相接不算重叠。 */
  function overlaps(startA, endA, startB, endB, eps) {
    var e = eps || EPS;
    return startA < endB - e && startB < endA - e;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds)) return "--:--";
    var sign = seconds < 0 ? "-" : "";
    seconds = Math.abs(seconds);
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    var ms = Math.round((seconds - Math.floor(seconds)) * 1000);
    if (ms === 1000) { ms = 0; s += 1; }
    function pad2(n) { return n < 10 ? "0" + n : "" + n; }
    function pad3(n) { return n < 10 ? "00" + n : n < 100 ? "0" + n : "" + n; }
    return sign + (h > 0 ? pad2(h) + ":" : "") + pad2(m) + ":" + pad2(s) + "." + pad3(ms);
  }

  function shortTime(seconds) {
    return (seconds < 0 ? "-" : "") + Math.abs(seconds).toFixed(3);
  }

  /* 简单稳定 id 生成器，可注入计数器（测试可复现）。 */
  function makeIdFactory(prefix) {
    var counter = 0;
    return function next() {
      counter += 1;
      return prefix + "_" + counter.toString(36);
    };
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  return {
    EPS: EPS,
    clamp: clamp,
    nearlyEqual: nearlyEqual,
    overlaps: overlaps,
    formatTime: formatTime,
    shortTime: shortTime,
    makeIdFactory: makeIdFactory,
    deepClone: deepClone
  };
});
