import { TextCache } from './resource.js';
import { spriteTextureKey } from './scene.js';

// NEGATIVE CONTROL ONLY. This renderer groups nodes by (texture, blend) and
// draws each group once, intentionally reordering transparent nodes. It exists
// so the harness can prove that pixel-level consistency detects broken
// transparency rather than accepting any draw-call reduction.
export function renderFrameUnsafe(device, scene, orderedNodes, registry, textCache) {
  const cache = textCache || new TextCache(registry);
  device.clear();
  device.resetStats();
  const groups = new Map();

  for (const node of orderedNodes) {
    if (node.alpha === 0) continue;
    let texture;
    if (node.type === 'sprite') {
      texture = registry.get(spriteTextureKey(node));
    } else {
      texture = cache.acquire(node.text, node.color, node.scale || 1).texture;
    }
    const key = `${texture.key}|${node.blend}|${node.alpha}`;
    if (!groups.has(key)) groups.set(key, { texture, blend: node.blend, alpha: node.alpha, quads: [] });
    groups.get(key).quads.push({ x: node.x, y: node.y, z: node.z });
  }

  let flushedBatches = 0;
  for (const group of groups.values()) {
    device.submit(group.texture, group.blend, group.quads, group.alpha);
    flushedBatches += 1;
  }
  return { deviceStats: { ...device.stats }, flushedBatches, textCache: cache.snapshot() };
}
