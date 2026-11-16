import { LITHOLOGY } from './constants.js';
import { mean, round } from './util.js';

export const STAT_BASIS = [
  { id: 'grMean', label: 'GR 均值（API）', field: 'gr', agg: 'mean' },
  { id: 'grMax', label: 'GR 最大值（API）', field: 'gr', agg: 'max' },
  { id: 'grMin', label: 'GR 最小值（API）', field: 'gr', agg: 'min' },
  { id: 'sampleCount', label: '采样点数', field: null, agg: 'count' },
  { id: 'thickness', label: '地层累计厚度（m）', field: null, agg: 'thickness' }
];

// 聚合完全基于当前筛选后的样本/层位实时计算，任何视图不得另设口径。
export function computeStats(filtered) {
  const perBorehole = filtered.boreholes.map((b) => {
    const samples = filtered.samples.filter((s) => s.boreholeId === b.id);
    const layers = filtered.layers.filter((l) => l.boreholeId === b.id);
    return {
      boreholeId: b.id,
      name: b.name,
      ...grAgg(samples),
      sampleCount: samples.length,
      thickness: round(layers.reduce((a, l) => a + (l.bottom - l.top), 0)),
      layerCount: layers.length
    };
  });

  const perLitho = [...new Set(filtered.layers.map((l) => l.lithoId))]
    .sort()
    .map((lithoId) => {
      const samples = filtered.samples.filter((s) => s.lithoId === lithoId);
      const layers = filtered.layers.filter((l) => l.lithoId === lithoId);
      return {
        lithoId,
        lithoName: LITHOLOGY[lithoId].name,
        ...grAgg(samples),
        sampleCount: samples.length,
        thickness: round(layers.reduce((a, l) => a + (l.bottom - l.top), 0)),
        layerCount: layers.length
      };
    });

  const total = {
    ...grAgg(filtered.samples),
    sampleCount: filtered.samples.length,
    thickness: round(filtered.layers.reduce((a, l) => a + (l.bottom - l.top), 0)),
    layerCount: filtered.layers.length,
    boreholeCount: filtered.boreholes.length
  };

  return { perBorehole, perLitho, total, empty: filtered.empty };
}

function grAgg(samples) {
  const vals = samples.map((s) => s.gr);
  return {
    grMean: vals.length ? round(mean(vals), 1) : null,
    grMax: vals.length ? round(Math.max(...vals), 1) : null,
    grMin: vals.length ? round(Math.min(...vals), 1) : null
  };
}

export function basisValue(row, basisId) {
  return row[basisId] === undefined ? null : row[basisId];
}
