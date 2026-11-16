// Deterministic layout engine: text -> positioned glyph geometry.
// Pure functions, no DOM access, so results are unit-testable.

import { getGlyph, hasGlyph, GRID } from './font.js';
import { PARAM_SPEC, validateParams } from './validation.js';

export const LAYOUT_SPEC = { wrapWidth: { min: 80, max: 4000 }, lineGap: 0.35 };

function strokeWidthForWeight(weight, fontSize) {
  const t = (weight - PARAM_SPEC.weight.min) /
    (PARAM_SPEC.weight.max - PARAM_SPEC.weight.min);
  return fontSize * (0.04 + t * 0.16);
}

function measureChar(ch, width, fontSize, slant, strokeWidth) {
  const sheared = hasGlyph(ch)
    ? Math.tan((slant * Math.PI) / 180) * GRID.capHeight
    : 0;
  const base = (hasGlyph(ch) ? GRID.advance : 3) * (fontSize / GRID.capHeight) * width;
  const cell = base + strokeWidth;
  return { cell, slantPx: sheared * (fontSize / GRID.capHeight) * width };
}

function wrapLines(text, wrapWidth, measure) {
  const hardLines = text.split('\n');
  const lines = [];
  for (const hardLine of hardLines) {
    const words = hardLine.split(' ');
    let current = '';
    let widthPx = 0;
    const push = () => {
      lines.push({ text: current, width: widthPx });
      current = '';
      widthPx = 0;
    };
    for (const [index, word] of words.entries()) {
      const token = index === 0 ? word : ` ${word}`;
      let tokenWidth = 0;
      for (const ch of token) {
        const { cell, slantPx } = measure(ch);
        tokenWidth += cell + Math.max(0, slantPx);
      }
      if (current && widthPx + tokenWidth > wrapWidth) push();
      current += token;
      widthPx += tokenWidth;
    }
    push();
  }
  return lines;
}

export function layoutLayer(layer, wrapWidth = 720) {
  const check = validateParams(layer);
  if (!check.ok) {
    const reason = check.errors.map((e) => e.reason).join('; ');
    return { ok: false, reason, glyphs: [], bounds: null };
  }
  const { text, fontSize, weight, slant, width, color } = layer;
  const strokeWidth = strokeWidthForWeight(weight, fontSize);
  const measure = (ch) => measureChar(ch, width, fontSize, slant, strokeWidth);
  const lineHeight = fontSize * (1 + LAYOUT_SPEC.lineGap);
  const wrapped = wrapLines(text || ' ', wrapWidth, measure);

  const glyphs = [];
  wrapped.forEach((line, lineIndex) => {
    let pen = 0;
    const baseline = fontSize + lineIndex * lineHeight;
    let col = 0;
    for (const ch of line.text) {
      const { cell, slantPx } = measure(ch);
      glyphs.push({
        char: ch,
        x: pen,
        y: baseline,
        slantPx,
        cell,
        strokeWidth,
        procedural: hasGlyph(ch),
        glyph: getGlyph(ch),
        fontSize,
        width,
        corner: layer.corner,
        color,
        line: lineIndex,
        col: col++
      });
      pen += cell;
    }
  });

  const maxLineWidth = wrapped.reduce((max, line) => Math.max(max, line.width), 0);
  const bounds = {
    width: Math.max(maxLineWidth, 1),
    height: wrapped.length * lineHeight,
    lines: wrapped.length,
    lineHeight
  };
  return { ok: true, glyphs, bounds };
}

export function layoutScene(scene, wrapWidth) {
  const layers = scene.layers.map((layer, index) => {
    const result = layoutLayer(layer, wrapWidth);
    return {
      id: layer.id,
      name: layer.name,
      order: index,
      position: layer.position || { x: 0, y: 0 },
      ...result
    };
  });
  const invalid = layers.filter((layer) => !layer.ok);
  return {
    ok: invalid.length === 0,
    invalid,
    layers,
    totalGlyphs: layers.reduce((sum, layer) => sum + layer.glyphs.length, 0)
  };
}

export { strokeWidthForWeight };
