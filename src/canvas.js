import { getIllustrationPrimitives } from "./artwork.js";

function drawPath(ctx, primitive) {
  if (typeof Path2D !== "function") return;
  const path = new Path2D(primitive.d);
  if (primitive.fill && primitive.fill !== "none") {
    ctx.fillStyle = primitive.fill;
    ctx.globalAlpha = primitive.fillOpacity ?? 1;
    ctx.fill(path);
  }
  if (primitive.stroke && primitive.stroke !== "none") {
    ctx.strokeStyle = primitive.stroke;
    ctx.globalAlpha = primitive.strokeOpacity ?? 1;
    ctx.lineWidth = primitive.strokeWidth ?? 1;
    ctx.stroke(path);
  }
}

export function drawPrimitive(ctx, primitive) {
  ctx.save();
  ctx.globalAlpha = primitive.opacity ?? 1;

  if (primitive.type === "circle") {
    ctx.beginPath();
    ctx.arc(primitive.cx, primitive.cy, primitive.r, 0, Math.PI * 2);
  } else if (primitive.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      primitive.cx,
      primitive.cy,
      primitive.rx,
      primitive.ry,
      ((primitive.rotate ?? 0) * Math.PI) / 180,
      0,
      Math.PI * 2,
    );
  } else if (primitive.type === "rect") {
    ctx.beginPath();
    ctx.roundRect(
      primitive.x,
      primitive.y,
      primitive.w,
      primitive.h,
      primitive.rx ?? 0,
    );
  } else if (primitive.type === "line") {
    ctx.beginPath();
    ctx.moveTo(primitive.x1, primitive.y1);
    ctx.lineTo(primitive.x2, primitive.y2);
  } else if (primitive.type === "path") {
    drawPath(ctx, primitive);
    ctx.restore();
    return;
  }

  if (primitive.fill && primitive.fill !== "none") {
    ctx.fillStyle = primitive.fill;
    ctx.globalAlpha = primitive.fillOpacity ?? 1;
    ctx.fill();
  }
  if (primitive.stroke && primitive.stroke !== "none") {
    ctx.strokeStyle = primitive.stroke;
    ctx.globalAlpha = primitive.strokeOpacity ?? 1;
    ctx.lineWidth = primitive.strokeWidth ?? 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawTextBlock(ctx, block) {
  ctx.save();
  ctx.font = block.font;
  ctx.fillStyle = block.fill;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = block.align === "center" ? "center" : block.align === "right" ? "right" : "left";

  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = `${block.letterSpacing}px`;
  }

  for (const line of block.lines) {
    ctx.fillText(line.text, line.x, line.baseline);
  }
  ctx.restore();
}

function drawPrimitives(ctx, primitives) {
  for (const primitive of primitives) drawPrimitive(ctx, primitive);
}

function strokeGuideRect(ctx, box, { dashed = false, color = "rgba(255,255,255,.88)" } = {}) {
  ctx.save();
  ctx.setLineDash(dashed ? [7, 6] : []);
  ctx.lineJoin = "round";

  ctx.strokeStyle = "rgba(20,20,18,.58)";
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x, box.y, box.w, box.h);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

function drawGuides(ctx, layout, design) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.safe.x, layout.safe.y, layout.safe.w, layout.safe.h);
  ctx.clip();

  if (design.grid.showGrid) {
    ctx.setLineDash([3, 6]);
    for (let column = 1; column < layout.grid.columns; column += 1) {
      const x = layout.safe.x + layout.grid.cellWidth * column;
      ctx.beginPath();
      ctx.moveTo(x, layout.safe.y);
      ctx.lineTo(x, layout.safe.y + layout.safe.h);
      ctx.strokeStyle = "rgba(255,255,255,.24)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (let row = 1; row < layout.grid.rows; row += 1) {
      const y = layout.safe.y + layout.grid.cellHeight * row;
      ctx.beginPath();
      ctx.moveTo(layout.safe.x, y);
      ctx.lineTo(layout.safe.x + layout.safe.w, y);
      ctx.strokeStyle = "rgba(255,255,255,.24)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();

  if (design.grid.showSafe) {
    strokeGuideRect(ctx, layout.safe, { dashed: true, color: "rgba(255,234,188,.9)" });
    const labelSize = Math.max(7, layout.minDimension * 0.0115);
    const labelX = layout.safe.x + labelSize * 0.36;
    const labelY = layout.safe.y + labelSize * 1.6;
    ctx.save();
    ctx.font = `700 ${labelSize}px "Arial", sans-serif`;
    ctx.fillStyle = "rgba(255,234,188,.95)";
    ctx.shadowColor = "rgba(0,0,0,.65)";
    ctx.shadowBlur = 3;
    ctx.fillText("SAFE AREA", labelX, labelY);
    ctx.restore();
  }
}

function drawSelection(ctx, layout, selected) {
  if (!selected) return;
  const contentBox =
    selected === "illustration" ? layout.illustration.box : layout[selected].contentBox;
  if (!contentBox || contentBox.w <= 0 || contentBox.h <= 0) return;

  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = "#ff7657";
  ctx.lineWidth = Math.max(1.2, layout.minDimension * 0.0022);
  ctx.strokeRect(
    contentBox.x - 3,
    contentBox.y - 3,
    contentBox.w + 6,
    contentBox.h + 6,
  );

  const handle = Math.max(4, layout.minDimension * 0.008);
  ctx.setLineDash([]);
  ctx.fillStyle = "#ff7657";
  for (const [x, y] of [
    [contentBox.x - 3, contentBox.y - 3],
    [contentBox.x + contentBox.w + 3, contentBox.y - 3],
    [contentBox.x - 3, contentBox.y + contentBox.h + 3],
    [contentBox.x + contentBox.w + 3, contentBox.y + contentBox.h + 3],
  ]) {
    ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
  }
  ctx.restore();
}

function drawIssueHighlight(ctx, layout, element) {
  if (!element) return;
  const box =
    element === "illustration"
      ? layout.illustration.box
      : element === "canvas"
        ? { x: 0, y: 0, w: layout.width, h: layout.height }
        : layout[element]?.contentBox;
  if (!box) return;

  ctx.save();
  ctx.fillStyle = "rgba(212,65,48,.12)";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  strokeGuideRect(ctx, box, { dashed: false, color: "rgba(255,107,88,.98)" });
  ctx.restore();
}

export function drawCover(ctx, layout, design, options = {}) {
  ctx.save();
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = design.theme.background;
  ctx.fillRect(0, 0, layout.width, layout.height);

  drawPrimitives(ctx, getIllustrationPrimitives(layout, design));
  drawTextBlock(ctx, layout.title);
  drawTextBlock(ctx, layout.author);

  if (options.showGuides) drawGuides(ctx, layout, design);
  if (options.issueElement) drawIssueHighlight(ctx, layout, options.issueElement);
  if (options.selected) drawSelection(ctx, layout, options.selected);
  ctx.restore();
}

export function renderCoverCanvas(canvas, layout, design, options = {}) {
  const pixelWidth = Math.max(1, options.pixelWidth ?? layout.width);
  const pixelHeight = Math.max(1, options.pixelHeight ?? layout.height);
  canvas.width = Math.round(pixelWidth);
  canvas.height = Math.round(pixelHeight);

  const ctx = canvas.getContext("2d");
  const scaleX = pixelWidth / layout.width;
  const scaleY = pixelHeight / layout.height;
  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  drawCover(ctx, layout, design, options);
  return canvas;
}

export function createTextMeasurer() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  return (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

export function hitTest(layout, point) {
  const order = ["illustration", "title", "author"];
  for (const element of order) {
    const box = element === "illustration" ? layout.illustration.box : layout[element].box;
    if (
      point.x >= box.x &&
      point.x <= box.x + box.w &&
      point.y >= box.y &&
      point.y <= box.y + box.h
    ) {
      return element;
    }
  }
  return null;
}
