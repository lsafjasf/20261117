// Save / reload. Two channels: localStorage autosave and explicit JSON files.
// Loading validates structurally first; on failure the caller keeps the
// current document and surfaces the exact offending field/rule.

import { createDocument } from "./store.js";

const STORAGE_KEY = "poster-studio:document:v1";
const SHAPE_TYPES = new Set(["rect", "ellipse", "triangle", "hexagon", "star"]);

export function saveLocal(doc) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return { ok: true, at: new Date().toISOString() };
  } catch (err) {
    return {
      ok: false,
      error: `浏览器存储写入失败：${err.message}。请改用“导出工程 JSON”备份文件。`,
    };
  }
}

export function loadLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ok: false, error: "本地没有已保存的海报工程。" };
  return parseDocument(raw);
}

export function clearLocal() {
  localStorage.removeItem(STORAGE_KEY);
}

export function projectJson(doc) {
  return JSON.stringify(doc, null, 2);
}

export function parseDocument(raw) {
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败（${err.message}）。文件可能被截断或手工修改过，当前画布内容已保留未变。`,
    };
  }
  const violations = validateShape(data);
  if (violations.length) {
    return {
      ok: false,
      error:
        "工程文件不符合排版数据规则，载入已取消，当前画布内容已保留：\n- " +
        violations.join("\n- "),
      violations,
    };
  }
  const doc = createDocument(data);
  doc.elements = data.elements.map((el) => ({ ...el, crop: el.crop ?? null }));
  return { ok: true, doc };
}

function isNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function validateShape(data) {
  const violations = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    violations.push("根节点必须是对象，收到的是 " + (Array.isArray(data) ? "数组" : typeof data));
    return violations;
  }
  for (const key of ["width", "height"]) {
    if (!isNumber(data[key]) || data[key] <= 0) {
      violations.push(`字段 ${key} 必须是正数，当前值：${JSON.stringify(data[key])}`);
    }
  }
  if (data.width > 4096 || data.height > 4096) {
    violations.push(`画布尺寸不得超过 4096px（规则 CANVAS_LIMIT），当前为 ${data.width}×${data.height}`);
  }
  if (!Array.isArray(data.elements)) {
    violations.push("字段 elements 必须是数组");
    return violations;
  }
  const ids = new Set();
  data.elements.forEach((el, i) => {
    const where = `elements[${i}]`;
    if (!el || typeof el !== "object") {
      violations.push(`${where} 必须是对象`);
      return;
    }
    if (typeof el.id !== "string" || !el.id) violations.push(`${where}.id 必须是非空字符串`);
    else if (ids.has(el.id)) violations.push(`${where}.id="${el.id}" 与其他元素重复（规则 UNIQUE_ID）`);
    ids.add(el.id);
    if (el.type !== "text" && !SHAPE_TYPES.has(el.type)) {
      violations.push(`${where}.type="${el.type}" 不是受支持的类型（text/rect/ellipse/triangle/hexagon/star）`);
    }
    for (const key of ["x", "y", "width", "height"]) {
      if (!isNumber(el[key])) violations.push(`${where}.${key} 必须是有限数字，当前值：${JSON.stringify(el[key])}`);
    }
    if (isNumber(el.width) && el.width <= 0) violations.push(`${where}.width 必须是正数，当前值：${el.width}`);
    if (isNumber(el.height) && el.height <= 0) violations.push(`${where}.height 必须是正数，当前值：${el.height}`);
    if (el.rotation !== undefined && (!isNumber(el.rotation) || Math.abs(el.rotation) > 360)) {
      violations.push(`${where}.rotation 必须在 -360~360 之间`);
    }
    if (el.type === "text" && typeof el.text !== "string") {
      violations.push(`${where}.text 必须是字符串（空字符串也可以，但不能是 ${typeof el.text}）`);
    }
    if (el.crop !== null && el.crop !== undefined) {
      const c = el.crop;
      const ok =
        c &&
        isNumber(c.x) &&
        isNumber(c.y) &&
        isNumber(c.width) &&
        isNumber(c.height) &&
        c.width > 0 &&
        c.height > 0;
      if (!ok) violations.push(`${where}.crop 必须包含正数 width/height 与数字 x/y，或直接置为 null（裁切越界由排版检查 CROP_RANGE 提示）`);
    }
  });
  return violations;
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
