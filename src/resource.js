import { mulberry32, fnv1a32 } from './rng.js';
import { rasterizeText } from './font.js';

export class Texture {
  constructor(key, data, width, height) {
    this.key = key;
    this.data = data;
    this.width = width;
    this.height = height;
    this.bytes = data ? data.byteLength : 0;
    this.disposed = false;
  }

  dispose() {
    this.data = null;
    this.bytes = 0;
    this.disposed = true;
  }
}

export class TextureRegistry {
  constructor() {
    this.textures = new Map();
  }

  add(texture) {
    if (this.textures.has(texture.key)) {
      throw new Error(`duplicate texture key: ${texture.key}`);
    }
    this.textures.set(texture.key, texture);
    return texture;
  }

  get(key) {
    const texture = this.textures.get(key);
    if (!texture || texture.disposed) return null;
    return texture;
  }

  get size() {
    return this.textures.size;
  }

  get liveBytes() {
    let total = 0;
    for (const texture of this.textures.values()) {
      if (!texture.disposed) total += texture.bytes;
    }
    return total;
  }

  get liveCount() {
    let total = 0;
    for (const texture of this.textures.values()) {
      if (!texture.disposed) total += 1;
    }
    return total;
  }

  dispose() {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}

// Deterministic procedural sprite texture so both pipelines share identical
// pixel content for the same logical sprite.
export function createSpriteTexture(key, seed, width, height, baseColor) {
  const random = mulberry32(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const noise = Math.floor(random() * 32) - 16;
      const vignette = Math.abs(x - width / 2) + Math.abs(y - height / 2);
      data[offset] = Math.max(0, Math.min(255, baseColor.r + noise));
      data[offset + 1] = Math.max(0, Math.min(255, baseColor.g + noise));
      data[offset + 2] = Math.max(0, Math.min(255, baseColor.b + noise));
      data[offset + 3] = vignette > (width + height) / 2 - 2 ? 0 : 255;
    }
  }
  return new Texture(key, data, width, height);
}

export function textCacheKey(text, color, scale) {
  return `text:${fnv1a32(`${text}|${color.r},${color.g},${color.b}|${scale}`)}`;
}

export class TextCache {
  constructor(registry) {
    this.registry = registry;
    this.lookups = 0;
    this.hits = 0;
  }

  get hitRate() {
    return this.lookups === 0 ? 0 : this.hits / this.lookups;
  }

  acquire(text, color, scale = 1) {
    this.lookups += 1;
    const key = textCacheKey(text, color, scale);
    const existing = this.registry.get(key);
    if (existing) {
      this.hits += 1;
      return { texture: existing, hit: true };
    }
    const { width, height, data } = rasterizeText(text, color, scale);
    const texture = new Texture(key, data, width, height);
    this.registry.add(texture);
    return { texture, hit: false };
  }

  snapshot() {
    return {
      lookups: this.lookups,
      hits: this.hits,
      hitRate: this.hitRate,
      entries: this.registry.liveCount
    };
  }
}
