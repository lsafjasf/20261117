import { measureLayoutText } from "./layout.js";

const FONT_FAMILY = '"Mise Sans", "PingFang SC", "Microsoft YaHei", sans-serif';
const SVG_FONT_FAMILY = "'Mise Sans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
let embeddedFontStylePromise;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function embeddedFontStyle() {
  if (!embeddedFontStylePromise) {
    embeddedFontStylePromise = (async () => {
      const [regular, bold] = await Promise.all([
        fetch("assets/NotoSansSC-Regular.woff2").then((response) => {
          if (!response.ok) throw new Error(`常规字体读取失败 (${response.status})`);
          return response.arrayBuffer();
        }),
        fetch("assets/NotoSansSC-Bold.woff2").then((response) => {
          if (!response.ok) throw new Error(`粗体字重读取失败 (${response.status})`);
          return response.arrayBuffer();
        }),
      ]);
      return `<style>
    @font-face { font-family: "Mise Sans"; font-style: normal; font-weight: 400; font-display: block; src: url("data:font/woff2;base64,${arrayBufferToBase64(
      regular,
    )}") format("woff2"); }
    @font-face { font-family: "Mise Sans"; font-style: normal; font-weight: 700; font-display: block; src: url("data:font/woff2;base64,${arrayBufferToBase64(
      bold,
    )}") format("woff2"); }
    text { font-synthesis: none; }
  </style>`;
    })().catch((error) => {
      embeddedFontStylePromise = null;
      throw new Error(`无法嵌入本地字体，SVG 可能与预览不一致：${error.message}`);
    });
  }
  return embeddedFontStylePromise;
}

function withAlpha(hex, alpha) {
  const value = String(hex).replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const number = Number.parseInt(normalized, 16);
  if (!Number.isFinite(number)) return `rgba(0,0,0,${alpha})`;
  const r = (number >> 16) & 255;
  const g = (number >> 8) & 255;
  const b = number & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawTextBlock(ctx, block) {
  if (!block?.lines?.length) return;
  ctx.font = `${block.fontWeight} ${block.fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = block.color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = block.align === "right" ? "right" : "left";
  const x = block.align === "right" ? block.x + (block.width || block.maxWidth) : block.x;
  block.lines.forEach((line, index) => {
    ctx.fillText(line, x, block.y + index * block.lineHeight + block.baselineOffset);
  });
  ctx.textAlign = "left";
}

function drawBadgeText(ctx, badge) {
  ctx.font = `${badge.fontWeight} ${badge.fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = badge.color;
  ctx.textBaseline = "alphabetic";
  const lineHeight = badge.lineHeight;
  const blockHeight = badge.lines.length * lineHeight;
  const top = badge.y + (badge.height - blockHeight) / 2;
  badge.lines.forEach((line, index) => {
    ctx.fillText(line, badge.x + badge.padX, top + index * lineHeight + badge.fontSize * 0.82);
  });
}

function drawBadge(ctx, badge, colors) {
  roundRectPath(ctx, badge.x, badge.y, badge.width, badge.height, badge.height / 2);
  if (badge.allergen) {
    ctx.fillStyle = badge.background;
    ctx.fill();
  } else {
    ctx.fillStyle = badge.background;
    ctx.fill();
    ctx.strokeStyle = withAlpha(colors.line, 0.95);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  drawBadgeText(ctx, badge);
}

function drawMotif(ctx, motif) {
  if (!motif) return;
  const { x, y, width, height, type, color, accent } = motif;
  ctx.save();
  if (type === "arch") {
    for (let index = 0; index < 5; index += 1) {
      const inset = index * width * 0.095;
      ctx.beginPath();
      ctx.arc(x + width / 2, y + height * 0.51, width / 2 - inset, Math.PI * 1.08, Math.PI * 1.92);
      ctx.strokeStyle = index === 1 ? withAlpha(accent, 0.7) : withAlpha(color, 0.72);
      ctx.lineWidth = index === 1 ? 1.6 : 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x + width * 0.16, y + height * 0.52);
    ctx.lineTo(x + width * 0.16, y + height * 0.8);
    ctx.moveTo(x + width * 0.84, y + height * 0.52);
    ctx.lineTo(x + width * 0.84, y + height * 0.8);
    ctx.strokeStyle = withAlpha(color, 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + width / 2, y + height * 0.48, width * 0.035, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  } else if (type === "grid") {
    const step = Math.max(7, width / 9);
    ctx.strokeStyle = withAlpha(color, 0.34);
    ctx.lineWidth = 0.8;
    for (let lineX = x; lineX <= x + width; lineX += step) {
      ctx.beginPath();
      ctx.moveTo(lineX, y);
      ctx.lineTo(lineX, y + height);
      ctx.stroke();
    }
    for (let lineY = y; lineY <= y + height; lineY += step) {
      ctx.beginPath();
      ctx.moveTo(x, lineY);
      ctx.lineTo(x + width, lineY);
      ctx.stroke();
    }
    ctx.fillStyle = withAlpha(accent, 0.9);
    ctx.fillRect(x + width * 0.66, y + height * 0.22, step * 2, step * 2);
  } else if (type === "sun") {
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.strokeStyle = withAlpha(color, 0.52);
    ctx.lineWidth = 1;
    for (let index = 0; index < 20; index += 1) {
      const angle = (index / 20) * Math.PI * 2;
      const inner = width * (index % 2 ? 0.23 : 0.27);
      const outer = width * (index % 2 ? 0.46 : 0.5);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, width * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(accent, 0.86);
    ctx.fill();
  }
  ctx.restore();
}

function drawHeader(ctx, layout) {
  const { header, colors, type } = layout;
  drawTextBlock(ctx, header.restaurant);
  drawTextBlock(ctx, header.headline);
  drawTextBlock(ctx, header.subheading);
  drawMotif(ctx, header.motif);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(header.divider.x1, header.divider.y1);
  ctx.lineTo(header.divider.x2, header.divider.y2);
  ctx.strokeStyle = withAlpha(colors.line, 0.95);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(header.divider.x1, header.divider.y1);
  ctx.lineTo(header.divider.x1 + Math.max(24, 58 * type.scale), header.divider.y1);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = Math.max(1.5, 2.2 * type.scale);
  ctx.stroke();
  ctx.restore();
}

function drawLeader(ctx, item, colors) {
  if (!item.price?.lines?.length) return;
  const nameWidth = Math.max(
    ...item.name.lines.map((line) => measureLayoutText(line, item.name.fontSize, item.name.fontWeight)),
    0,
  );
  const start = item.x + Math.min(nameWidth + 8, item.width * 0.72);
  const end = item.price.x - 8;
  if (end - start < 14) return;
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([1.2, 4.5]);
  ctx.moveTo(start, item.y + item.name.baselineOffset);
  ctx.lineTo(end, item.y + item.name.baselineOffset);
  ctx.strokeStyle = withAlpha(colors.line, 0.85);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawItem(ctx, item, layout, isLast) {
  drawTextBlock(ctx, item.name);
  drawLeader(ctx, item, layout.colors);
  drawTextBlock(ctx, item.price);

  for (const badge of item.tags) {
    drawBadge(ctx, badge, layout.colors);
  }
  if (item.description) drawTextBlock(ctx, item.description);

  if (!isLast) {
    const lineY = item.y + item.height - item.bottomPad * 0.45;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(item.x, lineY);
    ctx.lineTo(item.x + Math.min(item.width * 0.22, 52 * layout.type.scale), lineY);
    ctx.strokeStyle = withAlpha(layout.colors.line, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

function drawColumns(ctx, layout) {
  for (const column of layout.columnsData) {
    column.items.forEach((item, index) => {
      drawItem(ctx, item, layout, index === column.items.length - 1);
    });
  }
}

function drawFooter(ctx, layout) {
  const { footer, colors } = layout;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(footer.divider.x1, footer.divider.y1);
  ctx.lineTo(footer.divider.x2, footer.divider.y2);
  ctx.strokeStyle = withAlpha(colors.line, 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  drawTextBlock(ctx, footer.note);
  drawTextBlock(ctx, footer.pageNumber);
}

function drawSafeMargin(ctx, layout) {
  const { margin } = layout.page;
  ctx.save();
  ctx.strokeStyle = "rgba(42, 97, 74, 0.48)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(margin, margin, layout.page.width - margin * 2, layout.page.height - margin * 2);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(51, 94, 68, 0.04)";
  ctx.fillRect(0, 0, layout.page.width, margin);
  ctx.fillRect(0, layout.page.height - margin, layout.page.width, margin);
  ctx.fillRect(0, margin, margin, layout.page.height - margin * 2);
  ctx.fillRect(
    layout.page.width - margin,
    margin,
    margin,
    layout.page.height - margin * 2,
  );
  ctx.restore();
}

function findSelectedItem(layout, selectedId) {
  if (!selectedId) return null;
  for (const column of layout.columnsData) {
    const item = column.items.find((entry) => entry.id === selectedId);
    if (item) return item;
  }
  return null;
}

function drawSelection(ctx, layout, selectedId) {
  const item = findSelectedItem(layout, selectedId);
  if (!item) return;
  const pad = Math.max(5, 9 * layout.type.scale);
  ctx.save();
  roundRectPath(ctx, item.x - pad, item.y - pad, item.width + pad * 2, item.height + pad, pad);
  ctx.fillStyle = "rgba(255, 253, 246, 0.18)";
  ctx.fill();
  ctx.strokeStyle = "rgba(50, 91, 65, 0.72)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [handleX, handleY] of [
    [item.x - pad, item.y - pad],
    [item.x + item.width + pad, item.y - pad],
  ]) {
    ctx.beginPath();
    ctx.arc(handleX, handleY, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#f8f3e7";
    ctx.fill();
    ctx.strokeStyle = "#325b41";
    ctx.stroke();
  }
  ctx.restore();
}

export function renderCanvas(ctx, layout, options = {}) {
  const { width, height } = layout.page;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = layout.colors.background;
  ctx.fillRect(0, 0, width, height);

  const edge = ctx.createLinearGradient(0, 0, width, height);
  edge.addColorStop(0, "rgba(255,255,255,0.10)");
  edge.addColorStop(0.5, "rgba(255,255,255,0)");
  edge.addColorStop(1, "rgba(76,62,40,0.025)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, width, height);

  drawHeader(ctx, layout);
  drawColumns(ctx, layout);
  drawFooter(ctx, layout);

  if (options.safeMargin) drawSafeMargin(ctx, layout);
  if (options.selectedId) drawSelection(ctx, layout, options.selectedId);
  ctx.restore();
}

export function renderCanvasToPng(layout, scale = 2) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(layout.page.width * scale);
  canvas.height = Math.round(layout.page.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  renderCanvas(ctx, layout);
  return canvas;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgTextBlock(block) {
  if (!block?.lines?.length) return "";
  const anchor = block.align === "right" ? "end" : "start";
  const x = block.align === "right" ? block.x + (block.width || block.maxWidth) : block.x;
  return block.lines
    .map(
      (line, index) =>
        `<text x="${x.toFixed(2)}" y="${(block.y + index * block.lineHeight + block.baselineOffset).toFixed(
          2,
        )}" fill="${block.color}" font-family="${SVG_FONT_FAMILY}" font-size="${block.fontSize.toFixed(
          2,
        )}" font-weight="${block.fontWeight}" text-anchor="${anchor}">${escapeXml(line)}</text>`,
    )
    .join("\n");
}

function svgBadge(badge) {
  const textHeight = badge.lines.length * badge.lineHeight;
  const top = badge.y + (badge.height - textHeight) / 2;
  const text = badge.lines
    .map(
      (line, index) =>
        `<text x="${(badge.x + badge.padX).toFixed(2)}" y="${(
          top +
          index * badge.lineHeight +
          badge.fontSize * 0.82
        ).toFixed(2)}" fill="${badge.color}" font-family="${SVG_FONT_FAMILY}" font-size="${badge.fontSize.toFixed(
          2,
        )}" font-weight="${badge.fontWeight}">${escapeXml(line)}</text>`,
    )
    .join("");
  return `<g class="${badge.allergen ? "allergen-tag" : "dietary-tag"}" data-tag="${escapeXml(badge.text)}">
  <rect x="${badge.x.toFixed(2)}" y="${badge.y.toFixed(2)}" width="${badge.width.toFixed(
    2,
  )}" height="${badge.height.toFixed(2)}" rx="${(badge.height / 2).toFixed(2)}" fill="${
    badge.allergen ? badge.background : "transparent"
  }" stroke="${badge.border}" stroke-width="1"/>
  ${text}
</g>`;
}

function svgMotif(motif) {
  if (!motif) return "";
  const { x, y, width, height, type, color, accent } = motif;
  if (type === "arch") {
    const rings = [];
    for (let index = 0; index < 5; index += 1) {
      const radius = width / 2 - index * width * 0.095;
      rings.push(
        `<path d="M ${(x + width / 2 - radius).toFixed(2)} ${(y + height * 0.51).toFixed(2)} A ${radius.toFixed(
          2,
        )} ${radius.toFixed(2)} 0 0 1 ${(x + width / 2 + radius).toFixed(2)} ${(y + height * 0.51).toFixed(
          2,
        )}" fill="none" stroke="${index === 1 ? withAlpha(accent, 0.7) : withAlpha(color, 0.72)}" stroke-width="${
          index === 1 ? 1.6 : 1
        }"/>`,
      );
    }
    return `<g class="motif">${rings.join("")}
  <path d="M ${(x + width * 0.16).toFixed(2)} ${(y + height * 0.52).toFixed(2)} V ${(
    y +
    height * 0.8
  ).toFixed(2)} M ${(x + width * 0.84).toFixed(2)} ${(y + height * 0.52).toFixed(2)} V ${(
    y +
    height * 0.8
  ).toFixed(2)}" stroke="${withAlpha(color, 0.5)}" stroke-width="1"/>
  <circle cx="${(x + width / 2).toFixed(2)}" cy="${(y + height * 0.48).toFixed(2)}" r="${(
    width * 0.035
  ).toFixed(2)}" fill="${accent}"/>
</g>`;
  }
  if (type === "grid") {
    const step = Math.max(7, width / 9);
    const lines = [];
    for (let lineX = x; lineX <= x + width; lineX += step) {
      lines.push(
        `<path d="M ${lineX.toFixed(2)} ${y.toFixed(2)} V ${(y + height).toFixed(2)}"/>`,
      );
    }
    for (let lineY = y; lineY <= y + height; lineY += step) {
      lines.push(
        `<path d="M ${x.toFixed(2)} ${lineY.toFixed(2)} H ${(x + width).toFixed(2)}"/>`,
      );
    }
    return `<g class="motif" stroke="${withAlpha(color, 0.34)}" stroke-width="0.8">${lines.join("")}
  <rect x="${(x + width * 0.66).toFixed(2)}" y="${(y + height * 0.22).toFixed(2)}" width="${(
    step * 2
  ).toFixed(2)}" height="${(step * 2).toFixed(2)}" fill="${withAlpha(accent, 0.9)}" stroke="none"/>
</g>`;
  }
  if (type === "sun") {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rays = [];
    for (let index = 0; index < 20; index += 1) {
      const angle = (index / 20) * Math.PI * 2;
      const inner = width * (index % 2 ? 0.23 : 0.27);
      const outer = width * (index % 2 ? 0.46 : 0.5);
      rays.push(
        `<path d="M ${(cx + Math.cos(angle) * inner).toFixed(2)} ${(cy + Math.sin(angle) * inner).toFixed(
          2,
        )} L ${(cx + Math.cos(angle) * outer).toFixed(2)} ${(cy + Math.sin(angle) * outer).toFixed(2)}"/>`,
      );
    }
    return `<g class="motif" stroke="${withAlpha(color, 0.52)}" stroke-width="1">${rays.join("")}
  <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(width * 0.16).toFixed(2)}" fill="${withAlpha(
    accent,
    0.86,
  )}" stroke="none"/>
</g>`;
  }
  return "";
}

function svgLeader(item, colors) {
  const nameWidth = Math.max(
    ...item.name.lines.map((line) => measureLayoutText(line, item.name.fontSize, item.name.fontWeight)),
    0,
  );
  const start = item.x + Math.min(nameWidth + 8, item.width * 0.72);
  const end = item.price.x - 8;
  if (end - start < 14) return "";
  return `<path d="M ${start.toFixed(2)} ${(item.y + item.name.baselineOffset).toFixed(
    2,
  )} H ${end.toFixed(2)}" stroke="${withAlpha(colors.line, 0.85)}" stroke-width="1" stroke-dasharray="1.2 4.5"/>`;
}

function svgItem(item, layout, isLast) {
  const parts = [
    `<g class="menu-item" data-dish-id="${escapeXml(item.id)}">`,
    svgTextBlock(item.name),
    svgLeader(item, layout.colors),
    svgTextBlock(item.price),
  ];
  for (const badge of item.tags) parts.push(svgBadge(badge));
  if (item.description) parts.push(svgTextBlock(item.description));
  if (!isLast) {
    const lineY = item.y + item.height - item.bottomPad * 0.45;
    parts.push(
      `<path d="M ${item.x.toFixed(2)} ${lineY.toFixed(2)} H ${(
        item.x +
        Math.min(item.width * 0.22, 52 * layout.type.scale)
      ).toFixed(2)}" stroke="${withAlpha(layout.colors.line, 0.7)}" stroke-width="1"/>`,
    );
  }
  parts.push("</g>");
  return parts.join("\n");
}

export async function buildSvg(layout, doc) {
  const { width, height } = layout.page;
  const fontStyle = await embeddedFontStyle();
  const columns = layout.columnsData
    .flatMap((column) => column.items.map((item, index) => svgItem(item, layout, index === column.items.length - 1)))
    .join("\n");
  const headerDivider =
    `<path d="M ${layout.header.divider.x1} ${layout.header.divider.y1} H ${layout.header.divider.x2}" stroke="${withAlpha(
      layout.colors.line,
      0.95,
    )}" stroke-width="1"/>` +
    `<path d="M ${layout.header.divider.x1} ${layout.header.divider.y1} H ${(
      layout.header.divider.x1 +
      Math.max(24, 58 * layout.type.scale)
    ).toFixed(2)}" stroke="${layout.colors.accent}" stroke-width="${Math.max(
      1.5,
      2.2 * layout.type.scale,
    ).toFixed(2)}"/>`;
  const footerDivider = `<path d="M ${layout.footer.divider.x1} ${layout.footer.divider.y1} H ${layout.footer.divider.x2}" stroke="${withAlpha(
    layout.colors.line,
    0.9,
  )}" stroke-width="1"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="menu-title menu-desc">
  <title id="menu-title">${escapeXml(doc.restaurant)} · ${escapeXml(doc.headline)}</title>
  <desc id="menu-desc">由 Mise 可变菜单编排生成。文字、标签、装饰形状均为独立可编辑的 SVG 元素。</desc>
  <metadata>{"generator":"Mise","schema":"mise.restaurant-menu","columns":${layout.columns},"fitScale":${layout.fitScale}}</metadata>
  <defs>
    ${fontStyle}
    <linearGradient id="paper-light" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#4c3e28" stop-opacity="0.025"/>
    </linearGradient>
  </defs>
  <g id="menu-page">
    <rect id="paper" width="${width}" height="${height}" fill="${layout.colors.background}"/>
    <rect width="${width}" height="${height}" fill="url(#paper-light)"/>
    <g id="header">
      ${svgTextBlock(layout.header.restaurant)}
      ${svgTextBlock(layout.header.headline)}
      ${svgTextBlock(layout.header.subheading)}
      ${svgMotif(layout.header.motif)}
      ${headerDivider}
    </g>
    <g id="dishes">
      ${columns}
    </g>
    <g id="footer">
      ${footerDivider}
      ${svgTextBlock(layout.footer.note)}
      ${svgTextBlock(layout.footer.pageNumber)}
    </g>
  </g>
</svg>`;
}
