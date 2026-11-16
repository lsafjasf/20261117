export const FONT_FAMILY =
  '"Noto Serif SC", "Songti SC", "STSong", Georgia, serif';

const TAU = Math.PI * 2;

export function fontFor(weight, size) {
  return `${weight} ${Math.max(1, size)}px ${FONT_FAMILY}`;
}

export function approximateTextWidth(text, font) {
  const match = String(font).match(/([\d.]+)px/);
  const size = match ? Number(match[1]) : 16;
  let width = 0;
  for (const char of Array.from(String(text))) {
    if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(char)) width += size;
    else if (/\s/.test(char)) width += size * 0.28;
    else if (/[A-Z0-9]/.test(char)) width += size * 0.64;
    else width += size * 0.53;
  }
  return width;
}

function tokenizeParagraph(paragraph) {
  return paragraph.match(/[A-Za-z0-9]+(?:[’'\-][A-Za-z0-9]+)*|\s+|./gu) || [];
}

function breakLongToken(token, maxWidth, font, measure) {
  const parts = [];
  let current = "";
  for (const char of Array.from(token)) {
    const candidate = current + char;
    if (current && measure(candidate, font) > maxWidth) {
      parts.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function wrapText(text, maxWidth, font, measure = approximateTextWidth) {
  const source = String(text ?? "");
  if (!source) return [];
  const output = [];
  for (const paragraph of source.split(/\r?\n/)) {
    if (!paragraph) {
      output.push("");
      continue;
    }
    const tokens = tokenizeParagraph(paragraph);
    let current = "";
    for (const token of tokens) {
      const candidate = current + token;
      if (!current || measure(candidate, font) <= maxWidth) {
        if (measure(token, font) > maxWidth && !current) {
          const pieces = breakLongToken(token, maxWidth, font, measure);
          pieces.forEach((piece, index) => {
            if (index === pieces.length - 1) current = piece;
            else output.push(piece);
          });
        } else {
          current = candidate;
        }
        continue;
      }
      output.push(current.trimEnd());
      current = token.trimStart();
      if (measure(current, font) > maxWidth) {
        const pieces = breakLongToken(current, maxWidth, font, measure);
        pieces.forEach((piece, index) => {
          if (index === pieces.length - 1) current = piece;
          else output.push(piece);
        });
      }
    }
    if (current || paragraph === "") output.push(current.trimEnd());
  }
  return output;
}

function anchoredX(x, width, align) {
  if (align === "left") return x;
  if (align === "right") return x - width;
  return x - width / 2;
}

function buildTextLines({
  lines,
  x,
  top,
  fontSize,
  lineHeight,
  weight,
  align,
  fill,
  role,
  measure
}) {
  const font = fontFor(weight, fontSize);
  return lines.map((text, index) => {
    const width = text ? measure(text, font) : 0;
    const baseline = top + fontSize * 0.88 + index * lineHeight;
    return {
      text,
      x,
      baseline,
      fontSize,
      lineHeight,
      fontWeight: weight,
      fontFamily: FONT_FAMILY,
      font,
      align,
      anchor: align === "left" ? "start" : align === "right" ? "end" : "middle",
      fill,
      role,
      width,
      bbox: {
        x: anchoredX(x, width, align),
        y: baseline - fontSize * 0.88,
        width,
        height: fontSize * 1.06
      }
    };
  });
}

function linesBbox(lines) {
  if (!lines.length) return null;
  const left = Math.min(...lines.map((line) => line.bbox.x));
  const top = Math.min(...lines.map((line) => line.bbox.y));
  const right = Math.max(...lines.map((line) => line.bbox.x + line.bbox.width));
  const bottom = Math.max(...lines.map((line) => line.bbox.y + line.bbox.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function layoutText(project, colors, measure = approximateTextWidth) {
  const { width, height } = project.canvas;
  const settings = project.text;
  if (!settings.enabled) {
    return {
      titleLines: [],
      subtitleLines: [],
      lines: [],
      titleBlock: null,
      subtitleBlock: null,
      block: null,
      fontSizes: { title: settings.titleSize, subtitle: settings.subtitleSize }
    };
  }
  const titleFont = fontFor(700, settings.titleSize);
  const subtitleFont = fontFor(500, settings.subtitleSize);
  const titleTexts = wrapText(settings.title, settings.maxWidth, titleFont, measure);
  const subtitleTexts = wrapText(settings.subtitle, settings.maxWidth, subtitleFont, measure);
  const titleLineHeight = settings.titleSize * 1.18;
  const subtitleLineHeight = settings.subtitleSize * 1.2;
  const titleHeight = titleTexts.length
    ? (titleTexts.length - 1) * titleLineHeight + settings.titleSize * 1.06
    : 0;
  const subtitleHeight = subtitleTexts.length
    ? (subtitleTexts.length - 1) * subtitleLineHeight + settings.subtitleSize * 1.06
    : 0;
  const gap = titleTexts.length && subtitleTexts.length ? settings.lineGap : 0;
  const totalHeight = titleHeight + gap + subtitleHeight;
  const x = settings.x * width;
  const blockTop = settings.y * height - totalHeight / 2;
  const titleLines = buildTextLines({
    lines: titleTexts,
    x,
    top: blockTop,
    fontSize: settings.titleSize,
    lineHeight: titleLineHeight,
    weight: 700,
    align: settings.align,
    fill: colors[settings.titleColorRole],
    role: settings.titleColorRole,
    measure
  });
  const subtitleLines = buildTextLines({
    lines: subtitleTexts,
    x,
    top: blockTop + titleHeight + gap,
    fontSize: settings.subtitleSize,
    lineHeight: subtitleLineHeight,
    weight: 500,
    align: settings.align,
    fill: colors[settings.subtitleColorRole],
    role: settings.subtitleColorRole,
    measure
  });
  const lines = [...titleLines, ...subtitleLines];
  return {
    titleLines,
    subtitleLines,
    lines,
    titleBlock: linesBbox(titleLines),
    subtitleBlock: linesBbox(subtitleLines),
    block: linesBbox(lines),
    blockTop,
    totalHeight,
    fontSizes: { title: settings.titleSize, subtitle: settings.subtitleSize },
    maxWidth: settings.maxWidth
  };
}

function circle(cx, cy, r, fill, options = {}) {
  return { type: "circle", cx, cy, r, fill, ...options };
}

function ellipse(cx, cy, rx, ry, fill, options = {}) {
  return { type: "ellipse", cx, cy, rx, ry, fill, ...options };
}

function path(d, fill, options = {}) {
  return { type: "path", d, fill, ...options };
}

function diamondPath(cx, cy, radius) {
  return `M ${cx} ${cy - radius} L ${cx + radius} ${cy} L ${cx} ${cy + radius} L ${
    cx - radius
  } ${cy} Z`;
}

function petalShape(cx, cy, radius, angle, colors, options) {
  const distance = radius * 0.43;
  const rotation = angle + 90;
  return ellipse(
    cx + Math.cos(angle) * distance,
    cy + Math.sin(angle) * distance,
    radius * 0.25,
    radius * 0.46,
    colors.primary,
    {
      rotation,
      opacity: options.petalOpacity,
      stroke: colors.background,
      strokeWidth: options.hairline
    }
  );
}

function bloomMotif(project, colors, center, radius, hairline) {
  const shapes = [];
  const rotation = (project.motif.rotation * Math.PI) / 180;
  for (let index = 0; index < project.motif.petals; index += 1) {
    const angle = rotation + (index / project.motif.petals) * TAU;
    shapes.push(
      petalShape(center.x, center.y, radius, angle, colors, {
        petalOpacity: index % 2 === 0 ? 0.94 : 0.72,
        hairline
      })
    );
  }
  shapes.push(circle(center.x, center.y, radius * 0.33, colors.background, { opacity: 0.96 }));
  shapes.push(
    circle(center.x, center.y, radius * 0.29, "none", {
      stroke: colors.secondary,
      strokeWidth: Math.max(1, hairline * 1.4)
    })
  );
  shapes.push(circle(center.x, center.y, radius * 0.12, colors.accent));
  shapes.push(circle(center.x, center.y, radius * 0.045, colors.background));
  return shapes;
}

function diamondMotif(project, colors, center, radius, hairline) {
  const shapes = [];
  const rotation = project.motif.rotation;
  shapes.push(
    path(diamondPath(center.x, center.y, radius), colors.primary, {
      opacity: 0.94,
      rotation,
      rotationCenter: center
    })
  );
  shapes.push(
    path(diamondPath(center.x, center.y, radius * 0.68), colors.background, {
      opacity: 0.93,
      rotation: rotation + 45,
      rotationCenter: center
    })
  );
  shapes.push(
    path(diamondPath(center.x, center.y, radius * 0.45), colors.secondary, {
      opacity: 0.96,
      rotation,
      rotationCenter: center
    })
  );
  shapes.push(
    path(diamondPath(center.x, center.y, radius * 0.2), colors.accent, {
      rotation: rotation + 45,
      rotationCenter: center
    })
  );
  shapes.push(
    circle(center.x, center.y, radius * 0.06, colors.background, {
      stroke: colors.primary,
      strokeWidth: hairline
    })
  );
  return shapes;
}

function orbitMotif(project, colors, center, radius, hairline) {
  const shapes = [];
  for (let index = 0; index < 3; index += 1) {
    const ringRadius = radius * (0.38 + index * 0.22);
    shapes.push(
      circle(center.x, center.y, ringRadius, "none", {
        stroke: index % 2 ? colors.accent : colors.secondary,
        strokeWidth: Math.max(1, hairline * (index === 0 ? 1.8 : 1)),
        opacity: index === 2 ? 0.55 : 0.9
      })
    );
  }
  const rotation = (project.motif.rotation * Math.PI) / 180;
  for (let index = 0; index < project.motif.petals; index += 1) {
    const angle = rotation + (index / project.motif.petals) * TAU;
    shapes.push(
      circle(
        center.x + Math.cos(angle) * radius * 0.72,
        center.y + Math.sin(angle) * radius * 0.72,
        radius * 0.045,
        index % 2 ? colors.accent : colors.primary
      )
    );
  }
  shapes.push(circle(center.x, center.y, radius * 0.25, colors.primary));
  shapes.push(circle(center.x, center.y, radius * 0.16, colors.background));
  shapes.push(circle(center.x, center.y, radius * 0.05, colors.secondary));
  return shapes;
}

function cornerOrnaments(project, colors, hairline) {
  const { width, height } = project.canvas;
  const size = Math.min(width, height);
  const radius = size * 0.045;
  const shapes = [];
  const [cornerX, cornerY] = [0, 0];
  shapes.push(
    circle(cornerX, cornerY, radius, colors.primary, {
      opacity: 0.58,
      stroke: colors.background,
      strokeWidth: hairline
    })
  );
  shapes.push(circle(cornerX, cornerY, radius * 0.42, colors.background, { opacity: 0.82 }));
  const diamonds = [
    [width / 2, 0],
    [0, height / 2]
  ];
  diamonds.forEach(([x, y]) => {
    shapes.push(
      path(diamondPath(x, y, size * 0.028), colors.secondary, {
        opacity: 0.72,
        rotation: 45,
        rotationCenter: { x, y }
      })
    );
  });
  return shapes;
}

export function buildScene(project, scheme, measure = approximateTextWidth) {
  const colors = scheme.colors;
  const { width, height } = project.canvas;
  const center = { x: width / 2, y: height / 2 };
  const size = Math.min(width, height);
  const radius = (size * project.motif.scale) / 2;
  const hairline = Math.max(1, size * 0.0032);
  const shapes = cornerOrnaments(project, colors, hairline);
  const orbitRotation = (project.motif.rotation * Math.PI) / 180;
  for (let index = 0; index < project.motif.orbitCount; index += 1) {
    const angle = orbitRotation + (index / Math.max(1, project.motif.orbitCount)) * TAU;
    shapes.push(
      circle(
        center.x + Math.cos(angle) * size * project.motif.orbitRadius,
        center.y + Math.sin(angle) * size * project.motif.orbitRadius,
        size * project.motif.orbitDot,
        index % 3 === 0 ? colors.accent : colors.secondary,
        { opacity: 0.86 }
      )
    );
  }
  if (project.motif.kind === "diamond") {
    shapes.push(...diamondMotif(project, colors, center, radius, hairline));
  } else if (project.motif.kind === "orbit") {
    shapes.push(...orbitMotif(project, colors, center, radius, hairline));
  } else {
    shapes.push(...bloomMotif(project, colors, center, radius, hairline));
  }
  const clearRadius = size * 0.33;
  if (project.motif.showPlate) {
    shapes.push(
      circle(center.x, center.y, clearRadius, colors.background, {
        opacity: 0.92,
        stroke: colors.accent,
        strokeWidth: hairline * 1.2
      })
    );
    shapes.push(
      circle(center.x, center.y, clearRadius - hairline * 4, "none", {
        stroke: colors.primary,
        strokeWidth: hairline,
        opacity: 0.68
      })
    );
  }
  const text = layoutText(project, colors, measure);
  return {
    width,
    height,
    background: colors.background,
    colors,
    shapes,
    text,
    center,
    clearZone: {
      cx: center.x,
      cy: center.y,
      r: clearRadius,
      top: center.y - clearRadius,
      bottom: center.y + clearRadius,
      left: center.x - clearRadius,
      right: center.x + clearRadius
    },
    hairline
  };
}

function drawShape(ctx, shape) {
  const rotation = ((shape.rotation || 0) * Math.PI) / 180;
  ctx.save();
  ctx.globalAlpha = shape.opacity ?? 1;
  ctx.fillStyle = shape.fill || "none";
  ctx.strokeStyle = shape.stroke || "none";
  ctx.lineWidth = shape.strokeWidth || 0;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (shape.type === "circle") {
    ctx.translate(shape.cx, shape.cy);
    if (rotation) ctx.rotate(rotation);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(0.01, shape.r), 0, TAU);
  } else if (shape.type === "ellipse") {
    ctx.translate(shape.cx, shape.cy);
    if (rotation) ctx.rotate(rotation);
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(0.01, shape.rx), Math.max(0.01, shape.ry), 0, 0, TAU);
  } else if (shape.type === "path") {
    const center = shape.rotationCenter || { x: 0, y: 0 };
    ctx.translate(center.x, center.y);
    if (rotation) ctx.rotate(rotation);
    ctx.translate(-center.x, -center.y);
    ctx.beginPath();
    const pathData = new Path2D(shape.d);
    if (shape.fill && shape.fill !== "none") ctx.fill(pathData);
    if (shape.stroke && shape.stroke !== "none" && shape.strokeWidth) ctx.stroke(pathData);
    ctx.restore();
    return;
  } else {
    ctx.restore();
    return;
  }
  if (shape.fill && shape.fill !== "none") ctx.fill();
  if (shape.stroke && shape.stroke !== "none" && shape.strokeWidth) ctx.stroke();
  ctx.restore();
}

function drawTextLine(ctx, line, offsetX = 0, offsetY = 0) {
  if (!line.text) return;
  ctx.save();
  ctx.font = line.font;
  ctx.fillStyle = line.fill;
  ctx.textAlign = line.align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(line.text, line.x + offsetX, line.baseline + offsetY);
  ctx.restore();
}

export function paintPattern(
  ctx,
  scene,
  { tiles = 1, showSeams = false, transparent = false } = {}
) {
  const targetWidth = scene.width * tiles;
  const targetHeight = scene.height * tiles;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, targetWidth, targetHeight);
  ctx.clip();
  if (!transparent) {
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }
  for (const shape of scene.shapes) {
    for (let row = -1; row <= tiles; row += 1) {
      for (let column = -1; column <= tiles; column += 1) {
        const offsetX = column * scene.width;
        const offsetY = row * scene.height;
        ctx.save();
        ctx.translate(offsetX, offsetY);
        drawShape(ctx, shape);
        ctx.restore();
      }
    }
  }
  for (const line of scene.text.lines) {
    for (let row = -1; row <= tiles; row += 1) {
      for (let column = -1; column <= tiles; column += 1) {
        drawTextLine(ctx, line, column * scene.width, row * scene.height);
      }
    }
  }
  ctx.restore();
  if (showSeams && tiles > 1) {
    ctx.save();
    ctx.lineWidth = Math.max(1, scene.hairline);
    ctx.setLineDash([scene.hairline * 5, scene.hairline * 4]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    for (let index = 1; index < tiles; index += 1) {
      const x = index * scene.width;
      const y = index * scene.height;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, targetHeight);
      ctx.moveTo(0, y);
      ctx.lineTo(targetWidth, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function sizeCanvasForDisplay(canvas, cssWidth, cssHeight, dpr = 1) {
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  return { width, height };
}

export function paintCanvasPreview(
  canvas,
  scene,
  { cssWidth, cssHeight, tiles = 1, showSeams = false, dpr = 1 } = {}
) {
  const backing = sizeCanvasForDisplay(canvas, cssWidth, cssHeight, dpr);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(
    backing.width / (scene.width * tiles),
    0,
    0,
    backing.height / (scene.height * tiles),
    0,
    0
  );
  ctx.imageSmoothingEnabled = true;
  paintPattern(ctx, scene, { tiles, showSeams });
  return ctx;
}

export function renderTileBuffer(scene) {
  const buffer = document.createElement("canvas");
  buffer.width = scene.width;
  buffer.height = scene.height;
  const context = buffer.getContext("2d", { alpha: false });
  context.setTransform(1, 0, 0, 1, 0, 0);
  paintPattern(context, scene, { tiles: 1 });
  return buffer;
}

export function paintCanvasTile(canvas, scene, { cssWidth, cssHeight, dpr = 1 } = {}) {
  const buffer = renderTileBuffer(scene);
  const backing = sizeCanvasForDisplay(canvas, cssWidth, cssHeight, dpr);
  const context = canvas.getContext("2d", { alpha: false });
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(buffer, 0, 0, backing.width, backing.height);
  return context;
}

export function renderPreviewBuffer(scene, tiles = 3) {
  const tile = renderTileBuffer(scene);
  const buffer = document.createElement("canvas");
  buffer.width = scene.width * tiles;
  buffer.height = scene.height * tiles;
  const context = buffer.getContext("2d", { alpha: false });
  context.imageSmoothingEnabled = false;
  for (let row = 0; row < tiles; row += 1) {
    for (let column = 0; column < tiles; column += 1) {
      context.drawImage(tile, column * scene.width, row * scene.height);
    }
  }
  return buffer;
}

export function paintCanvasTiledPreview(
  canvas,
  scene,
  { cssWidth, cssHeight, tiles = 3, showSeams = false, dpr = 1 } = {}
) {
  const preview = renderPreviewBuffer(scene, tiles);
  const backing = sizeCanvasForDisplay(canvas, cssWidth, cssHeight, dpr);
  const context = canvas.getContext("2d", { alpha: false });
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(preview, 0, 0, backing.width, backing.height);
  if (showSeams && tiles > 1) {
    context.setTransform(
      backing.width / (scene.width * tiles),
      0,
      0,
      backing.height / (scene.height * tiles),
      0,
      0
    );
    context.save();
    context.lineWidth = Math.max(1, scene.hairline);
    context.setLineDash([scene.hairline * 5, scene.hairline * 4]);
    context.strokeStyle = "rgba(255, 255, 255, 0.72)";
    for (let index = 1; index < tiles; index += 1) {
      const x = index * scene.width;
      const y = index * scene.height;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, scene.height * tiles);
      context.moveTo(0, y);
      context.lineTo(scene.width * tiles, y);
      context.stroke();
    }
    context.restore();
  }
  return context;
}
