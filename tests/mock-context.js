// Minimal CanvasRenderingContext2D mock recording draw calls for assertions.

export function createMockContext() {
  const calls = [];
  const ctx = {
    calls,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    miterLimit: 10,
    lineDashOffset: 0,
    save() {
      calls.push(['save']);
    },
    restore() {
      calls.push(['restore']);
    },
    clearRect(x, y, w, h) {
      calls.push(['clearRect', x, y, w, h]);
    },
    fillRect(x, y, w, h) {
      calls.push(['fillRect', x, y, w, h]);
    },
    translate(x, y) {
      calls.push(['translate', x, y]);
    },
    rotate(angle) {
      calls.push(['rotate', angle]);
    },
    scale(x, y) {
      calls.push(['scale', x, y]);
    },
    beginPath() {
      calls.push(['beginPath']);
    },
    moveTo(x, y) {
      calls.push(['moveTo', x, y]);
    },
    lineTo(x, y) {
      calls.push(['lineTo', x, y]);
    },
    arc(x, y, r) {
      calls.push(['arc', x, y, r]);
    },
    stroke() {
      calls.push(['stroke']);
    },
    fill() {
      calls.push(['fill']);
    },
    strokeRect(x, y, w, h) {
      calls.push(['strokeRect', x, y, w, h]);
    },
    setLineDash(dash) {
      calls.push(['setLineDash', dash]);
    }
  };
  return ctx;
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _map: map
  };
}
