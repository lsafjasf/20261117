// 筛选与统计的唯一入口。地图、曲线、列表、图例、导出全部消费本模块输出，
// 保证“同一数据版本”与“导出数值 = 屏幕数值”。

export const TIME_WINDOWS = [
  { id: 'all', label: '全部时间', from: null, to: null },
  { id: 'q1', label: '2024 Q1（1–3 月）', from: '2024-01-01T00:00:00Z', to: '2024-03-31T23:59:59Z' },
  { id: 'q2', label: '2024 Q2（4–6 月）', from: '2024-04-01T00:00:00Z', to: '2024-06-30T23:59:59Z' },
  { id: 'q3', label: '2024 Q3（7–9 月）', from: '2024-07-01T00:00:00Z', to: '2024-09-30T23:59:59Z' },
  { id: 'q4', label: '2024 Q4（10–12 月，空窗口）', from: '2024-10-01T00:00:00Z', to: '2024-12-31T23:59:59Z' }
];

export function getWindow(id) {
  return TIME_WINDOWS.find((w) => w.id === id) || TIME_WINDOWS[0];
}

function inWindow(ts, win) {
  if (!win.from) return true;
  const t = Date.parse(ts);
  return t >= Date.parse(win.from) && t <= Date.parse(win.to);
}

// 在“已去重/已校验”的数据集上应用筛选
export function applyFilters(clean, opts) {
  const win = getWindow(opts.windowId);
  const selectedHoles = new Set(opts.boreholeIds);
  const selectedLithos = new Set(opts.lithoIds);

  const boreholes = clean.boreholes.filter((b) => selectedHoles.has(b.id));
  const layers = clean.layers.filter(
    (l) => selectedHoles.has(l.boreholeId) && selectedLithos.has(l.lithoId)
  );
  const samples = clean.samples.filter(
    (s) => selectedHoles.has(s.boreholeId)
      && selectedLithos.has(s.lithoId)
      && inWindow(s.measuredAt, win)
  );

  const empty = samples.length === 0;
  return {
    datasetId: clean.datasetId,
    window: win,
    boreholeIds: [...selectedHoles],
    lithoIds: [...selectedLithos],
    boreholes,
    layers,
    samples,
    empty,
    sourceCounts: {
      samplesIn: clean.samples.length,
      samplesOut: samples.length,
      layersIn: clean.layers.length,
      layersOut: layers.length
    }
  };
}
