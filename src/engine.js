import {
  CLOSURES,
  DATA_VERSION,
  DIRECTIONS,
  DIRECTION_BY_ID,
  GRADES,
  GRADE_BY_ID,
  ROADS,
  ROAD_BY_ID,
  WINDOWS,
  WINDOW_BY_ID,
  buildRawDataset,
} from "./data.js";

const LEGEND_BINS = [
  { id: "smooth", label: "畅通", min: 0, max: 25, color: "#439a7d" },
  { id: "slow", label: "缓行", min: 25, max: 50, color: "#cbae48" },
  { id: "congested", label: "拥堵", min: 50, max: 75, color: "#dd8341" },
  { id: "severe", label: "严重", min: 75, max: 100, color: "#d44f3f" },
];

const TIME_RE = /^2026-11-17 ([01]\d|2[0-3]):([0-5]\d)$/;
const prepareCache = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function timestampMinutes(value) {
  const match = TIME_RE.exec(value ?? "");
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function makeWindowStats() {
  return Object.fromEntries(
    WINDOWS.map((window) => [
      window.id,
      { raw: 0, duplicates: 0, invalid: 0, missing: 0, anomaly: 0, filled: 0, final: 0 },
    ]),
  );
}

function valueRange(field) {
  if (field === "speed") return [1, 140];
  if (field === "queue") return [0, 500];
  return [0, 10000];
}

function completeness(row) {
  return ["speed", "queue", "volume"].reduce((score, field) => {
    const value = asNumber(row[field]);
    const [min, max] = valueRange(field);
    return score + (value != null && value >= min && value <= max ? 1 : 0);
  }, 0);
}

function prepareRows(datasetId) {
  const raw = buildRawDataset(datasetId);
  const byWindow = makeWindowStats();
  const valid = [];
  let invalidRows = 0;
  let invalidTimeRows = 0;
  let invalidDirectionRows = 0;

  for (const source of raw) {
    const windowId = source.windowId;
    if (!byWindow[windowId]) continue;
    byWindow[windowId].raw += 1;
    const minutes = timestampMinutes(source.timestamp);
    const hasRoad = Boolean(ROAD_BY_ID[source.roadId]);
    const hasDirection = source.direction === "all" || Boolean(DIRECTION_BY_ID[source.direction]);
    if (minutes == null || !hasRoad || !hasDirection) {
      invalidRows += 1;
      byWindow[windowId].invalid += 1;
      if (minutes == null) invalidTimeRows += 1;
      if (!hasDirection) invalidDirectionRows += 1;
      continue;
    }
    valid.push({ ...source, _minutes: minutes });
  }

  const unique = new Map();
  let duplicateRows = 0;
  for (const row of valid) {
    const key = `${row.roadId}|${row.timestamp}|${row.direction}`;
    const current = unique.get(key);
    if (!current) {
      unique.set(key, row);
      continue;
    }
    duplicateRows += 1;
    byWindow[row.windowId].duplicates += 1;
    if (completeness(row) > completeness(current)) unique.set(key, row);
  }

  const rows = [...unique.values()].sort(
    (left, right) => left._minutes - right._minutes || left.roadId.localeCompare(right.roadId),
  );
  let missingFields = 0;
  let anomalyFields = 0;

  const groups = new Map();
  for (const row of rows) {
    row._missing = [];
    row._anomaly = [];
    row._filled = [];
    const groupKey = `${row.windowId}|${row.roadId}|${row.direction}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);

    for (const field of ["speed", "queue", "volume"]) {
      const value = asNumber(row[field]);
      const [min, max] = valueRange(field);
      if (value == null) {
        row._missing.push(field);
        row[field] = null;
        missingFields += 1;
        byWindow[row.windowId].missing += 1;
      } else if (value < min || value > max) {
        row._anomaly.push(field);
        row[field] = null;
        anomalyFields += 1;
        byWindow[row.windowId].anomaly += 1;
      } else {
        row[field] = value;
      }
    }
  }

  const globalMedians = {};
  for (const field of ["speed", "queue", "volume"]) {
    globalMedians[field] = median(rows.map((row) => row[field]).filter((value) => value != null));
  }

  let filledFields = 0;
  for (const row of rows) {
    const group = groups.get(`${row.windowId}|${row.roadId}|${row.direction}`);
    const fields = [...row._missing, ...row._anomaly];
    for (const field of fields) {
      const nearby = group
        .filter((candidate) => candidate[field] != null)
        .sort(
          (left, right) =>
            Math.abs(left._minutes - row._minutes) - Math.abs(right._minutes - row._minutes),
        )
        .slice(0, 5)
        .map((candidate) => candidate[field]);
      const roadValues = rows
        .filter(
          (candidate) =>
            candidate.roadId === row.roadId && candidate.direction === row.direction && candidate[field] != null,
        )
        .map((candidate) => candidate[field]);
      row[field] = median(nearby) ?? median(roadValues) ?? globalMedians[field] ?? 0;
      row._filled.push(field);
      filledFields += 1;
      byWindow[row.windowId].filled += 1;
    }
    byWindow[row.windowId].final += 1;
  }

  const finalRows = rows.map((row) => {
    const clean = { ...row };
    delete clean._minutes;
    return clean;
  });

  const hashInput = finalRows
    .map(
      (row) =>
        `${row.roadId}:${row.timestamp}:${row.direction}:${Number(row.speed).toFixed(1)}:${Math.round(row.queue)}:${Math.round(row.volume)}`,
    )
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < hashInput.length; index += 1) {
    hash ^= hashInput.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const expectedRows = ROADS.length * WINDOWS.length * 12;
  return {
    datasetId,
    rows: finalRows,
    byWindow,
    summary: {
      rawRows: raw.length,
      duplicateRows,
      invalidRows,
      invalidTimeRows,
      invalidDirectionRows,
      missingFields,
      anomalyFields,
      filledFields,
      finalRows: finalRows.length,
      expectedRows,
      coverage: finalRows.length / expectedRows,
      availableRoads: new Set(finalRows.map((row) => row.roadId)).size,
      dataHash: (hash >>> 0).toString(16).padStart(8, "0"),
      version: DATA_VERSION,
    },
  };
}

export function getPreparedDataset(datasetId) {
  if (!prepareCache.has(datasetId)) prepareCache.set(datasetId, prepareRows(datasetId));
  return prepareCache.get(datasetId);
}

export function indexFor(speed, queue, volume, freeFlow) {
  const speedScore = clamp(1 - speed / freeFlow, 0, 1);
  const queueScore = clamp(queue / 150, 0, 1);
  const volumeScore = clamp(volume / 2500, 0, 1);
  return Number(clamp(speedScore * 65 + queueScore * 25 + volumeScore * 10, 0, 100).toFixed(1));
}

export function indexBand(index) {
  return LEGEND_BINS.find((bin) => index >= bin.min && index < bin.max) ?? LEGEND_BINS[LEGEND_BINS.length - 1];
}

function aggregateRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.roadId)) groups.set(row.roadId, []);
    groups.get(row.roadId).push(row);
  }

  const result = [];
  for (const [roadId, samples] of groups) {
    const road = ROAD_BY_ID[roadId];
    if (!road) continue;
    const weight = samples.reduce((sum, row) => sum + row.volume, 0);
    const speed = samples.reduce((sum, row) => sum + row.speed * row.volume, 0) / Math.max(weight, 1);
    const queue = samples.reduce((sum, row) => sum + row.queue, 0) / samples.length;
    const volume = weight / samples.length;
    const index = indexFor(speed, queue, volume, road.freeFlow);
    result.push({
      ...road,
      speed: Number(speed.toFixed(1)),
      queue: Math.round(queue),
      volume: Math.round(volume),
      index,
      band: indexBand(index).id,
      samples: samples.length,
      lastTime: samples.reduce((latest, row) => (row.timestamp > latest ? row.timestamp : latest), ""),
    });
  }
  return result.sort((left, right) => right.index - left.index || left.name.localeCompare(right.name));
}

function aggregateSeries(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.timestamp)) groups.set(row.timestamp, []);
    groups.get(row.timestamp).push(row);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([timestamp, samples]) => {
      const weight = samples.reduce((sum, row) => sum + row.volume, 0);
      const speed = samples.reduce((sum, row) => sum + row.speed * row.volume, 0) / Math.max(weight, 1);
      const queue = samples.reduce((sum, row) => sum + row.queue, 0) / samples.length;
      const volume = weight / samples.length;
      const reference = samples.reduce(
        (sum, row) => sum + ROAD_BY_ID[row.roadId].freeFlow,
        0,
      ) / samples.length;
      return {
        timestamp,
        time: timestamp.slice(11),
        speed: Number(speed.toFixed(1)),
        queue: Math.round(queue),
        volume: Math.round(volume),
        index: indexFor(speed, queue, volume, reference),
        samples: samples.length,
      };
    });
}

export function buildView(datasetId, windowId, filters = {}) {
  const prepared = getPreparedDataset(datasetId);
  const window = WINDOW_BY_ID[windowId] ?? WINDOWS[1];
  const direction = filters.direction ?? "all";
  const grades = filters.grades ?? GRADES.map((grade) => grade.id);
  const gradeSet = new Set(grades);
  const eligibleRoads = ROADS.filter(
    (road) => gradeSet.has(road.grade) && (direction === "all" || road.direction === direction),
  );
  const eligibleIds = new Set(eligibleRoads.map((road) => road.id));
  const windowRows = prepared.rows.filter(
    (row) => row.windowId === window.id && eligibleIds.has(row.roadId),
  );
  const roads = aggregateRows(windowRows);
  const series = aggregateSeries(windowRows);
  const totalWeight = windowRows.reduce((sum, row) => sum + row.volume, 0);
  const weightedSpeed =
    windowRows.reduce((sum, row) => sum + row.speed * row.volume, 0) / Math.max(totalWeight, 1);
  const weightedFreeFlow =
    windowRows.reduce((sum, row) => sum + ROAD_BY_ID[row.roadId].freeFlow * row.volume, 0) /
    Math.max(totalWeight, 1);
  const avgQueue = roads.length
    ? roads.reduce((sum, road) => sum + road.queue, 0) / roads.length
    : 0;
  const avgIndex = roads.length
    ? roads.reduce((sum, road) => sum + road.index * road.samples, 0) /
      Math.max(roads.reduce((sum, road) => sum + road.samples, 0), 1)
    : 0;
  const hotspots = roads.filter((road) => road.index >= 50);
  const legend = LEGEND_BINS.map((bin) => ({
    ...bin,
    count: roads.filter((road) => road.index >= bin.min && road.index < bin.max).length,
  }));
  const closures = CLOSURES[window.id] ?? [];
  const closedIds = new Set(closures.map((item) => item.roadId));
  const quality = prepared.byWindow[window.id];
  const expectedSamples = eligibleRoads.length * 12;
  const signature = [
    prepared.summary.dataHash,
    window.id,
    direction,
    [...grades].sort().join(","),
    roads.map((road) => `${road.id}${road.index}`).join("|"),
  ].join("::");

  return {
    datasetId,
    dataVersion: prepared.summary.version,
    dataHash: prepared.summary.dataHash,
    viewRevision: signature,
    window,
    filters: { direction, grades: [...grades].sort() },
    directionMeta: DIRECTION_BY_ID[direction],
    eligibleRoads,
    roads,
    series,
    legend,
    hotspots,
    closures: closures.map((closure) => ({ ...closure, road: ROAD_BY_ID[closure.roadId] })),
    closedIds,
    quality,
    datasetSummary: prepared.summary,
    stats: {
      roadCount: roads.length,
      expectedRoadCount: eligibleRoads.length,
      hotspotCount: hotspots.length,
      samples: windowRows.length,
      expectedSamples,
      coverage: expectedSamples ? windowRows.length / expectedSamples : 0,
      speed: Number(weightedSpeed.toFixed(1)),
      freeFlow: Number(weightedFreeFlow.toFixed(1)),
      queue: Math.round(avgQueue),
      index: Number(avgIndex.toFixed(1)),
      peakIndex: series.length ? Math.max(...series.map((point) => point.index)) : 0,
    },
  };
}

function segmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function polylineDistance(left, right) {
  let best = Infinity;
  for (let index = 0; index < left.points.length - 1; index += 1) {
    for (const point of right.points) {
      best = Math.min(best, segmentDistance(point, left.points[index], left.points[index + 1]));
    }
  }
  for (let index = 0; index < right.points.length - 1; index += 1) {
    for (const point of left.points) {
      best = Math.min(best, segmentDistance(point, right.points[index], right.points[index + 1]));
    }
  }
  return best;
}

function roadLengthKm(road) {
  let length = 0;
  for (let index = 0; index < road.points.length - 1; index += 1) {
    const left = road.points[index];
    const right = road.points[index + 1];
    length += Math.hypot(right.x - left.x, right.y - left.y);
  }
  return length / 94;
}

const roadAdjacency = (() => {
  const adjacency = Object.fromEntries(ROADS.map((road) => [road.id, []]));
  for (let leftIndex = 0; leftIndex < ROADS.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ROADS.length; rightIndex += 1) {
      const left = ROADS[leftIndex];
      const right = ROADS[rightIndex];
      if (polylineDistance(left, right) <= 16) {
        const weight = (roadLengthKm(left) + roadLengthKm(right)) / 2;
        adjacency[left.id].push({ roadId: right.id, weight });
        adjacency[right.id].push({ roadId: left.id, weight });
      }
    }
  }
  return adjacency;
})();

export function computeRoute(startRoadId, endRoadId, closedRoadIds = []) {
  if (!startRoadId || !endRoadId) return { roadIds: [], lengthKm: 0, status: "idle" };
  const closed = new Set(closedRoadIds);
  if (closed.has(startRoadId) || closed.has(endRoadId)) {
    return { roadIds: [], lengthKm: 0, status: "closed-endpoint" };
  }
  if (startRoadId === endRoadId) {
    return { roadIds: [startRoadId], lengthKm: roadLengthKm(ROAD_BY_ID[startRoadId]), status: "ok" };
  }

  const distance = Object.fromEntries(ROADS.map((road) => [road.id, Infinity]));
  const previous = {};
  const unvisited = new Set(ROADS.map((road) => road.id).filter((id) => !closed.has(id)));
  distance[startRoadId] = 0;

  while (unvisited.size) {
    let current = null;
    let currentDistance = Infinity;
    for (const id of unvisited) {
      if (distance[id] < currentDistance) {
        current = id;
        currentDistance = distance[id];
      }
    }
    if (!current || current === endRoadId) break;
    unvisited.delete(current);
    for (const edge of roadAdjacency[current] ?? []) {
      if (!unvisited.has(edge.roadId)) continue;
      const candidate = distance[current] + edge.weight;
      if (candidate < distance[edge.roadId]) {
        distance[edge.roadId] = candidate;
        previous[edge.roadId] = current;
      }
    }
  }

  if (distance[endRoadId] === Infinity) {
    return { roadIds: [], lengthKm: 0, status: "no-path", closedCount: closed.size };
  }
  const roadIds = [endRoadId];
  let cursor = endRoadId;
  while (cursor !== startRoadId && previous[cursor]) {
    cursor = previous[cursor];
    roadIds.unshift(cursor);
  }
  const lengthKm = roadIds.reduce((sum, id) => sum + roadLengthKm(ROAD_BY_ID[id]), 0);
  return {
    roadIds,
    lengthKm: Number(lengthKm.toFixed(1)),
    status: "ok",
    closedCount: closed.size,
    avoidedClosed: [...closed].filter((id) => !roadIds.includes(id)).length,
  };
}

export function routeGeometry(roadIds) {
  const routes = roadIds.map((id) => ROAD_BY_ID[id]).filter(Boolean);
  const connectors = [];
  for (let index = 0; index < routes.length - 1; index += 1) {
    const left = routes[index];
    const right = routes[index + 1];
    let best = { distance: Infinity, left: null, right: null };
    for (const leftPoint of left.points) {
      for (const rightPoint of right.points) {
        const distance = Math.hypot(leftPoint.x - rightPoint.x, leftPoint.y - rightPoint.y);
        if (distance < best.distance) best = { distance, left: leftPoint, right: rightPoint };
      }
    }
    connectors.push([best.left, best.right]);
  }
  return { routes, connectors };
}

export function runSelfChecks() {
  const normal = buildView("normal", "w0809", {
    direction: "all",
    grades: GRADES.map((grade) => grade.id),
  });
  const empty = buildView("normal", "w0809", {
    direction: "south-north",
    grades: ["expressway"],
  });
  const missing = getPreparedDataset("missing");
  const anomaly = getPreparedDataset("anomaly");
  const repeated = buildView("normal", "w0809", {
    direction: "all",
    grades: GRADES.map((grade) => grade.id),
  });
  const validFinal = anomaly.rows.every(
    (row) =>
      row.speed >= 1 &&
      row.speed <= 140 &&
      row.queue >= 0 &&
      row.queue <= 500 &&
      row.volume >= 0 &&
      row.volume <= 10000,
  );
  const route = computeRoute("r05", "r12", ["r06", "r12"].filter((id) => id !== "r12"));
  const items = [
    {
      id: "normal",
      label: "正常筛选返回非空且曲线同源",
      ok: normal.roads.length > 0 && normal.series.length === 12 && normal.legend.reduce((sum, bin) => sum + bin.count, 0) === normal.roads.length,
      detail: `${normal.stats.roadCount} 路段 / ${normal.stats.samples} 样本`,
    },
    {
      id: "empty",
      label: "空结果保持零值且不伪造图形",
      ok: empty.roads.length === 0 && empty.series.length === 0 && empty.stats.hotspotCount === 0 && empty.stats.samples === 0,
      detail: "快速路 + 南→北 = 0 路段",
    },
    {
      id: "dedupe",
      label: "唯一键去重与补缺生效",
      ok: missing.summary.duplicateRows > 0 && missing.summary.filledFields > 0 && missing.summary.coverage > 0,
      detail: `去重 ${missing.summary.duplicateRows} · 补缺 ${missing.summary.filledFields}`,
    },
    {
      id: "anomaly",
      label: "坏时间剔除、越界值修复",
      ok: anomaly.summary.invalidRows > 0 && anomaly.summary.anomalyFields > 0 && validFinal,
      detail: `剔除 ${anomaly.summary.invalidRows} · 修复 ${anomaly.summary.anomalyFields}`,
    },
    {
      id: "snapshot",
      label: "重复计算快照与导出同源",
      ok: repeated.viewRevision === normal.viewRevision && route.roadIds.length > 0,
      detail: `视图哈希 ${normal.viewRevision.slice(-8)}`,
    },
  ];
  return { items, passed: items.filter((item) => item.ok).length, total: items.length };
}

export { LEGEND_BINS, DIRECTIONS, GRADES, WINDOWS };
