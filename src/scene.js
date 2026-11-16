// Scene graph: circular nodes, spatial-hash grid with a query cache
// (cache hit rate is one of the observable metrics), and a recording
// renderer so headless runs can compare draw output semantically.

export class RecordingRenderer {
  constructor() {
    this.calls = [];
    this.dpr = 1;
  }
  setTransform(dpr) {
    this.dpr = dpr;
    this.calls.push({ op: "setTransform", dpr });
  }
  clear(width, height) {
    this.calls.push({ op: "clear", width, height });
  }
  circle(x, y, r, fill) {
    this.calls.push({ op: "circle", x, y, r, fill });
  }
  // Semantic fingerprint of a frame: stable, comparable across runs.
  digest() {
    return this.calls
      .map((c) => (c.op === "circle" ? `c:${c.x},${c.y},${c.r},${c.fill}` : c.op))
      .join("|");
  }
  reset() {
    this.calls = [];
  }
}

class SpatialGrid {
  constructor(cellSize, metrics) {
    this.cellSize = cellSize;
    this.metrics = metrics;
    this.cells = new Map();
    this.cache = new Map(); // "x,y,r" -> node list
    this.dirty = true;
  }
  key(cx, cy) {
    return `${cx},${cy}`;
  }
  rebuild(nodes) {
    this.cells.clear();
    for (const n of nodes) {
      const minX = Math.floor((n.x - n.r) / this.cellSize);
      const maxX = Math.floor((n.x + n.r) / this.cellSize);
      const minY = Math.floor((n.y - n.r) / this.cellSize);
      const maxY = Math.floor((n.y + n.r) / this.cellSize);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          const k = this.key(cx, cy);
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k).push(n);
        }
      }
    }
    this.cache.clear();
    this.dirty = false;
  }
  invalidate() {
    this.dirty = true;
  }
  query(x, y, r, nodes) {
    if (this.dirty) this.rebuild(nodes);
    const ck = `${x},${y},${r}`;
    if (this.cache.has(ck)) {
      this.metrics.recordCache(true);
      return this.cache.get(ck);
    }
    this.metrics.recordCache(false);
    const minX = Math.floor((x - r) / this.cellSize);
    const maxX = Math.floor((x + r) / this.cellSize);
    const minY = Math.floor((y - r) / this.cellSize);
    const maxY = Math.floor((y + r) / this.cellSize);
    const found = new Set();
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket) for (const n of bucket) found.add(n);
      }
    }
    const list = [...found];
    this.cache.set(ck, list);
    return list;
  }
  dispose() {
    this.cells.clear();
    this.cache.clear();
  }
}

export class Scene {
  constructor(metrics) {
    this.metrics = metrics;
    this.nodes = [];
    this.grid = new SpatialGrid(64, metrics);
    this.viewport = { x: 0, y: 0, zoom: 1 };
  }
  addNode(id, x, y, r, color) {
    const node = { id, x, y, r, color, selected: false };
    this.nodes.push(node);
    this.grid.invalidate();
    return node;
  }
  // Hit test in logical (CSS-pixel) coordinates. Returns topmost node.
  hitTest(x, y) {
    const candidates = this.grid.query(x, y, 1, this.nodes);
    this.metrics.recordCollision(candidates.length);
    for (let i = candidates.length - 1; i >= 0; i--) {
      const n = candidates[i];
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy <= n.r * n.r) return n;
    }
    return null;
  }
  moveNode(node, x, y) {
    node.x = x;
    node.y = y;
    this.grid.invalidate();
  }
  selectOnly(node) {
    for (const n of this.nodes) n.selected = n === node;
  }
  applyZoom(deltaY, centerX, centerY) {
    const factor = Math.exp(-deltaY * 0.001);
    const next = Math.min(4, Math.max(0.25, this.viewport.zoom * factor));
    if (next === this.viewport.zoom) return;
    this.viewport.zoom = next;
    this.grid.invalidate();
  }
  render(renderer, viewWidth, viewHeight) {
    renderer.clear(viewWidth, viewHeight);
    // Viewport culling via the spatial grid: the query circle covers the
    // visible world rect, so the candidate set is a superset of what the
    // precise per-node check below keeps. Draw output is unchanged.
    const z = this.viewport.zoom;
    const cx = this.viewport.x + viewWidth / (2 * z);
    const cy = this.viewport.y + viewHeight / (2 * z);
    const radius = 0.5 * Math.hypot(viewWidth / z, viewHeight / z);
    const candidates = this.grid.query(cx, cy, radius, this.nodes);
    this.metrics.recordCollision(candidates.length);
    let active = 0;
    for (const n of candidates) {
      const sx = (n.x - this.viewport.x) * this.viewport.zoom;
      const sy = (n.y - this.viewport.y) * this.viewport.zoom;
      const sr = n.r * this.viewport.zoom;
      if (sx + sr < 0 || sy + sr < 0 || sx - sr > viewWidth || sy - sr > viewHeight)
        continue;
      active += 1;
      renderer.circle(sx, sy, sr, n.selected ? "#ff8800" : n.color);
    }
    this.metrics.recordActiveNodes(active);
  }
  // Export semantics: stable JSON of logical scene state.
  export() {
    return {
      nodes: this.nodes.map((n) => ({
        id: n.id,
        x: Number(n.x.toFixed(4)),
        y: Number(n.y.toFixed(4)),
        r: n.r,
        selected: n.selected,
      })),
      viewport: { ...this.viewport },
    };
  }
  dispose() {
    this.grid.dispose();
    this.nodes = [];
  }
}
