// Minimal rasterizer exposing the CanvasRenderingContext2D subset used by
// src/core/render.js. Operates on packed RGB pixel objects.

import { hexToRgb } from '../core/render.js';
import { drawText } from './font.js';

export class NodeCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Array(width * height);
    this._alpha = 1;
    this.clear();
  }

  clear() {
    for (let index = 0; index < this.pixels.length; index += 1) {
      this.pixels[index] = { r: 0, g: 0, b: 0 };
    }
  }

  setAlpha(alpha) {
    this._alpha = alpha;
  }

  fillRect(x, y, w, h, hex) {
    const base = hexToRgb(hex);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        const target = this.pixels[py * this.width + px];
        target.r = Math.round(base.r * this._alpha + target.r * (1 - this._alpha));
        target.g = Math.round(base.g * this._alpha + target.g * (1 - this._alpha));
        target.b = Math.round(base.b * this._alpha + target.b * (1 - this._alpha));
      }
    }
  }

  fillText(text, x, y, hex) {
    drawText(this.pixels, this.width, this.height, text, x, y,
      hexToRgb(hex), 2);
  }

  isBlack() {
    return this.pixels.every((pixel) =>
      pixel.r === 0 && pixel.g === 0 && pixel.b === 0);
  }
}
