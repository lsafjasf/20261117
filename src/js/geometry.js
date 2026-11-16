import { mulberry32, range, intRange } from './rng.js';
import { VIEW_W, VIEW_H } from './params.js';

// Tiles repeat horizontally; one tile is wider than the view so no
// individual building is ever split by a tile seam.
export const TILE_W = 1680;
export const GROUND_Y = VIEW_H - 64;

// Profiles run from furthest (0) to nearest (5).
export const LAYER_PROFILES = Object.freeze([
  { depth: 0.06, parallax: 0.12, topMin: 300, topMax: 430, base: GROUND_Y + 10, color: '#5b4a63' },
  { depth: 0.22, parallax: 0.28, topMin: 268, topMax: 412, base: GROUND_Y + 14, color: '#4c3b55' },
  { depth: 0.42, parallax: 0.5,  topMin: 232, topMax: 388, base: GROUND_Y + 18, color: '#3e2f47' },
  { depth: 0.62, parallax: 0.76, topMin: 188, topMax: 360, base: GROUND_Y + 24, color: '#312439' },
  { depth: 0.82, parallax: 1.0,  topMin: 132, topMax: 300, base: GROUND_Y + 34, color: '#241a2b' },
  { depth: 1.0,  parallax: 1.32, topMin: 88,  topMax: 236, base: VIEW_H,        color: '#17101d' },
]);

const ROOF_TYPES = ['flat', 'peaked', 'stepped', 'tank'];

function makeWindows(rand, bx, bw, top, base, litRatio, depth) {
  const windows = [];
  const cols = Math.max(1, Math.floor(bw / 34));
  const rows = Math.max(1, Math.floor((base - top - 34) / 42));
  const cellW = bw / cols;
  const cellH = (base - top - 30) / rows;
  const winW = Math.min(20, cellW * 0.46);
  const winH = Math.min(24, cellH * 0.5);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const wx = bx + cellW * (c + 0.5) - winW / 2;
      const wy = top + 22 + cellH * (r + 0.5) - winH / 2;
      const lit = rand() < litRatio * (1 - depth * 0.25);
      windows.push({
        x: Math.round(wx * 100) / 100,
        y: Math.round(wy * 100) / 100,
        w: Math.round(winW * 100) / 100,
        h: Math.round(winH * 100) / 100,
        lit,
        beamSeed: rand(),
      });
    }
  }
  return windows;
}

function makeBuilding(rand, x, profile, params) {
  const width = range(rand, 78, 168);
  const top = range(rand, profile.topMin, profile.topMax);
  const base = profile.base;
  const roof = ROOF_TYPES[intRange(rand, 0, ROOF_TYPES.length - 1)];
  const bx = Math.round(x * 100) / 100;
  return {
    x: bx,
    w: Math.round(width * 100) / 100,
    top: Math.round(top),
    base,
    roof,
    roofH: roof === 'flat' ? 0 : intRange(rand, 14, 34),
    windows: makeWindows(rand, bx, width, top, base, params.windowLitRatio, profile.depth),
  };
}

function generateLayer(layerIndex, profile, params) {
  const rand = mulberry32((params.seed + 1) * 1000003 + layerIndex * 7919);
  const buildings = [];
  const density = 0.35 + params.buildingDensity * 0.6;
  let x = -40;
  while (x < TILE_W + 40) {
    const gap = range(rand, 6, 26) + (1 - density) * range(rand, 10, 60);
    const building = makeBuilding(rand, x + gap, profile, params);
    buildings.push(building);
    x = building.x + building.w + gap;
  }
  return {
    layerIndex,
    depth: profile.depth,
    parallax: profile.parallax,
    color: profile.color,
    base: profile.base,
    buildings,
  };
}

// Pure, deterministic scene model. Same params -> same model (deep equal).
export function generateScene(params) {
  const count = params.layerCount;
  const layers = [];
  for (let i = 0; i < count; i += 1) {
    const profile = LAYER_PROFILES[LAYER_PROFILES.length - count + i];
    layers.push(generateLayer(i, profile, params));
  }
  return {
    tileW: TILE_W,
    groundY: GROUND_Y,
    width: VIEW_W,
    height: VIEW_H,
    layers,
  };
}

// Horizontal pixel offset of a layer for a normalized viewX in [-1, 1].
export function layerOffsetX(viewX, profile, parallaxStrength) {
  const maxShift = 220;
  return -viewX * maxShift * profile.parallax * parallaxStrength;
}

export function countObjects(scene) {
  let buildings = 0;
  let windows = 0;
  let lit = 0;
  for (const layer of scene.layers) {
    buildings += layer.buildings.length;
    for (const b of layer.buildings) {
      windows += b.windows.length;
      lit += b.windows.filter((win) => win.lit).length;
    }
  }
  return { layers: scene.layers.length, buildings, windows, lit };
}
