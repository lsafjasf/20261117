export const DATA_DATE = "2026-11-17";

export const AIRLINES = {
  CA: { code: "CA", name: "中国国航", short: "国航", color: "#f26479" },
  MU: { code: "MU", name: "中国东航", short: "东航", color: "#59d7e8" },
  CZ: { code: "CZ", name: "中国南航", short: "南航", color: "#7fca6b" },
  HU: { code: "HU", name: "海南航空", short: "海航", color: "#f2b84b" },
  "3U": { code: "3U", name: "四川航空", short: "川航", color: "#9a8df5" },
};

export const AIRPORTS = {
  PEK: { code: "PEK", name: "北京首都", city: "北京", lat: 40.08, lon: 116.58 },
  PVG: { code: "PVG", name: "上海浦东", city: "上海", lat: 31.14, lon: 121.8 },
  SHA: { code: "SHA", name: "上海虹桥", city: "上海", lat: 31.2, lon: 121.34 },
  CAN: { code: "CAN", name: "广州白云", city: "广州", lat: 23.39, lon: 113.3 },
  SZX: { code: "SZX", name: "深圳宝安", city: "深圳", lat: 22.64, lon: 114.06 },
  CTU: { code: "CTU", name: "成都双流", city: "成都", lat: 30.58, lon: 103.95 },
  TFU: { code: "TFU", name: "成都天府", city: "成都", lat: 30.32, lon: 104.44 },
  CKG: { code: "CKG", name: "重庆江北", city: "重庆", lat: 29.72, lon: 106.64 },
  XIY: { code: "XIY", name: "西安咸阳", city: "西安", lat: 34.44, lon: 108.75 },
  HGH: { code: "HGH", name: "杭州萧山", city: "杭州", lat: 30.23, lon: 120.45 },
  WUH: { code: "WUH", name: "武汉天河", city: "武汉", lat: 30.78, lon: 114.21 },
  KMG: { code: "KMG", name: "昆明长水", city: "昆明", lat: 25.1, lon: 102.93 },
  XMN: { code: "XMN", name: "厦门高崎", city: "厦门", lat: 24.54, lon: 118.13 },
  TAO: { code: "TAO", name: "青岛胶东", city: "青岛", lat: 36.27, lon: 120.37 },
  NKG: { code: "NKG", name: "南京禄口", city: "南京", lat: 31.74, lon: 118.86 },
};

export const WINDOWS = [
  { id: "morning", label: "早间", range: "06:00–10:00", start: 360, end: 600 },
  { id: "midday", label: "午间", range: "10:00–14:00", start: 600, end: 840 },
  { id: "evening", label: "晚间", range: "14:00–18:00", start: 840, end: 1080 },
  { id: "night", label: "夜间", range: "18:00–22:00", start: 1080, end: 1320 },
];

const ROUTES = [
  ["PEK", "PVG", "MU", 22],
  ["PEK", "CAN", "CA", 17],
  ["PVG", "CTU", "MU", 34],
  ["CAN", "HGH", "CZ", 12],
  ["SZX", "PEK", "HU", 27],
  ["CTU", "SHA", "3U", 31],
  ["KMG", "CAN", "CZ", 38],
  ["WUH", "PEK", "CA", 9],
  ["XIY", "SZX", "HU", 42],
  ["XMN", "PVG", "MU", 19],
  ["CKG", "PVG", "3U", 36],
  ["HGH", "CAN", "CZ", 14],
  ["TAO", "SHA", "CA", 25],
  ["NKG", "CTU", "MU", 29],
  ["TFU", "SZX", "3U", 33],
  ["PEK", "HGH", "HU", 20],
  ["SZX", "SHA", "CZ", 18],
  ["CAN", "NKG", "MU", 26],
];

const DELAY_VARIATION = [-6, -8, 2, 9, 18, 29, -4, 44, 12, -2, 23, 7];
const AIRLINE_ROTATION = ["CA", "MU", "CZ", "HU", "3U", "MU", "CA", "CZ", "3U", "HU", "CA", "MU"];
const ROUTE_SEQUENCE = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1,
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function minutesToTime(totalMinutes) {
  const minutes = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function timeToMinutes(time) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function createFlight(window, windowIndex, index) {
  const routeIndex = ROUTE_SEQUENCE[index];
  const [origin, destination, airlineCode, baseDelay] = ROUTES[routeIndex];
  const code = AIRLINE_ROTATION[(index + windowIndex * 2) % AIRLINE_ROTATION.length];
  const airline = AIRLINES[code];
  const airlineFromRoute = index % 3 === 0 ? airlineCode : code;
  const delayMin = baseDelay + DELAY_VARIATION[(index + windowIndex * 3) % DELAY_VARIATION.length];
  const scheduledMinutes = window.start + 8 + index * 9;
  const cancelled = (windowIndex * 18 + index) % 19 === 6;
  const status = cancelled ? "取消" : delayMin > 15 ? "延误" : "准点";

  return {
    flightKey: `${DATA_DATE}|${airlineFromRoute}${windowIndex + 1}${pad(index + 1)}`,
    flightNo: `${airlineFromRoute}${windowIndex + 1}${pad(index + 1)}`,
    date: DATA_DATE,
    airline: airlineFromRoute,
    airlineName: AIRLINES[airlineFromRoute]?.name ?? airline.name,
    origin,
    destination,
    scheduled: minutesToTime(scheduledMinutes),
    scheduledMinutes,
    actual: cancelled ? null : minutesToTime(scheduledMinutes + delayMin),
    delayMin: cancelled ? null : delayMin,
    status,
    sourceWindow: window.id,
  };
}

export const NORMAL_FLIGHTS = WINDOWS.flatMap((window, windowIndex) =>
  Array.from({ length: ROUTE_SEQUENCE.length }, (_, index) =>
    createFlight(window, windowIndex, index),
  ),
);

function cloneFlights(flights) {
  return flights.map((flight) => ({ ...flight }));
}

function setDelay(flight, delayMin, options = {}) {
  return {
    ...flight,
    delayMin,
    actual: delayMin == null ? null : minutesToTime(flight.scheduledMinutes + delayMin),
    status: options.status ?? (delayMin > 15 ? "延误" : "准点"),
    injectedIssue: options.issue ?? null,
  };
}

function withDuplicate(flights, index, onDuplicate) {
  const source = flights[index];
  const duplicate = onDuplicate({ ...source, duplicateOf: source.flightKey });
  return [...flights.slice(0, index + 1), duplicate, ...flights.slice(index + 1)];
}

function buildMissingFlights() {
  let flights = cloneFlights(NORMAL_FLIGHTS);
  const missingIndexes = [8, 29, 57];
  for (const index of missingIndexes) {
    flights[index] = setDelay(flights[index], null, {
      status: flights[index].status === "取消" ? "取消" : "准点",
      issue: "missing-delay",
    });
  }
  flights = withDuplicate(flights, 14, (duplicate) => ({
    ...duplicate,
    duplicateOf: duplicate.flightKey,
    injectedIssue: "duplicate",
  }));
  return flights;
}

function buildAnomalousFlights() {
  let flights = cloneFlights(NORMAL_FLIGHTS);
  flights[3] = setDelay(flights[3], -24, { status: "延误", issue: "negative-delay" });
  flights[24] = setDelay(flights[24], 999, { status: "延误", issue: "outlier-delay" });
  flights[41] = setDelay(flights[41], null, { status: "延误", issue: "missing-delay" });
  flights[62] = setDelay(flights[62], null, { status: "准点", issue: "missing-delay" });
  flights = withDuplicate(flights, 7, (duplicate) => ({
    ...duplicate,
    delayMin: duplicate.delayMin == null ? null : duplicate.delayMin + 6,
    injectedIssue: "duplicate-conflict",
  }));
  flights = withDuplicate(flights, 35, (duplicate) => ({
    ...duplicate,
    status: "取消",
    delayMin: null,
    actual: null,
    injectedIssue: "duplicate-cancel",
  }));
  return flights;
}

export const SCENARIOS = {
  normal: {
    id: "normal",
    label: "正常数据",
    note: "基线数据完整；仍执行同一套去重、补缺与聚合逻辑。",
    flights: cloneFlights(NORMAL_FLIGHTS),
  },
  missing: {
    id: "missing",
    label: "缺失数据",
    note: "含 1 条重复和 3 个缺失延误值，用分层中位数补缺。",
    flights: buildMissingFlights(),
  },
  anomalous: {
    id: "anomalous",
    label: "异常数据",
    note: "含冲突重复、取消重复、负延误与 999 分钟异常值。",
    flights: buildAnomalousFlights(),
  },
};

export function getScenario(id) {
  return SCENARIOS[id] ?? SCENARIOS.normal;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function routeKey(flight) {
  return `${flight.origin}-${flight.destination}`;
}

function fallbackMedian(groups, keys) {
  for (const key of keys) {
    const values = groups.get(key);
    if (values?.length) return median(values);
  }
  return null;
}

export function processFlights(rawFlights) {
  const duplicatesRemoved = { value: 0 };
  const byFlightKey = new Map();

  for (const raw of rawFlights) {
    if (byFlightKey.has(raw.flightKey)) duplicatesRemoved.value += 1;
    byFlightKey.set(raw.flightKey, {
      ...raw,
      airlineName: AIRLINES[raw.airline]?.name ?? raw.airlineName ?? raw.airline,
      routeKey: routeKey(raw),
    });
  }

  const accepted = [...byFlightKey.values()].sort(
    (a, b) => a.scheduledMinutes - b.scheduledMinutes || a.flightNo.localeCompare(b.flightNo),
  );
  const validByAirlineRoute = new Map();
  const validByRoute = new Map();
  const validByAirline = new Map();
  const allValid = [];
  let missingDelayCount = 0;
  let invalidDelayCount = 0;
  let cancellationCount = 0;

  for (const flight of accepted) {
    const cancelled = flight.status === "取消" || flight.status === "cancelled";
    if (cancelled) {
      cancellationCount += 1;
      continue;
    }
    if (flight.delayMin == null) {
      missingDelayCount += 1;
      continue;
    }
    if (!Number.isFinite(flight.delayMin) || flight.delayMin < 0 || flight.delayMin > 720) {
      invalidDelayCount += 1;
      continue;
    }
    const airlineRoute = `${flight.airline}|${flight.routeKey}`;
    if (!validByAirlineRoute.has(airlineRoute)) validByAirlineRoute.set(airlineRoute, []);
    if (!validByRoute.has(flight.routeKey)) validByRoute.set(flight.routeKey, []);
    if (!validByAirline.has(flight.airline)) validByAirline.set(flight.airline, []);
    validByAirlineRoute.get(airlineRoute).push(flight.delayMin);
    validByRoute.get(flight.routeKey).push(flight.delayMin);
    validByAirline.get(flight.airline).push(flight.delayMin);
    allValid.push(flight.delayMin);
  }

  let repairedMissing = 0;
  let repairedInvalid = 0;
  const flights = accepted.map((flight) => {
    const cancelled = flight.status === "取消" || flight.status === "cancelled";
    if (cancelled) {
      return {
        ...flight,
        cancelled: true,
        status: "取消",
        delayMinFinal: null,
        delaySource: "cancelled",
        qualityFlag: null,
      };
    }

    const missing = flight.delayMin == null;
    const invalid =
      !missing &&
      (!Number.isFinite(flight.delayMin) || flight.delayMin < 0 || flight.delayMin > 720);
    if (!missing && !invalid) {
      return {
        ...flight,
        cancelled: false,
        status: flight.delayMin > 15 ? "延误" : "准点",
        delayMinFinal: flight.delayMin,
        delaySource: "raw",
        qualityFlag: null,
      };
    }

    if (missing) repairedMissing += 1;
    if (invalid) repairedInvalid += 1;
    const airlineRoute = `${flight.airline}|${flight.routeKey}`;
    const imputed =
      fallbackMedian(validByAirlineRoute, [airlineRoute]) ??
      fallbackMedian(validByRoute, [flight.routeKey]) ??
      fallbackMedian(validByAirline, [flight.airline]) ??
      median(allValid) ??
      0;

    return {
      ...flight,
      cancelled: false,
      status: imputed > 15 ? "延误" : "准点",
      delayMinFinal: imputed,
      delaySource: missing ? "imputed-missing" : "imputed-invalid",
      qualityFlag: invalid ? "invalid-repaired" : "missing-repaired",
    };
  });

  const dates = [...new Set(flights.map((flight) => flight.date))].sort();
  return {
    flights,
    quality: {
      sourceRows: rawFlights.length,
      accepted: flights.length,
      duplicatesRemoved: duplicatesRemoved.value,
      missingDelayCount,
      invalidDelayCount,
      repairedMissing,
      repairedInvalid,
      cancellationCount,
      dateFrom: dates[0] ?? null,
      dateTo: dates.at(-1) ?? null,
    },
  };
}

export function filterFlights(flights, filters) {
  const airlineSet = new Set(filters.airlines ?? []);
  return flights.filter(
    (flight) =>
      airlineSet.has(flight.airline) &&
      flight.scheduledMinutes >= filters.start &&
      flight.scheduledMinutes < filters.end,
  );
}

export function aggregateRoutes(flights) {
  const groups = new Map();
  for (const flight of flights) {
    if (!groups.has(flight.routeKey)) {
      groups.set(flight.routeKey, []);
    }
    groups.get(flight.routeKey).push(flight);
  }

  return [...groups.entries()]
    .map(([key, routeFlights]) => {
      const cancelledCount = routeFlights.filter((flight) => flight.cancelled).length;
      const activeFlights = routeFlights.filter((flight) => !flight.cancelled);
      const delaySum = activeFlights.reduce((sum, flight) => sum + flight.delayMinFinal, 0);
      const avgDelay = activeFlights.length ? delaySum / activeFlights.length : null;
      return {
        key,
        origin: routeFlights[0].origin,
        destination: routeFlights[0].destination,
        flights: routeFlights,
        count: routeFlights.length,
        activeCount: activeFlights.length,
        cancelledCount,
        cancelRate: cancelledCount / routeFlights.length,
        avgDelay,
        onTimeCount: activeFlights.filter((flight) => flight.delayMinFinal <= 15).length,
      };
    })
    .sort((a, b) => b.count - a.count || (b.avgDelay ?? -1) - (a.avgDelay ?? -1));
}

export function buildTrendBins(flights, window) {
  const binMinutes = 30;
  const bins = Array.from({ length: Math.ceil((window.end - window.start) / binMinutes) }, (_, i) => {
    const start = window.start + i * binMinutes;
    return {
      start,
      end: Math.min(start + binMinutes, window.end),
      label: minutesToTime(start),
      count: 0,
      cancelled: 0,
      delaySum: 0,
      activeCount: 0,
    };
  });

  for (const flight of flights) {
    const index = Math.floor((flight.scheduledMinutes - window.start) / binMinutes);
    const bin = bins[Math.max(0, Math.min(index, bins.length - 1))];
    if (!bin) continue;
    bin.count += 1;
    if (flight.cancelled) {
      bin.cancelled += 1;
    } else {
      bin.delaySum += flight.delayMinFinal;
      bin.activeCount += 1;
    }
  }

  return bins.map((bin) => ({
    ...bin,
    avgDelay: bin.activeCount ? bin.delaySum / bin.activeCount : null,
  }));
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function buildSnapshot({ scenarioId, windowId, airlines }) {
  const scenario = getScenario(scenarioId);
  const window = WINDOWS.find((item) => item.id === windowId) ?? WINDOWS[0];
  const processed = processFlights(scenario.flights);
  const flights = filterFlights(processed.flights, {
    airlines,
    start: window.start,
    end: window.end,
  });
  const routes = aggregateRoutes(flights);
  const activeFlights = flights.filter((flight) => !flight.cancelled);
  const cancelledFlights = flights.filter((flight) => flight.cancelled);
  const delaySum = activeFlights.reduce((sum, flight) => sum + flight.delayMinFinal, 0);
  const avgDelay = activeFlights.length ? delaySum / activeFlights.length : null;
  const onTimeCount = activeFlights.filter((flight) => flight.delayMinFinal <= 15).length;
  const signatureBase = flights
    .map(
      (flight) =>
        `${flight.flightKey}:${flight.delayMinFinal ?? "C"}:${flight.delaySource}:${flight.airline}`,
    )
    .join("|");
  const viewSignature = fnv1a(`${scenarioId}|${windowId}|${airlines.join(",")}|${signatureBase}`);
  const dataSignature = fnv1a(signatureBase || scenarioId);

  return {
    scenarioId,
    scenarioLabel: scenario.label,
    scenarioNote: scenario.note,
    date: DATA_DATE,
    window,
    airlines: [...airlines],
    flights,
    routes,
    trend: buildTrendBins(flights, window),
    quality: processed.quality,
    summary: {
      flights: flights.length,
      active: activeFlights.length,
      routes: routes.length,
      cancelled: cancelledFlights.length,
      cancelRate: flights.length ? cancelledFlights.length / flights.length : 0,
      avgDelay,
      onTimeRate: activeFlights.length ? onTimeCount / activeFlights.length : null,
    },
    dataVersion: `D-${dataSignature.slice(0, 6)}`,
    viewVersion: `V-${viewSignature.slice(0, 6)}`,
  };
}

export function formatWindow(window) {
  return `${window.range} CST`;
}

export function formatFlightTime(flight) {
  return {
    scheduled: flight.scheduled,
    actual: flight.cancelled ? "—" : flight.actual ?? "—",
  };
}

export { routeKey };
