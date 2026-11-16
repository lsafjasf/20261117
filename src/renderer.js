// Canvas renderer. drawDocument() is shared by the interactive screen preview
// and the PNG export (same canvas 2D calls, same layout, no editor overlays in
// export mode), which guarantees PNG matches what the user sees.

import { getCrop, traceShape } from "./geometry.js";
import { firstBaselineY, fontString, layoutText, lineX } from "./text.js";

function applyTransform(ctx, el) {
  ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
  if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.width / 2, -el.height / 2);
}

function withCrop(ctx, el, draw) {
  const crop = getCrop(el);
  const clipped =
    crop.x !== 0 || crop.y !== 0 || crop.width !== el.width || crop.height !== el.height;
  ctx.save();
  if (clipped) {
    ctx.beginPath();
    ctx.rect(crop.x, crop.y, crop.width, crop.height);
    ctx.clip();
  }
  draw();
  ctx.restore();
}

export function drawElement(ctx, el) {
  ctx.save();
  applyTransform(ctx, el);
  if (el.type === "text") {
    withCrop(ctx, el, () => {
      const layout = layoutText(el, ctx);
      ctx.font = layout.font;
      ctx.fillStyle = el.fill || "#111111";
      ctx.textBaseline = "alphabetic";
      const baseline = firstBaselineY(el, layout);
      layout.lines.forEach((line, i) => {
        const x = lineX(el, line, ctx, layout);
        const y = baseline + i * layout.lineHeight;
        ctx.fillText(line, x, y);
      });
    });
  } else {
    withCrop(ctx, el, () => {
      traceShape(ctx, el);
      ctx.fillStyle = el.fill || "#3b82f6";
      ctx.fill();
      if (el.stroke) {
        ctx.strokeStyle = el.stroke;
        ctx.lineWidth = el.strokeWidth || 1;
        ctx.stroke();
      }
    });
  }
  ctx.restore();
}

export function drawDocument(ctx, doc) {
  ctx.save();
  ctx.fillStyle = doc.background || "#ffffff";
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const el of doc.elements) drawElement(ctx, el);
  ctx.restore();
}

// Renders at the exact document pixel size and returns a canvas element.
// Pass an optional existing canvas (used in Node tests with a mock).
export function renderToCanvas(doc, canvas) {
  const target = canvas || document.createElement("canvas");
  target.width = doc.width;
  target.height = doc.height;
  const ctx = target.getContext("2d");
  ctx.clearRect(0, 0, doc.width, doc.height);
  drawDocument(ctx, doc);
  return target;
}

export function exportPngBlob(doc) {
  return new Promise((resolve, reject) => {
    const canvas = renderToCanvas(doc);
    if (!canvas.toBlob) {
      reject(new Error("当前环境不支持 canvas.toBlob，无法导出 PNG。"));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG 编码失败，请检查画布尺寸是否超出浏览器限制。"));
    }, "image/png");
  });
}

// Interactive preview with selection, crop frame and safe-margin guides.
export function drawPreview(ctx, doc, view, state) {
  const { scale, offsetX, offsetY } = view;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  drawDocument(ctx, doc);

  if (state.showSafeMargin) {
    const m = 24;
    ctx.strokeStyle = "rgba(245, 158, 11, 0.9)";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(m, m, doc.width - m * 2, doc.height - m * 2);
    ctx.setLineDash([]);
  }

  const multiIds = state.selectionIds ? [...state.selectionIds] : [];
  for (const el of doc.elements) {
    if (multiIds.includes(el.id) && el.id !== state.selectedId) {
      drawSelection(ctx, el, { cropMode: false }, scale);
    }
  }
  const selected = doc.elements.find((el) => el.id === state.selectedId);
  if (selected) drawSelection(ctx, selected, state, scale);
  ctx.restore();
}

function drawSelection(ctx, el, state, scale) {
  ctx.save();
  applyTransform(ctx, el);
  const crop = state.cropMode ? getCrop(el) : { x: 0, y: 0, width: el.width, height: el.height };
  ctx.strokeStyle = state.cropMode ? "#f97316" : "#2563eb";
  ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash(state.cropMode ? [] : [4 / scale, 3 / scale]);
  ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
  ctx.setLineDash([]);
  const handle = 7 / scale;
  ctx.fillStyle = "#ffffff";
  for (const [hx, hy] of [
    [crop.x, crop.y],
    [crop.x + crop.width, crop.y],
    [crop.x, crop.y + crop.height],
    [crop.x + crop.width, crop.y + crop.height],
  ]) {
    ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
    ctx.strokeRect(hx - handle / 2, hy - handle / 2, handle, handle);
  }
  if (!state.cropMode) {
    const topX = crop.x + crop.width / 2;
    const gripY = crop.y - 18 / scale;
    ctx.beginPath();
    ctx.moveTo(topX, crop.y);
    ctx.lineTo(topX, gripY);
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 1.5 / scale;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(topX, gripY, 4.5 / scale, 0, Math.PI * 2);
    ctx.fillStyle = "#2563eb";
    ctx.fill();
  }
  ctx.restore();
}
