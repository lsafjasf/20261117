/* 数据模型与网格布局引擎。
 * 文档(doc)是唯一事实来源；区块只存内容、跨度与(固定时的)网格位置，
 * 像素坐标由 layout() 计算，保证切换栏数/缩放时内容不丢失。 */
(function (global) {
  'use strict';

  var ROW_HEIGHT = 96;      // 每格行高(px)
  var BLOCK_PAD = 12;       // 区块内边距
  var IMAGE_RATIO = 0.42;   // 图片区占区块宽度比例上限

  function uid() {
    return 'b' + Math.random().toString(36).slice(2, 9);
  }

  function defaultCanvas() {
    return { width: 1200, height: 1600, margin: 48, gap: 24, columns: 3, bg: '#ffffff' };
  }

  function makeBlock(partial) {
    var b = {
      id: uid(),
      title: '新区块',
      text: '',
      titleSize: 28,
      fontSize: 16,
      color: '#4a90d9',     // 图片占位颜色
      colSpan: 1,
      rowSpan: 3,
      autoHeight: true,
      pinned: false,
      gridCol: 0,           // 仅 pinned 时有效
      gridRow: 0
    };
    if (partial) { for (var k in partial) { b[k] = partial[k]; } }
    return b;
  }

  function makeDoc() {
    return { version: 1, canvas: defaultCanvas(), blocks: [] };
  }

  /* ---- 文本测量（Canvas 与 SVG 导出共用同一换行结果，保证一致） ---- */
  var measureCtx = null;
  function getCtx() {
    if (!measureCtx) {
      measureCtx = document.createElement('canvas').getContext('2d');
    }
    return measureCtx;
  }

  function fontOf(size, bold) {
    return (bold ? '700 ' : '400 ') + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
  }

  function wrapText(text, size, maxWidth, bold) {
    var ctx = getCtx();
    ctx.font = fontOf(size, bold);
    var lines = [];
    var paragraphs = String(text == null ? '' : text).split('\n');
    paragraphs.forEach(function (para) {
      if (para === '') { lines.push(''); return; }
      var line = '';
      // 按字符断行，兼容中英文混排与无空格长词
      for (var i = 0; i < para.length; i++) {
        var ch = para[i];
        if (ctx.measureText(line + ch).width > maxWidth && line !== '') {
          lines.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
      lines.push(line);
    });
    return lines;
  }

  /* 计算区块内容高度：标题 + 图片区 + 说明文字 */
  function contentHeight(block, innerWidth) {
    var h = BLOCK_PAD * 2;
    var titleLines = block.title ? wrapText(block.title, block.titleSize, innerWidth, true) : [];
    h += titleLines.length * Math.round(block.titleSize * 1.3);
    if (block.color) { h += Math.round(innerWidth * IMAGE_RATIO) + 8; }
    var bodyLines = block.text ? wrapText(block.text, block.fontSize, innerWidth, false) : [];
    h += bodyLines.length * Math.round(block.fontSize * 1.5);
    return { height: h, titleLines: titleLines, bodyLines: bodyLines };
  }

  /* ---- 布局 ---- */
  function cellWidth(canvas) {
    return (canvas.width - canvas.margin * 2 - canvas.gap * (canvas.columns - 1)) / canvas.columns;
  }

  function layout(doc) {
    var canvas = doc.canvas;
    var cols = canvas.columns;
    var cw = cellWidth(canvas);
    var gap = canvas.gap;
    var margin = canvas.margin;
    var occupancy = []; // occupancy[row][col] = blockId
    var notices = [];

    function ensureRows(r) {
      while (occupancy.length <= r) { occupancy.push(new Array(cols).fill(null)); }
    }
    function fits(row, col, span) {
      if (col + span > cols) { return false; }
      ensureRows(row);
      for (var c = col; c < col + span; c++) {
        if (occupancy[row][c]) { return false; }
      }
      return true;
    }
    function occupy(row, col, span, rowSpan, id) {
      ensureRows(row + rowSpan - 1);
      for (var r = row; r < row + rowSpan; r++) {
        for (var c = col; c < col + span; c++) { occupancy[r][c] = id; }
      }
    }

    // 栏数变化时收敛跨度，内容保留只调整占位
    doc.blocks.forEach(function (b) {
      if (b.colSpan > cols) {
        notices.push('区块「' + (b.title || b.id) + '」占列数 ' + b.colSpan +
          ' 超过当前 ' + cols + ' 栏，已收敛为 ' + cols + ' 栏，内容未丢失。');
        b.colSpan = cols;
      }
      if (b.colSpan < 1) { b.colSpan = 1; }
      if (b.rowSpan < 1) { b.rowSpan = 1; }
    });

    // 预算内容高度：自动高度区块需占用足以容纳内容的行数，
    // 否则像素高度会超出网格占位而与下方区块重叠
    doc.blocks.forEach(function (b) {
      var w = b.colSpan * cw + (b.colSpan - 1) * gap;
      var contentH = contentHeight(b, w - BLOCK_PAD * 2).height;
      b._effRowSpan = b.rowSpan;
      if (b.autoHeight) {
        var need = Math.ceil((contentH + gap) / (ROW_HEIGHT + gap));
        b._effRowSpan = Math.max(b.rowSpan, need);
      }
    });

    // 先放固定区块
    doc.blocks.forEach(function (b) {
      if (!b.pinned) { return; }
      var col = Math.max(0, Math.min(b.gridCol, cols - b.colSpan));
      var row = Math.max(0, b.gridRow);
      b._col = col; b._row = row;
      occupy(row, col, b.colSpan, b._effRowSpan, b.id);
    });

    // 再自动放置其余区块（稠密填充，跳过固定块）
    doc.blocks.forEach(function (b) {
      if (b.pinned) { return; }
      var placed = false;
      for (var row = 0; !placed; row++) {
        ensureRows(row);
        for (var col = 0; col + b.colSpan <= cols; col++) {
          if (fits(row, col, b.colSpan)) {
            b._col = col; b._row = row;
            occupy(row, col, b.colSpan, b._effRowSpan, b.id);
            placed = true;
            break;
          }
        }
        if (row > 500) { // 防御性退出，理论上不会到达
          b._col = 0; b._row = row;
          occupy(row, 0, b.colSpan, b._effRowSpan, b.id);
          placed = true;
        }
      }
    });

    // 网格坐标 -> 像素坐标
    doc.blocks.forEach(function (b) {
      b.x = margin + b._col * (cw + gap);
      b.w = b.colSpan * cw + (b.colSpan - 1) * gap;
      var info = contentHeight(b, b.w - BLOCK_PAD * 2);
      b._contentHeight = info.height;
      b._titleLines = info.titleLines;
      b._bodyLines = info.bodyLines;
      var spanH = b._effRowSpan * ROW_HEIGHT + (b._effRowSpan - 1) * gap;
      b.h = b.autoHeight ? Math.max(spanH, info.height) : spanH;
      b.y = margin + b._row * (ROW_HEIGHT + gap);
    });

    return notices;
  }

  global.PosterModel = {
    ROW_HEIGHT: ROW_HEIGHT,
    BLOCK_PAD: BLOCK_PAD,
    IMAGE_RATIO: IMAGE_RATIO,
    makeDoc: makeDoc,
    makeBlock: makeBlock,
    defaultCanvas: defaultCanvas,
    cellWidth: cellWidth,
    layout: layout,
    wrapText: wrapText,
    fontOf: fontOf,
    contentHeight: contentHeight
  };
})(window);
