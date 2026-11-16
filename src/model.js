import { createDefaultSchemes, normalizeHex } from "./palette.js";

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = "seamless-pattern-studio:project:v1";

export function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

const BASE_TEXT = {
  enabled: true,
  title: "同心花砖",
  subtitle: "SEAMLESS BLOOM · 2026",
  x: 0.5,
  y: 0.5,
  titleSize: 54,
  subtitleSize: 17,
  maxWidth: 286,
  lineGap: 10,
  align: "center",
  titleColorRole: "primary",
  subtitleColorRole: "secondary"
};

const BASE_MOTIF = {
  kind: "bloom",
  scale: 0.7,
  rotation: 0,
  petals: 10,
  orbitCount: 8,
  orbitRadius: 0.4,
  orbitDot: 0.017,
  showPlate: true
};

function schemaBase() {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: "同心花砖",
    canvas: {
      width: 512,
      height: 512,
      safeMargin: 32,
      zoom: 100,
      showSeams: false
    },
    palette: {
      locked: true,
      active: 0,
      rule: "analogous",
      schemes: createDefaultSchemes()
    },
    motif: clone(BASE_MOTIF),
    text: clone(BASE_TEXT),
    updatedAt: new Date().toISOString()
  };
}

export function createStandardProject() {
  return schemaBase();
}

export function createExtremeProject() {
  const project = schemaBase();
  project.name = "96px 极端长文本";
  project.canvas.width = 96;
  project.canvas.height = 96;
  project.canvas.safeMargin = 7;
  project.canvas.zoom = 220;
  project.motif.scale = 0.82;
  project.motif.petals = 12;
  project.motif.orbitCount = 12;
  project.text.title =
    "极长标题连续纹样不得裁切甲乙丙丁戊己庚辛壬癸0123456789";
  project.text.subtitle = "96PX MINIATURE · LONG UNBROKEN LABEL";
  project.text.titleSize = 22;
  project.text.subtitleSize = 8;
  project.text.maxWidth = 112;
  project.text.lineGap = 3;
  project.text.y = 0.52;
  project.palette.schemes = [
    {
      id: "mist",
      name: "晨雾",
      mode: "light",
      colors: {
        background: "#F2E9D7",
        primary: "#B5402D",
        secondary: "#1B4448",
        accent: "#D1912D"
      }
    },
    {
      id: "night",
      name: "夜航",
      mode: "dark",
      colors: {
        background: "#152E35",
        primary: "#B5402D",
        secondary: "#B2DCD1",
        accent: "#E6B95C"
      }
    },
    {
      id: "clay",
      name: "陶土",
      mode: "muted",
      colors: {
        background: "#DFC1A8",
        primary: "#B5402D",
        secondary: "#513A2B",
        accent: "#845A39"
      }
    }
  ];
  return project;
}

function numberOr(value, fallback, min = -Infinity, max = Infinity) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function textOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function normalizeScheme(scheme, fallback, index) {
  const source = scheme && typeof scheme === "object" ? scheme : {};
  const colors = source.colors && typeof source.colors === "object" ? source.colors : {};
  const fallbackColors = fallback.colors;
  return {
    id: textOr(source.id, fallback.id || `scheme-${index}`),
    name: textOr(source.name, fallback.name || `方案 ${index + 1}`),
    mode: textOr(source.mode, fallback.mode || "light"),
    colors: {
      background: normalizeHex(colors.background, fallbackColors.background),
      primary: normalizeHex(colors.primary, fallbackColors.primary),
      secondary: normalizeHex(colors.secondary, fallbackColors.secondary),
      accent: normalizeHex(colors.accent, fallbackColors.accent)
    }
  };
}

export function normalizeProject(input) {
  const base = schemaBase();
  const source = input && typeof input === "object" ? input : {};
  const canvas = source.canvas && typeof source.canvas === "object" ? source.canvas : {};
  const palette = source.palette && typeof source.palette === "object" ? source.palette : {};
  const motif = source.motif && typeof source.motif === "object" ? source.motif : {};
  const text = source.text && typeof source.text === "object" ? source.text : {};
  const sourceSchemes = Array.isArray(palette.schemes) ? palette.schemes : base.palette.schemes;
  const schemes = [0, 1, 2].map((index) =>
    normalizeScheme(sourceSchemes[index], base.palette.schemes[index], index)
  );
  const requestedActive = numberOr(palette.active, 0, 0, 2);
  return {
    schemaVersion: SCHEMA_VERSION,
    name: textOr(source.name, base.name),
    canvas: {
      width: Math.round(numberOr(canvas.width, base.canvas.width, 64, 2048)),
      height: Math.round(numberOr(canvas.height, base.canvas.height, 64, 2048)),
      safeMargin: Math.round(numberOr(canvas.safeMargin, base.canvas.safeMargin, 0, 512)),
      zoom: Math.round(numberOr(canvas.zoom, base.canvas.zoom, 25, 300)),
      showSeams: Boolean(canvas.showSeams)
    },
    palette: {
      locked: Boolean(palette.locked),
      active: Math.round(requestedActive),
      rule: ["analogous", "complementary", "monochrome"].includes(palette.rule)
        ? palette.rule
        : base.palette.rule,
      schemes
    },
    motif: {
      kind: ["bloom", "diamond", "orbit"].includes(motif.kind) ? motif.kind : base.motif.kind,
      scale: numberOr(motif.scale, base.motif.scale, 0.2, 1.2),
      rotation: numberOr(motif.rotation, base.motif.rotation, -180, 180),
      petals: Math.round(numberOr(motif.petals, base.motif.petals, 3, 24)),
      orbitCount: Math.round(numberOr(motif.orbitCount, base.motif.orbitCount, 0, 32)),
      orbitRadius: numberOr(motif.orbitRadius, base.motif.orbitRadius, 0.2, 0.65),
      orbitDot: numberOr(motif.orbitDot, base.motif.orbitDot, 0.004, 0.08),
      showPlate: motif.showPlate !== false
    },
    text: {
      enabled: text.enabled !== false,
      title: textOr(text.title, base.text.title),
      subtitle: textOr(text.subtitle, base.text.subtitle),
      x: numberOr(text.x, base.text.x, 0.1, 0.9),
      y: numberOr(text.y, base.text.y, 0.1, 0.9),
      titleSize: Math.round(numberOr(text.titleSize, base.text.titleSize, 6, 240)),
      subtitleSize: Math.round(numberOr(text.subtitleSize, base.text.subtitleSize, 6, 120)),
      maxWidth: Math.round(numberOr(text.maxWidth, base.text.maxWidth, 20, 2048)),
      lineGap: Math.round(numberOr(text.lineGap, base.text.lineGap, 0, 80)),
      align: ["left", "center", "right"].includes(text.align) ? text.align : base.text.align,
      titleColorRole: ["background", "primary", "secondary", "accent"].includes(
        text.titleColorRole
      )
        ? text.titleColorRole
        : base.text.titleColorRole,
      subtitleColorRole: ["background", "primary", "secondary", "accent"].includes(
        text.subtitleColorRole
      )
        ? text.subtitleColorRole
        : base.text.subtitleColorRole
    },
    updatedAt: textOr(source.updatedAt, new Date().toISOString())
  };
}

export function getActiveScheme(project) {
  return project.palette.schemes[project.palette.active] || project.palette.schemes[0];
}

export function projectFingerprint(project) {
  return JSON.stringify({
    ...project,
    updatedAt: "",
    canvas: { ...project.canvas, zoom: 0, showSeams: false }
  });
}
