// Minimal CanvasRenderingContext2D mock. It records the call sequence and
// implements measureText with a simple deterministic width model so the same
// layout pipeline used by the browser can run under Node.

export class MockContext {
  constructor() {
    this.calls = [];
    this._font = "16px sans-serif";
    this.saveCount = 0;
  }

  record(name, args) {
    this.calls.push({ name, args: args.map((a) => (typeof a === "number" ? Math.round(a * 1000) / 1000 : a)) });
  }

  save() { this.saveCount += 1; this.record("save", []); }
  restore() { this.saveCount -= 1; this.record("restore", []); }
  translate(x, y) { this.record("translate", [x, y]); }
  rotate(a) { this.record("rotate", [a]); }
  scale(x, y) { this.record("scale", [x, y]); }
  setTransform(...a) { this.record("setTransform", a); }
  clearRect(...a) { this.record("clearRect", a); }
  fillRect(...a) { this.record("fillRect", a); }
  strokeRect(...a) { this.record("strokeRect", a); }
  beginPath() { this.record("beginPath", []); }
  closePath() { this.record("closePath", []); }
  rect(...a) { this.record("rect", a); }
  moveTo(...a) { this.record("moveTo", a); }
  lineTo(...a) { this.record("lineTo", a); }
  arc(...a) { this.record("arc", a); }
  arcTo(...a) { this.record("arcTo", a); }
  ellipse(...a) { this.record("ellipse", a); }
  clip() { this.record("clip", []); }
  fill() { this.record("fill", []); }
  stroke() { this.record("stroke", []); }
  fillText(text, x, y) { this.record("fillText", [text, x, y]); }

  set font(value) { this._font = value; this.record("font", [value]); }
  get font() { return this._font; }
  set fillStyle(value) { this.record("fillStyle", [value]); }
  set strokeStyle(value) { this.record("strokeStyle", [value]); }
  set lineWidth(value) { this.record("lineWidth", [value]); }
  set textBaseline(value) { this.record("textBaseline", [value]); }
  set lineDashOffset(value) { this.record("lineDashOffset", [value]); }
  setLineDash(segments) { this.record("setLineDash", [segments]); }

  measureText(text) {
    const sizeMatch = this._font.match(/(\d+(?:\.\d+)?)px/);
    const fontSize = sizeMatch ? Number(sizeMatch[1]) : 16;
    let units = 0;
    for (const ch of String(text)) {
      if (/\s/.test(ch)) units += 0.3;
      else if (/[^\u0000-\u00ff]/.test(ch)) units += 1;
      else if (/[A-Z]/.test(ch)) units += 0.68;
      else units += 0.55;
    }
    return { width: units * fontSize };
  }
}

export class MockCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.context = new MockContext();
  }
  getContext() {
    return this.context;
  }
}
