/* 验证纹样（扭索纹 guilloche）路径生成器。
 * 同时供 Canvas 渲染与 SVG 导出使用，保证两处一致。
 * 所有坐标相对于纹样矩形区域 (x, y, w, h)。 */
(function (global) {
  'use strict';

  // 生成一组玫瑰线/正弦叠加曲线，返回 [{points:[[x,y],...], closed}] 列表
  function guilloche(x, y, w, h) {
    var cx = x + w / 2;
    var cy = y + h / 2;
    var curves = [];
    var rings = 3;
    for (var r = 0; r < rings; r++) {
      var baseR = (Math.min(w, h) / 2) * (0.45 + 0.25 * r);
      var amp = Math.min(w, h) * 0.08 * (r + 1);
      var freq = 5 + r * 2;
      var pts = [];
      var steps = 120;
      for (var i = 0; i <= steps; i++) {
        var t = (i / steps) * Math.PI * 2;
        var rad = baseR + amp * Math.sin(freq * t + r * 1.3);
        // 横向压缩为椭圆以贴合矩形区域
        var px = cx + rad * Math.cos(t) * (w / Math.min(w, h)) * 0.9;
        var py = cy + rad * Math.sin(t) * (h / Math.min(w, h)) * 0.9;
        pts.push([px, py]);
      }
      curves.push({ points: pts, closed: true });
    }
    return curves;
  }

  // 把曲线画到 canvas 上下文
  function strokeGuilloche(ctx, x, y, w, h, color, lineWidth) {
    var curves = guilloche(x, y, w, h);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth || 0.7;
    curves.forEach(function (c) {
      ctx.beginPath();
      c.points.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      if (c.closed) ctx.closePath();
      ctx.stroke();
    });
    ctx.restore();
  }

  // 生成 SVG path 的 d 字符串列表
  function guillochePaths(x, y, w, h) {
    return guilloche(x, y, w, h).map(function (c) {
      var d = c.points.map(function (p, i) {
        return (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
      }).join('');
      return c.closed ? d + 'Z' : d;
    });
  }

  var api = { guilloche: guilloche, strokeGuilloche: strokeGuilloche, guillochePaths: guillochePaths };
  global.TicketPattern = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
