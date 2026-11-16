/* SVG 导出：与 Canvas 渲染使用同一 layout 与纹样路径，保证导出与预览一致。 */
(function (global) {
  'use strict';

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildSVG(s) {
    var M = global.TicketModel;
    var R = global.TicketRender;
    var L = M.layout(s);
    var pad = R.PAD, bg = R.BG;
    var W = s.width + pad * 2;
    var H = s.height + pad * 2;
    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H
      + '" viewBox="0 0 ' + W + ' ' + H + '">');
    o.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + bg + '"/>');
    o.push('<g transform="translate(' + pad + ',' + pad + ')">');
    // 票面
    o.push('<rect x="0" y="0" width="' + s.width + '" height="' + s.height
      + '" rx="10" fill="#ffffff"/>');
    // 撕线缺口
    var notchR = Math.max(6, s.height * 0.045);
    o.push('<circle cx="' + L.tearPx + '" cy="0" r="' + notchR + '" fill="' + bg + '"/>');
    o.push('<circle cx="' + L.tearPx + '" cy="' + s.height + '" r="' + notchR + '" fill="' + bg + '"/>');
    // 撕线虚线
    o.push('<line x1="' + L.tearPx + '" y1="' + (notchR + 2) + '" x2="' + L.tearPx
      + '" y2="' + (s.height - notchR - 2)
      + '" stroke="#9aa0ad" stroke-width="1.5" stroke-dasharray="6 5"/>');
    // 验证纹样
    global.TicketPattern.guillochePaths(L.pattern.x, L.pattern.y, L.pattern.w, L.pattern.h)
      .forEach(function (d) {
        o.push('<path d="' + d + '" fill="none" stroke="#7c8fb8" stroke-width="0.8"/>');
      });
    // 文字
    L.texts.forEach(function (t) {
      var anchor = t.align === 'center' ? 'middle' : 'start';
      var fill = t.key === 'serial' ? '#b03a3a' : '#22242a';
      o.push('<text x="' + t.x + '" y="' + t.y + '" font-family="' + esc(s.fontFamily)
        + '" font-size="' + t.size + '" font-weight="' + t.weight
        + '" text-anchor="' + anchor + '" fill="' + fill + '">' + esc(t.text) + '</text>');
    });
    o.push('</g></svg>');
    return o.join('\n');
  }

  var api = { buildSVG: buildSVG };
  global.TicketSVG = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
