import {
  FONT_FAMILIES,
  getGeometry,
  getSheetLayout,
  measureTextElement,
  rect,
} from "./geometry.js";

const CARD_BG = "#fffdf7";
const SHEET_BG = "#f1ece3";
const INK = "#203027";
const MUTED = "#7a8078";
const ACCENT = "#bd5039";
const GUIDE_SAGE = "#587667";
const GUIDE_AMBER = "#a8732a";
const imageCache = new Map();

function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (imageCache.has(src)) {
    const cached = imageCache.get(src);
    if (cached instanceof Promise) return cached;
    return Promise.resolve(cached);
  }
  const promise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  }).then((image) => {
    imageCache.set(src, image);
    return image;
  });
  imageCache.set(src, promise);
  return promise;
}

function cachedImage(src) {
  const value = src ? imageCache.get(src) : null;
  return value && !(value instanceof Promise) ? value : null;
}

export async function preloadProjectImages(project) {
  const sources = new Set();
  for (const side of ["front", "back"]) {
    for (const element of project.sides?.[side] || []) {
      if (element.image) sources.add(element.image);
    }
  }
  const results = await Promise.all(
    Array.from(sources).map(async (src) => ({ src, image: await loadImage(src) })),
  );
  return results.filter((item) => !item.image).map((item) => item.src);
}

export function drawEditor(ctx, project, cssWidth, cssHeight, dpr, options = {}) {
  const geom = getGeometry(project);
  const sheet = getSheetLayout(geom.width, geom.height);
  const ppmm = Math.min(cssWidth / sheet.width, cssHeight / sheet.height);
  const offsetX = (cssWidth - sheet.width * ppmm) / 2;
  const offsetY = (cssHeight - sheet.height * ppmm) / 2;
  const canvas = ctx.canvas;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * ppmm, 0, 0, dpr * ppmm, dpr * offsetX, dpr * offsetY);

  drawSheetBackdrop(ctx, sheet);
  drawSideLabel(ctx, sheet.front.x, sheet.front.y - 7, "01", "FRONT", "正面", options.activeSide === "front");
  drawSideLabel(ctx, sheet.back.x, sheet.back.y - 7, "02", "BACK", "背面", options.activeSide === "back");
  drawCard(ctx, project, geom, "front", sheet.front, options);
  drawCard(ctx, project, geom, "back", sheet.back, options);
  drawTrimMarks(ctx, sheet.front);
  drawTrimMarks(ctx, sheet.back);
  drawSheetFooter(ctx, sheet, geom);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawSheetBackdrop(ctx, sheet) {
  ctx.save();
  ctx.fillStyle = "#f6f1e8";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.strokeStyle = "rgba(93,79,61,0.07)";
  ctx.lineWidth = 0.2;
  for (let x = 10; x < sheet.width; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, sheet.height);
    ctx.stroke();
  }
  for (let y = 10; y < sheet.height; y += 10) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(sheet.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSideLabel(ctx, x, y, number, latin, chinese, active) {
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.fillStyle = active ? ACCENT : MUTED;
  ctx.font = `500 2.1px ${FONT_FAMILIES.mono}`;
  ctx.fillText(`${number} / ${latin}`, x, y);
  ctx.fillStyle = active ? INK : MUTED;
  ctx.font = `500 2px ${FONT_FAMILIES.sans}`;
  ctx.fillText(chinese, x + 22, y);
  if (active) {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(x - 3.2, y - 0.8, 1.2, 1.6);
  }
  ctx.restore();
}

function drawCard(ctx, project, geom, side, position, options) {
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, geom.width, geom.height);
  ctx.clip();
  ctx.fillStyle = CARD_BG;
  ctx.fillRect(0, 0, geom.width, geom.height);
  drawPaperTexture(ctx, geom.width, geom.height);
  for (const element of project.sides[side] || []) {
    drawElement(ctx, element, side, options, false);
  }
  if (options.guides) {
    drawGuides(ctx, geom, side);
  }
  drawErrorOutlines(ctx, project, side, options, geom);
  if (options.selected?.side === side) {
    const element = project.sides[side].find((item) => item.id === options.selected.id);
    if (element) drawSelection(ctx, element);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(113,96,72,0.18)";
  ctx.lineWidth = 0.22;
  ctx.strokeRect(0, 0, geom.width, geom.height);
  ctx.restore();
}

function drawPaperTexture(ctx, width, height) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#9b8d78";
  for (let y = 5; y < height; y += 8.5) {
    for (let x = 5 + ((y * 7) % 13); x < width; x += 17) {
      ctx.fillRect(x, y, 0.18, 0.18);
    }
  }
  ctx.restore();
}

function drawSheetFooter(ctx, sheet, geom) {
  ctx.save();
  ctx.fillStyle = "#8b8274";
  ctx.font = `400 1.45px ${FONT_FAMILIES.mono}`;
  ctx.textBaseline = "middle";
  ctx.fillText(`${geom.width} × ${geom.height} MM`, 10, sheet.height - 4.4);
  ctx.textAlign = "right";
  ctx.fillText("CUT ON MARKS  /  SAFE MARGIN 6 MM", sheet.width - 10, sheet.height - 4.4);
  ctx.restore();
}

function drawTrimMarks(ctx, card) {
  ctx.save();
  ctx.strokeStyle = "#80776a";
  ctx.lineWidth = 0.22;
  const arm = 3.2;
  const gap = 1.2;
  const corners = [
    [card.x, card.y, -1, -1],
    [card.x + card.w, card.y, 1, -1],
    [card.x, card.y + card.h, -1, 1],
    [card.x + card.w, card.y + card.h, 1, 1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * gap, y);
    ctx.lineTo(x + sx * (gap + arm), y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + sy * gap);
    ctx.lineTo(x, y + sy * (gap + arm));
    ctx.stroke();
  }
  ctx.restore();
}

function drawElement(ctx, element, side, options, forExport) {
  ctx.save();
  if (element.kind === "photo") drawPhoto(ctx, element, options);
  else if (element.kind === "stamp") drawStamp(ctx, element);
  else if (element.kind === "address") drawAddress(ctx, element, options);
  else if (element.kind === "barcode") drawBarcode(ctx, element);
  else drawText(ctx, element, options);
  ctx.restore();
}

function drawPhoto(ctx, element, options) {
  const { x, y, w, h } = rect(element);
  const radius = Math.min(1.4, w * 0.035, h * 0.035);
  ctx.save();
  roundedRect(ctx, x, y, w, h, radius);
  ctx.clip();
  const image = cachedImage(element.image);
  if (image) {
    drawImageCover(ctx, image, x, y, w, h);
  } else {
    const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
    gradient.addColorStop(0, "#d8e2da");
    gradient.addColorStop(0.55, "#b9cbbf");
    gradient.addColorStop(1, "#eadfc9");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(255,248,218,0.88)";
    ctx.beginPath();
    ctx.arc(x + w * 0.73, y + h * 0.3, Math.min(w, h) * 0.105, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(63,103,81,0.62)";
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.72);
    ctx.quadraticCurveTo(x + w * 0.25, y + h * 0.45, x + w * 0.48, y + h * 0.7);
    ctx.quadraticCurveTo(x + w * 0.7, y + h * 0.48, x + w, y + h * 0.7);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(35,62,47,0.74)";
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.84);
    ctx.quadraticCurveTo(x + w * 0.36, y + h * 0.62, x + w * 0.64, y + h * 0.82);
    ctx.quadraticCurveTo(x + w * 0.82, y + h * 0.9, x + w, y + h * 0.78);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.64)";
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.08, y + h * 0.16);
    ctx.lineTo(x + w * 0.08, y + h * 0.84);
    ctx.stroke();
    ctx.fillStyle = "rgba(32,48,39,0.58)";
    ctx.font = `500 ${Math.max(1.2, Math.min(2.1, w * 0.045))}px ${FONT_FAMILIES.mono}`;
    ctx.fillText("PHOTO / FRAME", x + w * 0.5, y + h * 0.18);
  }
  const caption = String(element.text || "").trim();
  if (caption) {
    const captionSize = Math.max(1.3, Math.min(Number(element.style?.captionSize) || 2.1, h * 0.09));
    ctx.font = `500 ${captionSize}px ${FONT_FAMILIES.sans}`;
    const captionWidth = Math.min(w - 2.4, ctx.measureText(caption).width + 2.4);
    const capsuleH = captionSize + 1.5;
    const capsuleY = y + h - capsuleH - 1.2;
    ctx.fillStyle = "rgba(22,35,27,0.74)";
    roundedRect(ctx, x + 1.2, capsuleY, captionWidth, capsuleH, capsuleH / 2);
    ctx.fill();
    ctx.fillStyle = "#fffaf1";
    ctx.textBaseline = "middle";
    ctx.fillText(caption, x + 2.4, capsuleY + capsuleH / 2 + 0.06);
  }
  ctx.restore();
  ctx.strokeStyle = element.style?.frameColor || INK;
  ctx.lineWidth = 0.42;
  roundedRect(ctx, x, y, w, h, radius);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,253,247,0.56)";
  ctx.lineWidth = 0.25;
  roundedRect(ctx, x + 1.2, y + 1.2, w - 2.4, h - 2.4, Math.max(0.2, radius - 0.5));
  ctx.stroke();
}

function drawImageCover(ctx, image, x, y, w, h) {
  const naturalW = image.naturalWidth || image.width || 1;
  const naturalH = image.naturalHeight || image.height || 1;
  const scale = Math.max(w / naturalW, h / naturalH);
  const drawW = naturalW * scale;
  const drawH = naturalH * scale;
  ctx.drawImage(image, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
}

function drawStamp(ctx, element) {
  const { x, y, w, h } = rect(element);
  ctx.save();
  ctx.fillStyle = "#f5edda";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = element.style?.color || "#3b5545";
  ctx.lineWidth = 0.22;
  ctx.setLineDash([0.75, 0.85]);
  ctx.strokeRect(x + 0.45, y + 0.45, w - 0.9, h - 0.9);
  ctx.setLineDash([]);

  const innerX = x + w * 0.12;
  const innerY = y + h * 0.1;
  const innerW = w * 0.76;
  const innerH = h * 0.8;
  ctx.strokeStyle = element.style?.accent || ACCENT;
  ctx.lineWidth = 0.24;
  ctx.strokeRect(innerX, innerY, innerW, innerH);
  ctx.fillStyle = element.style?.accent || ACCENT;
  ctx.beginPath();
  ctx.arc(x + w * 0.67, y + h * 0.31, Math.min(w, h) * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(72,104,84,0.58)";
  ctx.beginPath();
  ctx.moveTo(innerX, y + h * 0.62);
  ctx.quadraticCurveTo(x + w * 0.34, y + h * 0.42, x + w * 0.56, y + h * 0.6);
  ctx.quadraticCurveTo(x + w * 0.73, y + h * 0.47, innerX + innerW, y + h * 0.63);
  ctx.lineTo(innerX + innerW, innerY + innerH);
  ctx.lineTo(innerX, innerY + innerH);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = element.style?.color || "#3b5545";
  ctx.lineWidth = 0.18;
  for (let offset = 1.6; offset < w; offset += 1.8) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y + 0.45);
    ctx.lineTo(x + offset, y + 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + offset, y + h - 1.1);
    ctx.lineTo(x + offset, y + h - 0.45);
    ctx.stroke();
  }
  for (let offset = 1.6; offset < h; offset += 1.8) {
    ctx.beginPath();
    ctx.moveTo(x + 0.45, y + offset);
    ctx.lineTo(x + 1.1, y + offset);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w - 1.1, y + offset);
    ctx.lineTo(x + w - 0.45, y + offset);
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = element.style?.color || "#3b5545";
  ctx.font = `500 ${Math.max(1.2, Math.min(2.05, w * 0.08))}px ${FONT_FAMILIES.mono}`;
  ctx.fillText("POSTAGE", x + w / 2, y + h * 0.17);
  ctx.font = `600 ${Math.max(2, Math.min(4.2, w * 0.2))}px ${FONT_FAMILIES.serif}`;
  ctx.fillText(String(element.text || "5.00"), x + w / 2, y + h * 0.74);
  ctx.font = `400 ${Math.max(1, Math.min(1.45, w * 0.055))}px ${FONT_FAMILIES.mono}`;
  ctx.fillText("CHINA", x + w / 2, y + h * 0.89);
  ctx.restore();
}

function setTextStyle(ctx, size, style = {}) {
  const family = FONT_FAMILIES[style.fontFamily] || FONT_FAMILIES.sans;
  const weight = Number(style.fontWeight) || 400;
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = style.color || INK;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
}

function measureSpacedLine(ctx, text, spacing) {
  if (!spacing) return ctx.measureText(text).width;
  let width = 0;
  for (const char of Array.from(text)) width += ctx.measureText(char).width + spacing;
  return Math.max(0, width - spacing);
}

function drawSpacedLine(ctx, text, x, y, spacing) {
  if (!spacing) {
    ctx.fillText(text, x, y);
    return;
  }
  let cursor = x;
  for (const char of Array.from(text)) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  }
}

function drawText(ctx, element, options) {
  const metrics = measureTextElement(element);
  const style = element.style || {};
  const box = rect(element);
  const spacing = Number(style.letterSpacing) || 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  setTextStyle(ctx, metrics.fontSize, style);
  let cursorY = box.y + metrics.padding;
  for (const line of metrics.lines) {
    const lineWidth = measureSpacedLine(ctx, line.text, spacing);
    let lineX = box.x + metrics.padding;
    if (style.align === "center") lineX = box.x + (box.w - lineWidth) / 2;
    if (style.align === "right") lineX = box.x + box.w - metrics.padding - lineWidth;
    drawSpacedLine(ctx, line.text, lineX, cursorY, spacing);
    cursorY += metrics.lineHeight;
  }
  ctx.restore();
  if (metrics.overflow && options.guides) {
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 0.35;
    ctx.setLineDash([1.2, 0.8]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = ACCENT;
    ctx.font = `500 1.35px ${FONT_FAMILIES.mono}`;
    ctx.fillText("TEXT OVERFLOW", box.x + 0.7, box.y + 0.7);
    ctx.restore();
  }
}

function drawAddress(ctx, element, options) {
  const metrics = measureTextElement(element);
  const style = element.style || {};
  const spacing = Number(style.letterSpacing) || 0;
  const box = rect(element);
  const innerW = box.w - metrics.padding * 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  setTextStyle(ctx, Math.max(1.1, metrics.fontSize * 0.78), {
    ...style,
    color: "#69796e",
    fontFamily: "mono",
    fontWeight: 500,
  });
  const headerY = box.y + metrics.padding;
  drawSpacedLine(ctx, "TO / 收件人", box.x + metrics.padding, headerY, spacing);
  ctx.strokeStyle = "rgba(91,112,99,0.42)";
  ctx.lineWidth = 0.15;
  ctx.beginPath();
  ctx.moveTo(box.x + metrics.padding, headerY + metrics.fontSize * 1.35);
  ctx.lineTo(box.x + box.w - metrics.padding, headerY + metrics.fontSize * 1.35);
  ctx.stroke();

  setTextStyle(ctx, metrics.fontSize, style);
  let cursorY = box.y + metrics.padding + metrics.headerHeight;
  for (const line of metrics.lines) {
    const lineWidth = measureSpacedLine(ctx, line.text, spacing);
    let lineX = box.x + metrics.padding;
    if (style.align === "center") lineX = box.x + (box.w - lineWidth) / 2;
    if (style.align === "right") lineX = box.x + box.w - metrics.padding - lineWidth;
    drawSpacedLine(ctx, line.text, lineX, cursorY, spacing);
    ctx.setLineDash([0.8, 0.9]);
    ctx.strokeStyle = "rgba(94,118,102,0.48)";
    ctx.lineWidth = 0.17;
    ctx.beginPath();
    const ruleY = cursorY + metrics.lineHeight * 0.84;
    ctx.moveTo(box.x + metrics.padding, ruleY);
    ctx.lineTo(box.x + metrics.padding + innerW, ruleY);
    ctx.stroke();
    ctx.setLineDash([]);
    cursorY += metrics.lineHeight;
  }
  ctx.restore();
  if (metrics.overflow && options.guides) {
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 0.35;
    ctx.setLineDash([1.2, 0.8]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }
}

function drawBarcode(ctx, element) {
  const { x, y, w, h } = rect(element);
  const code = String(element.text || "CN-200031-883");
  ctx.save();
  ctx.fillStyle = "rgba(255,253,247,0.92)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(54,72,60,0.24)";
  ctx.lineWidth = 0.13;
  ctx.strokeRect(x, y, w, h);
  const textSize = Math.max(0.9, Math.min(Number(element.style?.fontSize) || 1.5, h * 0.25));
  const barsTop = y + h * 0.14;
  const barsH = h * 0.53;
  const barsW = w - 2.4;
  let hash = 2166136261;
  for (const char of code) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  let cursor = x + 1.2;
  let index = 0;
  while (cursor < x + 1.2 + barsW) {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    const barW = 0.16 + (Math.abs(hash) % 4) * 0.07;
    const gap = 0.18 + (Math.abs(hash >>> 7) % 3) * 0.08;
    if (index % 2 === 0 || Math.abs(hash) % 3 !== 0) {
      ctx.fillStyle = "#26392e";
      ctx.fillRect(cursor, barsTop, Math.min(barW, x + 1.2 + barsW - cursor), barsH);
    }
    cursor += barW + gap;
    index += 1;
  }
  ctx.fillStyle = "#4e5b52";
  ctx.font = `400 ${textSize}px ${FONT_FAMILIES.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fitted = code;
  while (fitted.length > 4 && ctx.measureText(fitted).width > w - 1.4) {
    fitted = fitted.slice(0, -1);
  }
  ctx.fillText(fitted, x + w / 2, y + h * 0.84);
  ctx.restore();
}

function drawSelection(ctx, element) {
  const box = rect(element);
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 0.35;
  ctx.setLineDash([]);
  ctx.strokeRect(box.x - 0.35, box.y - 0.35, box.w + 0.7, box.h + 0.7);
  const handles = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ];
  ctx.fillStyle = "#fffaf2";
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 0.22;
  for (const [x, y] of handles) {
    ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
    ctx.strokeRect(x - 0.7, y - 0.7, 1.4, 1.4);
  }
  ctx.restore();
}

function drawIssueHalo(ctx, element) {
  const box = rect(element);
  ctx.save();
  ctx.strokeStyle = "rgba(180,64,50,0.82)";
  ctx.lineWidth = 0.32;
  ctx.setLineDash([1, 0.8]);
  ctx.strokeRect(box.x - 0.8, box.y - 0.8, box.w + 1.6, box.h + 1.6);
  ctx.restore();
}

function drawGuides(ctx, geom, side) {
  const sm = geom.safeMargin;
  ctx.save();
  ctx.strokeStyle = "rgba(189,80,57,0.42)";
  ctx.lineWidth = 0.18;
  ctx.setLineDash([1.2, 0.9]);
  ctx.strokeRect(sm, sm, geom.width - sm * 2, geom.height - sm * 2);
  ctx.fillStyle = "rgba(189,80,57,0.7)";
  ctx.font = `500 1.05px ${FONT_FAMILIES.mono}`;
  ctx.textBaseline = "top";
  ctx.fillText("SAFE 6 MM", sm + 0.7, sm + 0.5);
  ctx.setLineDash([]);
  if (side === "back") {
    drawGuideZone(ctx, geom.zones.stamp, "STAMP", "贴票区", "rgba(143,96,47,0.16)", "#96682e");
    drawGuideZone(
      ctx,
      geom.zones.address,
      "ADDRESS SAFE ZONE",
      "地址安全区 · 禁止其他文字",
      "rgba(76,117,91,0.11)",
      GUIDE_SAGE,
    );
    drawGuideZone(
      ctx,
      geom.zones.barcode,
      "BARCODE",
      "条码安全区 · 禁止文字",
      "rgba(168,115,42,0.13)",
      GUIDE_AMBER,
    );
  }
  ctx.restore();
}

function drawGuideZone(ctx, zone, title, subtitle, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 0.2;
  ctx.setLineDash([1, 0.8]);
  ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
  ctx.setLineDash([]);
  const size = zone.h < 8 ? 0.8 : 1.02;
  ctx.fillStyle = stroke;
  ctx.font = `500 ${size}px ${FONT_FAMILIES.mono}`;
  ctx.textBaseline = "top";
  ctx.fillText(title, zone.x + 0.7, zone.y + 0.45);
  if (zone.h > 12) {
    ctx.font = `400 ${Math.max(0.75, size * 0.82)}px ${FONT_FAMILIES.sans}`;
    ctx.fillText(subtitle, zone.x + 0.7, zone.y + size + 0.8);
  }
}

function drawErrorOutlines(ctx, project, side, options, geom) {
  if (!options.errorKeys?.size) return;
  ctx.save();
  for (const element of project.sides[side] || []) {
    if (!options.errorKeys.has(`${side}:${element.id}`)) continue;
    drawIssueHalo(ctx, element);
  }
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
