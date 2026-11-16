// Shared geometry, Canvas renderer and editable SVG serializer.

import { GRID } from './font.js';
import { layoutScene } from './layout.js';

export function glyphPaths(glyph) {
  const unit = glyph.fontSize / GRID.capHeight;
  const paths = [];
  if (!glyph.procedural) {
    return [];
  }
  for (const stroke of glyph.glyph) {
    const points = stroke.map((p) => ({
      x: glyph.x + p.x * unit * glyph.width + glyph.slantPx * p.y,
      y: glyph.y - p.y * unit
    }));
    if (points.length === 1) {
      const r = glyph.strokeWidth / 2;
      paths.push({ dot: true, cx: points[0].x, cy: points[0].y, r: Math.max(r, 0.6) });
    } else {
      paths.push({ line: true, points, width: glyph.strokeWidth, corner: glyph.corner });
    }
  }
  return paths;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function pathToD(path) {
  if (path.dot) {
    const { cx, cy, r } = path;
    return `M ${round(cx - r)} ${round(cy)} a ${round(r)} ${round(r)} 0 1 0 ${round(r * 2)} 0 a ${round(r)} ${round(r)} 0 1 0 ${round(-r * 2)} 0 Z`;
  }
  return path.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ');
}

function paintPath(ctx, path) {
  if (path.fallback) return;
  if (path.dot) {
    ctx.beginPath();
    ctx.arc(path.cx, path.cy, path.r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const corner = path.corner;
  ctx.lineWidth = path.width;
  ctx.lineJoin = corner > 0.5 ? 'round' : 'miter';
  ctx.lineCap = corner > 0.5 ? 'round' : 'butt';
  if (corner > 0 && corner <= 0.5) ctx.miterLimit = 2 + corner * 8;
  ctx.beginPath();
  path.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

export function renderCanvas(ctx, scene, view, canvasSize, selectedId = null, dashOffset = 0) {
  try {
    const layout = layoutScene(scene, scene.wrapWidth);
    if (!layout.ok) {
      return {
        ok: false,
        reason: layout.invalid.map((layer) => `${layer.name}: ${layer.reason}`).join('；')
      };
    }
    ctx.save();
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
    ctx.translate(view.panX, view.panY);
    ctx.rotate((view.rotation * Math.PI) / 180);
    ctx.scale(view.zoom, view.zoom);

    for (const layer of layout.layers) {
      ctx.save();
      ctx.translate(layer.position.x, layer.position.y);
      if (layer.id === selectedId) {
        ctx.strokeStyle = '#2f7df6';
        ctx.lineWidth = 2 / view.zoom;
        ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
        ctx.lineDashOffset = dashOffset;
        ctx.strokeRect(-8, -8, layer.bounds.width + 16, layer.bounds.height + 16);
        ctx.setLineDash([]);
      }
      for (const glyph of layer.glyphs) {
        const paths = glyphPaths(glyph);
        for (const path of paths) {
          if (path.fallback) continue;
          ctx.strokeStyle = glyph.color;
          ctx.fillStyle = glyph.color;
          paintPath(ctx, path);
        }
      }
      ctx.restore();
    }
    ctx.restore();
    return layout;
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export function serializeSVG(scene, view, size = { width: 1280, height: 720 }) {
  const layout = layoutScene(scene, scene.wrapWidth);
  const body = [];
  body.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">`);
  body.push(`<rect width="${size.width}" height="${size.height}" fill="${scene.background}"/>`);
  body.push(`<g id="view" transform="translate(${round(view.panX)} ${round(view.panY)}) rotate(${round(view.rotation)}) scale(${round(view.zoom)})">`);
  for (const layer of layout.layers) {
    body.push(`<g id="layer-${layer.id}" data-name="${escapeXml(layer.name)}" transform="translate(${round(layer.position.x)} ${round(layer.position.y)})">`);
    for (const glyph of layer.glyphs) {
      if (!glyph.procedural) continue;
      for (const path of glyphPaths(glyph)) {
        if (path.fallback) continue;
        const attrs = path.dot
          ? `d="${pathToD(path)}" fill="${glyph.color}"`
          : `d="${pathToD(path)}" fill="none" stroke="${glyph.color}" stroke-width="${round(path.width)}" stroke-linejoin="${path.corner > 0.5 ? 'round' : 'miter'}" stroke-linecap="${path.corner > 0.5 ? 'round' : 'butt'}"`;
        body.push(`<path ${attrs}/>`);
      }
    }
    body.push('</g>');
  }
  body.push('</g>');
  body.push(metadataBlock(scene, view));
  body.push('</svg>');
  return { svg: body.join('\n'), layout };
}

function metadataBlock(scene, view) {
  const payload = escapeXml(JSON.stringify({ scene, view, format: 'typo-studio/1' }));
  return `<metadata id="typo-studio-state" type="application/json">${payload}</metadata>`;
}

export function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
