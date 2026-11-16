// 数据处理管线：去重 → 补缺 → 时间窗口 → 聚合 → 异常判定 → 统一快照
// 纯函数、无 DOM 依赖，地图/曲线/列表/导出共用同一快照，杜绝“写死结果”。

import {
  NODES, METRICS, STEP_MS, BASE_TIME, SLOT_COUNT, THRESHOLDS
} from './data.js';

const keyOf = (r) => `${r.nodeId}|${r.metric}|${r.ts}`;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

// 1) 去重：同一 node/metric/ts 只保留最后一条（模拟上报覆盖）
export function dedupe(records) {
  const map = new Map();
  let removed = 0;
  for (const r of records) {
    const key = keyOf(r);
    if (map.has(key)) removed += 1;
    map.set(key, { ...r });
  }
  return { records: [...map.values()], removed };
}

function seriesIndex(records) {
  const idx = new Map();
  for (const r of records) idx.set(keyOf(r), r);
  return idx;
}

// 2) 补缺：在完整 24h 网格上对齐，缺口线性插值，首尾缺口用最近值；统计填充数
export function fillGaps(records) {
  const idx = seriesIndex(records);
  const out = [];
  let filled = 0;
  for (const node of NODES) {
    for (const metric of METRICS) {
      const bySlot = [];
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        bySlot.push(idx.get(`${node.id}|${metric}|${BASE_TIME + slot * STEP_MS}`) || null);
      }
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        if (bySlot[slot]) { out.push(bySlot[slot]); continue; }
        let left = slot - 1;
        while (left >= 0 && !bySlot[left]) left -= 1;
        let right = slot + 1;
        while (right < SLOT_COUNT && !bySlot[right]) right += 1;
        let value;
        if (left >= 0 && right < SLOT_COUNT) {
          const span = right - left;
          value = bySlot[left].value + (bySlot[right].value - bySlot[left].value) * ((slot - left) / span);
        } else if (left >= 0) {
          value = bySlot[left].value;
        } else if (right < SLOT_COUNT) {
          value = bySlot[right].value;
        } else {
          value = 0;
        }
        out.push({ nodeId: node.id, metric, ts: BASE_TIME + slot * STEP_MS, value: r3(value), quality: 'filled' });
        filled += 1;
      }
    }
  }
  return { records: out, filled };
}

// 3) 时间窗口截取（窗口右端可在时间轴上平移）
export function selectWindow(records, windowEnd, windowMs) {
  const start = windowEnd - windowMs;
  return records.filter((r) => r.ts > start && r.ts <= windowEnd);
}

const AGG_FNS = {
  avg: (vals) => vals.reduce((s, v) => s + v, 0) / vals.length,
  max: (vals) => Math.max(...vals),
  min: (vals) => Math.min(...vals),
  p95: (vals) => {
    const sorted = [...vals].sort((a, b) => a - b);
    const pos = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    return sorted[pos];
  }
};

// 4) 桶聚合：按 intervalMs 对齐到整桶，对桶内原始 5 分钟值应用统计口径
// 窗口边界处的首桶只包含窗口内样本，并把桶时间戳截断到窗口右端
export function aggregate(records, intervalMs, basis, windowEnd = Infinity) {
  const buckets = new Map();
  for (const r of records) {
    // 桶右端时间戳；窗口最前端的不完整桶不越过窗口起点
    const bucketTs = Math.floor(r.ts / intervalMs) * intervalMs + intervalMs;
    const key = `${r.nodeId}|${r.metric}|${bucketTs}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const fn = AGG_FNS[basis] || AGG_FNS.avg;
  const out = [];
  for (const [key, items] of buckets) {
    const sample = items[0];
    let ts = Number(key.split('|')[2]);
    const inWindow = items.filter((i) => i.ts <= windowEnd);
    if (!inWindow.length) continue;
    if (ts > windowEnd) ts = windowEnd;
    const values = inWindow.map((i) => i.value);
    out.push({
      nodeId: sample.nodeId,
      metric: sample.metric,
      ts,
      value: r3(fn(values)),
      sampleCount: inWindow.length,
      containsFilled: inWindow.some((i) => i.quality === 'filled')
    });
  }
  out.sort((a, b) => a.ts - b.ts || a.nodeId.localeCompare(b.nodeId));
  return out;
}

// 5) 异常判定（基于阈值，不预设固定节点/时间）
export function detectAnomalies(records) {
  const anomalies = [];
  for (const r of records) {
    let type = null;
    if (r.metric === 'pressure' && r.value < THRESHOLDS.pressureMin) type = '低压';
    if (r.metric === 'pressure' && r.value > THRESHOLDS.pressureMax) type = '超压';
    if (r.metric === 'leakage' && r.value > THRESHOLDS.leakageMax) type = '漏损超标';
    if (type) anomalies.push({ ...r, anomalyType: type });
  }
  return anomalies;
}

// 节点级过滤（作用于地图与列表）
export function filterNodes(nodeIds, filters) {
  return nodeIds.filter((id) => {
    const node = NODES.find((n) => n.id === id);
    if (filters.zone && node.zone !== filters.zone) return false;
    if (filters.nodeId && id !== filters.nodeId) return false;
    return true;
  });
}

// 记录级过滤（作用于曲线与导出数据）
export function filterRecords(records, filters) {
  return records.filter((r) => {
    const node = NODES.find((n) => n.id === r.nodeId);
    if (filters.zone && node.zone !== filters.zone) return false;
    if (filters.nodeId && r.nodeId !== filters.nodeId) return false;
    if (filters.metric && r.metric !== filters.metric) return false;
    if (filters.min !== null && filters.min !== '' && r.value < Number(filters.min)) return false;
    if (filters.max !== null && filters.max !== '' && r.value > Number(filters.max)) return false;
    return true;
  });
}

function hashContent(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// 构建统一快照：所有视图与导出只能读取该对象
export function buildSnapshot(rawRecords, opts) {
  const { windowEnd, windowMs, intervalMs, basis, filters } = opts;
  const deduped = dedupe(rawRecords);
  const filled = fillGaps(deduped.records);
  const windowed = selectWindow(filled.records, windowEnd, windowMs);
  const aggregated = aggregate(windowed, intervalMs, basis, windowEnd);
  const filtered = filterRecords(aggregated, filters);
  const anomalies = detectAnomalies(filtered);
  const nodeIds = filterNodes(NODES.map((n) => n.id), filters)
    .filter((id) => filtered.some((r) => r.nodeId === id));
  const stats = computeStats(filtered, anomalies);
  const version = hashContent(
    JSON.stringify({ windowEnd, windowMs, intervalMs, basis, filters, n: filtered.length, sum: r2(stats.valueSum) })
  );
  return {
    version,
    generatedAt: new Date().toISOString(),
    params: { windowEnd, windowMs, intervalMs, basis, filters: { ...filters } },
    quality: {
      rawCount: rawRecords.length,
      duplicatesRemoved: deduped.removed,
      gapsFilled: filled.filled,
      windowCount: windowed.length,
      aggregatedCount: aggregated.length,
      filteredCount: filtered.length
    },
    records: filtered,
    nodeIds,
    anomalies,
    stats
  };
}

export function computeStats(records, anomalies) {
  const byMetric = new Map();
  for (const m of METRICS) byMetric.set(m, []);
  let valueSum = 0;
  for (const r of records) {
    byMetric.get(r.metric)?.push(r.value);
    valueSum += r.value;
  }
  const summary = {};
  for (const [metric, vals] of byMetric) {
    summary[metric] = vals.length ? {
      avg: r3(vals.reduce((s, v) => s + v, 0) / vals.length),
      min: r3(Math.min(...vals)),
      max: r3(Math.max(...vals)),
      count: vals.length
    } : null;
  }
  const nodeSet = new Set(records.map((r) => r.nodeId));
  const anomalyNodes = new Set(anomalies.map((a) => a.nodeId));
  return {
    byMetric: summary,
    valueSum,
    totalPoints: records.length,
    activeNodes: nodeSet.size,
    anomalyPoints: anomalies.length,
    anomalyNodes: anomalyNodes.size
  };
}
