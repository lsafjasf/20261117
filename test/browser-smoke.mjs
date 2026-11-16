// 用最小 DOM/Canvas 桩在 Node 中冒烟运行浏览器入口，覆盖装配与交互链路。

class FakeContext {
  constructor() { this.font = ""; }
  createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }
  putImageData() {}
  drawImage() {}
  clearRect() {} fillRect() {} strokeRect() {} fillText() {}
  beginPath() {} moveTo() {} lineTo() {} stroke() {}
}
class FakeCanvas {
  constructor() { this.width = 300; this.height = 200; this._ctx = new FakeContext(); }
  getContext() { return this._ctx; }
  setPointerCapture() {}
  addEventListener() {}
}
const elements = new Map();
function makeEl(id) {
  if (id === "timeline" || id === "preview") return new FakeCanvas();
  return {
    id,
    style: {},
    value: id === "zoom" ? "20" : "16:9",
    checked: false,
    clientWidth: 400,
    textContent: "",
    children: [],
    addEventListener() {},
    replaceChildren() {},
    appendChild() {},
    click() {},
    getContext: () => new FakeContext()
  };
}
globalThis.document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  createElement: (tag) => (tag === "canvas" ? new FakeCanvas() : makeEl(`span-${Math.random()}`)),
  createDocumentFragment: () => ({ appendChild() {} })
};
globalThis.requestAnimationFrame = () => 0;
globalThis.localStorage = (() => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
})();
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
globalThis.Response = class { async arrayBuffer() { return new ArrayBuffer(0); } };
globalThis.URL = { createObjectURL: () => "blob:fake", revokeObjectURL() {} };

await import("../web/app.js");
console.log("浏览器入口装配冒烟通过");
