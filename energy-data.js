export const DATE = "2026-11-17";

export const SLOT_MINUTES = 15;
export const SLOT_COUNT = 88;

export const METERS = {
  grid: { id: "grid", label: "市电", short: "GRID", color: "#12766f" },
  pv: { id: "pv", label: "光伏", short: "PV", color: "#d6a018" },
};

export const FLOORS = [
  { id: "1F", label: "1F", name: "首层" },
  { id: "2F", label: "2F", name: "二层" },
  { id: "3F", label: "3F", name: "三层" },
  { id: "roof", label: "RF", name: "屋顶" },
];

export const ZONES = [
  { id: "lobby", name: "大堂", floor: "1F", meter: "grid", coeff: 7.2, icon: "01" },
  { id: "retail", name: "商业", floor: "1F", meter: "grid", coeff: 14.5, icon: "02" },
  { id: "eastOffice", name: "东办公", floor: "1F", meter: "grid", coeff: 18.2, icon: "03" },
  { id: "openOffice", name: "开放办公", floor: "2F", meter: "grid", coeff: 25.4, icon: "04" },
  { id: "meeting", name: "会议区", floor: "2F", meter: "grid", coeff: 15.8, icon: "05" },
  { id: "lab", name: "研发实验", floor: "2F", meter: "grid", coeff: 22.6, icon: "06" },
  { id: "execOffice", name: "高管办公", floor: "3F", meter: "grid", coeff: 11.8, icon: "07" },
  { id: "server", name: "机房", floor: "3F", meter: "grid", coeff: 29.5, icon: "08" },
  { id: "breakRoom", name: "茶水休闲", floor: "3F", meter: "grid", coeff: 8.4, icon: "09" },
  { id: "pvArray", name: "光伏阵列", floor: "roof", meter: "pv", coeff: 72, icon: "PV" },
];

export const DATASETS = [
  {
    id: "normal",
    label: "正常日",
    short: "正常",
    description: "完整采集，作为基线",
    color: "#12766f",
  },
  {
    id: "missing",
    label: "缺失日",
    short: "缺失",
    description: "随机断点，需插值补缺",
    color: "#b97818",
  },
  {
    id: "abnormal",
    label: "异常日",
    short: "异常",
    description: "含重复、缺口与负值/尖峰",
    color: "#b94b3b",
  },
];

export const WINDOWS = [
  { id: "morning", label: "早间", range: "06:00–10:00", start: 6, end: 10, startSlot: 24, endSlot: 40 },
  { id: "midday", label: "午间", range: "10:00–14:00", start: 10, end: 14, startSlot: 40, endSlot: 56 },
  { id: "afternoon", label: "午后", range: "14:00–18:00", start: 14, end: 18, startSlot: 56, endSlot: 72 },
  { id: "evening", label: "晚间", range: "18:00–22:00", start: 18, end: 22, startSlot: 72, endSlot: 88 },
];

export const DEVICES = [
  {
    id: "hvac",
    label: "暖通主机",
    short: "HVAC",
    share: 0.39,
    efficiency: 0.86,
    color: "#1f8a84",
    service: "有效冷量",
    unit: "kW冷",
  },
  {
    id: "lighting",
    label: "照明回路",
    short: "LIGHT",
    share: 0.22,
    efficiency: 0.94,
    color: "#4e7d67",
    service: "有效照明",
    unit: "kW光",
  },
  {
    id: "plug",
    label: "插座回路",
    short: "PLUG",
    share: 0.24,
    efficiency: 0.91,
    color: "#3d6d92",
    service: "设备用电",
    unit: "kW",
  },
  {
    id: "elevator",
    label: "动力回路",
    short: "MOTION",
    share: 0.15,
    efficiency: 0.82,
    color: "#93633d",
    service: "有效运力",
    unit: "kW",
  },
];

export const DISTRIBUTION_EFFICIENCY = 0.975;

export function getWindow(id) {
  return WINDOWS.find((item) => item.id === id) || WINDOWS[0];
}

export function slotTime(slot) {
  const minutes = slot * SLOT_MINUTES;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function timeline() {
  return Array.from({ length: SLOT_COUNT }, (_, slot) => ({
    slot,
    time: slotTime(slot),
    hour: slot / 4,
  }));
}

function noise(a, b, c = 0) {
  const x = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

function occupancy(zone, hour) {
  const weekdayShape = hour < 6 ? 0.28 : hour < 8 ? 0.48 : hour < 10 ? 0.92 : hour < 12 ? 1.03 : hour < 14 ? 0.82 : hour < 18 ? 0.98 : hour < 20 ? 0.68 : 0.38;
  if (zone.id === "server") return 0.94;
  if (zone.id === "meeting") return hour >= 9 && hour < 17 ? weekdayShape : 0.24;
  if (zone.id === "retail") return hour >= 10 && hour < 21 ? Math.max(0.7, weekdayShape) : 0.2;
  if (zone.id === "lab") return hour >= 8 && hour < 20 ? Math.max(0.68, weekdayShape) : 0.36;
  if (zone.id === "breakRoom") return hour >= 7 && hour < 19 ? Math.max(0.55, weekdayShape) : 0.2;
  return weekdayShape;
}

function solarPower(hour, slot) {
  if (hour < 6 || hour >= 18) return 0;
  const arc = Math.sin(((hour - 6) / 12) * Math.PI);
  const cloud = 0.82 + noise(slot, 91) * 0.28;
  return Math.max(0, 72 * arc * cloud);
}

function valueFor(zone, slot) {
  const hour = slot / 4;
  if (zone.meter === "pv") {
    return solarPower(hour, slot);
  }
  const floorFactor = zone.floor === "1F" ? 1.04 : zone.floor === "2F" ? 1 : 0.93;
  const jitter = 0.91 + noise(slot, ZONES.indexOf(zone) + 3, 17) * 0.18;
  return zone.coeff * occupancy(zone, hour) * floorFactor * jitter;
}

function makeRecord(zone, slot, value, kind) {
  const time = slotTime(slot);
  return {
    id: `${zone.id}:${zone.meter}:${DATE}T${time}`,
    timestamp: `${DATE}T${time}`,
    date: DATE,
    time,
    slot,
    floor: zone.floor,
    zoneId: zone.id,
    zoneName: zone.name,
    meter: zone.meter,
    kwh: Number((value * (SLOT_MINUTES / 60)).toFixed(4)),
    seed: `${kind}:${zone.id}:${slot}`,
  };
}

function buildNormalRecords() {
  const records = [];
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    for (const zone of ZONES) {
      records.push(makeRecord(zone, slot, valueFor(zone, slot), "normal"));
    }
  }
  return records;
}

function buildMissingRecords() {
  return buildNormalRecords().filter((record) => {
    const zoneIndex = ZONES.findIndex((zone) => zone.id === record.zoneId);
    return noise(record.slot, zoneIndex + 11, 29) > 0.052;
  });
}

function buildAbnormalRecords() {
  const records = buildMissingRecords().filter((record) => {
    const zoneIndex = ZONES.findIndex((zone) => zone.id === record.zoneId);
    return noise(record.slot + 5, zoneIndex + 7, 41) > 0.025;
  });

  const duplicates = [
    ["eastOffice", 28],
    ["openOffice", 43],
    ["execOffice", 62],
    ["server", 79],
    ["pvArray", 54],
  ];
  for (const [zoneId, slot] of duplicates) {
    const original = records.find((record) => record.zoneId === zoneId && record.slot === slot);
    if (original) records.push({ ...original, id: `${original.id}:duplicate`, seed: `${original.seed}:dup` });
  }

  const corruptions = [
    ["eastOffice", 30, -6.4],
    ["lobby", 68, 780],
    ["lab", 46, 410],
    ["pvArray", 51, -12],
    ["server", 82, 460],
  ];
  for (const [zoneId, slot, value] of corruptions) {
    const record = records.find((item) => item.zoneId === zoneId && item.slot === slot && !item.id.endsWith("duplicate"));
    if (record) {
      record.kwh = Number((value * (SLOT_MINUTES / 60)).toFixed(4));
      record.seed = `${record.seed}:corrupt`;
    }
  }

  return records;
}

const cache = new Map();

export function getRawDataset(id) {
  if (!cache.has(id)) {
    const records = id === "missing" ? buildMissingRecords() : id === "abnormal" ? buildAbnormalRecords() : buildNormalRecords();
    cache.set(id, { ...DATASETS.find((item) => item.id === id), records });
  }
  return cache.get(id);
}
