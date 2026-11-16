import { LITHOLOGY } from '../core/constants.js';

// Canvas 纹理：在已填充基色的矩形上叠加图案
export function paintTexture(ctx, texture, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  switch (texture) {
    case 'dots': return dots(ctx, x, y, w, h, '#6d5530');
    case 'clay': return clay(ctx, x, y, w, h, '#9a8254');
    case 'sand': return sand(ctx, x, y, w, h, '#b39a63');
    case 'gravel': return gravel(ctx, x, y, w, h, '#7d766a');
    case 'shale': return shale(ctx, x, y, w, h, '#5e4433');
    case 'siltstone': return siltstone(ctx, x, y, w, h, '#7a5c46');
    case 'limestone': return limestone(ctx, x, y, w, h, '#55717c');
    default: return undefined;
  }
}

function dots(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  for (let yy = y + 5; yy < y + h; yy += 9) {
    for (let xx = x + 5 + ((yy / 9) % 2) * 4; xx < x + w; xx += 9) {
      ctx.beginPath(); ctx.arc(xx, yy, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function clay(ctx, x, y, w, h, c) {
  ctx.strokeStyle = c; ctx.lineWidth = 1;
  for (let yy = y + 4; yy < y + h; yy += 7) {
    ctx.beginPath();
    ctx.moveTo(x, yy);
    for (let xx = x; xx <= x + w; xx += 6) {
      ctx.lineTo(xx, yy + Math.sin(xx * 0.8) * 1.6);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function sand(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  for (let yy = y + 3; yy < y + h; yy += 6) {
    for (let xx = x + 3 + ((yy / 6) % 2) * 3; xx < x + w; xx += 6) {
      ctx.fillRect(xx, yy, 1.2, 1.2);
    }
  }
  ctx.restore();
}

function gravel(ctx, x, y, w, h, c) {
  ctx.strokeStyle = c; ctx.lineWidth = 1.1;
  for (let yy = y + 6; yy < y + h + 6; yy += 11) {
    for (let xx = x + 6 + ((yy / 11) % 2) * 5; xx < x + w + 6; xx += 11) {
      ctx.beginPath(); ctx.ellipse(xx, yy, 3.4, 2.6, 0.6, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

function shale(ctx, x, y, w, h, c) {
  ctx.strokeStyle = c; ctx.lineWidth = 1.1;
  for (let yy = y + 3; yy < y + h; yy += 4) {
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
  }
  ctx.restore();
}

function siltstone(ctx, x, y, w, h, c) {
  shale(ctx, x, y, w, h, c);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  for (let xx = x - h; xx < x + w; xx += 8) {
    ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx + h, y + h); ctx.stroke();
  }
  ctx.restore();
}

function limestone(ctx, x, y, w, h, c) {
  ctx.strokeStyle = c; ctx.lineWidth = 1;
  const brickH = 9;
  for (let yy = y; yy < y + h; yy += brickH) {
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    const offset = (Math.round(yy / brickH) % 2) * 10;
    for (let xx = x + offset; xx < x + w; xx += 20) {
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + brickH); ctx.stroke();
    }
  }
  ctx.restore();
}

// SVG 图案定义，与 Canvas 纹理一一对应，保证导出观感一致
export function svgPatternDefs() {
  const defs = [];
  for (const litho of Object.values(LITHOLOGY)) {
    defs.push(svgPattern(litho.id, litho.color, litho.texture));
  }
  defs.push(`<pattern id="gapPattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="8" height="8" fill="#f4f4f2"/>
    <line x1="0" y1="0" x2="0" y2="8" stroke="#b8b8b0" stroke-width="2"/>
  </pattern>`);
  return `<defs>${defs.join('')}</defs>`;
}

function svgPattern(id, color, texture) {
  const inner = {
    dots: '<circle cx="3" cy="3" r="1.3" fill="#6d5530"/><circle cx="8" cy="8" r="1.3" fill="#6d5530"/>',
    clay: '<path d="M0 4 Q3 1 6 4 T12 4" fill="none" stroke="#9a8254" stroke-width="1"/>',
    sand: '<rect width="1.4" height="1.4" x="2" y="2" fill="#b39a63"/><rect width="1.4" height="1.4" x="8" y="7" fill="#b39a63"/>',
    gravel: '<ellipse cx="5" cy="5" rx="3.2" ry="2.4" fill="none" stroke="#7d766a" stroke-width="1"/>',
    shale: '<line x1="0" y1="3" x2="10" y2="3" stroke="#5e4433" stroke-width="1"/>',
    siltstone: '<line x1="0" y1="3" x2="10" y2="3" stroke="#5e4433"/><line x1="-2" y1="10" x2="8" y2="0" stroke="rgba(255,255,255,0.5)"/>',
    limestone: '<path d="M0 5 H10 M5 0 V5 M0 10 H10" fill="none" stroke="#55717c" stroke-width="0.8"/>'
  }[texture];
  return `<pattern id="pat-${id}" width="10" height="10" patternUnits="userSpaceOnUse">
    <rect width="10" height="10" fill="${color}"/>${inner}</pattern>`;
}
