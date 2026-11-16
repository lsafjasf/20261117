import { round } from './util.js';

// 固定 0.5m 深度网格重采样：同网格内多次测量取均值，无数据网格补 null（补缺）。
// 输出统一网格，曲线/列表/导出共用同一份重采样结果。
export function resampleSamples(samples, boreholes, columns = [], step = 0.5) {
  const result = {};
  for (const b of boreholes) {
    const own = samples.filter((s) => s.boreholeId === b.id);
    const gaps = (columns.find((c) => c.boreholeId === b.id)?.units || [])
      .filter((u) => u.kind === 'gap');
    const maxDepth = own.length ? Math.max(...own.map((s) => s.depth)) : 0;
    const bins = Math.max(1, Math.ceil((maxDepth + step) / step));
    const grid = Array.from({ length: bins }, (_, i) => ({
      depth: round(i * step),
      gr: null,
      count: 0
    }));
    const sums = new Float64Array(bins);
    const counts = new Uint16Array(bins);
    for (const s of own) {
      const idx = Math.floor(s.depth / step);
      if (idx >= bins) continue;
      sums[idx] += s.gr;
      counts[idx] += 1;
    }
    for (let i = 0; i < bins; i++) {
      const binTop = i * step;
      const inGap = gaps.some((g2) => binTop >= g2.top - 1e-9 && binTop < g2.bottom);
      if (inGap) {
        grid[i].gr = null;
        grid[i].count = 0;
        continue;
      }
      if (counts[i] > 0) {
        grid[i].gr = round(sums[i] / counts[i], 1);
        grid[i].count = counts[i];
      }
    }
    result[b.id] = { step, grid, filledBins: countsGtZero(counts), emptyBins: bins - countsGtZero(counts) };
  }
  return result;
}

function countsGtZero(typed) {
  let n = 0;
  for (const v of typed) if (v > 0) n++;
  return n;
}
