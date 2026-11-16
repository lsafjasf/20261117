import { fnv1a32 } from './rng.js';

export const SUPPORTED_BLENDS = new Set(['source-over', 'lighter']);

function blendPixel(dst, offset, src, srcOffset, mode, alpha) {
  const sa = (src[srcOffset + 3] / 255) * alpha;
  if (sa === 0) return 0;
  const sr = src[srcOffset];
  const sg = src[srcOffset + 1];
  const sb = src[srcOffset + 2];
  if (mode === 'lighter') {
    // Float accumulation with a single clamp at read time keeps repeated
    // additive contributions commutative regardless of submission order.
    dst[offset] = dst[offset] + sr * sa;
    dst[offset + 1] = dst[offset + 1] + sg * sa;
    dst[offset + 2] = dst[offset + 2] + sb * sa;
    dst[offset + 3] = Math.max(dst[offset + 3], 255 * sa);
  } else {
    const da = dst[offset + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA === 0) return 0;
    dst[offset] = (sr * sa + dst[offset] * da * (1 - sa)) / outA;
    dst[offset + 1] = (sg * sa + dst[offset + 1] * da * (1 - sa)) / outA;
    dst[offset + 2] = (sb * sa + dst[offset + 2] * da * (1 - sa)) / outA;
    dst[offset + 3] = outA * 255;
  }
  return 1;
}

export class SoftwareDevice {
  constructor({ width, height, background = { r: 14, g: 16, b: 22 } }) {
    this.width = width;
    this.height = height;
    this.background = background;
    this.data = new Float32Array(width * height * 4);
    this.activeState = null;
    this.stats = { drawCalls: 0, stateChanges: 0, pixelsBlended: 0 };
    this.disposed = false;
    this.trace = [];
    this.clear();
  }

  clear() {
    const { r, g, b } = this.background;
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = 255;
    }
  }

  _bind(textureKey, blend) {
    if (!SUPPORTED_BLENDS.has(blend)) {
      throw new Error(`unsupported blend mode: ${blend}`);
    }
    const next = `${textureKey}|${blend}`;
    if (this.activeState !== next) {
      this.stats.stateChanges += 1;
      this.activeState = next;
    }
  }

  // One device submission: in the baseline renderer this is a single textured
  // quad; in the batched renderer it is one flushed batch of quads.
  submit(texture, blend, quads, alpha) {
    if (this.disposed) throw new Error('device used after dispose()');
    this._bind(texture.key, blend);
    this.stats.drawCalls += 1;
    for (const quad of quads) {
      this.trace.push({ key: texture.key, blend, alpha, x: quad.x, y: quad.y, z: quad.z ?? null });
    }
    for (const quad of quads) {
      this._copyQuad(texture, quad, blend, alpha);
    }
  }

  _copyQuad(texture, quad, blend, nodeAlpha) {
    const x0 = Math.max(0, Math.floor(quad.x));
    const y0 = Math.max(0, Math.floor(quad.y));
    const x1 = Math.min(this.width, Math.ceil(quad.x + texture.width));
    const y1 = Math.min(this.height, Math.ceil(quad.y + texture.height));
    for (let y = y0; y < y1; y += 1) {
      const texY = y - Math.floor(quad.y);
      for (let x = x0; x < x1; x += 1) {
        const texX = x - Math.floor(quad.x);
        const srcOffset = (texY * texture.width + texX) * 4;
        const dstOffset = (y * this.width + x) * 4;
        this.stats.pixelsBlended += blendPixel(
          this.data, dstOffset, texture.data, srcOffset, blend, nodeAlpha
        );
      }
    }
  }

  snapshot() {
    const out = new Uint8ClampedArray(this.data.length);
    for (let i = 0; i < this.data.length; i += 1) {
      out[i] = Math.max(0, Math.min(255, this.data[i]));
    }
    return out;
  }

  fingerprint() {
    let hash = 0x811c9dc5;
    for (let i = 0; i < this.data.length; i += 1) {
      hash ^= Math.max(0, Math.min(255, this.data[i]));
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  resetStats() {
    this.stats = { drawCalls: 0, stateChanges: 0, pixelsBlended: 0 };
    this.activeState = null;
    this.trace = [];
  }

  dispose() {
    this.data = null;
    this.activeState = null;
    this.disposed = true;
  }
}

export function diffSnapshots(a, b) {
  if (a.length !== b.length) {
    throw new Error('snapshot size mismatch');
  }
  let differingPixels = 0;
  let maxChannelDelta = 0;
  let hashA = 0x811c9dc5;
  let hashB = 0x811c9dc5;
  for (let i = 0; i < a.length; i += 1) {
    const delta = Math.abs(a[i] - b[i]);
    if (delta !== 0 && i % 4 === 0) differingPixels += 1;
    if (delta > maxChannelDelta) maxChannelDelta = delta;
    hashA = Math.imul(hashA ^ a[i], 0x01000193);
    hashB = Math.imul(hashB ^ b[i], 0x01000193);
  }
  return {
    equal: differingPixels === 0,
    differingPixels,
    maxChannelDelta,
    hashA: hashA >>> 0,
    hashB: hashB >>> 0
  };
}

// Order-safety check for batching. Source-over entries must appear in the exact
// same sequence on both traces. Additive (lighter) entries are compared as
// multisets per z layer because addition is commutative. Requires node z to be
// carried on trace entries by the caller.
export function tracesAreSafe(baseTrace, optTrace) {
  if (baseTrace.length !== optTrace.length) return false;
  const baseOver = baseTrace.filter((entry) => entry.blend !== 'lighter');
  const optOver = optTrace.filter((entry) => entry.blend !== 'lighter');
  if (baseOver.length !== optOver.length) return false;
  for (let i = 0; i < baseOver.length; i += 1) {
    const a = baseOver[i];
    const b = optOver[i];
    if (a.key !== b.key || a.blend !== b.blend || a.alpha !== b.alpha
      || a.x !== b.x || a.y !== b.y || a.z !== b.z) {
      return false;
    }
  }
  const additiveSignature = (trace) => trace
    .filter((entry) => entry.blend === 'lighter')
    .map((entry) => `${entry.z}:${entry.key}:${entry.alpha}:${entry.x},${entry.y}`)
    .sort()
    .join('|');
  return additiveSignature(baseTrace) === additiveSignature(optTrace);
}
