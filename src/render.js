// render.js — Canvas 2D renderer. Works with any 2D context implementation
// (browser canvas or @napi-rs/canvas). All shadows are computed
// geometrically; no shadow bitmaps are loaded.

import {
  WORLD, LAYER_ORDER, sunScreenPosition,
  computeRidgeShadows, computeObjectShadows,
} from './scene.js';

const RIDGE_COLORS = ['#aebfd6', '#93a9c6', '#7890b0', '#5d7594', '#425871'];
const RIDGE_GROUND = ['#9db1ca', '#849cbc', '#6a84a4', '#51677f', '#374a5e'];
export const FONT_FAMILY = "'Noto Sans SC', sans-serif";

// The renderer needs to build offscreen canvases for the soft-shadow mask.
// Browser and Node each provide their own factory via setCanvasFactory.
let canvasFactory = null;
export function setCanvasFactory(factory) {
  canvasFactory = factory;
}
function makeCanvas(width, height) {
  if (canvasFactory) return canvasFactory(width, height);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    return c;
  }
  throw new Error('no canvas factory: call setCanvasFactory() first');
}

// Separable box blur over RGBA pixels (two passes, running sum).
function boxBlur(ctx, width, height, radius) {
  if (radius < 1) return;
  const img = ctx.getImageData(0, 0, width, height);
  const src = img.data;
  const tmp = new Uint8ClampedArray(src.length);
  const div = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let ch = 0; ch < 4; ch += 1) {
      let sum = 0;
      for (let i = -radius; i <= radius; i += 1) {
        sum += src[row + Math.min(width - 1, Math.max(0, i)) * 4 + ch];
      }
      for (let x = 0; x < width; x += 1) {
        tmp[row + x * 4 + ch] = sum / div;
        const add = Math.min(width - 1, x + radius + 1);
        const sub = Math.max(0, x - radius);
        sum += src[row + add * 4 + ch] - src[row + sub * 4 + ch];
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let ch = 0; ch < 4; ch += 1) {
      let sum = 0;
      for (let i = -radius; i <= radius; i += 1) {
        sum += tmp[Math.min(height - 1, Math.max(0, i)) * width * 4 + x * 4 + ch];
      }
      for (let y = 0; y < height; y += 1) {
        src[y * width * 4 + x * 4 + ch] = sum / div;
        const add = Math.min(height - 1, y + radius + 1);
        const sub = Math.max(0, y - radius);
        sum += tmp[add * width * 4 + x * 4 + ch] - tmp[sub * width * 4 + x * 4 + ch];
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

const maskCache = new Map();

// Builds the soft ridge-shadow mask: shade values painted per ridge node,
// blurred, then recolored so luminance becomes alpha. Cached per sun config.
function buildShadowMask(scene, state) {
  const key = [scene.seed, state.sun.azimuth, state.sun.elevation,
    state.shadows.softness].join('|');
  if (maskCache.has(key)) return maskCache.get(key);
  const w = WORLD.width;
  const h = WORLD.height;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const groups = computeRidgeShadows(scene, state);
  for (const group of groups) {
    const ridge = scene.ridges[group.ridgeIndex];
    ctx.save();
    ridgePath(ctx, ridge);
    ctx.clip();
    const segs = group.segments;
    for (let i = 0; i < segs.length - 1; i += 1) {
      const shade = (segs[i].shade + segs[i + 1].shade) / 2;
      if (shade <= 0.01) continue;
      const v = Math.round(Math.min(1, shade) * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      const x0 = segs[i].x - 0.5;
      ctx.fillRect(x0, Math.min(segs[i].y, segs[i + 1].y) - 2,
        segs[i + 1].x - segs[i].x + 1, h);
    }
    ctx.restore();
  }
  boxBlur(ctx, w, h, Math.round(2 + state.shadows.softness * 9));
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i];
    d[i] = 14; d[i + 1] = 20; d[i + 2] = 38; d[i + 3] = lum;
  }
  ctx.putImageData(img, 0, 0);
  if (maskCache.size > 8) maskCache.clear();
  maskCache.set(key, canvas);
  return canvas;
}

function ridgePath(ctx, ridge) {
  ctx.beginPath();
  ctx.moveTo(ridge.nodes[0].x, ridge.nodes[0].y);
  for (const node of ridge.nodes) ctx.lineTo(node.x, node.y);
  ctx.lineTo(ridge.nodes[ridge.nodes.length - 1].x, WORLD.height + 60);
  ctx.lineTo(ridge.nodes[0].x, WORLD.height + 60);
  ctx.closePath();
}

function drawSky(ctx, state) {
  const el = state.sun.elevation;
  const warm = Math.max(0, 1 - el / 60);
  const grad = ctx.createLinearGradient(0, 0, 0, WORLD.height);
  grad.addColorStop(0, `rgb(${58 + warm * 90}, ${104 + warm * 40}, ${168 - warm * 40})`);
  grad.addColorStop(0.55, `rgb(${150 + warm * 80}, ${178 + warm * 30}, ${214 - warm * 30})`);
  grad.addColorStop(1, `rgb(${224 + warm * 20}, ${228 - warm * 20}, ${236 - warm * 40})`);
  ctx.fillStyle = grad;
  ctx.fillRect(-220, -140, WORLD.width + 440, WORLD.height + 280);
}

function drawSun(ctx, state) {
  const pos = sunScreenPosition(state.sun);
  const glow = ctx.createRadialGradient(pos.x, pos.y, 4, pos.x, pos.y, 90);
  glow.addColorStop(0, 'rgba(255, 244, 200, 0.95)');
  glow.addColorStop(0.25, 'rgba(255, 226, 150, 0.55)');
  glow.addColorStop(1, 'rgba(255, 226, 150, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff6d8';
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 22, 0, Math.PI * 2);
  ctx.fill();
}

function drawRidges(ctx, scene) {
  for (const ridge of scene.ridges) {
    const i = ridge.index;
    const grad = ctx.createLinearGradient(0, 120, 0, WORLD.height);
    grad.addColorStop(0, RIDGE_COLORS[i]);
    grad.addColorStop(1, RIDGE_GROUND[i]);
    ridgePath(ctx, ridge);
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

// Soft ridge-cast shadow: blitted from the cached blurred mask, clipped to
// each receiver ridge so ridges occlude one another correctly.
function drawRidgeShadows(ctx, scene, state) {
  const mask = buildShadowMask(scene, state);
  const groups = computeRidgeShadows(scene, state);
  ctx.save();
  ctx.globalAlpha = Math.min(1, state.shadows.strength + 0.15);
  for (const group of groups) {
    const ridge = scene.ridges[group.ridgeIndex];
    ctx.save();
    ridgePath(ctx, ridge);
    ctx.clip();
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

// Soft object shadows: gradient-filled projected quads, clipped to the
// front ridge, edge softness grows with state.shadows.softness.
function drawObjectShadows(ctx, scene, state) {
  const data = computeObjectShadows(scene, state);
  const strength = state.shadows.strength;
  const soften = state.shadows.softness;
  const front = scene.ridges[scene.ridges.length - 1];
  ctx.save();
  ridgePath(ctx, front);
  ctx.clip();
  for (const shadow of [...data.trees, ...data.rocks]) {
    const dirX = shadow.tipX - shadow.baseX;
    const dirY = shadow.tipY - shadow.baseY;
    const len = Math.hypot(dirX, dirY);
    if (len < 0.5) continue;
    const nx = -dirY / len;
    const ny = dirX / len;
    const w0 = shadow.halfWidth * (0.8 + soften * 0.4);
    const w1 = shadow.halfWidth * (0.35 + soften * 1.1);
    const grad = ctx.createLinearGradient(shadow.baseX, shadow.baseY, shadow.tipX, shadow.tipY);
    grad.addColorStop(0, `rgba(10, 15, 30, ${(0.8 * strength).toFixed(3)})`);
    grad.addColorStop(Math.max(0.05, 1 - soften * 0.5), `rgba(10, 15, 30, ${(0.42 * strength).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(14, 20, 38, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(shadow.baseX + nx * w0, shadow.baseY + ny * w0);
    ctx.lineTo(shadow.tipX + nx * w1, shadow.tipY + ny * w1);
    ctx.lineTo(shadow.tipX - nx * w1, shadow.tipY - ny * w1);
    ctx.lineTo(shadow.baseX - nx * w0, shadow.baseY - ny * w0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawTerrainDetails(ctx, scene) {
  for (const rock of scene.rocks) {
    ctx.fillStyle = '#6d6a70';
    ctx.beginPath();
    ctx.ellipse(rock.x, rock.y - rock.height / 2, rock.width / 2, rock.height / 2, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(rock.x - rock.width * 0.12, rock.y - rock.height * 0.62,
      rock.width * 0.2, rock.height * 0.18, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const tree of scene.trees) {
    ctx.fillStyle = '#4a3a28';
    ctx.fillRect(tree.x - 1.6, tree.y - tree.height * 0.28, 3.2, tree.height * 0.28);
    ctx.fillStyle = '#2e4d33';
    for (let tier = 0; tier < 3; tier += 1) {
      const ty = tree.y - tree.height * (0.2 + tier * 0.27);
      const tw = tree.width * (1 - tier * 0.26);
      ctx.beginPath();
      ctx.moveTo(tree.x, ty - tree.height * 0.34);
      ctx.lineTo(tree.x + tw / 2, ty);
      ctx.lineTo(tree.x - tw / 2, ty);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// Labels render last with a halo so shadows can never swallow them.
// The halo is painted with offset fills instead of strokeText: some font
// backends glitch on CJK outlines when stroked.
function haloText(ctx, text, x, y) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  const r = 2.2;
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i;
    ctx.fillText(text, x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.fillStyle = '#16202f';
  ctx.fillText(text, x, y);
}

function drawLabels(ctx, scene) {
  ctx.font = `600 15px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const label of scene.labels) {
    ctx.fillStyle = 'rgba(20, 28, 44, 0.9)';
    ctx.beginPath();
    ctx.arc(label.x, label.y + 6, 2.6, 0, Math.PI * 2);
    ctx.fill();
    haloText(ctx, label.text, label.x, label.y);
  }
}

function drawAnnotations(ctx, state) {
  ctx.font = `12px ${FONT_FAMILY}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const text = `方位 ${state.sun.azimuth.toFixed(0)}° · 高度 ${state.sun.elevation.toFixed(0)}°`
    + ` · 影长 ×${state.shadows.length.toFixed(2)}`
    + ` · 缩放 ${state.view.zoom.toFixed(2)}`;
  haloText(ctx, text, 14, 22);
}

// render draws the full scene. opts.record(layer) observes layer order;
// opts.view overrides the view transform (used by tests).
export function render(ctx, scene, state, opts = {}) {
  const record = typeof opts.record === 'function' ? opts.record : () => {};
  const view = opts.view || state.view;
  ctx.save();
  ctx.translate(WORLD.width / 2 + view.panX, WORLD.height / 2 + view.panY);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-WORLD.width / 2, -WORLD.height / 2);
  const layers = state.layers;
  const passes = {
    sky: () => layers.sky && drawSky(ctx, state),
    sun: () => layers.sun && drawSun(ctx, state),
    ridges: () => layers.ridges && drawRidges(ctx, scene),
    ridgeShadows: () => layers.ridgeShadows && layers.ridges && drawRidgeShadows(ctx, scene, state),
    objectShadows: () => layers.objectShadows && layers.ridges && drawObjectShadows(ctx, scene, state),
    terrainDetails: () => layers.terrainDetails !== false && layers.ridges
      && drawTerrainDetails(ctx, scene),
    labels: () => layers.labels && drawLabels(ctx, scene),
    annotations: () => layers.annotations && drawAnnotations(ctx, state),
  };
  for (const name of LAYER_ORDER) {
    record(name);
    passes[name]();
  }
  ctx.restore();
}

export { LAYER_ORDER };
