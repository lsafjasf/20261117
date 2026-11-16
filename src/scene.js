import { mulberry32 } from './rng.js';
import { createSpriteTexture } from './resource.js';

export const BLEND_MODES = ['source-over', 'lighter'];

const PALETTE = [
  { r: 230, g: 92, b: 92 },
  { r: 92, g: 176, b: 230 },
  { r: 240, g: 200, b: 90 },
  { r: 120, g: 210, b: 140 },
  { r: 190, g: 130, b: 230 }
];

const LABELS = [
  'SCORE 100', 'LVL 3', 'READY', 'GO!', 'BONUS 50',
  'HIT 25', 'COMB0 8', 'TIMER 60', 'PLAYER 1', 'ENEMY 9'
];

// One-time structural validation. Invalid scenes fail loudly with node ids so
// the failure is diagnosable instead of being hidden inside the renderer.
export function validateScene(scene) {
  const errors = [];
  if (!Number.isFinite(scene.width) || scene.width <= 0) {
    errors.push({ nodeId: 'scene', field: 'width', reason: 'must be a positive number' });
  }
  if (!Number.isFinite(scene.height) || scene.height <= 0) {
    errors.push({ nodeId: 'scene', field: 'height', reason: 'must be a positive number' });
  }
  if (!Array.isArray(scene.nodes)) {
    errors.push({ nodeId: 'scene', field: 'nodes', reason: 'must be an array' });
    return errors;
  }

  const ids = new Set();
  for (const node of scene.nodes) {
    if (!node || typeof node.id !== 'string' || node.id.length === 0) {
      errors.push({ nodeId: String(node && node.id), field: 'id', reason: 'missing id' });
      continue;
    }
    if (ids.has(node.id)) {
      errors.push({ nodeId: node.id, field: 'id', reason: 'duplicate id' });
    }
    ids.add(node.id);
    if (node.type !== 'sprite' && node.type !== 'text') {
      errors.push({ nodeId: node.id, field: 'type', reason: `unknown type: ${node.type}` });
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      errors.push({ nodeId: node.id, field: 'position', reason: 'coordinates must be finite' });
    }
    if (!Number.isFinite(node.alpha) || node.alpha < 0 || node.alpha > 1) {
      errors.push({ nodeId: node.id, field: 'alpha', reason: 'must be within [0,1]' });
    }
    if (!BLEND_MODES.includes(node.blend)) {
      errors.push({ nodeId: node.id, field: 'blend', reason: `unsupported: ${node.blend}` });
    }
    if (node.type === 'text' && (typeof node.text !== 'string' || node.text.length === 0)) {
      errors.push({ nodeId: node.id, field: 'text', reason: 'text must be a non-empty string' });
    }
    if (node.type === 'sprite' && (!Number.isFinite(node.w) || node.w <= 0)) {
      errors.push({ nodeId: node.id, field: 'w', reason: 'width must be positive' });
    }
  }
  return errors;
}

export class SceneValidationError extends Error {
  constructor(errors) {
    super(`scene validation failed with ${errors.length} error(s)`);
    this.name = 'SceneValidationError';
    this.errors = errors;
  }
}

// Fixed, seeded scene: many sprites and texts with overlapping transparency.
export function buildFixedScene({
  seed = 20261117,
  width = 320,
  height = 240,
  spriteCount = 360,
  textCount = 120
} = {}) {
  const random = mulberry32(seed);
  const nodes = [];
  const zLayers = 6;
  const sizePool = [8, 10, 12, 14, 16, 18];
  // Shared-prefab clusters: consecutive sprites reuse one texture key
  // (color + size + seed) and blend inside a z layer, like packed instances.
  while (nodes.length < spriteCount) {
    const clusterSize = Math.min(spriteCount - nodes.length, 4 + Math.floor(random() * 3));
    const color = PALETTE[Math.floor(random() * PALETTE.length)];
    const size = sizePool[Math.floor(random() * sizePool.length)];
    const blend = BLEND_MODES[Math.floor(random() * BLEND_MODES.length)];
    const z = Math.floor(random() * zLayers);
    for (let member = 0; member < clusterSize; member += 1) {
      nodes.push({
        id: `sprite-${nodes.length}`,
        type: 'sprite',
        x: Math.floor(random() * width),
        y: Math.floor(random() * height),
        w: size,
        h: size,
        alpha: 0.9,
        blend,
        z,
        color,
        textureSeed: 1000 + PALETTE.indexOf(color)
      });
    }
  }
  const textScalePool = [1, 2];
  let textMade = 0;
  while (textMade < textCount) {
    const clusterSize = Math.min(textCount - textMade, 3 + Math.floor(random() * 3));
    const text = LABELS[Math.floor(random() * LABELS.length)];
    const color = PALETTE[Math.floor(random() * PALETTE.length)];
    const scale = textScalePool[Math.floor(random() * textScalePool.length)];
    const blend = BLEND_MODES[Math.floor(random() * BLEND_MODES.length)];
    const z = zLayers + Math.floor(random() * 4);
    for (let member = 0; member < clusterSize; member += 1) {
      nodes.push({
        id: `text-${textMade}`,
        type: 'text',
        text,
        x: Math.floor(random() * width),
        y: Math.floor(random() * height),
        scale,
        alpha: 0.9,
        blend,
        z,
        color
      });
      textMade += 1;
    }
  }
  return { name: 'fixed', seed, width, height, nodes };
}

// Boundary scene: off-screen nodes, alpha extremes, single-pixel sprites,
// duplicate labels (cache reuse), and a node clipped by each screen edge.
export function buildBoundaryScene({ width = 320, height = 240 } = {}) {
  const nodes = [
    { id: 'off-left', type: 'sprite', x: -10, y: 40, w: 12, h: 12, alpha: 1, blend: 'source-over', z: 0, color: PALETTE[0], textureSeed: 1 },
    { id: 'off-top', type: 'sprite', x: 60, y: -8, w: 12, h: 12, alpha: 0, blend: 'source-over', z: 1, color: PALETTE[1], textureSeed: 2 },
    { id: 'off-right', type: 'sprite', x: width - 4, y: 70, w: 12, h: 12, alpha: 1, blend: 'lighter', z: 2, color: PALETTE[2], textureSeed: 3 },
    { id: 'off-bottom', type: 'sprite', x: 100, y: height - 4, w: 12, h: 12, alpha: 0.5, blend: 'lighter', z: 2, color: PALETTE[3], textureSeed: 4 },
    { id: 'pixel', type: 'sprite', x: 150, y: 120, w: 1, h: 1, alpha: 1, blend: 'source-over', z: 3, color: PALETTE[4], textureSeed: 5 },
    { id: 'zero-alpha-text', type: 'text', text: 'GHOST', x: 10, y: 200, scale: 1, alpha: 0, blend: 'source-over', z: 5, color: PALETTE[0] },
    { id: 'label-a', type: 'text', text: 'READY', x: 20, y: 16, scale: 2, alpha: 1, blend: 'source-over', z: 6, color: PALETTE[1] },
    { id: 'label-b', type: 'text', text: 'READY', x: 120, y: 16, scale: 2, alpha: 0.8, blend: 'lighter', z: 6, color: PALETTE[1] },
    { id: 'label-c', type: 'text', text: 'READY', x: 220, y: 200, scale: 2, alpha: 1, blend: 'source-over', z: 7, color: PALETTE[1] }
  ];
  return { name: 'boundary', seed: 7, width, height, nodes };
}

// Deliberately invalid scene: renderer must reject it and keep diagnostics.
export function buildInvalidScene({ width = 320, height = 240 } = {}) {
  const base = buildBoundaryScene({ width, height });
  base.name = 'invalid';
  base.nodes[2] = { ...base.nodes[2], blend: 'screen' };
  base.nodes[5] = { ...base.nodes[5], alpha: 1.5 };
  base.nodes.push({ id: 'bad-text', type: 'text', text: '', x: 0, y: 0, scale: 1, alpha: 1, blend: 'source-over', z: 0, color: PALETTE[0] });
  base.nodes.push({ x: 1, y: 1, type: 'sprite', w: 4, h: 4, alpha: 1, blend: 'source-over', z: 0, color: PALETTE[0], textureSeed: 9 });
  return base;
}

// Builds the persistent sprite textures shared by every frame of a scene.
export function buildSpriteRegistry(scene, registry) {
  const seen = new Set();
  for (const node of scene.nodes) {
    if (node.type !== 'sprite') continue;
    const key = spriteTextureKey(node);
    if (seen.has(key)) continue;
    seen.add(key);
    registry.add(createSpriteTexture(key, node.textureSeed, node.w, node.h, node.color));
  }
  return seen;
}

export function spriteTextureKey(node) {
  return `sprite:${node.textureSeed}:${node.w}x${node.h}`;
}
