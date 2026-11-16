/* Canvas 渲染与 SVG 导出。两者使用 model 计算出的相同换行结果，
 * 保证导出与预览一致。 */
(function (global) {
  'use strict';

  var M = global.PosterModel;

  function drawCanvas(ctx, doc, opts) {
    opts = opts || {};
    var c = doc.canvas;
    ctx.save();
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, c.width, c.height);

    if (opts.showGuides) {
      // 安全边距
      ctx.strokeStyle = '#e74c3c';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(c.margin, c.margin, c.width - c.margin * 2, c.height - c.margin * 2);
      // 网格列参考线
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.setLineDash([2, 4]);
      var cw = M.cellWidth(c);
      for (var i = 0; i < c.columns; i++) {
        var x = c.margin + i * (cw + c.gap);
        ctx.strokeRect(x, c.margin, cw, c.height - c.margin * 2);
      }
      ctx.setLineDash([]);
    }

    var issueIds = opts.issueIds || {};
    doc.blocks.forEach(function (b) {
      drawBlock(ctx, b, {
        selected: opts.selectedId === b.id,
        issue: !!issueIds[b.id]
      });
    });
    ctx.restore();
  }

  function drawBlock(ctx, b, state) {
    var pad = M.BLOCK_PAD;
    ctx.save();
    // 卡片底
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = state.issue ? '#e74c3c' : (state.selected ? '#2d9cdb' : '#d0d4da');
    ctx.lineWidth = state.selected || state.issue ? 2.5 : 1;
    roundRect(ctx, b.x, b.y, b.w, b.h, 6);
    ctx.fill();
    ctx.stroke();

    // 裁切区域：固定行高时超出的文字不画出卡片（并在校验中报告）
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();

    var cx = b.x + pad;
    var cy = b.y + pad;
    var innerW = b.w - pad * 2;

    // 标题
    ctx.fillStyle = '#1a1a1a';
    ctx.font = M.fontOf(b.titleSize, true);
    ctx.textBaseline = 'top';
    b._titleLines.forEach(function (line) {
      ctx.fillText(line, cx, cy);
      cy += Math.round(b.titleSize * 1.3);
    });

    // 图片占位
    if (b.color) {
      var imgH = Math.round(innerW * M.IMAGE_RATIO);
      ctx.fillStyle = b.color;
      roundRect(ctx, cx, cy, innerW, imgH, 4);
      ctx.fill();
      cy += imgH + 8;
    }

    // 说明文字
    ctx.fillStyle = '#444';
    ctx.font = M.fontOf(b.fontSize, false);
    b._bodyLines.forEach(function (line) {
      ctx.fillText(line, cx, cy);
      cy += Math.round(b.fontSize * 1.5);
    });
    ctx.restore();

    if (b.pinned) {
      ctx.fillStyle = '#2d9cdb';
      ctx.font = M.fontOf(12, true);
      ctx.textBaseline = 'top';
      ctx.fillText('📌 已固定', b.x + 6, b.y + 4);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---- SVG 导出：与 Canvas 共用换行与坐标 ---- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toSVG(doc) {
    var c = doc.canvas;
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + c.width +
      '" height="' + c.height + '" viewBox="0 0 ' + c.width + ' ' + c.height + '">');
    out.push('<rect width="100%" height="100%" fill="' + c.bg + '"/>');
    doc.blocks.forEach(function (b) {
      var pad = M.BLOCK_PAD;
      var clipId = 'clip-' + b.id;
      out.push('<clipPath id="' + clipId + '"><rect x="' + b.x + '" y="' + b.y +
        '" width="' + b.w + '" height="' + b.h + '"/></clipPath>');
      out.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
        '" rx="6" fill="#ffffff" stroke="#d0d4da"/>');
      out.push('<g clip-path="url(#' + clipId + ')">');
      var cx = b.x + pad;
      var cy = b.y + pad;
      var innerW = b.w - pad * 2;
      b._titleLines.forEach(function (line) {
        out.push('<text x="' + cx + '" y="' + (cy + b.titleSize) +
          '" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="' +
          b.titleSize + '" font-weight="700" fill="#1a1a1a">' + esc(line) + '</text>');
        cy += Math.round(b.titleSize * 1.3);
      });
      if (b.color) {
        var imgH = Math.round(innerW * M.IMAGE_RATIO);
        out.push('<rect x="' + cx + '" y="' + cy + '" width="' + innerW +
          '" height="' + imgH + '" rx="4" fill="' + b.color + '"/>');
        cy += imgH + 8;
      }
      b._bodyLines.forEach(function (line) {
        out.push('<text x="' + cx + '" y="' + (cy + b.fontSize) +
          '" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="' +
          b.fontSize + '" fill="#444444">' + esc(line) + '</text>');
        cy += Math.round(b.fontSize * 1.5);
      });
      out.push('</g>');
    });
    out.push('</svg>');
    return out.join('\n');
  }

  global.PosterRender = { drawCanvas: drawCanvas, toSVG: toSVG };
})(window);
