export const DATA_VERSION = "QC-2026.11.17 · r3";
export const SAMPLE_MINUTES = 5;

export const WINDOWS = [
  {
    id: "w0708",
    label: "07:00 — 08:00",
    compact: "07:00–08:00",
    name: "早高峰前",
    start: "07:00",
    end: "08:00",
    peak: 0.76,
  },
  {
    id: "w0809",
    label: "08:00 — 09:00",
    compact: "08:00–09:00",
    name: "早高峰",
    start: "08:00",
    end: "09:00",
    peak: 0.91,
  },
  {
    id: "w1718",
    label: "17:00 — 18:00",
    compact: "17:00–18:00",
    name: "晚高峰",
    start: "17:00",
    end: "18:00",
    peak: 0.84,
  },
  {
    id: "w2223",
    label: "22:00 — 23:00",
    compact: "22:00–23:00",
    name: "夜间平峰",
    start: "22:00",
    end: "23:00",
    peak: 0.15,
  },
];

export const DIRECTIONS = [
  { id: "all", label: "全部方向", short: "全部", arrow: "↔", factor: 1 },
  { id: "east-west", label: "东→西", short: "东→西", arrow: "←", factor: 1.04 },
  { id: "west-east", label: "西→东", short: "西→东", arrow: "→", factor: 1.01 },
  { id: "south-north", label: "南→北", short: "南→北", arrow: "↑", factor: 0.96 },
  { id: "north-south", label: "北→南", short: "北→南", arrow: "↓", factor: 0.99 },
];

export const GRADES = [
  { id: "expressway", label: "快速路", short: "快速", freeFlow: 80, color: "#6d94ca" },
  { id: "arterial", label: "主干路", short: "主干", freeFlow: 58, color: "#d0a454" },
  { id: "secondary", label: "次干路", short: "次干", freeFlow: 42, color: "#9aa8a0" },
];

const N = {
  A: { x: 80, y: 92 },
  B: { x: 280, y: 100 },
  C: { x: 500, y: 96 },
  D: { x: 720, y: 106 },
  E: { x: 900, y: 100 },
  F: { x: 80, y: 210 },
  G: { x: 280, y: 215 },
  H: { x: 500, y: 207 },
  I: { x: 720, y: 211 },
  J: { x: 900, y: 200 },
  K: { x: 80, y: 320 },
  L: { x: 280, y: 322 },
  M: { x: 500, y: 316 },
  NN: { x: 720, y: 311 },
  O: { x: 900, y: 320 },
  P: { x: 100, y: 430 },
  Q: { x: 280, y: 424 },
  R: { x: 500, y: 425 },
  S: { x: 720, y: 425 },
  T: { x: 880, y: 430 },
  U: { x: 120, y: 540 },
  V: { x: 300, y: 540 },
  W: { x: 500, y: 535 },
  X: { x: 680, y: 540 },
  Y: { x: 860, y: 530 },
};

function points(...items) {
  return items.map((item) => ({ ...item }));
}

export const ROADS = [
  {
    id: "r01", name: "北环快速路", code: "N-01", grade: "expressway", direction: "east-west",
    from: "E", to: "A", freeFlow: 80, baseLoad: 0.48,
    points: points(N.A, { x: 280, y: 103 }, { x: 500, y: 105 }, { x: 720, y: 112 }, N.E),
    labelAt: { x: 372, y: 87 },
  },
  {
    id: "r02", name: "延安高架", code: "E-02", grade: "expressway", direction: "west-east",
    from: "F", to: "J", freeFlow: 76, baseLoad: 0.56,
    points: points(N.F, { x: 280, y: 205 }, { x: 500, y: 210 }, { x: 720, y: 202 }, N.J),
    labelAt: { x: 390, y: 223 },
  },
  {
    id: "r03", name: "中山大道", code: "A-03", grade: "arterial", direction: "south-north",
    from: "W", to: "C", freeFlow: 58, baseLoad: 1.18,
    points: points({ x: 500, y: 535 }, { x: 510, y: 425 }, { x: 500, y: 316 }, { x: 490, y: 207 }, N.C),
    labelAt: { x: 516, y: 352 },
  },
  {
    id: "r04", name: "滨江大道", code: "A-04", grade: "arterial", direction: "east-west",
    from: "Y", to: "U", freeFlow: 56, baseLoad: 0.58,
    points: points(N.U, { x: 300, y: 535 }, { x: 500, y: 545 }, { x: 680, y: 535 }, N.Y),
    labelAt: { x: 365, y: 560 },
  },
  {
    id: "r05", name: "人民路", code: "A-05", grade: "arterial", direction: "north-south",
    from: "B", to: "V", freeFlow: 56, baseLoad: 0.71,
    points: points(N.B, { x: 270, y: 215 }, { x: 285, y: 322 }, { x: 275, y: 424 }, N.V),
    labelAt: { x: 292, y: 374 },
  },
  {
    id: "r06", name: "建设路", code: "A-06", grade: "arterial", direction: "south-north",
    from: "X", to: "D", freeFlow: 58, baseLoad: 0.74,
    points: points(N.X, { x: 710, y: 425 }, { x: 720, y: 311 }, { x: 710, y: 211 }, N.D),
    labelAt: { x: 730, y: 374 },
  },
  {
    id: "r07", name: "和平路", code: "S-07", grade: "secondary", direction: "west-east",
    from: "K", to: "O", freeFlow: 42, baseLoad: 0.62,
    points: points(N.K, { x: 280, y: 330 }, { x: 500, y: 316 }, { x: 720, y: 300 }, N.O),
    labelAt: { x: 595, y: 332 },
  },
  {
    id: "r08", name: "解放路", code: "S-08", grade: "secondary", direction: "east-west",
    from: "T", to: "P", freeFlow: 42, baseLoad: 0.66,
    points: points(N.P, { x: 280, y: 410 }, { x: 500, y: 430 }, { x: 720, y: 440 }, N.T),
    labelAt: { x: 405, y: 455 },
  },
  {
    id: "r09", name: "湖西路", code: "S-09", grade: "secondary", direction: "north-south",
    from: "F", to: "P", freeFlow: 40, baseLoad: 0.45,
    points: points(N.F, { x: 76, y: 275 }, { x: 84, y: 360 }, N.P),
    labelAt: { x: 52, y: 390 },
  },
  {
    id: "r10", name: "湖滨路", code: "S-10", grade: "secondary", direction: "south-north",
    from: "T", to: "J", freeFlow: 42, baseLoad: 0.54,
    points: points(N.J, { x: 910, y: 270 }, { x: 900, y: 350 }, N.T),
    labelAt: { x: 920, y: 380 },
  },
  {
    id: "r11", name: "科技路", code: "S-11", grade: "secondary", direction: "north-south",
    from: "G", to: "Q", freeFlow: 40, baseLoad: 0.49,
    points: points(N.G, { x: 276, y: 280 }, { x: 282, y: 350 }, N.Q),
    labelAt: { x: 294, y: 302 },
  },
  {
    id: "r12", name: "望江路", code: "S-12", grade: "secondary", direction: "south-north",
    from: "S", to: "I", freeFlow: 42, baseLoad: 0.61,
    points: points(N.I, { x: 718, y: 270 }, { x: 714, y: 350 }, N.S),
    labelAt: { x: 730, y: 330 },
  },
  {
    id: "r13", name: "西环高架", code: "E-13", grade: "expressway", direction: "north-south",
    from: "A", to: "K", freeFlow: 78, baseLoad: 0.52,
    points: points(N.A, { x: 74, y: 160 }, { x: 76, y: 255 }, N.K),
    labelAt: { x: 88, y: 242 },
  },
  {
    id: "r14", name: "江湾路", code: "S-14", grade: "secondary", direction: "south-north",
    from: "O", to: "E", freeFlow: 42, baseLoad: 0.57,
    points: points(N.E, { x: 905, y: 180 }, { x: 900, y: 250 }, N.O),
    labelAt: { x: 916, y: 252 },
  },
];

export const ROAD_BY_ID = Object.fromEntries(ROADS.map((road) => [road.id, road]));
export const GRADE_BY_ID = Object.fromEntries(GRADES.map((grade) => [grade.id, grade]));
export const DIRECTION_BY_ID = Object.fromEntries(DIRECTIONS.map((direction) => [direction.id, direction]));
export const WINDOW_BY_ID = Object.fromEntries(WINDOWS.map((window) => [window.id, window]));

export const CLOSURES = {
  w0708: [
    { roadId: "r11", from: "07:10", to: "08:00", reason: "管线抢修" },
  ],
  w0809: [
    { roadId: "r06", from: "08:20", to: "09:00", reason: "事故处置" },
  ],
  w1718: [
    { roadId: "r07", from: "17:00", to: "17:45", reason: "桥梁检修" },
    { roadId: "r12", from: "17:20", to: "18:00", reason: "临时管制" },
  ],
  w2223: [],
};

export const DATASETS = [
  { id: "normal", label: "正常", description: "完整基线" },
  { id: "missing", label: "缺失", description: "重复与空值" },
  { id: "anomaly", label: "异常", description: "越界与坏时间" },
];

function hashNoise(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function sampleTime(window, sampleIndex) {
  const startHour = Number(window.start.slice(0, 2));
  const startMinute = Number(window.start.slice(3, 5));
  const total = startHour * 60 + startMinute + sampleIndex * SAMPLE_MINUTES;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

function rushShape(window, ratio) {
  const peak = window.peak;
  if (window.id === "w2223") {
    return peak + Math.sin(ratio * Math.PI) * 0.08;
  }
  const center = window.id === "w0809" ? 0.44 : window.id === "w1718" ? 0.61 : 0.58;
  const bell = Math.exp(-Math.pow((ratio - center) / 0.31, 2));
  return 0.36 + peak * bell * 0.78;
}

function baselineRows() {
  const rows = [];
  for (const window of WINDOWS) {
    for (const road of ROADS) {
      const directionFactor = DIRECTION_BY_ID[road.direction].factor;
      for (let sampleIndex = 0; sampleIndex < 12; sampleIndex += 1) {
        const time = sampleTime(window, sampleIndex);
        const ratio = sampleIndex / 11;
        const noise = hashNoise(`${road.id}:${window.id}:${sampleIndex}`) - 0.5;
        const congestion = clamp(
          rushShape(window, ratio) * 0.48 + road.baseLoad * 0.52 * directionFactor + noise * 0.09,
          0.04,
          0.99,
        );
        const speed = clamp(road.freeFlow * (1 - congestion * 0.72) + noise * 2.2, 5, road.freeFlow);
        const queue = Math.max(0, Math.round(Math.pow(congestion, 1.85) * 190 + noise * 13));
        const volume = Math.max(80, Math.round(300 + congestion * 1740 + noise * 90));
        rows.push({
          roadId: road.id,
          windowId: window.id,
          timestamp: `2026-11-17 ${time}`,
          direction: road.direction,
          speed: Number(speed.toFixed(1)),
          queue,
          volume,
        });
      }
    }
  }
  return rows;
}

export function buildRawDataset(datasetId) {
  const base = baselineRows();
  if (datasetId === "normal") {
    return base.map((row) => ({ ...row }));
  }

  const rows = [];
  base.forEach((row, index) => {
    const copy = { ...row };
    if (datasetId === "missing") {
      if (index % 17 === 0) copy.speed = null;
      if (index % 19 === 0) copy.queue = null;
      if (index % 23 === 0) copy.volume = null;
    }

    if (datasetId === "anomaly") {
      if (index % 29 === 0) copy.speed = -12;
      if (index % 31 === 0) copy.speed = 999;
      if (index % 23 === 0) copy.queue = -45;
      if (index % 27 === 0) copy.queue = 2350;
      if (index % 43 === 0) copy.timestamp = "2026-13-40 25:88";
      if (index % 67 === 0) copy.direction = "unknown";
    }

    rows.push(copy);

    if (index % 17 === 0 || index % 37 === 0) {
      rows.push({
        ...copy,
        speed: copy.speed == null ? null : Number(copy.speed) + 0.4,
        queue: copy.queue == null ? null : Number(copy.queue) + 3,
      });
    }
  });
  return rows;
}
