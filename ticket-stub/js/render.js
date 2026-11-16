/* Canvas 渲染器：票根、撕线（含缺口）、验证纹样与文字。
 * 预览与 PNG 导出共用同一绘制函数，保证所见即所得。 */
(function (global) {
  'use strict';

  var PAD = 24;        // 票面四周留白（用于呈现撕线缺口）
  var BG = '#2b2d33';  // 背景色（缺口颜色与之相同，形成"可撕"视觉）

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 在给定 ctx 上绘制整张票（含背景），scale 为缩放系数
  function renderTicket(ctx, s, scale) {
    var M = global.TicketModel;
    var L = M.layout(s);
    var W = (s.width + PAD * 2) * scale;
    var H = (s.height + PAD * 2) * scale;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(PAD, PAD);

    // 票面
    ctx.fillStyle = BG;
    ctx.fillRect(-PAD, -PAD, s.width + PAD * 2, s.height + PAD * 2);
    roundedRect(ctx, 0, 0, s.width, s.height, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 撕线两端的半圆缺口（用背景色"咬掉"）
    var notchR = Math.max(6, s.height * 0.045);
    ctx.fillStyle = BG;
    ctx.beginPath();
    ctx.arc(L.tearPx, 0, notchR, 0, Math.PI * 2);
    ctx.arc(L.tearPx, s.height, notchR, 0, Math.PI * 2);
    ctx.fill();

    // 撕线（虚线）
    ctx.strokeStyle = '#9aa0ad';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(L.tearPx, notchR + 2);
    ctx.lineTo(L.tearPx, s.height - notchR - 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 验证纹样（仅副券区）
    global.TicketPattern.strokeGuilloche(ctx, L.pattern.x, L.pattern.y, L.pattern.w, L.pattern.h, '#7c8fb8', 0.8);

    // 文字
    L.texts.forEach(function (t) {
      ctx.fillStyle = t.key === 'serial' ? '#b03a3a' : '#22242a';
      ctx.font = t.weight + ' ' + t.size + 'px ' + s.fontFamily;
      ctx.textAlign = t.align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(t.text, t.x, t.y);
    });

    ctx.restore();
    return { width: W, height: H };
  }

  var api = { PAD: PAD, BG: BG, renderTicket: renderTicket };
  global.TicketRender = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
