import {
  PROJECT_VERSION,
  STORAGE_KEY,
  createDesign,
  getSizePreset,
} from "./constants.js";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ALIGNMENTS = new Set(["left", "center", "right"]);
const FONT_KEYS = new Set(["serif", "display", "sans", "mono"]);
const ILLUSTRATION_STYLES = new Set(["arch", "orbit", "bloom", "none"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function checkPosition(position, name) {
  if (!isRecord(position)) throw new Error(`缺少 ${name} 的位置数据。`);
  for (const key of ["x", "y", "w", "h"]) {
    if (!finite(position[key])) throw new Error(`${name} 的 ${key} 必须是数字。`);
  }
}

function validateRawDesign(raw) {
  if (!isRecord(raw)) throw new Error("设计数据必须是一个对象。");
  if (raw.version !== undefined && raw.version > PROJECT_VERSION) {
    throw new Error(`项目版本 ${raw.version} 高于当前支持的版本 ${PROJECT_VERSION}。`);
  }
  if (raw.title !== undefined && typeof raw.title !== "string") {
    throw new Error("书名必须是文字。");
  }
  if (raw.author !== undefined && typeof raw.author !== "string") {
    throw new Error("作者名必须是文字。");
  }
  if (!isRecord(raw.size) || !finite(raw.size.width) || !finite(raw.size.height)) {
    throw new Error("缺少有效的画布宽高。");
  }
  if (!isRecord(raw.theme)) throw new Error("缺少主题色数据。");
  for (const key of ["background", "ink", "accent"]) {
    if (!HEX_COLOR.test(String(raw.theme[key] ?? ""))) {
      throw new Error(`主题色 ${key} 必须是六位十六进制颜色。`);
    }
  }
  if (!isRecord(raw.grid)) throw new Error("缺少网格设置。");
  for (const key of ["columns", "rows", "margin"]) {
    if (!finite(raw.grid[key])) throw new Error(`网格 ${key} 必须是数字。`);
  }
  if (!isRecord(raw.typography)) throw new Error("缺少字体设置。");
  if (raw.typography.align !== undefined && !ALIGNMENTS.has(raw.typography.align)) {
    throw new Error("文字对齐方式无效。");
  }
  if (raw.typography.font !== undefined && !FONT_KEYS.has(raw.typography.font)) {
    throw new Error("字体家族无效。");
  }
  if (!isRecord(raw.illustration)) throw new Error("缺少插图设置。");
  if (
    raw.illustration.style !== undefined &&
    !ILLUSTRATION_STYLES.has(raw.illustration.style)
  ) {
    throw new Error("插图样式无效。");
  }
  if (!isRecord(raw.positions)) throw new Error("缺少元素位置数据。");
  checkPosition(raw.positions.title, "标题");
  checkPosition(raw.positions.illustration, "插图");
  checkPosition(raw.positions.author, "作者");
  return raw;
}

export function normalizeDesign(raw) {
  const checked = validateRawDesign(raw);
  const design = createDesign("standard", checked);
  design.version = PROJECT_VERSION;
  design.size.preset = getSizePreset(design.size.width, design.size.height);
  design.grid.columns = Math.round(design.grid.columns);
  design.grid.rows = Math.round(design.grid.rows);
  return design;
}

export function serializeProject(design, savedAt = new Date().toISOString()) {
  return JSON.stringify(
    {
      kind: "folio-cover-project",
      version: PROJECT_VERSION,
      savedAt,
      design,
    },
    null,
    2,
  );
}

export function parseProject(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "文件不是有效的 JSON。当前封面与输入内容未被更改。",
    };
  }

  try {
    if (parsed?.kind && parsed.kind !== "folio-cover-project") {
      throw new Error("这不是 Folio 书封项目文件。");
    }
    if (parsed?.version !== undefined && parsed.version > PROJECT_VERSION) {
      throw new Error(`项目版本 ${parsed.version} 高于当前支持的版本 ${PROJECT_VERSION}。`);
    }
    const source = parsed?.design ?? parsed;
    return {
      ok: true,
      design: normalizeDesign(source),
      savedAt: parsed?.savedAt ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      error: `${error.message} 当前封面与输入内容未被更改。`,
    };
  }
}

export function saveToLocalStorage(design) {
  const savedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(design, savedAt));
    return { ok: true, savedAt };
  } catch {
    return {
      ok: false,
      error: "浏览器无法写入本地存储。请检查隐私模式或存储空间，当前内容仍保留在编辑器中。",
    };
  }
}

export function loadFromLocalStorage() {
  let text;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return {
      ok: false,
      error: "浏览器无法读取本地存储。当前封面与输入内容未被更改。",
    };
  }

  if (!text) {
    return {
      ok: false,
      error: "本机还没有已保存的项目。请先点击“保存”。",
    };
  }

  return parseProject(text);
}
