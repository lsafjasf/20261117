export const PROJECT_VERSION = 1;
export const STORAGE_KEY = "folio-cover-studio.project.v1";
export const HISTORY_LIMIT = 80;

export const SIZE_LIMITS = {
  minWidth: 120,
  maxWidth: 4000,
  minHeight: 180,
  maxHeight: 6000,
};

export const FONT_STACKS = {
  serif:
    '"Folio Serif", "Iowan Old Style", Baskerville, Georgia, "Times New Roman", "Noto Serif SC", "Songti SC", serif',
  display:
    '"Folio Sans", "Arial Black", Impact, "Helvetica Neue", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  sans:
    '"Folio Sans", "Avenir Next", Avenir, "Helvetica Neue", Arial, "Noto Sans SC", "Microsoft YaHei", sans-serif',
  mono:
    '"Courier New", "SFMono-Regular", Consolas, "Folio Sans", "Noto Sans Mono CJK SC", monospace',
};

export const FONT_EMBEDS = {
  serif: {
    family: "Folio Serif",
    file: "NotoSerifSC-cjk.woff2",
  },
  display: {
    family: "Folio Sans",
    file: "NotoSansSC-cjk.woff2",
  },
  sans: {
    family: "Folio Sans",
    file: "NotoSansSC-cjk.woff2",
  },
  mono: {
    family: "Folio Sans",
    file: "NotoSansSC-cjk.woff2",
  },
};

export const SIZE_PRESETS = {
  standard: { width: 1200, height: 1800 },
  pocket: { width: 600, height: 900 },
  mini: { width: 240, height: 360 },
};

export const PALETTES = [
  { name: "松林", background: "#153a35", ink: "#f7eedb", accent: "#e0a458" },
  { name: "陶土", background: "#8e3f2c", ink: "#f9ead7", accent: "#f0bd6b" },
  { name: "午夜", background: "#17233f", ink: "#eef2fb", accent: "#7eb7d6" },
  { name: "沙丘", background: "#d8c6a4", ink: "#2c2b25", accent: "#9d5d3d" },
  { name: "石墨", background: "#252825", ink: "#f1efe7", accent: "#c5d184" },
  { name: "樱纸", background: "#f0e5df", ink: "#3d2927", accent: "#bd5d67" },
];

const BASE_DESIGN = {
  version: PROJECT_VERSION,
  title: "The Quiet Atlas",
  author: "MARA CHEN",
  size: {
    preset: "standard",
    width: 1200,
    height: 1800,
  },
  theme: {
    background: "#153a35",
    ink: "#f7eedb",
    accent: "#e0a458",
  },
  grid: {
    columns: 6,
    rows: 9,
    margin: 0.08,
    showGrid: true,
    showSafe: true,
  },
  typography: {
    font: "serif",
    titleScale: 1,
    authorScale: 1,
    lineHeight: 1.02,
    letterSpacing: 0,
    align: "left",
    autoFit: true,
  },
  illustration: {
    style: "arch",
    scale: 1,
  },
  positions: {
    title: { x: 0.02, y: 0.03, w: 0.96, h: 0.42 },
    illustration: { x: 0.55, y: 0.5, w: 0.43, h: 0.42 },
    author: { x: 0.02, y: 0.9, w: 0.6, h: 0.075 },
  },
};

const LONG_TITLE =
  "在风经过之前，所有尚未命名的城市都收藏着同一张地图，而我们在漫长的夜里学习如何阅读彼此的沉默，并把每一次告别折成可以随身携带的纸船";

export const CASES = {
  standard: {
    label: "标准案例",
    description: "1200 × 1800 · 短标题",
    design: BASE_DESIGN,
  },
  long: {
    label: "极长文本",
    description: "自动换行与字号收缩",
    design: {
      ...BASE_DESIGN,
      title: LONG_TITLE,
      author: "林照野 / 城市夜间测绘小组",
      theme: {
        background: "#17233f",
        ink: "#eef2fb",
        accent: "#7eb7d6",
      },
      typography: {
        ...BASE_DESIGN.typography,
        lineHeight: 1.08,
      },
      illustration: {
        style: "orbit",
        scale: 0.82,
      },
      positions: {
        ...BASE_DESIGN.positions,
        title: { x: 0.02, y: 0.02, w: 0.96, h: 0.55 },
        illustration: { x: 0.6, y: 0.64, w: 0.38, h: 0.28 },
        author: { x: 0.02, y: 0.92, w: 0.78, h: 0.06 },
      },
    },
  },
  mini: {
    label: "极小尺寸",
    description: "240 × 360 · 安全边距",
    design: {
      ...BASE_DESIGN,
      title: "纸上群岛",
      author: "周渡",
      size: {
        preset: "mini",
        width: 240,
        height: 360,
      },
      theme: {
        background: "#8e3f2c",
        ink: "#f9ead7",
        accent: "#f0bd6b",
      },
      grid: {
        ...BASE_DESIGN.grid,
        columns: 4,
        rows: 6,
      },
      typography: {
        ...BASE_DESIGN.typography,
        align: "center",
        authorScale: 1.25,
      },
      illustration: {
        style: "bloom",
        scale: 0.92,
      },
      positions: {
        title: { x: 0.04, y: 0.05, w: 0.92, h: 0.36 },
        illustration: { x: 0.5, y: 0.5, w: 0.44, h: 0.34 },
        author: { x: 0.19, y: 0.9, w: 0.62, h: 0.07 },
      },
    },
  },
};

function mergeDeep(base, override) {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? structuredClone(override) : structuredClone(base);
  }

  if (base && typeof base === "object") {
    const result = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(override || {})]);

    for (const key of keys) {
      if (override && Object.hasOwn(override, key)) {
        result[key] = mergeDeep(base[key], override[key]);
      } else {
        result[key] = mergeDeep(base[key], undefined);
      }
    }

    return result;
  }

  return override === undefined ? base : override;
}

export function createDesign(caseName = "standard", overrides = {}) {
  const source = CASES[caseName]?.design ?? BASE_DESIGN;
  return mergeDeep(source, overrides);
}

export function cloneDesign(design) {
  return structuredClone(design);
}

export function getFontStack(fontKey) {
  return FONT_STACKS[fontKey] ?? FONT_STACKS.serif;
}

export function getSizePreset(width, height) {
  const match = Object.entries(SIZE_PRESETS).find(
    ([, size]) => size.width === width && size.height === height,
  );
  return match?.[0] ?? "custom";
}
