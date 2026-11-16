// CanvasApp: wires scene, input implementation, renderer, inertia loop
// and resource accounting (listeners/timers) for the release test.
import { Scene, RecordingRenderer } from "./scene.js";
import { Metrics, LogSink } from "./metrics.js";

export class CanvasApp {
  constructor({ width = 800, height = 600, dpr = 1, inputImpl, clock }) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.rect = { left: 0, top: 0, width, height };
    this.clock = clock;
    this.metrics = new Metrics();
    this.logs = new LogSink();
    this.scene = new Scene(this.metrics);
    this.renderer = new RecordingRenderer();
    this.renderer.setTransform(dpr);
    this.input = new inputImpl(this);
    this.clickEvents = [];
    this.inertia = null;
    this.timers = new Set();
    this.listeners = new Set();
    this.dirty = true;
    this.disposed = false;
  }
  addListener(type) {
    this.listeners.add(type);
  }
  removeListener(type) {
    this.listeners.delete(type);
  }
  dispatch(event) {
    if (this.disposed) {
      this.logs.warn("app.disposed", "event dispatched after dispose", {
        type: event && event.type,
      });
      return;
    }
    if (event.timeStamp === undefined) event.timeStamp = this.clock.time();
    this.input.handle(event);
    this.dirty = true;
  }
  emitClick(node, x, y) {
    this.clickEvents.push({ nodeId: node ? node.id : null, x, y });
    if (node) this.scene.selectOnly(node);
  }
  startInertia(node, vx, vy) {
    this.inertia = { node, vx, vy };
  }
  stopInertia() {
    this.inertia = null;
  }
  // One animation frame: advance inertia, render if dirty, time it.
  tick(dtMs = 16.7) {
    const start = performance.now();
    if (this.inertia) {
      const { node } = this.inertia;
      this.scene.moveNode(node, node.x + this.inertia.vx, node.y + this.inertia.vy);
      this.inertia.vx *= 0.92;
      this.inertia.vy *= 0.92;
      if (Math.hypot(this.inertia.vx, this.inertia.vy) < 0.1) {
        this.inertia = null;
        if (this.input.onInertiaEnd) this.input.onInertiaEnd();
      }
      this.dirty = true;
    }
    if (this.dirty) {
      this.renderer.reset();
      this.renderer.setTransform(this.dpr);
      this.scene.render(this.renderer, this.width, this.height);
      this.dirty = false;
    }
    this.clock.advance(dtMs);
    this.metrics.recordFrame(performance.now() - start);
  }
  runFrames(n, dtMs = 16.7) {
    for (let i = 0; i < n; i++) this.tick(dtMs);
  }
  export() {
    return this.scene.export();
  }
  resourceCounts() {
    return {
      listeners: this.listeners.size,
      timers: this.timers.size,
      gridCacheEntries: this.scene.grid.cache.size,
      gridCells: this.scene.grid.cells.size,
      nodes: this.scene.nodes.length,
    };
  }
  dispose() {
    this.stopInertia();
    this.input.dispose();
    this.scene.dispose();
    this.listeners.clear();
    this.timers.clear();
    this.disposed = true;
  }
}
