/* 数据处理管线：去重 → 校验 → 网格化 → 线性补缺 → 累计 → 聚合 → 版本哈希 */
(function (root) {
  'use strict';
  var RF = root.RF;
  var H = RF.util.HOURS;

  var PIPELINE_VERSION = 'pipe-v1.3';
  var ST = { VALID: 0, MISSING: 1, ANOMALOUS: 2, FILLED: 3 };

  function isValidRain(v, maxValid) {
    return typeof v === 'number' && isFinite(v) && v >= 0 && v <= maxValid;
  }

  // 去重：同站点同小时保留最后一条；返回映射与被移除条数
  function dedupe(records) {
    var map = {};
    var dupRemoved = 0;
    records.forEach(function (r) {
      var key = r.stationId + '#' + r.hour;
      if (map[key]) dupRemoved++;
      map[key] = r;
    });
    return { map: map, dupRemoved: dupRemoved };
  }

  // 线性插值补缺；首尾缺口用最近有效值，全缺列保持缺失
  function fillGaps(values, status) {
    var n = values.length;
    var filled = 0;
    var h = 0;
    while (h < n) {
      if (status[h] !== ST.VALID) { h++; continue; }
      var end = h;
      while (end < n && status[end] === ST.VALID) end++;
      if (end > 0 && end < n) {
        var next = end;
        while (next < n && status[next] !== ST.VALID) next++;
        if (next < n) {
          for (var j = end; j < next; j++) {
            var ratio = (j - end + 1) / (next - end + 1);
            values[j] = values[end - 1] + (values[next] - values[end - 1]) * ratio;
            status[j] = ST.FILLED;
            filled++;
          }
          h = next;
          continue;
        }
      }
      h = end;
    }
    // 首尾边界缺口：最近邻填补
    var first = status.indexOf(ST.VALID);
    var lastValid = -1;
    for (var i = n - 1; i >= 0; i--) if (status[i] === ST.VALID) { lastValid = i; break; }
    if (first === -1) return 0; // 全缺列：保持缺失，不做臆造
    if (first > 0) {
      for (var a = 0; a < first; a++) {
        values[a] = values[first]; status[a] = ST.FILLED; filled++;
      }
    }
    if (lastValid >= 0) {
      for (var b = lastValid + 1; b < n; b++) {
        values[b] = values[lastValid]; status[b] = ST.FILLED; filled++;
      }
    }
    return filled;
  }

  function process(dataset) {
    var dd = dedupe(dataset.records);
    var grid = {};
    var totals = {
      rawCount: dataset.records.length,
      uniqueCount: Object.keys(dd.map).length,
      dupRemoved: dd.dupRemoved,
      anomalyCells: 0,
      missingCells: 0,
      filledCells: 0,
      validCells: 0
    };
    var hashParts = [PIPELINE_VERSION, dataset.id];

    RF.stations.STATIONS.forEach(function (st) {
      var values = new Array(H).fill(null);
      var raw = new Array(H).fill(null);
      var status = new Array(H).fill(ST.MISSING);
      var origin = new Array(H).fill(ST.MISSING);
      for (var h = 0; h < H; h++) {
        var rec = dd.map[st.id + '#' + h];
        if (!rec) continue;
        raw[h] = rec.rain;
        if (isValidRain(rec.rain, dataset.maxValid)) {
          values[h] = rec.rain;
          status[h] = ST.VALID;
          origin[h] = ST.VALID;
        } else {
          status[h] = ST.ANOMALOUS;
          origin[h] = ST.ANOMALOUS;
          totals.anomalyCells++;
        }
      }
      var hadValid = false;
      for (var hv = 0; hv < H; hv++) if (status[hv] === ST.VALID) { hadValid = true; break; }
      var filled = hadValid ? fillGaps(values, status) : 0;
      var cum = new Array(H).fill(null);
      var run = 0;
      for (var k = 0; k < H; k++) {
        if (values[k] !== null) { run += values[k]; cum[k] = run; }
      }
      grid[st.id] = {
        values: values, raw: raw, status: status, origin: origin,
        cum: cum, filledCount: filled
      };
      for (var c = 0; c < H; c++) {
        if (status[c] === ST.MISSING) totals.missingCells++;
        else if (status[c] === ST.VALID) totals.validCells++;
      }
      totals.filledCells += filled;
      hashParts.push(st.id, status.join(''), values.map(function (v) {
        return v === null ? 'x' : v.toFixed(3);
      }).join(','));
    });

    var stationStats = {};
    RF.stations.STATIONS.forEach(function (st) {
      stationStats[st.id] = aggregate(grid[st.id], 0, H - 1);
    });

    return {
      datasetId: dataset.id,
      datasetName: dataset.name,
      grid: grid,
      totals: totals,
      stationStats: stationStats,
      version: RF.util.hash32(hashParts.join('|')),
      pipelineVersion: PIPELINE_VERSION
    };
  }

  // 窗口聚合：所有视图、列表、导出共用同一口径
  function aggregate(cell, w0, w1) {
    var valid = 0, missing = 0, anomalous = 0, filled = 0;
    var total = 0, maxV = -Infinity, observed = 0;
    for (var h = w0; h <= w1; h++) {
      var s = cell.status[h];
      if (s === ST.VALID) { valid++; observed++; total += cell.values[h]; maxV = Math.max(maxV, cell.values[h]); }
      else if (s === ST.FILLED) { filled++; observed++; total += cell.values[h]; maxV = Math.max(maxV, cell.values[h]); }
      else if (s === ST.MISSING) { missing++; }
      if (cell.origin && cell.origin[h] === ST.ANOMALOUS) anomalous++;
    }
    var len = w1 - w0 + 1;
    var stillMissing = 0;
    for (var m = w0; m <= w1; m++) {
      if (cell.status[m] === ST.MISSING) stillMissing++;
    }
    return {
      windowLength: len,
      valid: valid,
      missing: missing,
      anomalous: anomalous,
      filled: filled,
      total: observed ? total : null,
      maxInstant: maxV === -Infinity ? null : maxV,
      mean: observed ? total / observed : null,
      missingRate: stillMissing / len
    };
  }

  RF.pipeline = {
    ST: ST,
    PIPELINE_VERSION: PIPELINE_VERSION,
    isValidRain: isValidRain,
    dedupe: dedupe,
    fillGaps: fillGaps,
    process: process,
    aggregate: aggregate
  };
})(typeof window !== 'undefined' ? window : globalThis);
