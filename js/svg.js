// SVG export: pure vector paths so the result stays smooth at any zoom.

function pathOf(line) {
  const pts = line.points;
  if (!pts.length) return '';
  let d = `M ${pts[0][0].toFixed(3)} ${pts[0][1].toFixed(3)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i][0].toFixed(3)} ${pts[i][1].toFixed(3)}`;
  }
  if (line.closed) d += ' Z';
  return d;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function exportSVG({ world, lines, labels, layers, terrainBands }) {
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${world.x} ${world.y} ${world.w} ${world.h}" ` +
    `width="${world.w}" height="${world.h}">`
  );
  if (layers.terrain) {
    parts.push(`<g id="terrain">`);
    parts.push(
      `<rect x="${world.x}" y="${world.y}" width="${world.w}" height="${world.h}" fill="#f4efe4"/>`
    );
    if (terrainBands) {
      for (const band of terrainBands) {
        parts.push(
          `<path d="${pathOf(band.line)}" fill="none" stroke="${band.color}" ` +
          `stroke-width="${(world.w / 400).toFixed(3)}" stroke-opacity="0.35"/>`
        );
      }
    }
    parts.push(`</g>`);
  }
  if (layers.contours) {
    parts.push(`<g id="contours" fill="none" stroke="#8a5a2b" stroke-width="${(world.w / 800).toFixed(3)}">`);
    for (const line of lines) {
      parts.push(`<path data-level="${line.level}" d="${pathOf(line)}"/>`);
    }
    parts.push(`</g>`);
  }
  if (layers.labels) {
    const fs = world.w / 55;
    parts.push(
      `<g id="labels" font-family="serif" font-size="${fs.toFixed(2)}" fill="#5a3a1b" text-anchor="middle">`
    );
    for (const lb of labels) {
      const deg = ((lb.angle * 180) / Math.PI).toFixed(2);
      parts.push(
        `<text transform="translate(${lb.x.toFixed(3)} ${lb.y.toFixed(3)}) rotate(${deg})">${esc(lb.text)}</text>`
      );
    }
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join('\n');
}
