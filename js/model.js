import {
  SAFE_MARGIN_MM,
  clamp,
  getGeometry,
  rect,
  rectsOverlap,
} from "./geometry.js";

export const PROJECT_VERSION = 1;
export const STORAGE_KEY = "paper-between-postcard-project-v1";

export const PRESETS = {
  standard: {
    label: "标准",
    landscape: { width: 148, height: 100 },
    portrait: { width: 100, height: 148 },
  },
  square: {
    label: "方形",
    landscape: { width: 120, height: 120 },
    portrait: { width: 120, height: 120 },
  },
  mini: {
    label: "迷你",
    landscape: { width: 90, height: 60 },
    portrait: { width: 60, height: 90 },
  },
};

let idCounter = 0;

export function makeId(prefix = "el") {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function deepClone(value) {
  return structuredClone(value);
}

export function dimensionsFor(preset, orientation) {
  const resolvedPreset = PRESETS[preset] ? preset : "standard";
  const resolvedOrientation = orientation === "portrait" ? "portrait" : "landscape";
  return { ...PRESETS[resolvedPreset][resolvedOrientation] };
}

export function orientationFor(preset, currentOrientation) {
  if (preset === "square") return "landscape";
  return currentOrientation === "portrait" ? "portrait" : "landscape";
}

const DEFAULT_STYLE = {
  fontSize: 3,
  minFontSize: 1.7,
  lineHeight: 1.6,
  fontWeight: 400,
  fontFamily: "sans",
  color: "#25382e",
  align: "left",
  letterSpacing: 0,
};

export function createElement(kind, overrides = {}) {
  const common = {
    id: makeId(kind),
    kind,
    role: "",
    x: 12,
    y: 12,
    w: 30,
    h: 15,
    text: "",
    image: null,
    style: { ...DEFAULT_STYLE },
  };

  if (kind === "photo") {
    return {
      ...common,
      role: "photo",
      text: "旅途中的光",
      style: {
        ...common.style,
        captionSize: 2.1,
        frameColor: "#31473b",
        placeholder: "sun",
      },
    };
  }
  if (kind === "stamp") {
    return {
      ...common,
      role: "stamp",
      text: "5.00",
      style: {
        ...common.style,
        fontSize: 2.2,
        color: "#3b5545",
        accent: "#bf553d",
      },
    };
  }
  if (kind === "address") {
    return {
      ...common,
      role: "address",
      text: "收件人\n省市区街道门牌号\n邮编",
      style: { ...common.style, fontSize: 2.4, minFontSize: 1.7, lineHeight: 1.9 },
    };
  }
  if (kind === "barcode") {
    return {
      ...common,
      role: "barcode",
      text: "CN-200031-883",
      style: { ...common.style, fontSize: 1.7, color: "#25382e" },
    };
  }
  return {
    ...common,
    role: "custom-text",
    text: "写下一句想说的话",
    style: { ...common.style, fontSize: 3, lineHeight: 1.55 },
  };
}

function mergeStyle(element) {
  return {
    ...element,
    style: { ...DEFAULT_STYLE, ...(element.style || {}) },
  };
}

function createBaseProject({ name, preset, orientation }) {
  const dims = dimensionsFor(preset, orientation);
  return {
    version: PROJECT_VERSION,
    name,
    preset,
    orientation,
    width: dims.width,
    height: dims.height,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sides: { front: [], back: [] },
  };
}

export function createStandardProject() {
  const project = createBaseProject({
    name: "海边来信 · 标准旅行卡",
    preset: "standard",
    orientation: "landscape",
  });
  project.sides.front = [
    {
      ...createElement("photo"),
      id: "front-photo",
      role: "hero",
      text: "东山岛 · 南门湾",
      image: null,
    },
    {
      ...createElement("text"),
      id: "front-headline",
      role: "headline",
      text: "去看海吧",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 6.4,
        lineHeight: 1.25,
        fontWeight: 600,
        fontFamily: "serif",
        color: "#1e2b24",
      },
    },
    {
      ...createElement("text"),
      id: "front-caption",
      role: "caption",
      text: "海风会把未说完的话，\n带到很远很远的地方。",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 2.9,
        lineHeight: 1.75,
        color: "#61786a",
      },
    },
    {
      ...createElement("text"),
      id: "front-footer",
      role: "footer",
      text: "GREETINGS FROM THE COAST · 2026",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 2.05,
        lineHeight: 1.4,
        fontFamily: "mono",
        letterSpacing: 0.08,
        color: "#7c827a",
      },
    },
  ];
  project.sides.back = [
    {
      ...createElement("text"),
      id: "back-note",
      role: "note",
      text:
        "见字如面。\n\n这里的傍晚很慢，潮水一遍遍漫过礁石。把这一小片海寄给你，愿你在忙碌的日子里，也记得抬头看看天。",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 3,
        lineHeight: 1.75,
        color: "#2c4034",
      },
    },
    {
      ...createElement("text"),
      id: "back-signature",
      role: "signature",
      text: "—— 小满 · 厦门",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 2.25,
        lineHeight: 1.4,
        color: "#727a71",
      },
    },
    {
      ...createElement("stamp"),
      id: "back-stamp",
      role: "stamp",
      text: "5.00",
    },
    {
      ...createElement("address"),
      id: "back-address",
      role: "address",
      text: "林小满  收\n上海市徐汇区衡山路 88 号\n200031",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 2.45,
        lineHeight: 1.9,
        color: "#2d4035",
      },
    },
    {
      ...createElement("barcode"),
      id: "back-barcode",
      role: "barcode",
      text: "CN-200031-883",
    },
  ];
  return applyLayout(project);
}

export function createExtremeProject() {
  const project = createBaseProject({
    name: "极限长文 · 迷你压力测试",
    preset: "mini",
    orientation: "landscape",
  });
  const longNote =
    "这是一段用来测试极小尺寸与超长文本的留言。海边的风从清晨吹到黄昏，我们沿着防波堤慢慢走，把每一朵浪花都当作一句没有说完的话。明信片很小，想写的事情却很多，所以文字需要自动换行、缩小到仍然可读的字号，并与地址区和条码区保持清楚的距离。愿这封信抵达时，刚好赶上你窗边的一束光。";
  project.sides.front = [
    {
      ...createElement("photo"),
      id: "front-photo",
      role: "hero",
      text: "MINI / 01",
      image: null,
    },
    {
      ...createElement("text"),
      id: "front-headline",
      role: "headline",
      text: "小小\n远方",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 4,
        lineHeight: 1.25,
        fontWeight: 600,
        fontFamily: "serif",
      },
    },
    {
      ...createElement("text"),
      id: "front-caption",
      role: "caption",
      text: "90 × 60 mm\n长文本压力测试",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 1.9,
        lineHeight: 1.5,
        color: "#61786a",
      },
    },
    {
      ...createElement("text"),
      id: "front-footer",
      role: "footer",
      text: "EDGE CASE / SAFE ZONES",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 1.55,
        lineHeight: 1.2,
        fontFamily: "mono",
        color: "#7c827a",
      },
    },
  ];
  project.sides.back = [
    {
      ...createElement("text"),
      id: "back-note",
      role: "note",
      text: longNote,
      style: {
        ...DEFAULT_STYLE,
        fontSize: 1.9,
        minFontSize: 1.65,
        lineHeight: 1.38,
        color: "#2c4034",
      },
    },
    {
      ...createElement("stamp"),
      id: "back-stamp",
      role: "stamp",
      text: "5.00",
    },
    {
      ...createElement("address"),
      id: "back-address",
      role: "address",
      text: "周野  收\n杭州市西湖区北山街 9 号\n310007",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 1.85,
        minFontSize: 1.5,
        lineHeight: 1.68,
      },
    },
    {
      ...createElement("barcode"),
      id: "back-barcode",
      role: "barcode",
      text: "CN-310007-090",
    },
  ];
  return applyLayout(project);
}

function preferredSizeFor(kind, project) {
  const width = Number(project.width) || 148;
  const height = Number(project.height) || 100;
  if (kind === "photo") {
    const w = clamp(width * 0.26, 20, 48);
    return { w, h: w * 0.72 };
  }
  if (kind === "stamp") {
    return { w: clamp(width * 0.18, 14, 27), h: clamp(height * 0.26, 18, 34) };
  }
  if (kind === "address") {
    return { w: clamp(width * 0.4, 28, 58), h: clamp(height * 0.25, 12, 35) };
  }
  if (kind === "barcode") {
    return { w: clamp(width * 0.28, 20, 40), h: clamp(height * 0.07, 5, 8) };
  }
  return { w: clamp(width * 0.34, 22, 52), h: clamp(height * 0.18, 9, 24) };
}

export function findFreeRect(project, side, size, options = {}) {
  const geom = getGeometry(project);
  const effectiveSide = options.side || side;
  const bounds = {
    x: SAFE_MARGIN_MM,
    y: SAFE_MARGIN_MM,
    w: geom.width - SAFE_MARGIN_MM * 2,
    h: geom.height - SAFE_MARGIN_MM * 2,
  };
  let searchBounds = bounds;
  if (options.kind === "address") {
    searchBounds = {
      x: geom.zones.address.x + 1,
      y: geom.zones.address.y + 1,
      w: Math.max(1, geom.zones.address.w - 2),
      h: Math.max(1, geom.zones.address.h - 2),
    };
  }
  const obstacles = [];
  const ignoredIds = new Set(options.ignoreIds || []);
  if (options.ignoreId) ignoredIds.add(options.ignoreId);
  if (effectiveSide === "back") {
    obstacles.push({ ...geom.zones.address, id: "__address-zone" });
    obstacles.push({ ...geom.zones.barcode, id: "__barcode-zone" });
  }
  for (const sideName of ["front", "back"]) {
    if (sideName !== effectiveSide) continue;
    for (const element of project.sides?.[sideName] || []) {
      if (!ignoredIds.has(element.id)) obstacles.push(rect(element));
    }
  }

  function search(width, height) {
    const step = 1;
    const candidates = [];
    for (let y = searchBounds.y; y <= searchBounds.y + searchBounds.h - height; y += step) {
      for (let x = searchBounds.x; x <= searchBounds.x + searchBounds.w - width; x += step) {
        candidates.push({
          x,
          y,
          w: width,
          h: height,
          score: (x - searchBounds.x) + (y - searchBounds.y) * 0.55,
        });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const candidate of candidates) {
      if (
        candidate.x >= bounds.x - 0.01 &&
        candidate.y >= bounds.y - 0.01 &&
        candidate.x + candidate.w <= bounds.x + bounds.w + 0.01 &&
        candidate.y + candidate.h <= bounds.y + bounds.h + 0.01 &&
        !obstacles.some((obstacle) => rectsOverlap(candidate, obstacle, 0.7))
      ) {
        return { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h };
      }
    }
    return null;
  }

  const width = Math.min(size.w, searchBounds.w);
  const height = Math.min(size.h, searchBounds.h);
  const roomy = search(width, height);
  if (roomy) return roomy;
  for (const factor of [0.82, 0.68, 0.56, 0.45]) {
    const fitted = search(
      Math.max(8, Math.min(width * factor, searchBounds.w)),
      Math.max(4, Math.min(height * factor, searchBounds.h)),
    );
    if (fitted) return fitted;
  }
  return {
    x: searchBounds.x,
    y: searchBounds.y,
    w: Math.min(width, searchBounds.w),
    h: Math.min(height, searchBounds.h),
    crowded: true,
  };
}

export function applyLayout(project, options = {}) {
  const preset = PRESETS[options.preset] ? options.preset : project.preset || "standard";
  const orientation = orientationFor(preset, options.orientation || project.orientation);
  const dims = dimensionsFor(preset, orientation);
  const oldWidth = Number(project.width) || dims.width;
  const oldHeight = Number(project.height) || dims.height;
  const scale = Math.min(dims.width / oldWidth, dims.height / oldHeight);
  const next = {
    ...deepClone(project),
    preset,
    orientation,
    width: dims.width,
    height: dims.height,
    updatedAt: new Date().toISOString(),
  };
  const geom = getGeometry(next);
  const shouldScale = Boolean(options.rescaleFonts);

  for (const sideName of ["front", "back"]) {
    const elements = next.sides?.[sideName] || [];
    const usedSlots = new Set();
    const placed = [];
    const primary = [];
    const extras = [];
    for (const element of elements) {
      const roleFallback = element.kind === "text" ? "custom-text" : element.kind;
      const role = element.role || roleFallback;
      const available = geom.slots[sideName]?.[role];
      if (available && !usedSlots.has(role)) {
        primary.push({ element, role, slot: available });
      } else {
        extras.push(element);
      }
    }

    for (const entry of primary) {
      const { element, role, slot } = entry;
      element.role = role;
      element.x = slot.x;
      element.y = slot.y;
      element.w = slot.w;
      element.h = slot.h;
      usedSlots.add(role);
      if (shouldScale && element.style?.fontSize) {
        element.style.fontSize = Number(
          clamp(element.style.fontSize * scale, 1.55, 24).toFixed(2),
        );
      }
      placed.push(element);
    }

    for (let extraIndex = 0; extraIndex < extras.length; extraIndex += 1) {
      const element = extras[extraIndex];
      const compactDefault = preferredSizeFor(element.kind, next);
      const desired = {
        w: shouldScale ? Math.max(8, element.w * scale) : element.w || compactDefault.w,
        h: shouldScale ? Math.max(4, element.h * scale) : element.h || compactDefault.h,
      };
      if (sideName === "back" && element.kind === "address") {
        const slot = geom.slots.back.address;
        const index = placed.filter((item) => item.kind === "address").length;
        element.x = slot.x + index * 1.5;
        element.y = slot.y + index * 1.5;
        element.w = slot.w;
        element.h = slot.h;
      } else {
        const free = findFreeRect(next, sideName, desired, {
          kind: element.kind,
          ignoreIds: extras.slice(extraIndex).map((item) => item.id),
        });
        element.x = Number(free.x.toFixed(2));
        element.y = Number(free.y.toFixed(2));
        element.w = Number(free.w.toFixed(2));
        element.h = Number(free.h.toFixed(2));
      }
      if (shouldScale && element.style?.fontSize) {
        element.style.fontSize = Number(
          clamp(element.style.fontSize * scale, 1.55, 24).toFixed(2),
        );
      }
      placed.push(element);
    }
    next.sides[sideName] = elements;
  }
  return next;
}

export function addElement(project, sideName, kind) {
  const next = deepClone(project);
  let side = sideName === "front" ? "front" : "back";
  if (kind === "address") side = "back";
  const list = next.sides[side];
  const existingAddress = kind === "address" && list.some((element) => element.kind === "address");
  if (existingAddress) return { project: next, existingAddress: true, element: null };
  const element = createElement(kind);
  const geom = getGeometry(next);
  const sameKindCount = list.filter((item) => item.kind === kind).length;
  const size = preferredSizeFor(kind, next);
  let role = "";
  if (kind === "photo" && side === "front" && sameKindCount === 0) role = "hero";
  if (kind === "text" && side === "back" && sameKindCount === 0 && !list.some((item) => item.role === "note")) {
    role = "note";
  }
  if (kind === "stamp" && side === "back" && sameKindCount === 0) role = "stamp";
  if (kind === "address" && side === "back" && sameKindCount === 0) role = "address";
  element.role = role || `${kind}-extra`;

  const slot = role ? geom.slots[side]?.[role] : null;
  if (slot) {
    Object.assign(element, { x: slot.x, y: slot.y, w: slot.w, h: slot.h });
  } else if (kind === "stamp") {
    const sizeInZone = { w: geom.zones.stamp.w - 2.8, h: geom.zones.stamp.h - 2.8 };
    const free = findFreeRect(next, side, sizeInZone, { kind });
    Object.assign(element, free);
  } else {
    const free = findFreeRect(next, side, size, { kind });
    Object.assign(element, free);
  }
  list.push(element);
  next.updatedAt = new Date().toISOString();
  return { project: next, existingAddress: false, element };
}

export function setProjectPreset(project, preset) {
  return applyLayout(project, {
    preset,
    orientation: orientationFor(preset, project.orientation),
    rescaleFonts: preset !== project.preset,
  });
}

export function setProjectOrientation(project, orientation) {
  if (project.preset === "square" && orientation === "portrait") {
    return applyLayout(project, { preset: project.preset, orientation: project.orientation });
  }
  return applyLayout(project, {
    preset: project.preset,
    orientation,
    rescaleFonts: false,
  });
}

export function serializeProject(project) {
  return JSON.stringify(
    {
      ...project,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

function requireFinite(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label}必须是 ${min}–${max} 之间的数字。`);
  }
  return number;
}

function normalizeElement(raw, index, sideName, usedIds) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${sideName === "front" ? "正面" : "背面"}第 ${index + 1} 个元素格式无效。`);
  }
  const kinds = new Set(["photo", "stamp", "address", "text", "barcode"]);
  if (!kinds.has(raw.kind)) {
    throw new Error(`第 ${index + 1} 个元素的类型“${String(raw.kind)}”不受支持。`);
  }
  let id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : makeId(raw.kind);
  if (usedIds.has(id)) id = makeId(raw.kind);
  usedIds.add(id);
  return mergeStyle({
    ...raw,
    id,
    role: typeof raw.role === "string" ? raw.role : "",
    x: requireFinite(raw.x, "元素横坐标", -200, 600),
    y: requireFinite(raw.y, "元素纵坐标", -200, 600),
    w: requireFinite(raw.w, "元素宽度", 1, 600),
    h: requireFinite(raw.h, "元素高度", 1, 600),
    text: typeof raw.text === "string" ? raw.text : "",
    image: typeof raw.image === "string" && raw.image.startsWith("data:image/") ? raw.image : null,
    style: raw.style && typeof raw.style === "object" ? raw.style : {},
  });
}

export function normalizeProject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("项目文件根节点必须是对象。");
  }
  const preset = PRESETS[raw.preset] ? raw.preset : "standard";
  const orientation = raw.orientation === "portrait" ? "portrait" : "landscape";
  const dims = dimensionsFor(preset, orientation);
  if (!raw.sides || typeof raw.sides !== "object") {
    throw new Error("项目缺少正反面内容（sides）。");
  }
  if (!Array.isArray(raw.sides.front) || !Array.isArray(raw.sides.back)) {
    throw new Error("正面与背面都必须是元素数组。");
  }
  const usedIds = new Set();
  const front = raw.sides.front.map((element, index) =>
    normalizeElement(element, index, "front", usedIds),
  );
  const back = raw.sides.back.map((element, index) =>
    normalizeElement(element, index, "back", usedIds),
  );
  return {
    version: PROJECT_VERSION,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.slice(0, 120) : "未命名明信片",
    preset,
    orientation,
    width: raw.width == null ? dims.width : requireFinite(raw.width, "画布宽度", 30, 400),
    height: raw.height == null ? dims.height : requireFinite(raw.height, "画布高度", 30, 400),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sides: { front, back },
  };
}

export function parseProject(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`项目文件不是有效 JSON：${error.message}`);
  }
  return normalizeProject(raw);
}

export function hasAddressOnBack(project) {
  return project.sides.back.some((element) => element.kind === "address");
}

export function countElements(project) {
  return project.sides.front.length + project.sides.back.length;
}

export function findElement(project, side, id) {
  return project.sides[side]?.find((element) => element.id === id) || null;
}

export function updateElement(project, side, id, updater) {
  const next = deepClone(project);
  const target = next.sides[side]?.find((element) => element.id === id);
  if (!target) return next;
  updater(target);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function removeElement(project, side, id) {
  const next = deepClone(project);
  next.sides[side] = next.sides[side].filter((element) => element.id !== id);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function duplicateElement(project, side, id) {
  const source = findElement(project, side, id);
  if (!source) return { project, element: null };
  const next = deepClone(project);
  const copy = deepClone(source);
  copy.id = makeId(source.kind);
  copy.role = `${source.kind}-copy`;
  const free = findFreeRect(next, side, { w: Math.min(source.w, next.width - 12), h: Math.min(source.h, next.height - 12) }, {
    kind: source.kind,
    ignoreId: source.id,
  });
  copy.x = free.x + 2;
  copy.y = free.y + 2;
  copy.w = free.w;
  copy.h = free.h;
  next.sides[side].push(copy);
  return { project: next, element: copy };
}
