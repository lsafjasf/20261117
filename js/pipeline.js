// 纯数据管道：去重 -> 异常清洗 -> 补缺 -> 归一化 -> 因子评分 -> 加权 -> 过滤 -> 统计/聚合。
// 不接触 DOM / Canvas，可直接在 Node 中测试。

import { CELL_COUNT, GRID_COLS, GRID_ROWS, RAW_RANGE } from './data.js';

const METRICS = ['elevation', 'ndvi', 'waterDist'];

function isMissing(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

function isUsableNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function inRawRange(metric, v) {
  const r = RAW_RANGE[metric];
  return isUsableNumber(v) && v >= r.min && v <= r.max;
}

// 1) 去重：同一 cellId + timestamp + 三因子取值完全一致视为重复，保留首条。
export function dedupe(records) {
  const seen = new Set();
  const out = [];
  let removed = 0;
  for (const rec of records) {
    const key = [
      rec.cellId, rec.timestamp, rec.elevation, rec.ndvi, rec.waterDist,
    ].join('|');
    if (seen.has(key)) {
      removed += 1;
      continue;
    }
    seen.add(key);
    out.push(rec);
  }
  return { records: out, removed };
}

function neighborIds(cellId) {
  const row = Math.floor(cellId / GRID_COLS);
  const col = cellId % GRID_COLS;
  const ids = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) ids.push(r * GRID_COLS + c);
    }
  }
  return ids;
}

// 2)+3) 异常置空后，用 8 邻域均值补缺；邻域仍缺则用全局均值兜底。
export function cleanAndFill(records) {
  const byId = new Map(records.map((r) => [r.cellId, { ...r, issues: [] }]));
  let anomalyCount = 0;
  let filledCount = 0;

  for (const rec of byId.values()) {
    for (const m of METRICS) {
      if (isMissing(rec[m])) {
        rec.issues.push(`${m}:缺失`);
      } else if (!inRawRange(m, rec[m])) {
        rec.issues.push(`${m}:异常(${rec[m]})`);
        rec[m] = null;
        anomalyCount += 1;
      }
    }
  }

  const globalMean = {};
  for (const m of METRICS) {
    const vals = [...byId.values()].map((r) => r[m]).filter(isUsableNumber);
    globalMean[m] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  for (const rec of byId.values()) {
    for (const m of METRICS) {
      if (isMissing(rec[m])) {
        const nbrVals = neighborIds(rec.cellId)
          .map((id) => byId.get(id)?.[m])
          .filter(isUsableNumber);
        if (nbrVals.length > 0) {
          rec[m] = nbrVals.reduce((a, b) => a + b, 0) / nbrVals.length;
          rec.issues.push(`${m}:邻域补缺`);
        } else {
          rec[m] = globalMean[m];
          rec.issues.push(`${m}:全局补缺`);
        }
        filledCount += 1;
      }
    }
  }

  const cells = [...byId.values()].sort((a, b) => a.cellId - b.cellId);
  return { cells, anomalyCount, filledCount, globalMean };
}

// 4) 归一化到 0..1（同时保存原始量纲值用于展示）。
export function normalize(cells) {
  const ranges = {};
  for (const m of METRICS) {
    const vals = cells.map((c) => c[m]);
    ranges[m] = { min: Math.min(...vals), max: Math.max(...vals) };
  }
  return cells.map((c) => {
    const norm = {};
    for (const m of METRICS) {
      const { min, max } = ranges[m];
      norm[m] = max === min ? 0.5 : (c[m] - min) / (max - min);
    }
    return { ...c, norm, ranges };
  });
}

// 5) 单因子适宜度：高程适中最佳、NDVI 越高越好、距水越近越好。
export function factorScores(cell) {
  const elevation = 1 - Math.abs(cell.norm.elevation - 0.42) / 0.58;
  return {
    elevation: Math.max(0, Math.min(1, elevation)),
    ndvi: cell.norm.ndvi,
    water: 1 - cell.norm.waterDist,
  };
}

export function levelOf(score) {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  if (score >= 0.25) return 'low';
  return 'poor';
}

export const LEVELS = [
  { id: 'high', label: '高适宜', color: '#1a7d3c' },
  { id: 'medium', label: '中适宜', color: '#7fc24b' },
  { id: 'low', label: '低适宜', color: '#f0c93d' },
  { id: 'poor', label: '不适宜', color: '#d9534f' },
];

// 6) 加权综合评分（权重自动归一化，允许滑块组合为任意非负值）。
export function scoreCells(cells, weights) {
  const sum = weights.elevation + weights.ndvi + weights.water;
  const w = {
    elevation: weights.elevation / sum,
    ndvi: weights.ndvi / sum,
    water: weights.water / sum,
  };
  return cells.map((cell) => {
    const factors = factorScores(cell);
    const contributions = {
      elevation: factors.elevation * w.elevation,
      ndvi: factors.ndvi * w.ndvi,
      water: factors.water * w.water,
    };
    const score = contributions.elevation + contributions.ndvi + contributions.water;
    return { ...cell, factors, contributions, score, level: levelOf(score), weights: w };
  });
}

// 7) 过滤：适宜度区间、高程区间、等级勾选。
export function applyFilters(cells, filter) {
  return cells.filter((c) => (
    c.score >= filter.scoreMin &&
    c.score <= filter.scoreMax &&
    c.elevation >= filter.elevMin &&
    c.elevation <= filter.elevMax &&
    filter.levels.includes(c.level)
  ));
}

// 8) 统计（统计口径：all=全部网格，filtered=筛选后）。
export function computeStats(cells, mode = 'filtered') {
  const n = cells.length;
  if (n === 0) {
    return { count: 0, mean: null, median: null, min: null, max: null, std: null, byLevel: {} };
  }
  const scores = cells.map((c) => c.score).sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? scores[(n - 1) / 2] : (scores[n / 2 - 1] + scores[n / 2]) / 2;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const byLevel = {};
  for (const c of cells) byLevel[c.level] = (byLevel[c.level] || 0) + 1;
  return {
    count: n,
    mean,
    median,
    min: scores[0],
    max: scores[n - 1],
    std: Math.sqrt(variance),
    byLevel,
    mode,
  };
}

// 聚合：按等级或按行（南北带）汇总平均适宜度。
export function aggregate(cells, dimension) {
  if (dimension === 'level') {
    const groups = new Map();
    for (const c of cells) {
      const g = groups.get(c.level) || { key: c.level, values: [] };
      g.values.push(c.score);
      groups.set(c.level, g);
    }
    return [...groups.values()].map((g) => ({
      key: g.key,
      count: g.values.length,
      mean: g.values.reduce((a, b) => a + b, 0) / g.values.length,
    }));
  }
  const groups = new Map();
  for (const c of cells) {
    const key = `R${c.row}`;
    const g = groups.get(key) || { key, values: [] };
    g.values.push(c.score);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    key: g.key,
    count: g.values.length,
    mean: g.values.reduce((a, b) => a + b, 0) / g.values.length,
  }));
}

// 数据版本：对“输入数据指纹 + 权重 + 过滤条件”做哈希，保证地图/曲线/列表/导出同源。
export function dataVersion({ windowId, pipelineInfo, weights, filter, statsMode, agg }) {
  const payload = JSON.stringify({ windowId, pipelineInfo, weights, filter, statsMode, agg });
  let h = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `v-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export function processWindow(records, weights, filter) {
  const deduped = dedupe(records);
  const cleaned = cleanAndFill(deduped.records);
  const normalized = normalize(cleaned.cells);
  const scored = scoreCells(normalized, weights);
  const filtered = applyFilters(scored, filter);
  const pipelineInfo = {
    inputCount: records.length,
    dedupedRemoved: deduped.removed,
    anomalyCount: cleaned.anomalyCount,
    filledCount: cleaned.filledCount,
    cellCount: CELL_COUNT,
  };
  return { allCells: scored, filteredCells: filtered, pipelineInfo };
}
