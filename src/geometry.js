// Pure geometry helpers shared by the canvas renderer, SVG serializer,
// hit-testing and validation. No DOM access so it runs in Node tests.

export const MIN_ELEMENT_SIZE = 4;

export function defaultCrop(el) {
  return { x: 0, y: 0, width: el.width, height: el.height };
}

export function getCrop(el) {
  return el.crop && el.crop.width > 0 && el.crop.height > 0
    ? el.crop
    : defaultCrop(el);
}

// Axis-aligned rectangle of the visible (cropped, unrotated) element in
// document coordinates.
export function visibleRect(el) {
  const crop = getCrop(el);
  return {
    x: el.x + crop.x,
    y: el.y + crop.y,
    width: crop.width,
    height: crop.height,
  };
}

function rotatePoint(cx, cy, x, y, rad) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

// Axis-aligned bounding box after rotation, in document coordinates.
export function boundingBox(el) {
  const rect = visibleRect(el);
  const angle = ((el.rotation || 0) * Math.PI) / 180;
  if (!angle) return rect;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ].map(([x, y]) => rotatePoint(cx, cy, x, y, angle));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

export function rectsIntersect(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function polygonPath(points) {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`)
    .join(" ") + " Z";
}

export function round(n) {
  return Math.round(n * 1000) / 1000;
}

// SVG path data in element-local coordinates (box 0,0 -> width,height).
export function shapePath(el) {
  const w = el.width;
  const h = el.height;
  switch (el.type) {
    case "rect": {
      const r = Math.min(el.cornerRadius || 0, w / 2, h / 2);
      if (r <= 0) return `M0 0 H${round(w)} V${round(h)} H0 Z`;
      return [
        `M${round(r)} 0`,
        `H${round(w - r)} A${round(r)} ${round(r)} 0 0 1 ${round(w)} ${round(r)}`,
        `V${round(h - r)} A${round(r)} ${round(r)} 0 0 1 ${round(w - r)} ${round(h)}`,
        `H${round(r)} A${round(r)} ${round(r)} 0 0 1 0 ${round(h - r)}`,
        `V${round(r)} A${round(r)} ${round(r)} 0 0 1 ${round(r)} 0 Z`,
      ].join(" ");
    }
    case "ellipse":
      return `M${round(w / 2)} 0 A${round(w / 2)} ${round(h / 2)} 0 1 0 ${round(w / 2)} ${round(h)} A${round(w / 2)} ${round(h / 2)} 0 1 0 ${round(w / 2)} 0 Z`;
    case "triangle":
      return polygonPath([
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]);
    case "hexagon": {
      const k = w / 4;
      return polygonPath([
        { x: k, y: 0 },
        { x: w - k, y: 0 },
        { x: w, y: h / 2 },
        { x: w - k, y: h },
        { x: k, y: h },
        { x: 0, y: h / 2 },
      ]);
    }
    case "star": {
      const points = el.starPoints || 5;
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.45;
      const pts = [];
      for (let i = 0; i < points * 2; i += 1) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + (i * Math.PI) / points;
        pts.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
      }
      return polygonPath(pts);
    }
    default:
      return "";
  }
}

// Canvas equivalent of shapePath: traces the same local geometry.
export function traceShape(ctx, el) {
  const w = el.width;
  const h = el.height;
  ctx.beginPath();
  switch (el.type) {
    case "rect": {
      const r = Math.min(el.cornerRadius || 0, w / 2, h / 2);
      if (r <= 0) ctx.rect(0, 0, w, h);
      else {
        ctx.moveTo(r, 0);
        ctx.arcTo(w, 0, w, h, r);
        ctx.arcTo(w, h, 0, h, r);
        ctx.arcTo(0, h, 0, 0, r);
        ctx.arcTo(0, 0, w, 0, r);
        ctx.closePath();
      }
      break;
    }
    case "ellipse":
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case "triangle":
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      break;
    case "hexagon": {
      const k = w / 4;
      ctx.moveTo(k, 0);
      ctx.lineTo(w - k, 0);
      ctx.lineTo(w, h / 2);
      ctx.lineTo(w - k, h);
      ctx.lineTo(k, h);
      ctx.lineTo(0, h / 2);
      ctx.closePath();
      break;
    }
    case "star": {
      const points = el.starPoints || 5;
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.45;
      for (let i = 0; i < points * 2; i += 1) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + (i * Math.PI) / points;
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      break;
  }
}

export function hitTest(el, docX, docY) {
  const angle = ((el.rotation || 0) * Math.PI) / 180;
  let x = docX - (el.x + el.width / 2);
  let y = docY - (el.y + el.height / 2);
  if (angle) {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    x = rx;
    y = ry;
  }
  const lx = x + el.width / 2;
  const ly = y + el.height / 2;
  if (lx < 0 || ly < 0 || lx > el.width || ly > el.height) return false;
  if (el.type === "ellipse") {
    const nx = (lx - el.width / 2) / (el.width / 2);
    const ny = (ly - el.height / 2) / (el.height / 2);
    return nx * nx + ny * ny <= 1;
  }
  return true;
}
