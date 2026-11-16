import { rasterizeText } from './font.js';
import { Texture, textCacheKey } from './resource.js';
import { spriteTextureKey } from './scene.js';

// Baseline pipeline: one device submission per visible node. Text textures are
// rebuilt every frame and disposed at frame end, which is the pre-optimization
// behavior being measured.
export function renderFrameBaseline(device, scene, orderedNodes, registry) {
  const transientTextures = [];
  device.clear();
  device.resetStats();

  for (const node of orderedNodes) {
    if (node.alpha === 0) continue;

    if (node.type === 'sprite') {
      const texture = registry.get(spriteTextureKey(node));
      if (!texture) throw new Error(`missing sprite texture for node ${node.id}`);
      device.submit(texture, node.blend, [{ x: node.x, y: node.y, z: node.z }], node.alpha);
      continue;
    }

    const key = textCacheKey(node.text, node.color, node.scale || 1);
    const raster = rasterizeText(node.text, node.color, node.scale || 1);
    const texture = new Texture(key, raster.data, raster.width, raster.height);
    transientTextures.push(texture);
    device.submit(texture, node.blend, [{ x: node.x, y: node.y, z: node.z }], node.alpha);
  }

  const transientBytesAllocated = transientTextures
    .reduce((sum, texture) => sum + texture.bytes, 0);
  for (const texture of transientTextures) texture.dispose();
  return {
    deviceStats: { ...device.stats },
    transientTexturesCreated: transientTextures.length,
    transientBytesAllocated
  };
}
