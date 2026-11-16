import { GLYPH_ROWS } from './font-data.js';

export const GLYPH_W = 5;
export const GLYPH_H = 7;
const ADVANCE = 6;
const LINE_H = 9;
const FALLBACK = '?';

export function lineWidth(text) {
  return text.length * ADVANCE - 1;
}

export function textDimensions(text, scale = 1) {
  const lines = text.split('\n');
  const width = Math.max(...lines.map(lineWidth));
  const height = lines.length * LINE_H - 2;
  return { width: width * scale, height: height * scale };
}

// Rasterizes text into an RGBA texture. Lit pixels carry the requested color
// with full alpha; transparent background stays alpha 0.
export function rasterizeText(text, color, scale = 1) {
  const { width, height } = textDimensions(text, scale);
  const data = new Uint8ClampedArray(width * height * 4);
  const lines = text.split('\n');

  lines.forEach((line, lineIndex) => {
    for (let column = 0; column < line.length; column += 1) {
      const glyph = GLYPH_ROWS[line[column]] || GLYPH_ROWS[FALLBACK];
      for (let row = 0; row < GLYPH_H; row += 1) {
        for (let pixel = 0; pixel < GLYPH_W; pixel += 1) {
          if (glyph[row][pixel] !== '#') continue;
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              const x = (column * ADVANCE + pixel) * scale + sx;
              const y = (lineIndex * LINE_H + row) * scale + sy;
              const offset = (y * width + x) * 4;
              data[offset] = color.r;
              data[offset + 1] = color.g;
              data[offset + 2] = color.b;
              data[offset + 3] = 255;
            }
          }
        }
      }
    }
  });

  return { width, height, data };
}
