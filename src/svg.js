import { getIllustrationPrimitives } from "./artwork.js";

function number(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(rounded) ? String(rounded) : "0";
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function opacityAttributes(primitive) {
  const attributes = [];
  if (primitive.fillOpacity !== undefined) {
    attributes.push(`fill-opacity="${number(primitive.fillOpacity)}"`);
  }
  if (primitive.strokeOpacity !== undefined) {
    attributes.push(`stroke-opacity="${number(primitive.strokeOpacity)}"`);
  }
  return attributes;
}

function paintAttributes(primitive) {
  const attributes = [];
  if (primitive.fill !== undefined) attributes.push(`fill="${escapeXml(primitive.fill)}"`);
  if (primitive.stroke !== undefined) {
    attributes.push(`stroke="${escapeXml(primitive.stroke)}"`);
  }
  if (primitive.strokeWidth !== undefined) {
    attributes.push(`stroke-width="${number(primitive.strokeWidth)}"`);
  }
  if (primitive.strokeLinecap) {
    attributes.push(`stroke-linecap="${escapeXml(primitive.strokeLinecap)}"`);
  }
  return [...attributes, ...opacityAttributes(primitive)].join(" ");
}

function primitiveToSvg(primitive, index) {
  const paint = paintAttributes(primitive);
  const editable = `data-editable="illustration-shape" data-shape-index="${index}"`;

  if (primitive.type === "circle") {
    return `<circle cx="${number(primitive.cx)}" cy="${number(primitive.cy)}" r="${number(
      primitive.r,
    )}" ${paint} ${editable}/>`;
  }

  if (primitive.type === "ellipse") {
    const rotation =
      primitive.rotate !== undefined && primitive.rotate !== 0
        ? ` transform="rotate(${number(primitive.rotate)} ${number(primitive.cx)} ${number(
            primitive.cy,
          )})"`
        : "";
    return `<ellipse cx="${number(primitive.cx)}" cy="${number(primitive.cy)}" rx="${number(
      primitive.rx,
    )}" ry="${number(primitive.ry)}"${rotation} ${paint} ${editable}/>`;
  }

  if (primitive.type === "rect") {
    return `<rect x="${number(primitive.x)}" y="${number(primitive.y)}" width="${number(
      primitive.w,
    )}" height="${number(primitive.h)}" rx="${number(primitive.rx ?? 0)}" ${paint} ${editable}/>`;
  }

  if (primitive.type === "line") {
    return `<line x1="${number(primitive.x1)}" y1="${number(primitive.y1)}" x2="${number(
      primitive.x2,
    )}" y2="${number(primitive.y2)}" ${paint} ${editable}/>`;
  }

  return `<path d="${escapeXml(primitive.d)}" ${paint} ${editable}/>`;
}

function textBlockToSvg(id, block, label) {
  const anchor =
    block.align === "center" ? "middle" : block.align === "right" ? "end" : "start";
  const tspans = block.lines
    .map(
      (line, index) =>
        `<tspan x="${number(line.x)}" y="${number(line.baseline)}" data-line="${index + 1}">${escapeXml(
          line.text,
        )}</tspan>`,
    )
    .join("\n      ");

  return [
    `<g id="${id}" data-editable="${id}" aria-label="${escapeXml(label)}">`,
    `    <text id="${id}-text" xml:space="preserve" font-family="${escapeXml(
      block.font.replace(/^\d+\s+[\d.]+px\s+/, ""),
    )}" font-size="${number(block.fontSize)}" font-weight="${
      id === "title" ? "700" : "600"
    }" fill="${escapeXml(block.fill)}" letter-spacing="${number(
      block.letterSpacing,
    )}" text-anchor="${anchor}" style="text-rendering:geometricPrecision">`,
    `      ${tspans}`,
    "    </text>",
    "  </g>",
  ].join("\n");
}

function fontEmbedStyle(fontEmbed) {
  if (!fontEmbed?.dataUrl || !fontEmbed?.family) return "";
  return [
    "  <style>",
    `    @font-face { font-family: "${escapeXml(fontEmbed.family)}"; src: url("${
      fontEmbed.dataUrl
    }") format("woff2"); font-style: normal; font-weight: 400; }`,
    "    text { font-synthesis: weight; }",
    "  </style>",
  ].join("\n");
}

export function designToSvg(layout, design, { fontEmbed = null } = {}) {
  const primitives = getIllustrationPrimitives(layout, design);
  const shapes = primitives
    .map((primitive, index) => `    ${primitiveToSvg(primitive, index)}`)
    .join("\n");
  const title = textBlockToSvg("title", layout.title, "书名");
  const author = textBlockToSvg("author", layout.author, "作者");
  const embed = fontEmbedStyle(fontEmbed);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${number(
      layout.width,
    )}" height="${number(layout.height)}" viewBox="0 0 ${number(
      layout.width,
    )} ${number(layout.height)}" role="img" aria-labelledby="cover-title cover-desc">`,
    `  <title id="cover-title">${escapeXml(design.title || "未命名书封")}</title>`,
    `  <desc id="cover-desc">由 Folio 书封工坊生成；文字和图形均保留为可编辑 SVG 元素。</desc>`,
    ...(embed ? [embed] : []),
    `  <rect id="cover-background" data-editable="background" x="0" y="0" width="${number(
      layout.width,
    )}" height="${number(layout.height)}" fill="${escapeXml(design.theme.background)}"/>`,
    '  <g id="illustration" data-editable="illustration">',
    shapes,
    "  </g>",
    `  ${title.replaceAll("\n", "\n  ")}`,
    `  ${author.replaceAll("\n", "\n  ")}`,
    "</svg>",
    "",
  ].join("\n");
}
