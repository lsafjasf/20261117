/* 极简 Canvas 2D 桩：记录绘制命令，并对 fillRect 做光栅化，
   支持 getImageData，用于 Node 下的黑帧与渲染测试。 */
"use strict";

function hexToRgba(style, alpha) {
  var m = String(style).match(/^#([0-9a-f]{6})$/i);
  if (!m) return [0, 0, 0, 255 * alpha];
  var n = parseInt(m[1], 16);
  return [
    (n >> 16) & 255,
    (n >> 8) & 255,
    n & 255,
    Math.round(255 * alpha)
  ];
}

function parseRgba(style) {
  var m = String(style).match(/rgba?\(([^)]+)\)/);
  if (!m) return hexToRgba(style, 1);
  var parts = m[1].split(",").map(function (x) { return x.trim(); });
  return [
    Number(parts[0]), Number(parts[1]), Number(parts[2]),
    Math.round(255 * (parts[3] === undefined ? 1 : Number(parts[3])))
  ];
}

function over(dst, src) {
  var sa = src[3] / 255;
  var da = dst[3] / 255;
  var outA = sa + da * (1 - sa);
  if (outA === 0) return [0, 0, 0, 0];
  function blend(i) {
    return Math.round((src[i] * sa + dst[i] * da * (1 - sa)) / outA);
  }
  return [blend(0), blend(1), blend(2), Math.round(outA * 255)];
}

function FakeContext(width, height) {
  this.canvas = { width: width, height: height };
  this.fillStyle = "#000000";
  this.strokeStyle = "#000000";
  this.globalAlpha = 1;
  this.lineWidth = 1;
  this.font = "10px sans-serif";
  this.textBaseline = "alphabetic";
  this.ops = [];
  this._w = width;
  this._h = height;
}

FakeContext.prototype._record = function (type, args) {
  this.ops.push({
    type: type,
    args: Array.prototype.slice.call(args),
    fillStyle: this.fillStyle,
    globalAlpha: this.globalAlpha
  });
};

FakeContext.prototype.fillRect = function (x, y, w, h) {
  this._record("fillRect", arguments);
};
FakeContext.prototype.strokeRect = function () { this._record("strokeRect", arguments); };
FakeContext.prototype.clearRect = function () { this.ops = []; };
FakeContext.prototype.beginPath = function () { this._record("beginPath", arguments); };
FakeContext.prototype.moveTo = function () { this._record("moveTo", arguments); };
FakeContext.prototype.lineTo = function () { this._record("lineTo", arguments); };
FakeContext.prototype.closePath = function () { this._record("closePath", arguments); };
FakeContext.prototype.stroke = function () { this._record("stroke", arguments); };
FakeContext.prototype.fill = function () { this._record("fill", arguments); };
FakeContext.prototype.fillText = function () { this._record("fillText", arguments); };
FakeContext.prototype.arc = function () { this._record("arc", arguments); };
FakeContext.prototype.save = function () {};
FakeContext.prototype.restore = function () {};
FakeContext.prototype.createLinearGradient = function () {
  return {
    _stops: [],
    addColorStop: function (offset, color) { this._stops.push([offset, color]); },
    firstColor: function () { return this._stops.length ? this._stops[0][1] : "#1f2a3a"; }
  };
};
FakeContext.prototype.measureText = function (text) {
  return { width: String(text).length * 10 };
};
FakeContext.prototype.createGain = function () { return {}; };

FakeContext.prototype.getImageData = function (x, y, w, h) {
  var pixels = new Uint8ClampedArray(w * h * 4);
  var self = this;
  this.ops.forEach(function (op) {
    if (op.type !== "fillRect") return;
    var rect = op.args;
    var style = op.fillStyle;
    if (style && typeof style === "object" && style.firstColor) style = style.firstColor();
    var rgba = String(style).indexOf("rgb") === 0
      ? parseRgba(style)
      : hexToRgba(style, op.globalAlpha);
    var x0 = Math.max(0, Math.floor(rect[0]));
    var y0 = Math.max(0, Math.floor(rect[1]));
    var x1 = Math.min(self._w, Math.ceil(rect[0] + rect[2]));
    var y1 = Math.min(self._h, Math.ceil(rect[1] + rect[3]));
    for (var py = y0; py < y1; py++) {
      for (var px = x0; px < x1; px++) {
        var idx = (py * w + px) * 4;
        var dst = [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]];
        var merged = over(dst, rgba);
        pixels[idx] = merged[0];
        pixels[idx + 1] = merged[1];
        pixels[idx + 2] = merged[2];
        pixels[idx + 3] = merged[3];
      }
    }
  });
  return { data: pixels, width: w, height: h };
};

function FakeCanvas(width, height) {
  this.width = width;
  this.height = height;
  this._ctx = new FakeContext(width, height);
}
FakeCanvas.prototype.getContext = function () { return this._ctx; };

module.exports = { FakeCanvas: FakeCanvas, FakeContext: FakeContext, over: over };
