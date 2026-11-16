import { VIEW_W, VIEW_H } from './params.js';
import { layerOffsetX, TILE_W } from './geometry.js';
import { fillSky, drawSun, windowColor, beamColor } from './palette.js';

function traceRoof(ctx, b) {
  const { x, w, top, roof, roofH } = b;
  if (roof === 'peaked') {
    ctx.moveTo(x, top);
    ctx.lineTo(x + w * 0.5, top - roofH);
    ctx.lineTo(x + w, top);
  } else if (roof === 'stepped') {
    const step = w / 3;
    ctx.moveTo(x, top);
    ctx.lineTo(x, top - roofH);
    ctx.lineTo(x + step, top - roofH);
    ctx.lineTo(x + step, top - roofH * 0.45);
    ctx.lineTo(x + step * 2, top - roofH * 0.45);
    ctx.lineTo(x + step * 2, top);
  } else if (roof === 'tank') {
    ctx.moveTo(x, top);
    ctx.lineTo(x + w * 0.28, top);
    ctx.lineTo(x + w * 0.28, top - roofH);
    ctx.lineTo(x + w * 0.72, top - roofH);
    ctx.lineTo(x + w * 0.72, top);
  } else {
    ctx.moveTo(x, top);
    ctx.lineTo(x + w, top);
  }
}

// One closed building silhouette with every window cut out via even-odd.
function traceBuilding(ctx, b) {
  ctx.beginPath();
  ctx.moveTo(b.x, b.base);
  ctx.lineTo(b.x, b.top);
  traceRoof(ctx, b);
  ctx.lineTo(b.x + b.w, b.base);
  ctx.closePath();
  for (const win of b.windows) {
    ctx.rect(win.x, win.y, win.w, win.h);
  }
}

// A single lit window projects a slanted warm beam down-left, where the
// nearer layers cast longer beams.
function traceBeam(ctx, win, depth) {
  const lean = 26 + depth * 58 + win.beamSeed * 26;
  const length = 90 + depth * 150;
  ctx.beginPath();
  ctx.moveTo(win.x, win.y);
  ctx.lineTo(win.x + win.w, win.y);
  ctx.lineTo(win.x + win.w - lean * 0.55, win.y + length);
  ctx.lineTo(win.x - lean, win.y + length * 0.82);
  ctx.closePath();
}

function drawLayer(ctx, layer, offsetX, params) {
  const tileCount = Math.ceil(VIEW_W / TILE_W) + 2;
  ctx.save();
  ctx.translate(offsetX % TILE_W, 0);

  for (let tile = -1; tile < tileCount; tile += 1) {
    const shift = tile * TILE_W;

    if (params.lightBeams) {
      ctx.fillStyle = beamColor();
      for (const b of layer.buildings) {
        for (const win of b.windows) {
          if (!win.lit) continue;
          ctx.save();
          ctx.translate(shift, 0);
          traceBeam(ctx, win, layer.depth);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // Soft paper drop shadow, offset toward the viewer (down-right).
    ctx.save();
    ctx.translate(shift + 6 + layer.depth * 8, 8 + layer.depth * 10);
    ctx.fillStyle = 'rgba(20, 10, 26, 0.28)';
    for (const b of layer.buildings) {
      traceBuilding(ctx, b);
      ctx.fill('evenodd');
    }
    ctx.restore();

    // Paper body with real window holes.
    ctx.save();
    ctx.translate(shift, 0);
    ctx.fillStyle = layer.color;
    for (const b of layer.buildings) {
      traceBuilding(ctx, b);
      ctx.fill('evenodd');
    }

    // Unlit holes show a dark interior; lit windows glow warm light
    // "through" the hole, rather than exposing sky directly.
    for (const b of layer.buildings) {
      for (const win of b.windows) {
        ctx.fillStyle = win.lit ? windowColor(win.beamSeed) : 'rgba(10, 6, 14, 0.88)';
        ctx.fillRect(win.x, win.y, win.w, win.h);
      }
    }
    // Thin paper edge highlight on the left edge of each building.
    ctx.strokeStyle = 'rgba(255, 214, 170, 0.10)';
    ctx.lineWidth = 1.2;
    for (const b of layer.buildings) {
      ctx.beginPath();
      ctx.moveTo(b.x, b.base);
      ctx.lineTo(b.x, b.top);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawGround(ctx, scene) {
  const grad = ctx.createLinearGradient(0, scene.groundY, 0, VIEW_H);
  grad.addColorStop(0, '#2a1d31');
  grad.addColorStop(1, '#120b17');
  ctx.fillStyle = grad;
  ctx.fillRect(0, scene.groundY, VIEW_W, VIEW_H - scene.groundY);
  // A wet-paper reflective streak under the sun side.
  const sheen = ctx.createLinearGradient(0, 0, VIEW_W, 0);
  sheen.addColorStop(0, 'rgba(255,170,110,0)');
  sheen.addColorStop(0.55, 'rgba(255,170,110,0.10)');
  sheen.addColorStop(1, 'rgba(255,170,110,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, scene.groundY, VIEW_W, VIEW_H - scene.groundY);
}

function drawVignette(ctx) {
  const grad = ctx.createRadialGradient(
    VIEW_W / 2, VIEW_H * 0.46, VIEW_H * 0.35,
    VIEW_W / 2, VIEW_H * 0.5, VIEW_H * 0.85,
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(12,6,18,0.42)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// Deterministic paper-grain speckle so two frames with the same params
// are pixel identical (no Math.random in rendering).
let grainPattern = null;
export function resetGrain() {
  grainPattern = null;
}

function getGrainPattern(ctx) {
  if (grainPattern) return grainPattern;
  const off = document.createElement('canvas');
  off.width = 128;
  off.height = 128;
  const octx = off.getContext('2d');
  const img = octx.createImageData(128, 128);
  let state = 123456789;
  for (let i = 0; i < img.data.length; i += 4) {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    const v = 128 + (state & 31);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 10;
  }
  octx.putImageData(img, 0, 0);
  grainPattern = ctx.createPattern(off, 'repeat');
  return grainPattern;
}

// Full frame. Layers render back -> front so nearer paper always
// occludes farther paper, and each layer's beams sit beneath its body.
export function renderScene(ctx, scene, params, view) {
  const { viewX, viewY, zoom } = { viewX: 0, viewY: 0, zoom: 1, ...view };
  ctx.save();
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  // The sky always covers the full canvas so zooming out never reveals
  // transparent/white margins; only the paper scene scales around center.
  fillSky(ctx, params, viewX);
  if (zoom !== 1) {
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
  }
  drawSun(ctx, params, viewX, viewY);

  for (const layer of scene.layers) {
    const offsetX = layerOffsetX(viewX, layer, params.parallaxStrength);
    const offsetY = viewY * 26 * layer.depth;
    ctx.save();
    ctx.translate(0, offsetY);
    drawLayer(ctx, layer, offsetX, params);
    ctx.restore();
  }

  drawGround(ctx, scene);
  drawVignette(ctx);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = getGrainPattern(ctx);
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function exportPNG(ctx) {
  return ctx.canvas.toDataURL('image/png');
}
