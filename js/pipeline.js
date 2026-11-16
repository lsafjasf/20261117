/* 数据处理管线：去重 → 校验 → 异常截断 → 补缺 → 筛选聚合 → 热区半径布局。
   纯函数、无 DOM 依赖，浏览器与 Node 共用，便于自动化验证。 */
(function (global) {
  const App = (global.App = global.App || {});
  const { hashString, clamp } = App.util;
  const { STATIONS, LINES, HOURS, STATION_HOUR_CAP, stationById } = App.network;

  const VALID_TYPE = new Set(['entry', 'exit']);
  const VALID_EVENT = new Set(['regular', 'transfer']);

  function dedupeKey(r) {
    return [r.id, r.stationId, r.lineId, r.hour, r.minute, r.type, r.eventType, r.cardId].join('|');
  }

  function dedupeRecords(records) {
    const seen = new Set();
    const kept = [];
    let removed = 0;
    records.forEach((r) => {
      const key = dedupeKey(r);
      if (seen.has(key)) {
        removed++;
        return;
      }
      seen.add(key);
      kept.push(r);
    });
    return { records: kept, removed };
  }

  function validateRecord(r) {
    const station = stationById[r.stationId];
    if (!station) return '未知站点 ' + r.stationId;
    const line = LINES.find((l) => l.id === r.lineId);
    if (!line || !line.stationIds.includes(r.stationId)) return '线路与站点不匹配';
    if (!Number.isInteger(r.hour) || !HOURS.includes(r.hour)) return '小时越界';
    if (!Number.isInteger(r.minute) || r.minute < 0 || r.minute > 59) return '分钟越界';
    if (!VALID_TYPE.has(r.type)) return '进出方向非法';
    if (!VALID_EVENT.has(r.eventType)) return '换乘类型非法';
    return null;
  }

  function validateRecords(records) {
    const valid = [];
    const invalid = [];
    records.forEach((r) => {
      const reason = validateRecord(r);
      if (reason) invalid.push({ record: r, reason });
      else valid.push(r);
    });
    return { valid, invalid };
  }

  // 超上限桶截断：按 id 排序后保留前 CAP 条，保证确定性
  function capOutliers(records) {
    const buckets = new Map();
    records.forEach((r) => {
      const key = r.stationId + '@' + r.hour;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    });
    const kept = [];
    const outlierBuckets = [];
    let truncated = 0;
    buckets.forEach((list, key) => {
      if (list.length <= STATION_HOUR_CAP) {
        kept.push(...list);
        return;
      }
      const sorted = list.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
      kept.push(...sorted.slice(0, STATION_HOUR_CAP));
      truncated += list.length - STATION_HOUR_CAP;
      const [stationId, hourStr] = key.split('@');
      outlierBuckets.push({ stationId, hour: Number(hourStr), observed: list.length, cappedTo: STATION_HOUR_CAP });
    });
    return { records: kept, truncated, outlierBuckets };
  }

  // 补缺：运营网格内无记录的站点-小时桶补 0
  function fillMissing(records) {
    const present = new Set(records.map((r) => r.stationId + '@' + r.hour));
    const filled = [];
    STATIONS.forEach((s) => {
      HOURS.forEach((h) => {
        const key = s.id + '@' + h;
        if (!present.has(key)) filled.push({ stationId: s.id, hour: h });
      });
    });
    return { filledBuckets: filled };
  }

  function cleanDataset(rawRecords) {
    const step1 = dedupeRecords(rawRecords);
    const step2 = validateRecords(step1.records);
    const step3 = capOutliers(step2.valid);
    const step4 = fillMissing(step3.records);
    return {
      cleaned: step3.records,
      report: {
        rawCount: rawRecords.length,
        duplicatesRemoved: step1.removed,
        invalidCount: step2.invalid.length,
        invalid: step2.invalid,
        outlierTruncated: step3.truncated,
        outlierBuckets: step3.outlierBuckets,
        filledBuckets: step4.filledBuckets,
        filledCount: step4.filledBuckets.length,
        cleanCount: step3.records.length,
      },
    };
  }

  function recordMatches(r, filters, window) {
    if (filters.lineId !== 'ALL' && r.lineId !== filters.lineId) return false;
    if (r.hour < window.startHour || r.hour >= window.endHour) return false;
    if (filters.transferType === 'none' && r.eventType !== 'regular') return false;
    if (filters.transferType === 'transfer' && r.eventType !== 'transfer') return false;
    return true;
  }

  function canonicalId(stationId) {
    const s = stationById[stationId];
    return s.aliasOf || s.id;
  }

  function emptyStationMetric() {
    return { entry: 0, exit: 0, regular: 0, transfer: 0, total: 0 };
  }

  function aggregate(cleanedRecords, filters, window) {
    const byStation = new Map();
    const byHour = new Map();
    window.hours.forEach((h) => byHour.set(h, emptyStationMetric()));
    let matched = 0;

    cleanedRecords.forEach((r) => {
      if (!recordMatches(r, filters, window)) return;
      matched++;
      const cid = canonicalId(r.stationId);
      if (!byStation.has(cid)) byStation.set(cid, emptyStationMetric());
      const m = byStation.get(cid);
      m[r.type]++;
      m[r.eventType]++;
      m.total++;
      const hm = byHour.get(r.hour);
      hm[r.type]++;
      hm[r.eventType]++;
      hm.total++;
    });

    const stations = STATIONS.filter((s) => !s.aliasOf).map((s) => {
      const m = byStation.get(s.id) || emptyStationMetric();
      return { stationId: s.id, name: s.name, x: s.x, y: s.y, transfer: !!s.transfer, ...m };
    });
    const hours = window.hours.map((h) => ({ hour: h, ...byHour.get(h) }));
    return { stations, hours, matchedRecords: matched };
  }

  // 站点标签占位框（世界坐标），热区不得覆盖
  function labelRect(station) {
    const width = station.name.length * 13 + 10;
    const height = 18;
    return { x: station.x - width / 2, y: station.y + 10, width, height };
  }

  function distanceToRect(x, y, rect) {
    const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
    const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
    return Math.hypot(dx, dy);
  }

  // 半径随 sqrt(统计值) 缩放，再收缩到不覆盖任何其他站点标签与圆点
  function computeRadii(stationMetrics) {
    const totals = stationMetrics.map((s) => s.total);
    const maxTotal = Math.max(1, ...totals);
    const rMin = 12;
    const rMax = 62;
    const radii = stationMetrics.map((s) =>
      s.total === 0 ? 0 : rMin + (rMax - rMin) * Math.sqrt(s.total / maxTotal)
    );
    stationMetrics.forEach((s, i) => {
      if (radii[i] === 0) return;
      stationMetrics.forEach((other, j) => {
        if (i === j) return;
        const labelLimit = distanceToRect(s.x, s.y, labelRect(other)) - 4;
        const dotLimit = Math.hypot(s.x - other.x, s.y - other.y) - 9;
        radii[i] = clamp(Math.min(radii[i], labelLimit, dotLimit), s.total > 0 ? 8 : 0, rMax);
      });
    });
    return radii;
  }

  function filterSignature(filters, window, datasetId) {
    return hashString([datasetId, filters.lineId, window.id, filters.transferType].join('|'));
  }

  App.pipeline = {
    dedupeRecords,
    validateRecords,
    capOutliers,
    fillMissing,
    cleanDataset,
    aggregate,
    computeRadii,
    labelRect,
    recordMatches,
    canonicalId,
    filterSignature,
  };
})(typeof window !== 'undefined' ? window : globalThis);
