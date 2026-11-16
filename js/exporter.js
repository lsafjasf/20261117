// 导出：SVG（展开图，与预览共用 TextLayout 保证一致）与 PNG（当前画布视图）。
const Exporter = (() => {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function toSVG(doc) {
    const P = doc.page, pw = P.w / P.panels;
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${P.w}mm" height="${P.h}mm" viewBox="0 0 ${P.w} ${P.h}" font-family="PingFang SC, Microsoft YaHei, sans-serif">`);
    parts.push(`<rect x="0" y="0" width="${P.w}" height="${P.h}" fill="#ffffff"/>`);
    for (const el of doc.elements) {
      if (el.type === 'rect') {
        parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="${el.fill}"`
          + (el.stroke && el.lineWidth > 0 ? ` stroke="${el.stroke}" stroke-width="${el.lineWidth}"` : '') + '/>');
      } else if (el.type === 'ellipse') {
        parts.push(`<ellipse cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" rx="${el.w / 2}" ry="${el.h / 2}" fill="${el.fill}"`
          + (el.stroke && el.lineWidth > 0 ? ` stroke="${el.stroke}" stroke-width="${el.lineWidth}"` : '') + '/>');
      } else if (el.type === 'text') {
        const lay = TextLayout.layout(el, 4); // 与预览同一排版引擎
        const fsMm = el.fontSize * PT_TO_MM;
        const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
        const tx = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w : el.x;
        const weight = el.bold ? ' font-weight="bold"' : '';
        parts.push(`<text font-size="${fsMm.toFixed(3)}" fill="${el.color}" text-anchor="${anchor}"${weight}>`);
        lay.lines.forEach((ln, i) => {
          const y = el.y + i * lay.lineHeightMm + fsMm;
          parts.push(`<tspan x="${tx}" y="${y.toFixed(3)}">${esc(ln)}</tspan>`);
        });
        parts.push('</text>');
      }
    }
    // 折线参考（非打印层，便于核对分页）
    parts.push(`<g stroke="#1e64c8" stroke-width="0.3" stroke-dasharray="4 3" opacity="0.6">`);
    for (let i = 1; i < P.panels; i++) {
      parts.push(`<line x1="${i * pw}" y1="0" x2="${i * pw}" y2="${P.h}"/>`);
    }
    parts.push('</g></svg>');
    return parts.join('\n');
  }

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function exportSVG(doc) {
    download('trifold.svg', new Blob([toSVG(doc)], { type: 'image/svg+xml' }));
  }

  function exportPNG(canvas) {
    canvas.toBlob(b => download('trifold.png', b), 'image/png');
  }

  return { toSVG, exportSVG, exportPNG };
})();
