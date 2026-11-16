export const STORAGE_KEY = "isometric-plaza.draft.v1";
export const SAVED_KEY = "isometric-plaza.saved.v1";
export const DEFAULT_SEED = 20261117;
export const PLAZA_HALF = 6.7;
export const PATH_HALF = 1.12;
export const BED_SIZE = 3.65;
export const PLANT_COUNT_PER_BED = 58;
export const SEASONS = ["spring", "summer", "autumn", "winter"];
export const SEASON_LABELS = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };

export const BEDS = [
  { id: "bed-nw", x: -3.28, z: -3.28, rotation: 0 },
  { id: "bed-ne", x: 3.28, z: -3.28, rotation: 0 },
  { id: "bed-sw", x: -3.28, z: 3.28, rotation: 0 },
  { id: "bed-se", x: 3.28, z: 3.28, rotation: 0 }
];

export const BENCH_IDS = ["bench-a", "bench-b", "bench-c"];

export const DEFAULT_STATE = Object.freeze({
  version: 1,
  seed: DEFAULT_SEED,
  season: "spring",
  view: { angle: 0, zoom: 1 },
  paused: false,
  layers: {
    ground: true,
    paths: true,
    beds: true,
    plants: true,
    benches: true,
    decor: true
  },
  benches: [
    { id: "bench-a", x: 0.78, z: -3.7, rotation: 90 },
    { id: "bench-b", x: -0.78, z: 3.7, rotation: -90 },
    { id: "bench-c", x: 3.7, z: 0.78, rotation: 180 }
  ]
});

export class SceneValidationError extends Error {
  constructor(issues) {
    super(issues.join("；"));
    this.name = "SceneValidationError";
    this.issues = issues;
  }
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isPointOnPath(x, z, margin = 0) {
  const reach = PLAZA_HALF - 0.25 + margin;
  const half = PATH_HALF + margin;
  return (
    (Math.abs(x) <= half && Math.abs(z) <= reach) ||
    (Math.abs(z) <= half && Math.abs(x) <= reach)
  );
}

export function pointInsideBed(x, z, inset = 0) {
  return BEDS.some((bed) => (
    Math.abs(x - bed.x) <= BED_SIZE / 2 - inset &&
    Math.abs(z - bed.z) <= BED_SIZE / 2 - inset
  ));
}

export function createScene(seed = DEFAULT_SEED) {
  const safeSeed = normalizeSeed(seed);
  const random = mulberry32(safeSeed);
  const beds = BEDS.map((bed, index) => {
    const plants = [];
    let attempts = 0;
    while (plants.length < PLANT_COUNT_PER_BED && attempts < PLANT_COUNT_PER_BED * 30) {
      attempts += 1;
      const x = bed.x + (random() - 0.5) * (BED_SIZE - 0.7);
      const z = bed.z + (random() - 0.5) * (BED_SIZE - 0.7);
      const pathClear = !isPointOnPath(x, z, 0.3);
      const bedClear = pointInsideBed(x, z, 0.28);
      if (!pathClear || !bedClear) continue;
      const typeRoll = random();
      const type = typeRoll < 0.17 ? "shrub" : typeRoll < 0.31 ? "grass" : "flower";
      plants.push({
        id: `${bed.id}-plant-${plants.length}`,
        x: round(x, 4),
        z: round(z, 4),
        height: type === "shrub" ? 0.55 + random() * 0.25 : type === "grass" ? 0.35 + random() * 0.3 : 0.32 + random() * 0.45,
        size: 0.65 + random() * 0.55,
        tone: Math.floor(random() * 5),
        phase: round(random() * Math.PI * 2, 4),
        type
      });
    }
    return {
      ...bed,
      width: BED_SIZE,
      depth: BED_SIZE,
      plantCount: plants.length,
      plants
    };
  });
  return { seed: safeSeed, beds, plantCount: beds.reduce((sum, bed) => sum + bed.plants.length, 0) };
}

export function cloneDefaultState() {
  return structuredClone(DEFAULT_STATE);
}

export function normalizeSeed(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 4294967295) {
    throw new SceneValidationError(["seed 必须是 1–4294967295 之间的整数"]);
  }
  return number;
}

export function validateState(input) {
  const issues = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SceneValidationError(["场景参数必须是对象"]);
  }
  try {
    normalizeSeed(input.seed);
  } catch (error) {
    issues.push(...error.issues);
  }
  if (!SEASONS.includes(input.season)) issues.push("season 必须为 spring、summer、autumn 或 winter");
  if (!input.view || typeof input.view !== "object") {
    issues.push("缺少 view 视角参数");
  } else {
    if (!Number.isFinite(input.view.angle) || input.view.angle < -180 || input.view.angle > 180) {
      issues.push("视角 angle 必须在 -180°–180° 之间");
    }
    if (!Number.isFinite(input.view.zoom) || input.view.zoom < 0.65 || input.view.zoom > 1.45) {
      issues.push("缩放 zoom 必须在 0.65–1.45 之间");
    }
  }
  if (!input.layers || typeof input.layers !== "object") {
    issues.push("缺少图层设置");
  } else {
    for (const layer of ["ground", "paths", "beds", "plants", "benches", "decor"]) {
      if (typeof input.layers[layer] !== "boolean") issues.push(`图层 ${layer} 必须为布尔值`);
    }
  }
  if (typeof input.paused !== "boolean") issues.push("paused 必须为布尔值");
  if (!Array.isArray(input.benches) || input.benches.length !== BENCH_IDS.length) {
    issues.push("必须保留 3 张长椅");
  } else {
    const seen = new Set();
    for (const bench of input.benches) {
      if (!BENCH_IDS.includes(bench.id)) {
        issues.push(`未知长椅 ${String(bench.id)}`);
        continue;
      }
      if (seen.has(bench.id)) issues.push(`长椅 ${bench.id} 重复`);
      seen.add(bench.id);
      if (!isPointOnPath(bench.x, bench.z, 0.02)) {
        issues.push(`长椅 ${bench.id} 必须位于步道上`);
      }
      if (!Number.isFinite(bench.x) || !Number.isFinite(bench.z) || Math.abs(bench.x) > 5.8 || Math.abs(bench.z) > 5.8) {
        issues.push(`长椅 ${bench.id} 超出广场范围`);
      }
      if (!Number.isFinite(bench.rotation) || bench.rotation < -180 || bench.rotation > 180) {
        issues.push(`长椅 ${bench.id} 的 rotation 必须在 -180°–180° 之间`);
      }
    }
  }
  if (issues.length) throw new SceneValidationError(issues);
  return structuredClone(input);
}

export function sanitizeLoadedState(value, fallback = DEFAULT_STATE) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { state: cloneDefaultState(), error: "存档格式损坏：顶层必须为对象" };
  }
  try {
    const merged = mergeState(fallback, value);
    return { state: validateState(merged), error: null };
  } catch (error) {
    return {
      state: cloneDefaultState(),
      error: error instanceof SceneValidationError ? error.message : "存档格式损坏"
    };
  }
}

export function mergeState(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return structuredClone(base);
  return {
    ...structuredClone(base),
    ...structuredClone(patch),
    view: { ...base.view, ...(patch.view || {}) },
    layers: { ...base.layers, ...(patch.layers || {}) },
    benches: Array.isArray(patch.benches) ? structuredClone(patch.benches) : structuredClone(base.benches)
  };
}

export function nearestPathPoint(x, z) {
  const clamped = clampPlaza(x, z);
  const vertical = {
    x: clamp(Math.abs(clamped.x) < 0.32 ? 0 : Math.sign(clamped.x) * 0.8, -0.82, 0.82),
    z: clamp(clamped.z, -5.7, 5.7)
  };
  const horizontal = {
    x: clamp(clamped.x, -5.7, 5.7),
    z: clamp(Math.abs(clamped.z) < 0.32 ? 0 : Math.sign(clamped.z) * 0.8, -0.82, 0.82)
  };
  const dv = (clamped.x - vertical.x) ** 2 + (clamped.z - vertical.z) ** 2;
  const dh = (clamped.x - horizontal.x) ** 2 + (clamped.z - horizontal.z) ** 2;
  return dv < dh ? vertical : horizontal;
}

export function clampPlaza(x, z) {
  return {
    x: clamp(Number.isFinite(x) ? x : 0, -5.75, 5.75),
    z: clamp(Number.isFinite(z) ? z : 0, -5.75, 5.75)
  };
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
