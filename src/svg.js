// SVG serializer. Text stays as editable <text>/<tspan> elements and shapes
// stay as editable <path> elements; crop is expressed with <clipPath>.
// The geometry and line layout are the same functions the canvas renderer
// uses, which is what makes PNG and SVG output match the on-screen preview.

import { getCrop, shapePath, round } from "./geometry.js";
import { firstBaselineY, fontString, layoutText, lineX, measureWidth } from "./text.js";

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function transform(el) {
  const parts = [];
  if (el.rotation) {
    parts.push(
      `rotate(${round(el.rotation)} ${round(el.x + el.width / 2)} ${round(el.y + el.height / 2)})`
    );
  }
  parts.push(`translate(${round(el.x)} ${round(el.y)})`);
  return parts.join(" ");
}

function textSvg(el, ctx, defs) {
  const crop = getCrop(el);
  const clipped = crop.x !== 0 || crop.y !== 0 || crop.width !== el.width || crop.height !== el.height;
  const clipId = `clip-${el.id}`;
  if (clipped) {
    defs.push(
      `<clipPath id="${clipId}"><rect x="${round(crop.x)}" y="${round(crop.y)}" width="${round(crop.width)}" height="${round(crop.height)}"/></clipPath>`
    );
  }
  const layout = layoutText(el, ctx);
  const baseline = firstBaselineY(el, layout);
  const measureCtx = makeMeasureCtx(ctx, layout.font);
  const tspans = layout.lines
    .map((line, i) => {
      const y = round(baseline + i * layout.lineHeight);
      return `<tspan x="${round(lineX(el, line, measureCtx, layout))}" y="${y}">${esc(line)}</tspan>`;
    })
    .join("");
  const attrs = [
    `data-id="${esc(el.id)}"`,
    `font-family="${esc(fontFamilyCsv(el))}"`,
    `font-size="${round(layout.fontSize)}"`,
    `font-weight="${el.fontWeight || 700}"`,
    el.fontStyle === "italic" ? 'font-style="italic"' : "",
    `fill="${esc(el.fill || "#111111")}"`,
    `xml:space="preserve"`,
    clipped ? `clip-path="url(#${clipId})"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<g transform="${transform(el)}" data-id="${esc(el.id)}" data-name="${esc(el.name || el.id)}"><text ${attrs}>${tspans}</text></g>`;
}

function makeMeasureCtx(ctx, font) {
  return {
    _font: font,
    set font(value) { this._font = value; },
    get font() { return this._font; },
    measureText(text) { return { width: measureWidth(ctx, text, this._font) }; },
  };
}

function fontFamilyCsv(el) {
  const raw = fontString(el);
  const match = raw.match(/(?:italic )?(?:\d+) (?:\d+(?:\.\d+)?)px (.*)$/);
  return match ? match[1] : "sans-serif";
}

function shapeSvg(el, defs) {
  const crop = getCrop(el);
  const clipped = crop.x !== 0 || crop.y !== 0 || crop.width !== el.width || crop.height !== el.height;
  const clipId = `clip-${el.id}`;
  if (clipped) {
    defs.push(
      `<clipPath id="${clipId}"><rect x="${round(crop.x)}" y="${round(crop.y)}" width="${round(crop.width)}" height="${round(crop.height)}"/></clipPath>`
    );
  }
  const attrs = [
    `data-id="${esc(el.id)}"`,
    `data-name="${esc(el.name || el.id)}"`,
    `d="${shapePath(el)}"`,
    `fill="${esc(el.fill || "#3b82f6")}"`,
    el.stroke ? `stroke="${esc(el.stroke)}"` : "",
    el.strokeWidth ? `stroke-width="${round(el.strokeWidth)}"` : "",
    clipped ? `clip-path="url(#${clipId})"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<g transform="${transform(el)}"><path ${attrs}/></g>`;
}

export function toSvg(doc, ctx = null) {
  const defs = [];
  const body = doc.elements.map((el) => {
    if (el.type === "text") return textSvg(el, ctx, defs);
    return shapeSvg(el, defs);
  });
  const bg = doc.background || "#ffffff";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`,
    `<title>${esc(doc.name || "poster")}</title>`,
    defs.length ? `<defs>${defs.join("")}</defs>` : "",
    `<rect width="${doc.width}" height="${doc.height}" fill="${esc(bg)}"/>`,
    body.join("\n"),
    "</svg>",
  ]
    .filter(Boolean)
    .join("\n");
}
