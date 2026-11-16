// Deterministic text layout used by BOTH the canvas renderer and the SVG
// serializer so PNG preview and SVG export wrap and shrink text identically.

export const FONT_STACKS = {
  sans: "Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  serif: "Georgia, 'Times New Roman', 'Songti SC', SimSun, 'Noto Serif SC', serif",
  mono: "'Courier New', Consolas, Menlo, monospace",
};

export function fontString(el) {
  const weight = el.fontWeight || 700;
  const style = el.fontStyle === "italic" ? "italic " : "";
  return `${style}${weight} ${el.fontSize}px ${FONT_STACKS[el.fontFamily] || FONT_STACKS.sans}`;
}

// Split into tokens that preserve spaces and support per-character fallback
// for scripts without spaces (CJK).
function tokenize(text) {
  return text
    .split(/(\s+)/)
    .filter((t) => t.length > 0)
    .flatMap((token) => {
      if (/^\s+$/.test(token)) return [{ text: token, breakable: true, space: true }];
      const chars = Array.from(token);
      if (chars.length === 1) return [{ text: token, breakable: false }];
      return chars.map((ch) => ({ text: ch, breakable: true }));
    });
}

export function measureWidth(ctx, text, font) {
  if (ctx && ctx.measureText) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }
  // Node fallback: estimate from code points. Rough but deterministic and
  // only used by headless logic tests; the browser always passes a ctx.
  const sizeMatch = String(font).match(/(\d+(?:\.\d+)?)px/);
  const fontSize = sizeMatch ? Number(sizeMatch[1]) : 16;
  let width = 0;
  for (const ch of text) {
    width += (/\s/.test(ch) ? 0.33 : /[^\u0000-\u00ff]/.test(ch) ? 1 : 0.55) * fontSize;
  }
  return width;
}

function wrapAt(el, ctx, fontSize) {
  const font = fontString({ ...el, fontSize });
  const maxWidth = Math.max(1, el.width);
  const paragraphs = String(el.text || "").split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    const tokens = tokenize(paragraph);
    let line = "";
    for (const token of tokens) {
      if (token.space) {
        if (line) line += token.text;
        continue;
      }
      const candidate = line + token.text;
      if (measureWidth(ctx, candidate, font) <= maxWidth || line === "") {
        line = candidate;
      } else {
        lines.push(line.trimEnd());
        line = token.text;
      }
    }
    lines.push(line.trimEnd());
  }
  const lineHeight = fontSize * (el.lineHeight || 1.25);
  return { lines, lineHeight, font };
}

// Returns lines, final font size, line height and total block height.
// autoFit shrinks the font until the text fits the element box (min 6px).
export function layoutText(el, ctx = null) {
  let fontSize = el.fontSize || 16;
  let result = wrapAt(el, ctx, fontSize);
  const minSize = 6;
  if (el.autoFit) {
    while (fontSize > minSize) {
      const blockHeight = result.lines.length * result.lineHeight;
      const widest = Math.max(
        0,
        ...result.lines.map((line) => measureWidth(ctx, line, result.font))
      );
      if (blockHeight <= el.height && widest <= el.width) break;
      fontSize -= 1;
      result = wrapAt(el, ctx, fontSize);
    }
  }
  const blockHeight = result.lines.length * result.lineHeight;
  return {
    lines: result.lines,
    font: result.font,
    fontSize,
    lineHeight: result.lineHeight,
    blockHeight,
    overflowY: blockHeight > el.height + 0.5,
  };
}

export function alignX(el) {
  return el.textAlign || "left";
}

export function lineX(el, line, ctx, layout) {
  const width = ctx.measureText(line).width;
  if (alignX(el) === "center") return el.width / 2 - width / 2;
  if (alignX(el) === "right") return el.width - width;
  return 0;
}

export function firstBaselineY(el, layout, verticalAlign = el.verticalAlign || "top") {
  if (verticalAlign === "middle") {
    return Math.max(layout.lineHeight, (el.height - layout.blockHeight) / 2 + layout.lineHeight * 0.8);
  }
  if (verticalAlign === "bottom") {
    return Math.max(layout.lineHeight, el.height - layout.blockHeight + layout.lineHeight * 0.8);
  }
  return layout.lineHeight * 0.8;
}
