/* 自检：在浏览器与 Node 均可运行的断言场景，覆盖去重、补缺、异常截断、聚合、空结果。 */
(function (global) {
  const App = (global.App = global.App || {});

  function run() {
    const { cleanDataset, aggregate, computeRadii } = App.pipeline;
    const { WINDOWS, hoursOfWindow, STATION_HOUR_CAP } = App.network;
    const reports = [];
    const check = (name, cond, detail) => reports.push({ name, pass: !!cond, detail: detail || '' });

    const normal = App.generate.buildNormalRecords(20261117);
    const missing = App.generate.buildMissingRecords(20261117);
    const anomaly = App.generate.buildAnomalyRecords(20261117);

    const normalClean = cleanDataset(normal);
    check('正常数据：无重复无非法', normalClean.report.duplicatesRemoved === 0 && normalClean.report.invalidCount === 0);
    check('正常数据：无异常截断', normalClean.report.outlierTruncated === 0);

    const missClean = cleanDataset(missing);
    check(
      '缺失数据：恰好补回 ' + App.generate.MISSING_BUCKETS.length + ' 个桶',
      missClean.report.filledCount === App.generate.MISSING_BUCKETS.length
    );

    const anomClean = cleanDataset(anomaly);
    check('异常数据：删除 8 条重复', anomClean.report.duplicatesRemoved === 8,
      '实际 ' + anomClean.report.duplicatesRemoved);
    check('异常数据：剔除 5 条非法', anomClean.report.invalidCount === 5,
      '实际 ' + anomClean.report.invalidCount);
    // 注入桶观测值应为「正常基线桶 + (CAP+45)」，再统一截断到 CAP
    const baseBucket = (records, stationId, hour) =>
      records.filter((r) => r.stationId === stationId && r.hour === hour).length;
    const injected = [['L1S5', 8], ['L2S4', 18]];
    const observedOk = injected.every(([stationId, hour]) => {
      const b = anomClean.report.outlierBuckets.find((x) => x.stationId === stationId && x.hour === hour);
      return b && b.observed === baseBucket(normal, stationId, hour) + STATION_HOUR_CAP + 45 &&
        b.cappedTo === STATION_HOUR_CAP;
    });
    check('异常数据：两个注入桶观测值=基线+注入量并截断到上限', observedOk);
    check('异常数据：报告中含两个异常桶',
      anomClean.report.outlierBuckets.length >= 2 &&
      anomClean.report.outlierBuckets.every((b) => b.cappedTo === STATION_HOUR_CAP));

    // 截断后任何站点-小时桶都不超过上限
    const bucketSizes = new Map();
    anomClean.cleaned.forEach((r) => {
      const k = r.stationId + '@' + r.hour;
      bucketSizes.set(k, (bucketSizes.get(k) || 0) + 1);
    });
    check('截断后无桶超过上限 ' + STATION_HOUR_CAP, Math.max(...bucketSizes.values()) <= STATION_HOUR_CAP);

    const allDay = { ...WINDOWS.find((w) => w.id === 'w_all'), hours: hoursOfWindow(WINDOWS.find((w) => w.id === 'w_all')) };
    const aggAll = aggregate(anomClean.cleaned, { lineId: 'ALL', transferType: 'all' }, allDay);
    check('聚合：站点总量之和等于命中记录数',
      aggAll.stations.reduce((a, s) => a + s.total, 0) === aggAll.matchedRecords);
    check('聚合：每站进站+出站之和等于总量',
      aggAll.stations.every((s) => s.entry + s.exit === s.total));

    // 线路筛选：所有命中记录必须属于该线路
    const aggL1 = aggregate(anomClean.cleaned, { lineId: 'L1', transferType: 'all' }, allDay);
    check('线路筛选：L1 命中量与全量不同', aggL1.matchedRecords < aggAll.matchedRecords && aggL1.matchedRecords > 0);

    // 防遮挡：任意热区半径不进入其他站点标签矩形
    const radii = computeRadii(aggAll.stations);
    let overlap = false;
    aggAll.stations.forEach((s, i) => {
      aggAll.stations.forEach((o, j) => {
        if (i === j || radii[i] === 0) return;
        const rect = App.pipeline.labelRect(o);
        const dx = Math.max(rect.x - s.x, 0, s.x - (rect.x + rect.width));
        const dy = Math.max(rect.y - s.y, 0, s.y - (rect.y + rect.height));
        if (Math.hypot(dx, dy) < radii[i] - 0.5) overlap = true;
      });
    });
    check('热区半径不覆盖其他站点标签', !overlap);

    // 空结果：缺失桶所在站点 + 缺失小时 + 非换乘（缺失桶本就无记录）
    const b = App.generate.MISSING_BUCKETS[0];
    const emptyWin = { id: 'single', name: '单小时', startHour: b.hour, endHour: b.hour + 1, hours: [b.hour] };
    const emptyAgg = aggregate(missClean.cleaned, { lineId: 'ALL', transferType: 'all' }, emptyWin);
    const stationRow = emptyAgg.stations.find((s) => s.stationId === App.pipeline.canonicalId(b.stationId));
    check('空结果：缺失桶站点该小时为 0', stationRow.total === 0);

    // 另一组必然空结果：全部数据只在 6–21 点，22 点窗口无记录
    const nightWin = { id: 'night', name: '夜间', startHour: 22, endHour: 23, hours: [22] };
    const nightAgg = aggregate(normalClean.cleaned, { lineId: 'ALL', transferType: 'all' }, nightWin);
    check('空结果：22 点窗口命中 0 条', nightAgg.matchedRecords === 0 && nightAgg.stations.every((s) => s.total === 0));

    // 筛选可复现：相同输入两次聚合结果一致
    const again = aggregate(anomClean.cleaned, { lineId: 'L1', transferType: 'transfer' }, allDay);
    const again2 = aggregate(anomClean.cleaned, { lineId: 'L1', transferType: 'transfer' }, allDay);
    check('聚合确定性：重复执行结果一致', JSON.stringify(again) === JSON.stringify(again2));

    return reports;
  }

  App.selftest = { run };
})(typeof window !== 'undefined' ? window : globalThis);
