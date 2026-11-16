import { getFontStack } from "./constants.js";

const CJK_OR_PUNCTUATION =
  /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/u;
const WHITESPACE = /\s/u;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fontString(size, weight, family) {
  return `${weight} ${size}px ${family}`;
}

function glyphWidth(char) {
  if (WHITESPACE.test(char)) return 0.3;
  if (CJK_OR_PUNCTUATION.test(char)) return 1;
  if (/[A-Z0-9]/.test(char)) return 0.64;
  if (/[a-z]/.test(char)) return 0.52;
  return 0.42;
}

export function estimateTextWidth(text, font) {
  const size = Number.parseFloat(font.match(/([\d.]+)px/)?.[1] ?? "16");
  return Array.from(text).reduce((sum, char) => sum + glyphWidth(char) * size, 0);
}

export function tokenizeParagraph(paragraph) {
  const tokens = [];
  let latin = "";

  const flushLatin = () => {
    if (latin) tokens.push(latin);
    latin = "";
  };

  for (const char of Array.from(paragraph)) {
    if (WHITESPACE.test(char)) {
      flushLatin();
      tokens.push(" ");
    } else if (CJK_OR_PUNCTUATION.test(char)) {
      flushLatin();
      tokens.push(char);
    } else {
      latin += char;
    }
  }

  flushLatin();
  return tokens;
}

function measureWithSpacing(text, font, letterSpacing, measureText) {
  if (!text) return 0;
  return measureText(text, font) + Math.max(0, text.length - 1) * letterSpacing;
}

function splitOversizedToken(token, maxWidth, font, letterSpacing, measureText) {
  const pieces = [];
  let current = "";

  for (const char of Array.from(token)) {
    const candidate = current + char;
    if (current && measureWithSpacing(candidate, font, letterSpacing, measureText) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

export function wrapText(text, {
  maxWidth,
  font,
  letterSpacing = 0,
  measureText = estimateTextWidth,
}) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  const lines = [];

  for (const paragraph of normalized.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    const tokens = tokenizeParagraph(paragraph);
    let current = "";

    const pushCurrent = () => {
      lines.push(current.trimEnd());
      current = "";
    };

    for (const token of tokens) {
      if (token === " " && !current) continue;

      const candidate = current + token;
      if (measureWithSpacing(candidate, font, letterSpacing, measureText) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current.trim()) pushCurrent();

      if (token === " ") continue;

      if (measureWithSpacing(token, font, letterSpacing, measureText) > maxWidth) {
        const pieces = splitOversizedToken(
          token,
          Math.max(1, maxWidth),
          font,
          letterSpacing,
          measureText,
        );
        const last = pieces.pop() ?? "";
        for (const piece of pieces) lines.push(piece);
        current = last;
      } else {
        current = token;
      }
    }

    if (current || tokens.length === 0) pushCurrent();
  }

  return lines;
}

function layoutTextBlock({
  text,
  box,
  fontSize,
  lineHeight,
  letterSpacing,
  align,
  font,
  fill,
  measureText,
}) {
  const lineHeightPx = fontSize * lineHeight;
  const lines = wrapText(text, {
    maxWidth: Math.max(1, box.w),
    font,
    letterSpacing,
    measureText,
  });
  const measured = lines.map((line) => ({
    text: line,
    width: measureWithSpacing(line, font, letterSpacing, measureText),
  }));
  const maxLineWidth = measured.reduce((max, line) => Math.max(max, line.width), 0);
  const anchorX =
    align === "center" ? box.x + box.w / 2 : align === "right" ? box.x + box.w : box.x;
  const contentX =
    align === "center"
      ? box.x + (box.w - maxLineWidth) / 2
      : align === "right"
        ? box.x + box.w - maxLineWidth
        : box.x;
  const firstBaseline = box.y + fontSize * 0.84;
  const contentHeight = lines.length * lineHeightPx;

  return {
    text,
    box,
    font,
    fontSize,
    lineHeight,
    lineHeightPx,
    letterSpacing,
    align,
    fill,
    anchorX,
    lines: measured.map((line, index) => ({
      ...line,
      x: anchorX,
      baseline: firstBaseline + index * lineHeightPx,
    })),
    maxLineWidth,
    contentHeight,
    contentBox: {
      x: contentX,
      y: box.y,
      w: maxLineWidth,
      h: contentHeight,
    },
    anchorY: firstBaseline,
  };
}

function titleFontSize(design) {
  const minDimension = Math.min(design.size.width, design.size.height);
  const scale = clamp(Number(design.typography.titleScale) || 1, 0.1, 5);
  return clamp(minDimension * 0.112 * scale, 8, 520);
}

function authorFontSize(design) {
  const minDimension = Math.min(design.size.width, design.size.height);
  const scale = clamp(Number(design.typography.authorScale) || 1, 0.1, 5);
  return clamp(minDimension * 0.028 * scale, 6, 120);
}

function fontFor(design, size, weight) {
  return fontString(size, weight, getFontStack(design.typography.font));
}

function fitTitle(design, box, measureText) {
  const family = getFontStack(design.typography.font);
  const lineHeight = clamp(Number(design.typography.lineHeight) || 1.02, 0.7, 2);
  const spacingUnit = Math.min(design.size.width, design.size.height) / 1200;
  const letterSpacing = Number(design.typography.letterSpacing || 0) * spacingUnit;
  const baseSize = titleFontSize(design);
  const minSize = Math.max(6, baseSize * 0.36);

  const build = (size) => {
    const font = fontString(size, 700, family);
    return layoutTextBlock({
      text: design.title,
      box,
      fontSize: size,
      lineHeight,
      letterSpacing,
      align: design.typography.align,
      font,
      fill: design.theme.ink,
      measureText,
    });
  };

  const fits = (candidate) =>
    candidate.contentHeight <= box.h + 0.01 && candidate.maxLineWidth <= box.w + 0.01;

  let chosen = build(baseSize);
  let overflow = !fits(chosen);
  let fitted = false;

  if (overflow && design.typography.autoFit) {
    let low = minSize;
    let high = baseSize;
    let best = build(minSize);

    if (fits(best)) {
      for (let index = 0; index < 18; index += 1) {
        const middle = (low + high) / 2;
        const candidate = build(middle);
        if (fits(candidate)) {
          best = candidate;
          low = middle;
        } else {
          high = middle;
        }
      }
      chosen = best;
      overflow = false;
      fitted = chosen.fontSize < baseSize - 0.2;
    } else {
      chosen = best;
      overflow = true;
      fitted = true;
    }
  }

  return {
    ...chosen,
    baseSize,
    minSize,
    fitted,
    overflow,
  };
}

function fitAuthor(design, box, measureText) {
  const family = getFontStack(design.typography.font);
  const lineHeight = 1.28;
  const spacingUnit = Math.min(design.size.width, design.size.height) / 1200;
  const letterSpacing = spacingUnit * 1.7;
  const baseSize = authorFontSize(design);
  const minSize = Math.max(5, baseSize * 0.55);

  const build = (size) => {
    const font = fontString(size, 600, family);
    return layoutTextBlock({
      text: design.author,
      box,
      fontSize: size,
      lineHeight,
      letterSpacing,
      align: design.typography.align,
      font,
      fill: design.theme.ink,
      measureText,
    });
  };

  const fits = (candidate) =>
    candidate.contentHeight <= box.h + 0.01 && candidate.maxLineWidth <= box.w + 0.01;

  let chosen = build(baseSize);
  let overflow = !fits(chosen);

  if (overflow && design.typography.autoFit) {
    let low = minSize;
    let high = baseSize;
    let best = build(minSize);

    if (fits(best)) {
      for (let index = 0; index < 14; index += 1) {
        const middle = (low + high) / 2;
        const candidate = build(middle);
        if (fits(candidate)) {
          best = candidate;
          low = middle;
        } else {
          high = middle;
        }
      }
      chosen = best;
      overflow = false;
    } else {
      chosen = best;
    }
  }

  return {
    ...chosen,
    baseSize,
    minSize,
    overflow,
  };
}

function normalizedBox(safe, position) {
  const x = safe.x + Number(position.x || 0) * safe.w;
  const y = safe.y + Number(position.y || 0) * safe.h;
  return {
    x,
    y,
    w: Number(position.w || 0) * safe.w,
    h: Number(position.h || 0) * safe.h,
  };
}

function scaledBox(box, scale) {
  const factor = clamp(Number(scale) || 1, 0.1, 3);
  const width = box.w * factor;
  const height = box.h * factor;
  return {
    x: box.x + (box.w - width) / 2,
    y: box.y + (box.h - height) / 2,
    w: width,
    h: height,
  };
}

export function computeLayout(design, measureText = estimateTextWidth) {
  const width = Math.max(1, Number(design.size.width) || 1);
  const height = Math.max(1, Number(design.size.height) || 1);
  const minDimension = Math.min(width, height);
  const marginRatio = clamp(Number(design.grid.margin) || 0, 0, 0.45);
  const margin = minDimension * marginRatio;
  const safe = {
    x: margin,
    y: margin,
    w: Math.max(1, width - margin * 2),
    h: Math.max(1, height - margin * 2),
  };
  const columns = clamp(Math.round(Number(design.grid.columns) || 6), 1, 40);
  const rows = clamp(Math.round(Number(design.grid.rows) || 9), 1, 60);

  const title = fitTitle(design, normalizedBox(safe, design.positions.title), measureText);
  const author = fitAuthor(design, normalizedBox(safe, design.positions.author), measureText);
  const illustrationBase = normalizedBox(safe, design.positions.illustration);
  const illustration = {
    box: scaledBox(illustrationBase, design.illustration.scale),
    baseBox: illustrationBase,
    style: design.illustration.style,
    visible: design.illustration.style !== "none",
  };

  return {
    width,
    height,
    minDimension,
    margin,
    safe,
    grid: {
      columns,
      rows,
      cellWidth: safe.w / columns,
      cellHeight: safe.h / rows,
    },
    title,
    author,
    illustration,
    elements: {
      title: title.contentBox,
      author: author.contentBox,
      illustration: illustration.box,
    },
  };
}

export function clampNormalizedPosition(position, grid = null) {
  const width = clamp(Number(position.w) || 0, 0, 1);
  const height = clamp(Number(position.h) || 0, 0, 1);
  let x = clamp(Number(position.x) || 0, 0, Math.max(0, 1 - width));
  let y = clamp(Number(position.y) || 0, 0, Math.max(0, 1 - height));

  if (grid) {
    const stepX = 1 / Math.max(1, grid.columns);
    const stepY = 1 / Math.max(1, grid.rows);
    x = clamp(Math.round(x / stepX) * stepX, 0, Math.max(0, 1 - width));
    y = clamp(Math.round(y / stepY) * stepY, 0, Math.max(0, 1 - height));
  }

  return { ...position, x, y, w: width, h: height };
}
