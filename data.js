export const DATE_LABEL = "2026-11-17";
export const THRESHOLD = 4.5;
export const BUCKET_MINUTES = 5;
export const SAMPLE_MINUTES = 2;

export const AREAS = [
  { id: "A", name: "A口", type: "entrance", x: 0.075, y: 0.2, w: 0.15, h: 0.14, inward: 1, label: "A" },
  { id: "B", name: "B口", type: "entrance", x: 0.775, y: 0.2, w: 0.15, h: 0.14, inward: -1, label: "B" },
  { id: "C", name: "C口", type: "entrance", x: 0.075, y: 0.66, w: 0.15, h: 0.14, inward: 1, label: "C" },
  { id: "D", name: "D口", type: "entrance", x: 0.775, y: 0.66, w: 0.15, h: 0.14, inward: -1, label: "D" },
  { id: "N", name: "北通道", type: "passage", x: 0.3, y: 0.225, w: 0.4, h: 0.11, inward: 1, label: "N" },
  { id: "M", name: "中央通道", type: "passage", x: 0.3, y: 0.445, w: 0.4, h: 0.11, inward: 1, label: "M" },
  { id: "S", name: "南通道", type: "passage", x: 0.3, y: 0.665, w: 0.4, h: 0.11, inward: 1, label: "S" }
];

export const WINDOWS = [
  { id: "0708", name: "早峰爬升", start: 420, end: 480, startLabel: "07:00", endLabel: "08:00" },
  { id: "0809", name: "峰值窗口", start: 480, end: 540, startLabel: "08:00", endLabel: "09:00" }
];

export const DATASETS = [
  {
    id: "normal",
    name: "正常采样",
    tag: "NORMAL",
    caption: "完整客流曲线",
    accent: "mint"
  },
  {
    id: "missing",
    name: "缺失样本",
    tag: "GAPPED",
    caption: "含空洞与重复",
    accent: "amber"
  },
  {
    id: "anomaly",
    name: "异常样本",
    tag: "ALERT",
    caption: "注入局部拥挤",
    accent: "coral"
  }
];

export const RAW_TIMES = Array.from(
  { length: (540 - 420) / SAMPLE_MINUTES + 1 },
  (_, index) => 420 + index * SAMPLE_MINUTES
);

const ZONE_MODEL = {
  A: { peak: 472, spread: 28, baseIn: 28, surgeIn: 220, baseOut: 12, surgeOut: 46, capacity: 72, phase: 0.2 },
  B: { peak: 500, spread: 32, baseIn: 16, surgeIn: 96, baseOut: 9, surgeOut: 33, capacity: 48, phase: 1.4 },
  C: { peak: 490, spread: 34, baseIn: 20, surgeIn: 82, baseOut: 12, surgeOut: 56, capacity: 45, phase: 2.3 },
  D: { peak: 505, spread: 30, baseIn: 24, surgeIn: 190, baseOut: 13, surgeOut: 76, capacity: 75, phase: 3.1 },
  N: { peak: 478, spread: 35, baseIn: 64, surgeIn: 330, baseOut: 38, surgeOut: 76, capacity: 165, phase: 0.8 },
  M: { peak: 492, spread: 33, baseIn: 72, surgeIn: 402, baseOut: 42, surgeOut: 96, capacity: 188, phase: 1.9 },
  S: { peak: 502, spread: 37, baseIn: 58, surgeIn: 305, baseOut: 35, surgeOut: 130, capacity: 158, phase: 2.8 }
};

const MISSING_POINTS = [
  ["A", 450], ["A", 452], ["A", 454], ["A", 456],
  ["B", 464], ["B", 466], ["B", 468], ["B", 470],
  ["C", 474], ["C", 476], ["C", 478], ["C", 480],
  ["D", 484], ["D", 486], ["D", 488], ["D", 490],
  ["N", 494], ["N", 496], ["N", 498], ["N", 500],
  ["M", 504], ["M", 506], ["S", 512], ["S", 514]
];

const ANOMALY_MODEL = { peak: 491, spread: 9 };

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseRecord(zone, time) {
  const model = ZONE_MODEL[zone.id];
  const wave = Math.exp(-0.5 * ((time - model.peak) / model.spread) ** 2);
  const lateOut = Math.exp(-0.5 * ((time - 512) / 25) ** 2);
  const pulse = 1 + 0.045 * Math.sin(time / 7 + model.phase);
  const inflow = Math.max(1, Math.round((model.baseIn + model.surgeIn * wave) * pulse));
  const outflow = Math.max(1, Math.round((model.baseOut + model.surgeOut * lateOut) * (1.02 - 0.03 * Math.cos(time / 9))));
  const density = round(0.58 + (inflow + outflow * 0.62) / model.capacity + 0.12 * Math.sin(time / 6 + model.phase), 2);
  return {
    id: `${zone.id}-${time}`,
    zoneId: zone.id,
    time,
    inflow,
    outflow,
    density,
    quality: "measured",
    anomaly: false
  };
}

function cloneWithId(record, index) {
  return { ...record, id: `${record.id}-dup${index}`, quality: "duplicate" };
}

function buildRawRows(datasetId) {
  const rows = [];
  for (const time of RAW_TIMES) {
    for (const zone of AREAS) {
      const record = baseRecord(zone, time);
      if (datasetId === "anomaly") applyAnomaly(record);
      rows.push(record);
    }
  }

  if (datasetId === "missing") {
    const omitted = new Set(MISSING_POINTS.map(([zoneId, time]) => `${zoneId}-${time}`));
    return rows
      .filter((row) => !omitted.has(row.id))
      .flatMap((row, index) => index % 79 === 0 ? [row, cloneWithId(row, index)] : [row]);
  }

  if (datasetId === "anomaly") {
    const omitted = new Set(["A-438", "B-516", "C-532", "D-446", "N-458", "S-524"]);
    return rows
      .filter((row) => !omitted.has(row.id))
      .flatMap((row, index) => index % 97 === 0 ? [row, cloneWithId(row, index)] : [row]);
  }

  return rows.flatMap((row, index) => index % 83 === 0 ? [row, cloneWithId(row, index)] : [row]);
}

function applyAnomaly(record) {
  const wave = Math.exp(-0.5 * ((record.time - ANOMALY_MODEL.peak) / ANOMALY_MODEL.spread) ** 2);
  if (record.zoneId === "M") {
    record.density = round(record.density + 4.7 * wave + 0.25, 2);
    record.inflow += Math.round(105 * wave);
    record.anomaly = record.density >= THRESHOLD;
  }
  if (record.zoneId === "B" && record.time >= 508 && record.time <= 518) {
    record.density = round(record.density + 3.9, 2);
    record.outflow += 72;
    record.anomaly = record.density >= THRESHOLD;
  }
  if (record.zoneId === "S" && record.time >= 522 && record.time <= 532) {
    record.density = round(record.density + 2.8, 2);
    record.inflow += 64;
    record.anomaly = record.density >= THRESHOLD;
  }
}

function dedupeRows(rows) {
  const unique = new Map();
  let duplicates = 0;
  for (const row of rows) {
    const key = `${row.zoneId}|${row.time}`;
    if (unique.has(key)) {
      duplicates += 1;
      continue;
    }
    unique.set(key, row);
  }
  return {
    rows: [...unique.values()].sort((a, b) => a.time - b.time || AREAS.findIndex((area) => area.id === a.zoneId) - AREAS.findIndex((area) => area.id === b.zoneId)),
    duplicates
  };
}

function interpolateValue(previous, next, key, ratio) {
  if (key === "anomaly") return false;
  return round(previous[key] + (next[key] - previous[key]) * ratio, key === "density" ? 2 : 0);
}

function fillGaps(rows) {
  const filled = [];
  let imputed = 0;
  for (const zone of AREAS) {
    const samples = rows.filter((row) => row.zoneId === zone.id);
    const byTime = new Map(samples.map((sample) => [sample.time, sample]));
    for (const time of RAW_TIMES) {
      const measured = byTime.get(time);
      if (measured) {
        filled.push({ ...measured, quality: "measured" });
        continue;
      }
      const previous = samples.filter((sample) => sample.time < time).at(-1);
      const next = samples.find((sample) => sample.time > time);
      if (!previous && !next) continue;
      const anchorPrevious = previous || next;
      const anchorNext = next || previous;
      const span = anchorNext.time - anchorPrevious.time || 1;
      const ratio = previous ? (time - previous.time) / span : 0;
      filled.push({
        id: `imputed-${zone.id}-${time}`,
        zoneId: zone.id,
        time,
        inflow: interpolateValue(anchorPrevious, anchorNext, "inflow", ratio),
        outflow: interpolateValue(anchorPrevious, anchorNext, "outflow", ratio),
        density: interpolateValue(anchorPrevious, anchorNext, "density", ratio),
        quality: "imputed",
        anomaly: false
      });
      imputed += 1;
    }
  }
  return { rows: filled.sort((a, b) => a.time - b.time), imputed };
}

export function aggregateRows(rows) {
  const aggregated = [];
  for (let bucketTime = 420; bucketTime < 540; bucketTime += BUCKET_MINUTES) {
    for (const zone of AREAS) {
      const samples = rows.filter((row) => row.zoneId === zone.id && row.time >= bucketTime && row.time < bucketTime + BUCKET_MINUTES);
      if (!samples.length) continue;
      const average = (field) => samples.reduce((total, row) => total + row[field], 0) / samples.length;
      const density = round(average("density"), 2);
      aggregated.push({
        zoneId: zone.id,
        zoneName: zone.name,
        type: zone.type,
        bucketTime,
        density,
        inflow: round(average("inflow"), 1),
        outflow: round(average("outflow"), 1),
        sampleCount: samples.length,
        imputedCount: samples.filter((row) => row.quality === "imputed").length,
        anomaly: samples.some((row) => row.anomaly) || density >= THRESHOLD
      });
    }
  }
  return aggregated;
}

function hashRows(rows) {
  let hash = 2166136261;
  for (const row of rows) {
    const text = [row.zoneId, row.bucketTime, row.density, row.inflow, row.outflow, row.anomaly ? 1 : 0].join(":");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(0, 8);
}

const cache = new Map();

export function getProcessedDataset(datasetId) {
  if (cache.has(datasetId)) return cache.get(datasetId);
  const dataset = DATASETS.find((item) => item.id === datasetId) || DATASETS[0];
  const raw = buildRawRows(dataset.id);
  const deduped = dedupeRows(raw);
  const filled = fillGaps(deduped.rows);
  const aggregated = aggregateRows(filled.rows);
  const expectedSamples = AREAS.length * RAW_TIMES.length;
  const missing = Math.max(0, expectedSamples - deduped.rows.length);
  const anomalyRows = filled.rows.filter((row) => row.anomaly);
  const anomalyZones = [...new Set(anomalyRows.map((row) => row.zoneId))];
  const result = {
    dataset,
    raw,
    deduped: deduped.rows,
    filled: filled.rows,
    aggregated,
    summary: {
      rawRows: raw.length,
      duplicateRows: deduped.duplicates,
      uniqueRows: deduped.rows.length,
      missingRows: missing,
      imputedRows: filled.imputed,
      remainingGaps: expectedSamples - filled.rows.length,
      aggregatedRows: aggregated.length,
      anomalyRows: anomalyRows.length,
      anomalyZones: anomalyZones.length,
      expectedSamples,
      version: hashRows(aggregated)
    }
  };
  cache.set(datasetId, result);
  return result;
}

export function getWindowRows(processed, windowId) {
  const window = WINDOWS.find((item) => item.id === windowId) || WINDOWS[1];
  return processed.aggregated.filter((row) => row.bucketTime >= window.start && row.bucketTime < window.end);
}

export function getZone(zoneId) {
  return AREAS.find((area) => area.id === zoneId);
}

export function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function formatWindow(window) {
  return `${window.startLabel}–${window.endLabel}`;
}
