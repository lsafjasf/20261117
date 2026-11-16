/* 合成数据生成器：正常 / 缺失 / 异常三组，全部确定性可复现。浏览器与 Node 共用。 */
(function (global) {
  const App = (global.App = global.App || {});
  const { mulberry32 } = App.util;
  const { STATIONS, LINES, HOURS, STATION_HOUR_CAP } = App.network;

  // 缺失数据：这些「站点-小时」桶整体缺失，需要补缺
  const MISSING_BUCKETS = [
    { stationId: 'L1S4', hour: 8 },
    { stationId: 'L1S4', hour: 9 },
    { stationId: 'L2S5', hour: 12 },
    { stationId: 'L2S5', hour: 13 },
    { stationId: 'L1S9', hour: 18 },
  ];

  const STATION_WEIGHT = {
    L1S1: 0.7, L1S2: 0.9, L1S3: 1.6, L1S4: 1.1, L1S5: 1.2,
    L1S6: 0.8, L1S7: 1.3, L1S8: 1.7, L1S9: 0.9, L1S10: 0.6,
    L2S1: 1.0, L2S2: 0.8, L2S3: 1.6, L2S4: 1.2, L2S5: 0.9,
    L2S6: 1.1, L2S7: 1.7, L2S8: 1.0,
  };

  function peakFactor(hour) {
    if (hour === 8 || hour === 18) return 2.4;
    if (hour === 7 || hour === 9 || hour === 17 || hour === 19) return 1.7;
    if (hour >= 11 && hour <= 13) return 1.2;
    return 0.8;
  }

  function lineOf(stationId) {
    return LINES.find((l) => l.stationIds.includes(stationId)).id;
  }

  function bucketExpected(stationId, hour, rng) {
    const base = 14 * STATION_WEIGHT[stationId] * peakFactor(hour);
    return Math.max(1, Math.round(base + rng() * 6));
  }

  function buildNormalRecords(seed) {
    const rng = mulberry32(seed);
    const records = [];
    let seq = 0;
    STATIONS.forEach((station) => {
      HOURS.forEach((hour) => {
        const count = bucketExpected(station.id, hour, rng);
        for (let k = 0; k < count; k++) {
          const isTransfer = !!station.transfer && rng() < 0.28;
          records.push({
            id: 'evt-' + (++seq).toString(36),
            stationId: station.id,
            lineId: lineOf(station.id),
            hour,
            minute: Math.floor(rng() * 60),
            type: rng() < 0.5 ? 'entry' : 'exit',
            eventType: isTransfer ? 'transfer' : 'regular',
            cardId: 'C' + (1000 + Math.floor(rng() * 9000)),
          });
        }
      });
    });
    return records;
  }

  // 与正常数据同种子、同分布，仅跳过缺失桶
  function buildMissingRecords(seed) {
    const rng = mulberry32(seed);
    const records = [];
    let seq = 0;
    const isMissing = (stationId, hour) =>
      MISSING_BUCKETS.some((b) => b.stationId === stationId && b.hour === hour);
    STATIONS.forEach((station) => {
      HOURS.forEach((hour) => {
        const count = bucketExpected(station.id, hour, rng);
        if (isMissing(station.id, hour)) return;
        for (let k = 0; k < count; k++) {
          const isTransfer = !!station.transfer && rng() < 0.28;
          records.push({
            id: 'evt-m' + (++seq).toString(36),
            stationId: station.id,
            lineId: lineOf(station.id),
            hour,
            minute: Math.floor(rng() * 60),
            type: rng() < 0.5 ? 'entry' : 'exit',
            eventType: isTransfer ? 'transfer' : 'regular',
            cardId: 'C' + (1000 + Math.floor(rng() * 9000)),
          });
        }
      });
    });
    return records;
  }

  function buildAnomalyRecords(seed) {
    const records = buildNormalRecords(seed).map((r) => ({ ...r, id: r.id.replace('evt-', 'evt-a-') }));
    const rng = mulberry32(seed + 777);

    // 1) 完全重复记录（同 id 同行内容），共 8 条
    const duplicates = [];
    for (let i = 0; i < 8; i++) {
      const src = records[Math.floor(rng() * records.length)];
      duplicates.push({ ...src });
    }

    // 2) 非法记录
    const invalid = [
      { id: 'bad-1', stationId: 'GHOST', lineId: 'L1', hour: 8, minute: 0, type: 'entry', eventType: 'regular', cardId: 'C9999' },
      { id: 'bad-2', stationId: 'L1S1', lineId: 'L1', hour: 25, minute: 0, type: 'entry', eventType: 'regular', cardId: 'C9999' },
      { id: 'bad-3', stationId: 'L1S1', lineId: 'L1', hour: 8, minute: 0, type: null, eventType: 'regular', cardId: 'C9999' },
      { id: 'bad-4', stationId: 'L1S1', lineId: 'L9', hour: 8, minute: 0, type: 'exit', eventType: 'regular', cardId: 'C9999' },
      { id: 'bad-5', stationId: 'L1S1', lineId: 'L1', hour: 8, minute: 99, type: 'exit', eventType: 'weird', cardId: 'C9999' },
    ];

    // 3) 异常高值：向两个站点小时桶注入大量刷卡，超过上限
    const outliers = [];
    let oseq = 0;
    [['L1S5', 8], ['L2S4', 18]].forEach(([stationId, hour]) => {
      for (let k = 0; k < STATION_HOUR_CAP + 45; k++) {
        outliers.push({
          id: 'evt-out-' + (++oseq),
          stationId,
          lineId: lineOf(stationId),
          hour,
          minute: Math.floor(rng() * 60),
          type: rng() < 0.5 ? 'entry' : 'exit',
          eventType: 'regular',
          cardId: 'C8888',
        });
      }
    });

    return records.concat(duplicates, invalid, outliers);
  }

  const DATASETS = [
    { id: 'normal', name: '正常数据', description: '16 站 × 16 小时，无重复无非法', build: () => buildNormalRecords(20261117) },
    { id: 'missing', name: '缺失数据', description: '5 个站点-小时桶整体缺失，验证补缺', build: () => buildMissingRecords(20261117), missingBuckets: MISSING_BUCKETS },
    { id: 'anomaly', name: '异常数据', description: '含重复、非法记录与超上限异常桶', build: () => buildAnomalyRecords(20261117) },
  ];

  App.generate = { DATASETS, MISSING_BUCKETS, buildNormalRecords, buildMissingRecords, buildAnomalyRecords };
})(typeof window !== 'undefined' ? window : globalThis);
