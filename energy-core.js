import {
  DATE,
  DEVICES,
  DISTRIBUTION_EFFICIENCY,
  FLOORS,
  METERS,
  SLOT_MINUTES,
  ZONES,
  getWindow,
  slotTime,
  timeline,
} from "./energy-data.js";

const EPSILON = 1e-7;

export function hashText(text, seed = 2166136261) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function seriesKey(record) {
  return `${record.floor}|${record.zoneId}|${record.meter}`;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isPhysicalAnomaly(record, neighbors) {
  if (!Number.isFinite(record.kwh) || record.kwh < 0) return true;
  if (record.meter === "pv" && record.kwh > 55) return true;
  if (record.meter === "grid" && record.kwh > 140) return true;
  if (neighbors.length < 2) return false;
  const local = median(neighbors);
  return local > 0 && record.kwh > Math.max(local * 2.8, local + 32);
}

function interpolate(knownValues, slot) {
  if (knownValues.has(slot)) return knownValues.get(slot);
  let previous = null;
  let next = null;
  for (let cursor = slot - 1; cursor >= 0; cursor -= 1) {
    if (knownValues.has(cursor)) {
      previous = cursor;
      break;
    }
  }
  for (let cursor = slot + 1; cursor < 88; cursor += 1) {
    if (knownValues.has(cursor)) {
      next = cursor;
      break;
    }
  }
  if (previous === null && next === null) return 0;
  if (previous === null) return knownValues.get(next);
  if (next === null) return knownValues.get(previous);
  const ratio = (slot - previous) / (next - previous);
  return knownValues.get(previous) + (knownValues.get(next) - knownValues.get(previous)) * ratio;
}

export function cleanDataset(rawDataset) {
  const expectedKeys = ZONES.map((zone) => `${zone.floor}|${zone.id}|${zone.meter}`);
  const groups = new Map(expectedKeys.map((key) => [key, []]));
  const seen = new Set();
  let duplicates = 0;
  let invalidDropped = 0;

  for (const record of rawDataset.records) {
    const key = seriesKey(record);
    const uniqueKey = `${key}|${record.slot}`;
    if (!groups.has(key) || !Number.isFinite(record.slot)) {
      invalidDropped += 1;
      continue;
    }
    if (seen.has(uniqueKey)) {
      duplicates += 1;
      continue;
    }
    seen.add(uniqueKey);
    groups.get(key).push({ ...record, rawKwh: record.kwh });
  }

  const zoneLookup = new Map(ZONES.map((zone) => [zone.id, zone]));
  const cleanedRecords = [];
  let missingFilled = 0;
  let anomaliesCorrected = 0;

  for (const [key, group] of groups) {
    const [floor, zoneId, meter] = key.split("|");
    const zone = zoneLookup.get(zoneId);
    const rawBySlot = new Map(group.map((record) => [record.slot, record]));
    const good = new Map();
    const anomalies = new Set();

    for (let slot = 0; slot < 88; slot += 1) {
      const record = rawBySlot.get(slot);
      if (!record) continue;
      const neighbors = [-2, -1, 1, 2]
        .map((offset) => rawBySlot.get(slot + offset))
        .filter(Boolean)
        .map((item) => item.kwh)
        .filter((value) => Number.isFinite(value) && value >= 0);
      if (isPhysicalAnomaly(record, neighbors)) {
        anomalies.add(slot);
        anomaliesCorrected += 1;
      } else {
        good.set(slot, record.kwh);
      }
    }

    for (let slot = 0; slot < 88; slot += 1) {
      const raw = rawBySlot.get(slot);
      const wasMissing = !raw;
      if (wasMissing) missingFilled += 1;
      const corrected = anomalies.has(slot);
      const kwh = Number(Math.max(0, interpolate(good, slot)).toFixed(4));
      cleanedRecords.push({
        id: raw?.id || `${zoneId}:${meter}:${DATE}T${slotTime(slot)}`,
        timestamp: `${DATE}T${slotTime(slot)}`,
        date: DATE,
        time: slotTime(slot),
        slot,
        floor,
        zoneId,
        zoneName: zone?.name || zoneId,
        meter,
        kwh,
        rawKwh: raw?.kwh ?? null,
        powerKw: Number((kwh * (60 / SLOT_MINUTES)).toFixed(4)),
        quality: corrected ? "corrected" : wasMissing ? "filled" : "observed",
      });
    }
  }

  cleanedRecords.sort((a, b) => a.slot - b.slot || a.zoneId.localeCompare(b.zoneId));
  const stats = {
    rawCount: rawDataset.records.length,
    cleanCount: cleanedRecords.length,
    uniqueCount: seen.size,
    duplicates,
    missingFilled,
    anomaliesCorrected,
    invalidDropped,
    filledTotal: missingFilled + anomaliesCorrected,
  };
  const signature = cleanedRecords
    .map((record) => `${record.slot}:${record.zoneId}:${record.meter}:${record.kwh}`)
    .join("|");
  const dataVersion = `DV-${hashText(`${rawDataset.id}|${stats.rawCount}|${signature}`)}`;

  return {
    id: rawDataset.id,
    label: rawDataset.label,
    short: rawDataset.short,
    description: rawDataset.description,
    date: DATE,
    records: cleanedRecords,
    stats,
    dataVersion,
  };
}

export function filterRecords(records, filter) {
  const search = (filter.search || "").trim().toLocaleLowerCase("zh-CN");
  return records.filter((record) => {
    if (filter.floor !== "all" && record.floor !== filter.floor) return false;
    if (filter.source !== "all" && record.meter !== filter.source) return false;
    if (search) {
      const floorLabel = FLOORS.find((floor) => floor.id === record.floor)?.name || record.floor;
      const haystack = `${record.zoneName} ${record.zoneId} ${floorLabel} ${record.meter}`.toLocaleLowerCase("zh-CN");
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export function filterSummary(filter) {
  const floor = filter.floor === "all" ? "全部楼层" : FLOORS.find((item) => item.id === filter.floor)?.name || filter.floor;
  const source = filter.source === "all" ? "全部能源" : METERS[filter.source]?.label || filter.source;
  const search = filter.search?.trim() ? `搜索「${filter.search.trim()}」` : "无搜索词";
  return `${floor} / ${source} / ${search}`;
}

export function statisticalScope(windowId) {
  const window = getWindow(windowId);
  return `${DATE} ${window.range} · 15 分钟聚合 · 功率=区间电量×4 · 有效服务为设备输出 · 损失=输入−有效服务`;
}

function emptyInterval(window, slot, time) {
  return {
    slot,
    time,
    gridPower: 0,
    pvPower: 0,
    totalPower: 0,
    kwh: 0,
    recordCount: 0,
    filled: 0,
    corrected: 0,
  };
}

export function aggregateDataset(clean, filter, windowId) {
  const window = getWindow(windowId);
  const filtered = filterRecords(clean.records, filter);
  const selected = filtered.filter((record) => record.slot >= window.startSlot && record.slot < window.endSlot);
  const slots = timeline().slice(window.startSlot, window.endSlot);
  const slotMap = new Map(slots.map((item) => [item.slot, emptyInterval(window, item.slot, item.time)]));

  for (const record of selected) {
    const target = slotMap.get(record.slot);
    if (!target) continue;
    if (record.meter === "grid") target.gridPower += record.powerKw;
    if (record.meter === "pv") target.pvPower += record.powerKw;
    target.totalPower = target.gridPower + target.pvPower;
    target.kwh += record.kwh;
    target.recordCount += 1;
    if (record.quality === "filled") target.filled += 1;
    if (record.quality === "corrected") target.corrected += 1;
  }

  const intervals = [...slotMap.values()].map((interval) => ({
    ...interval,
    gridPower: Number(interval.gridPower.toFixed(4)),
    pvPower: Number(interval.pvPower.toFixed(4)),
    totalPower: Number((interval.gridPower + interval.pvPower).toFixed(4)),
    kwh: Number(interval.kwh.toFixed(4)),
  }));
  const divisor = Math.max(1, intervals.length);
  const gridAvg = intervals.reduce((sum, item) => sum + item.gridPower, 0) / divisor;
  const pvAvg = intervals.reduce((sum, item) => sum + item.pvPower, 0) / divisor;
  const totalKwh = selected.reduce((sum, record) => sum + record.kwh, 0);

  const zoneMap = new Map();
  for (const record of selected) {
    if (!zoneMap.has(record.zoneId)) {
      zoneMap.set(record.zoneId, {
        zoneId: record.zoneId,
        zoneName: record.zoneName,
        floor: record.floor,
        meter: record.meter,
        kwh: 0,
        powerSum: 0,
        points: 0,
      });
    }
    const zone = zoneMap.get(record.zoneId);
    zone.kwh += record.kwh;
    zone.powerSum += record.powerKw;
    zone.points += 1;
  }
  const zones = [...zoneMap.values()].map((zone) => ({
    ...zone,
    kwh: Number(zone.kwh.toFixed(4)),
    averagePower: Number((zone.powerSum / divisor).toFixed(4)),
  }));

  const daySlots = timeline().map((item) => ({ slot: item.slot, time: item.time, gridPower: 0, pvPower: 0 }));
  for (const record of filtered) {
    const target = daySlots[record.slot];
    if (!target) continue;
    if (record.meter === "grid") target.gridPower += record.powerKw;
    if (record.meter === "pv") target.pvPower += record.powerKw;
  }
  const day = daySlots.map((item) => ({
    ...item,
    gridPower: Number(item.gridPower.toFixed(4)),
    pvPower: Number(item.pvPower.toFixed(4)),
    totalPower: Number((item.gridPower + item.pvPower).toFixed(4)),
  }));

  const quality = {
    filled: selected.filter((record) => record.quality === "filled").length,
    corrected: selected.filter((record) => record.quality === "corrected").length,
    observed: selected.filter((record) => record.quality === "observed").length,
  };

  return {
    window,
    filter,
    hasData: selected.length > 0,
    selected,
    intervals,
    zones,
    day,
    gridAvg: Number(gridAvg.toFixed(4)),
    pvAvg: Number(pvAvg.toFixed(4)),
    totalKwh: Number(totalKwh.toFixed(4)),
    recordCount: selected.length,
    quality,
  };
}

function makeLink(source, target, value, color, label) {
  return { source, target, value: Math.max(0, value), color, label };
}

export function buildFlow(aggregate, loadFactors = {}) {
  const input = aggregate.gridAvg + aggregate.pvAvg;
  const hasData = aggregate.hasData && input > EPSILON;
  const gridRatio = input > 0 ? aggregate.gridAvg / input : 0;
  const pvRatio = input > 0 ? aggregate.pvAvg / input : 0;
  const factors = Object.fromEntries(DEVICES.map((device) => [
    device.id,
    Math.min(1.4, Math.max(0.2, Number(loadFactors?.[device.id] ?? 1))),
  ]));
  const denominator = DEVICES.reduce((sum, device) => sum + device.share * device.efficiency, 0);
  const deviceResults = DEVICES.map((device) => {
    const baselineUseful = hasData
      ? (input * DISTRIBUTION_EFFICIENCY * device.share * device.efficiency) / denominator
      : 0;
    const useful = baselineUseful * factors[device.id];
    const deviceInput = useful / device.efficiency;
    return {
      ...device,
      factor: factors[device.id],
      baselineUseful,
      useful,
      input: deviceInput,
      loss: Math.max(0, deviceInput - useful),
    };
  });

  const deviceInputTotal = deviceResults.reduce((sum, item) => sum + item.input, 0);
  const totalInput = hasData ? deviceInputTotal / DISTRIBUTION_EFFICIENCY : 0;
  const distributionLoss = totalInput - deviceInputTotal;
  const usefulTotal = deviceResults.reduce((sum, item) => sum + item.useful, 0);
  const equipmentLoss = deviceResults.reduce((sum, item) => sum + item.loss, 0);
  const lossTotal = distributionLoss + equipmentLoss;
  const gridInput = totalInput * gridRatio;
  const pvInput = totalInput * pvRatio;

  const nodes = [
    { id: "grid", label: METERS.grid.label, detail: "外部电网输入", column: 0, value: gridInput, color: METERS.grid.color },
    { id: "pv", label: METERS.pv.label, detail: "屋顶光伏输入", column: 0, value: pvInput, color: METERS.pv.color },
    { id: "bus", label: "配电母线", detail: "建筑总输入", column: 1, value: totalInput, color: "#173f3b" },
    ...deviceResults.map((device) => ({
      id: device.id,
      label: device.label,
      detail: `${device.short} · 效率 ${Math.round(device.efficiency * 100)}%`,
      column: 2,
      value: device.input,
      color: device.color,
      efficiency: device.efficiency,
    })),
    ...deviceResults.map((device) => ({
      id: `service-${device.id}`,
      label: device.service,
      detail: `来自${device.label}`,
      column: 3,
      value: device.useful,
      color: device.color,
      service: true,
    })),
    {
      id: "distribution-loss",
      label: "配电损耗",
      detail: `母线效率 ${Math.round(DISTRIBUTION_EFFICIENCY * 100)}%`,
      column: 3,
      value: distributionLoss,
      color: "#c98238",
      loss: true,
    },
    {
      id: "equipment-loss",
      label: "设备热损",
      detail: "四类设备转换损失合计",
      column: 4,
      value: equipmentLoss,
      color: "#c05743",
      loss: true,
    },
  ];

  const links = [];
  if (gridInput > 0) links.push(makeLink("grid", "bus", gridInput, METERS.grid.color, "市电输入"));
  if (pvInput > 0) links.push(makeLink("pv", "bus", pvInput, METERS.pv.color, "光伏输入"));
  for (const device of deviceResults) {
    if (device.input > 0) links.push(makeLink("bus", device.id, device.input, device.color, device.label));
    if (device.useful > 0) links.push(makeLink(device.id, `service-${device.id}`, device.useful, device.color, device.service));
    if (device.loss > 0) links.push(makeLink(device.id, "equipment-loss", device.loss, "#c05743", `${device.short} 热损`));
  }
  if (distributionLoss > 0) links.push(makeLink("bus", "distribution-loss", distributionLoss, "#c98238", "配电损耗"));

  const inputCheck = gridInput + pvInput;
  const outputCheck = usefulTotal + lossTotal;
  const balanceError = Math.abs(inputCheck - outputCheck);
  const nodeErrors = [];
  for (const node of nodes) {
    if (node.column === 1 || node.column === 2) {
      const incoming = links.filter((link) => link.target === node.id).reduce((sum, link) => sum + link.value, 0);
      const outgoing = links.filter((link) => link.source === node.id).reduce((sum, link) => sum + link.value, 0);
      if (Math.abs(incoming - outgoing) > 1e-6) {
        nodeErrors.push({ node: node.id, incoming, outgoing, error: incoming - outgoing });
      }
    }
  }

  return {
    hasData,
    nodes,
    links,
    devices: deviceResults,
    factors,
    totals: {
      input: totalInput,
      grid: gridInput,
      pv: pvInput,
      useful: usefulTotal,
      loss: lossTotal,
      distributionLoss,
      equipmentLoss,
      efficiency: totalInput > 0 ? usefulTotal / totalInput : 0,
    },
    conservation: {
      ok: balanceError <= 1e-6 && nodeErrors.length === 0,
      balanceError,
      nodeErrors,
    },
  };
}

export function buildSnapshot(clean, config) {
  const aggregate = aggregateDataset(clean, config.filter, config.windowId);
  const flow = buildFlow(aggregate, config.loadFactors);
  const filterText = filterSummary(config.filter);
  const window = getWindow(config.windowId);
  const scenarioVersion = `SC-${hashText(`${clean.dataVersion}|${config.windowId}|${filterText}|${JSON.stringify(flow.factors)}`)}`;
  return {
    clean,
    config,
    aggregate,
    flow,
    window,
    filterText,
    dataVersion: clean.dataVersion,
    scenarioVersion,
    scope: statisticalScope(config.windowId),
  };
}

export function buildExportManifest(snapshot) {
  const { flow, aggregate, clean, config, window, filterText, dataVersion, scenarioVersion } = snapshot;
  return {
    title: "建筑能量流分析图",
    generatedAt: new Date().toISOString(),
    dataVersion,
    scenarioVersion,
    dataset: { id: clean.id, label: clean.label },
    window: { id: window.id, label: window.label, range: window.range, slots: aggregate.intervals.length },
    filter: { ...config.filter, text: filterText },
    scope: snapshot.scope,
    kpis: {
      input: flow.totals.input,
      useful: flow.totals.useful,
      loss: flow.totals.loss,
      efficiency: flow.totals.efficiency,
      grid: flow.totals.grid,
      pv: flow.totals.pv,
    },
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      column: node.column,
      value: node.value,
    })),
    conservation: {
      ok: flow.conservation.ok,
      balanceError: flow.conservation.balanceError,
    },
    quality: {
      records: aggregate.recordCount,
      filled: aggregate.quality.filled,
      corrected: aggregate.quality.corrected,
    },
    displayRange: config.rangeMode === "day" ? "全天 00:00–22:00" : window.range,
  };
}

export function buildCsv(snapshot) {
  const manifest = buildExportManifest(snapshot);
  const metadata = [
    ["section", "建筑能量流导出"],
    ["generatedAt", manifest.generatedAt],
    ["dataset", manifest.dataset.label],
    ["window", `${manifest.window.label} ${manifest.window.range}`],
    ["filter", manifest.filter.text],
    ["scope", manifest.scope],
    ["dataVersion", manifest.dataVersion],
    ["scenarioVersion", manifest.scenarioVersion],
    ["displayRange", manifest.displayRange],
    ["result", snapshot.aggregate.hasData ? "MATCHED" : "NO_MATCHING_RECORDS"],
    ["input_kW", manifest.kpis.input.toFixed(4)],
    ["useful_kW", manifest.kpis.useful.toFixed(4)],
    ["loss_kW", manifest.kpis.loss.toFixed(4)],
    ["efficiency", (manifest.kpis.efficiency * 100).toFixed(3)],
    ["conservation", manifest.conservation.ok ? "PASS" : "FAIL"],
    [],
    ["interval", "grid_kW", "pv_kW", "total_kW", "kWh", "filled", "corrected"],
  ];
  const rows = snapshot.aggregate.hasData
    ? snapshot.aggregate.intervals.map((interval) => [
      interval.time,
      interval.gridPower.toFixed(4),
      interval.pvPower.toFixed(4),
      interval.totalPower.toFixed(4),
      interval.kwh.toFixed(4),
      interval.filled,
      interval.corrected,
    ])
    : [];
  const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [...metadata, ...rows].map((row) => row.map(cell).join(",")).join("\n");
}
