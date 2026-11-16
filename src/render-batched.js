import { TextCache } from './resource.js';
import { spriteTextureKey } from './scene.js';

// Maximum quads in one device submission, mirroring a real batch buffer cap.
const MAX_BATCH = 64;

// Safe batching pipeline. Only adjacent nodes sharing the exact same
// (texture, blend, alpha) state merge into one batch, and layers always emit
// in strict z order. This conservative rule stays correct even where
// source-over (non-commutative) and additive blending interact in one layer.
// Pixel and trace gates in the harness reject any rendered-frame change.
export function renderFrameBatched(device, scene, orderedNodes, registry, textCache) {
  const cache = textCache || new TextCache(registry);
  device.clear();
  device.resetStats();

  let cacheMisses = 0;
  const resolveTexture = (node) => {
    if (node.type === 'sprite') {
      const texture = registry.get(spriteTextureKey(node));
      if (!texture) throw new Error(`missing sprite texture for node ${node.id}`);
      return texture;
    }
    const result = cache.acquire(node.text, node.color, node.scale || 1);
    if (!result.hit) cacheMisses += 1;
    return result.texture;
  };

  // Strict consecutive batching while walking the prepared node order. A group
  // merges only adjacent nodes sharing (texture, blend, alpha); any intervening
  // node — including a different blend mode — closes the group. This is the
  // only universally order-safe rule once source-over (non-commutative) and
  // additive blending interact in the same layer.
  const layers = new Map();
  const layerOrder = [];
  for (const node of orderedNodes) {
    if (node.alpha === 0) continue;
    if (!layers.has(node.z)) {
      layers.set(node.z, { stream: [] });
      layerOrder.push(node.z);
    }
    const layer = layers.get(node.z);
    const texture = resolveTexture(node);
    const stateKey = `${texture.key}|${node.blend}|${node.alpha}`;
    const quad = { x: node.x, y: node.y, z: node.z };

    const last = layer.stream[layer.stream.length - 1];
    if (last && last.stateKey === stateKey) {
      last.quads.push(quad);
    } else {
      layer.stream.push({ stateKey, texture, blend: node.blend, alpha: node.alpha, quads: [quad] });
    }
  }

  let flushedBatches = 0;
  let capacitySplits = 0;
  for (const z of layerOrder) {
    for (const group of layers.get(z).stream) {
      let offset = 0;
      while (offset < group.quads.length) {
        const slice = group.quads.slice(offset, offset + MAX_BATCH);
        device.submit(group.texture, group.blend, slice, group.alpha);
        flushedBatches += 1;
        offset += MAX_BATCH;
      }
      capacitySplits += Math.ceil(group.quads.length / MAX_BATCH) - 1;
    }
  }

  return {
    deviceStats: { ...device.stats },
    flushedBatches,
    layers: layerOrder.length,
    capacitySplits,
    cacheMisses,
    textCache: cache.snapshot()
  };
}
