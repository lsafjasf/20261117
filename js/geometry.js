export const SAFE_MARGIN_MM = 6;

export const FONT_FAMILIES = {
  sans: '"Postcard Sans","PingFang SC","Microsoft YaHei",sans-serif',
  serif: '"Postcard Serif","Songti SC","SimSun",serif',
  mono: '"Postcard Mono","Postcard Sans","SFMono-Regular",Consolas,monospace',
};

const textMeasureCanvas = document.createElement("canvas");
const textMeasureContext = textMeasureCanvas.getContext("2d");
const MEASURE_SCALE = 10;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function rect(value) {
  return {
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    w: Math.max(0, Number(value.w) || 0),
    h: Math.max(0, Number(value.h) || 0),
  };
}

export function rectsOverlap(a, b, tolerance = 0.05) {
  const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return overlapW > tolerance && overlapH > tolerance;
}

export function containsRect(outer, inner, tolerance = 0.05) {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance
  );
}

export function insetRect(value, by) {
  const r = rect(value);
  return {
    x: r.x + by,
    y: r.y + by,
    w: Math.max(0, r.w - by * 2),
    h: Math.max(0, r.h - by * 2),
  };
}

function isLandscape(width, height) {
  return width >= height * 1.12;
}

function isPortrait(width, height) {
  return height >= width * 1.12;
}

function baseSlots(width, height, portrait) {
  const sm = SAFE_MARGIN_MM;
  if (isLandscape(width, height)) {
    const stampW = clamp(width * 0.2, 16, 30);
    const stampH = clamp(height * 0.35, 18, 38);
    const stamp = { x: width - sm - stampW, y: 8, w: stampW, h: stampH };
    const addressW = clamp(width * 0.405, 30, 60);
    const addressX = width - sm - addressW;
    const barcodeH = clamp(height * 0.08, 5, 8);
    const barcodeY = height - sm - barcodeH;
    const addressY = Math.max(stamp.y + stamp.h + 2, height * 0.47);
    const addressH = Math.max(9, barcodeY - 3 - addressY);
    const address = { x: addressX, y: addressY, w: addressW, h: addressH };
    const barcode = {
      x: addressX,
      y: barcodeY,
      w: Math.min(addressW * 0.74, 44),
      h: barcodeH,
    };
    const compact = width <= 100;
    const noteWidth = compact ? stamp.x - (sm + 6) - 4 : addressX - (sm + 6) - 4;
    const noteY = compact ? Math.max(sm + 2, height * 0.17) : Math.max(sm + 5, height * 0.18);
    const noteH = compact
      ? Math.max(8, addressY - noteY - 2)
      : Math.min(height * 0.5, height - sm - noteY - 14);
    const note = { x: sm + 6, y: noteY, w: Math.max(18, noteWidth), h: noteH };
    const signatureY = note.y + note.h + 2;
    const signatureH = Math.max(3.5, Math.min(8, height - sm - signatureY - 1));
    const signature = {
      x: note.x,
      y: signatureY,
      w: Math.max(16, note.w * 0.78),
      h: signatureH,
    };
    const photo = compact
      ? { x: sm + 2, y: sm + 2, w: width * 0.45, h: height * 0.57 }
      : { x: sm + 8, y: sm + 9, w: width * 0.58, h: height * 0.63 };
    const rightX = compact ? photo.x + photo.w + 4 : photo.x + photo.w + 8;
    const rightW = Math.max(18, width - sm - 2 - rightX);
    return {
      zones: { stamp, address, barcode },
      front: {
        hero: photo,
        headline: compact
          ? { x: rightX, y: sm + 3, w: rightW, h: height * 0.27 }
          : { x: rightX, y: sm + 10, w: rightW, h: height * 0.24 },
        caption: compact
          ? { x: rightX, y: height * 0.44, w: rightW, h: height * 0.25 }
          : { x: rightX, y: height * 0.42, w: rightW, h: height * 0.25 },
        footer: compact
          ? { x: sm + 2, y: height - sm - 3.5, w: Math.max(20, photo.w), h: 3.5 }
          : { x: sm + 8, y: height - sm - 5, w: width * 0.64, h: 5 },
      },
      back: {
        note,
        signature,
        stamp: insetRect(stamp, 1.4),
        address: insetRect({ x: address.x + 2, y: address.y + 2, w: address.w - 4, h: address.h - 2 }, 0),
        barcode: insetRect(barcode, 0.7),
      },
    };
  }

  if (isPortrait(width, height)) {
    const stampW = clamp(width * 0.24, 13, 24);
    const stampH = clamp(height * 0.22, 18, 32);
    const stamp = { x: width - sm - stampW, y: 8, w: stampW, h: stampH };
    const noteX = sm + 6;
    const noteY = Math.max(sm + 5, height * 0.1);
    const noteW = Math.max(18, stamp.x - noteX - 4);
    const noteH = Math.min(height * 0.35, height * 0.38);
    const note = { x: noteX, y: noteY, w: noteW, h: noteH };
    const barcodeH = clamp(height * 0.055, 5, 8);
    const barcodeY = height - sm - barcodeH;
    const signatureY = note.y + note.h + 3;
    const addressY = Math.max(height * 0.54, signatureY + 5);
    const addressH = Math.max(10, barcodeY - 3 - addressY);
    const address = { x: sm + 4, y: addressY, w: width - sm * 2 - 8, h: addressH };
    const barcode = { x: sm + 4, y: barcodeY, w: Math.min(40, width * 0.45), h: barcodeH };
    const signature = {
      x: note.x,
      y: signatureY,
      w: Math.max(16, note.w),
      h: Math.max(2.5, Math.min(7, addressY - signatureY - 1)),
    };
    const heroY = sm + 6;
    const heroH = height * 0.45;
    const headlineY = Math.max(height * 0.55, heroY + heroH + 3);
    const headlineH = height * 0.13;
    const footerY = height - sm - 4;
    const captionY = Math.max(height * 0.69, headlineY + headlineH + 2);
    return {
      zones: { stamp, address, barcode },
      front: {
        hero: { x: sm + 4, y: heroY, w: width - sm * 2 - 8, h: heroH },
        headline: {
          x: sm + 4,
          y: headlineY,
          w: width - sm * 2 - 8,
          h: headlineH,
        },
        caption: {
          x: sm + 4,
          y: captionY,
          w: width * 0.66,
          h: Math.max(4, Math.min(height * 0.12, footerY - captionY - 2)),
        },
        footer: {
          x: sm + 4,
          y: footerY,
          w: width - sm * 2 - 8,
          h: 4,
        },
      },
      back: {
        note,
        signature,
        stamp: insetRect(stamp, 1.2),
        address: insetRect(address, 1.2),
        barcode: insetRect(barcode, 0.6),
      },
    };
  }

  const stamp = { x: width - sm - 24, y: 8, w: 24, h: 32 };
  const address = { x: width * 0.55, y: height * 0.54, w: width - width * 0.55 - sm, h: 0 };
  address.h = Math.max(10, height - sm - 11 - address.y);
  const barcode = { x: address.x, y: height - sm - 8, w: Math.min(address.w, 32), h: 8 };
  const note = { x: sm + 6, y: sm + 8, w: width * 0.49, h: height * 0.38 };
  const signature = { x: note.x, y: note.y + note.h + 3, w: note.w, h: 6 };
  return {
    zones: { stamp, address, barcode },
    front: {
      hero: { x: sm + 8, y: sm + 8, w: width * 0.46, h: height * 0.42 },
      headline: { x: width * 0.62, y: sm + 10, w: width * 0.28, h: height * 0.2 },
      caption: { x: width * 0.62, y: height * 0.34, w: width * 0.28, h: height * 0.24 },
      footer: { x: sm + 8, y: height - sm - 5, w: width * 0.55, h: 5 },
    },
    back: {
      note,
      signature,
      stamp: insetRect(stamp, 1.2),
      address: insetRect(address, 1.2),
      barcode: insetRect(barcode, 0.7),
    },
  };
}

export function getGeometry(project) {
  const width = Number(project.width) || 148;
  const height = Number(project.height) || 100;
  const landscape = isLandscape(width, height);
  const portrait = isPortrait(width, height);
  const slots = baseSlots(width, height);
  return {
    width,
    height,
    safeMargin: SAFE_MARGIN_MM,
    landscape,
    portrait,
    orientation: landscape ? "landscape" : portrait ? "portrait" : "square",
    zones: slots.zones,
    slots,
    sheet: getSheetLayout(width, height),
  };
}

export function getSheetLayout(width, height) {
  const margin = 10;
  const gap = 12;
  const top = 15;
  const bottom = 10;
  return {
    width: width * 2 + margin * 2 + gap,
    height: height + top + bottom,
    front: { x: margin, y: top, w: width, h: height },
    back: { x: margin + width + gap, y: top, w: width, h: height },
  };
}

export function elementFrame(side, role, fallback) {
  if (!fallback) return null;
  return { side, role, ...rect(fallback) };
}

function fontString(sizePx, style) {
  const family = FONT_FAMILIES[style?.fontFamily] || FONT_FAMILIES.sans;
  const weight = Number(style?.fontWeight) || 400;
  return `${weight} ${sizePx}px ${family}`;
}

function measureLine(text, sizePx, spacingPx) {
  if (!spacingPx) return textMeasureContext.measureText(text).width;
  let width = 0;
  for (const char of Array.from(text)) {
    width += textMeasureContext.measureText(char).width + spacingPx;
  }
  return Math.max(0, width - spacingPx);
}

function splitLongToken(token, maxWidthPx, sizePx, spacingPx) {
  const pieces = [];
  let current = "";
  for (const char of Array.from(token)) {
    const next = current + char;
    if (current && measureLine(next, sizePx, spacingPx) > maxWidthPx) {
      pieces.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function tokenizeParagraph(paragraph) {
  const matches = paragraph.match(
    /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]|[^\s\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]+|\s+/g,
  );
  return matches || [];
}

export function wrapText(text, maxWidthMm, sizeMm, style = {}) {
  const sizePx = sizeMm * MEASURE_SCALE;
  const maxWidthPx = maxWidthMm * MEASURE_SCALE;
  const spacingPx = (Number(style.letterSpacing) || 0) * MEASURE_SCALE;
  textMeasureContext.font = fontString(sizePx, style);
  const sourceLines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const lines = [];
  let widest = 0;

  for (const paragraph of sourceLines) {
    if (paragraph === "") {
      lines.push({ text: "", width: 0 });
      continue;
    }
    const tokens = tokenizeParagraph(paragraph);
    let line = "";
    for (const token of tokens) {
      if (token.startsWith(" ") && line === "") continue;
      const candidate = line + token;
      if (measureLine(candidate, sizePx, spacingPx) <= maxWidthPx) {
        line = candidate;
        continue;
      }
      if (line) {
        widest = Math.max(widest, measureLine(line, sizePx, spacingPx));
        lines.push({ text: line.trimEnd(), width: widest / MEASURE_SCALE });
        line = "";
      }
      if (token === " ") continue;
      if (measureLine(token, sizePx, spacingPx) > maxWidthPx) {
        const pieces = splitLongToken(token, maxWidthPx, sizePx, spacingPx);
        for (let index = 0; index < pieces.length - 1; index += 1) {
          widest = Math.max(widest, measureLine(pieces[index], sizePx, spacingPx));
          lines.push({ text: pieces[index], width: widest / MEASURE_SCALE });
        }
        line = pieces[pieces.length - 1] || "";
      } else {
        line = token.trimStart();
      }
    }
    if (line) {
      const width = measureLine(line, sizePx, spacingPx);
      widest = Math.max(widest, width);
      lines.push({ text: line.trimEnd(), width: width / MEASURE_SCALE });
    }
  }

  if (!lines.length) lines.push({ text: "", width: 0 });
  return { lines, widthMm: widest / MEASURE_SCALE };
}

export function isTextElement(element) {
  return element?.kind === "text" || element?.kind === "address";
}

export function measureTextElement(element) {
  const style = element.style || {};
  const box = rect(element);
  const padding = 0.7;
  const maxWidth = Math.max(1, box.w - padding * 2);
  const maxHeight = Math.max(1, box.h - padding * 2);
  const addressHeader = element.kind === "address";
  const requestedSize = clamp(Number(style.fontSize) || 3, 0.8, 24);
  const minSize = clamp(Number(style.minFontSize) || 1.7, 0.8, requestedSize);
  const lineHeightFactor = clamp(Number(style.lineHeight) || 1.55, 0.9, 3);
  const step = 0.1;
  let measured = null;
  let size = requestedSize;

  while (size >= minSize - 0.001) {
    const wrapped = wrapText(element.text, maxWidth, size, style);
    const lineHeight = size * lineHeightFactor;
    const headerHeight = addressHeader ? size * 1.8 : 0;
    const height = wrapped.lines.length * lineHeight + headerHeight;
    measured = {
      fontSize: size,
      lines: wrapped.lines,
      width: wrapped.widthMm,
      lineHeight,
      headerHeight,
      height,
    };
    if (wrapped.widthMm <= maxWidth + 0.05 && height <= maxHeight + 0.05) {
      break;
    }
    size = Math.round((size - step) * 10) / 10;
  }

  const overflowX = Math.max(0, measured.width - maxWidth);
  const overflowY = Math.max(0, measured.height - maxHeight);
  return {
    ...measured,
    requestedSize,
    overflowX,
    overflowY,
    overflow: overflowX > 0.08 || overflowY > 0.08,
    shrunk: measured.fontSize + 0.05 < requestedSize,
    tooSmall: measured.fontSize < 2.05,
    maxWidth,
    maxHeight,
    padding,
  };
}

export function pointInRect(x, y, value, tolerance = 0) {
  const r = rect(value);
  return (
    x >= r.x - tolerance &&
    x <= r.x + r.w + tolerance &&
    y >= r.y - tolerance &&
    y <= r.y + r.h + tolerance
  );
}

export function elementLabel(element) {
  const labels = {
    photo: "照片框",
    stamp: "邮票",
    address: "地址线",
    text: "短句",
    barcode: "条码",
  };
  const base = labels[element?.kind] || "元素";
  const preview = String(element?.text || "").replace(/\s+/g, " ").trim();
  return preview ? `${base} · ${preview.slice(0, 10)}${preview.length > 10 ? "…" : ""}` : base;
}
