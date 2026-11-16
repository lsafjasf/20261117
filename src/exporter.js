import { buildScene, renderTileBuffer } from "./render.js";

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function number(value) {
  return Number(value.toFixed(3)).toString();
}

function rotationAttribute(shape) {
  if (!shape.rotation) return "";
  const center = shape.rotationCenter || { x: shape.cx ?? 0, y: shape.cy ?? 0 };
  return ` transform="rotate(${number(shape.rotation)} ${number(center.x)} ${number(
    center.y
  )})"`;
}

function paintAttributes(shape) {
  const attributes = [
    `fill="${shape.fill && shape.fill !== "none" ? escapeXml(shape.fill) : "none"}"`
  ];
  if (shape.opacity !== undefined && shape.opacity !== 1) {
    attributes.push(`opacity="${number(shape.opacity)}"`);
  }
  if (shape.stroke && shape.stroke !== "none") {
    attributes.push(`stroke="${escapeXml(shape.stroke)}"`);
    attributes.push(`stroke-width="${number(shape.strokeWidth || 0)}"`);
    attributes.push('stroke-linecap="round"');
    attributes.push('stroke-linejoin="round"');
  }
  return attributes.join(" ");
}

function shapeToSvg(shape, index) {
  if (shape.type === "circle") {
    return `<circle data-shape-index="${index}" cx="${number(shape.cx)}" cy="${number(
      shape.cy
    )}" r="${number(shape.r)}" ${paintAttributes(shape)}/>`;
  }
  if (shape.type === "ellipse") {
    const rotation = rotationAttribute(shape);
    return `<ellipse data-shape-index="${index}" cx="${number(shape.cx)}" cy="${number(
      shape.cy
    )}" rx="${number(shape.rx)}" ry="${number(shape.ry)}" ${paintAttributes(
      shape
    )}${rotation}/>`;
  }
  if (shape.type === "path") {
    const rotation = rotationAttribute(shape);
    return `<path data-shape-index="${index}" d="${escapeXml(shape.d)}" ${paintAttributes(
      shape
    )}${rotation}/>`;
  }
  return "";
}

function textToSvg(line, index) {
  if (!line.text) return "";
  return `<text data-text-line="${index}" x="${number(line.x)}" y="${number(
    line.baseline
  )}" font-family="${escapeXml(line.fontFamily)}" font-size="${number(
    line.fontSize
  )}" font-weight="${line.fontWeight}" text-anchor="${line.anchor}" fill="${escapeXml(
    line.fill
  )}">${escapeXml(line.text)}</text>`;
}

export function buildSvg(project, scheme, measure) {
  const scene = buildScene(project, scheme, measure);
  const { width, height } = project.canvas;
  const fontImport =
    '@import url("https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700&display=swap");';
  const offsets = [];
  for (let row = -1; row <= 1; row += 1) {
    for (let column = -1; column <= 1; column += 1) {
      offsets.push({ x: column * width, y: row * height });
    }
  }
  const layers = [];
  scene.shapes.forEach((shape, index) => {
    const repeats = offsets
      .map(
        (offset) =>
          `<g transform="translate(${offset.x} ${offset.y})">${shapeToSvg(
            shape,
            index
          )}</g>`
      )
      .join("");
    layers.push(`<g id="shape-layer-${index}">${repeats}</g>`);
  });
  scene.text.lines.forEach((line, index) => {
    const repeats = offsets
      .map(
        (offset) =>
          `<g transform="translate(${offset.x} ${offset.y})">${textToSvg(line, index)}</g>`
      )
      .join("");
    layers.push(`<g id="text-layer-${index}">${repeats}</g>`);
  });
  const metadata = escapeXml(
    JSON.stringify({
      name: project.name,
      schemaVersion: project.schemaVersion,
      palette: {
        active: scheme.id,
        primary: scheme.colors.primary
      },
      tile: { width, height },
      locked: project.palette.locked
    })
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(
      project.name
    )}">`,
    `<title>${escapeXml(project.name)}</title>`,
    `<metadata>${metadata}</metadata>`,
    `<style type="text/css">${escapeXml(fontImport)}</style>`,
    `<defs><clipPath id="tile-clip"><rect width="${width}" height="${height}"/></clipPath></defs>`,
    `<rect id="tile-background" width="${width}" height="${height}" fill="${escapeXml(
      scene.background
    )}"/>`,
    '<g clip-path="url(#tile-clip)">',
    layers.join(""),
    "</g>",
    "</svg>"
  ].join("\n");
}

export function renderPngBlob(project, scheme, measure, dpr = 1) {
  return new Promise((resolve, reject) => {
    try {
      const scene = buildScene(project, scheme, measure);
      const source = renderTileBuffer(scene);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(project.canvas.width * dpr);
      canvas.height = Math.round(project.canvas.height * dpr);
      const context = canvas.getContext("2d", { alpha: false });
      context.imageSmoothingEnabled = true;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("浏览器无法生成 PNG 数据。"));
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function safeFilename(name, fallback = "seamless-pattern") {
  const cleaned = String(name || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return cleaned || fallback;
}
