// BASELINE (pre-fix) input handling: separate ad-hoc listeners sharing
// mutable flags. Kept intentionally buggy to reproduce the reported
// ordering defects and to serve as the "before" baseline:
// 1. Drag deltas are computed in device pixels (clientX * dpr) but
//    applied to logical coordinates, so objects jump at dpr > 1.
// 2. Click fires on pointerup based only on a per-down flag, so the
//    pointerup that ends an inertial drag or a pinch still emits click.
// 3. Pinch and drag share lastX/lastY; when a pinch ends with one
//    finger lifted, the stale anchor makes the object jump.
// 4. No validation: stray/cancel/out-of-order events mutate state.
import { normalizeWheelDelta } from "./coords.js";

export class LegacyInput {
  constructor(app) {
    this.app = app;
    this.pointers = new Map();
    this.dragNode = null;
    this.lastX = 0;
    this.lastY = 0;
    this.moved = false;
    this.inertia = null;
    this.pinchDist = 0;
  }
  handle(e) {
    const { scene, rect, dpr } = this.app;
    switch (e.type) {
      case "pointerdown": {
        const x = e.clientX * dpr;
        const y = e.clientY * dpr;
        this.pointers.set(e.pointerId, { x, y });
        this.moved = false;
        if (this.pointers.size === 2) {
          const pair = [...this.pointers.values()];
          this.pinchDist = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
          this.dragNode = null;
        } else {
          const hit = scene.hitTest(e.clientX - rect.left, e.clientY - rect.top);
          this.dragNode = hit;
          this.lastX = x;
          this.lastY = y;
        }
        break;
      }
      case "pointermove": {
        const p = this.pointers.get(e.pointerId);
        if (!p) break;
        p.x = e.clientX * dpr;
        p.y = e.clientY * dpr;
        if (this.pointers.size === 2) {
          const pair = [...this.pointers.values()];
          const d = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
          scene.applyZoom((this.pinchDist - d) * 2, 0, 0);
          this.pinchDist = d;
        } else if (this.dragNode) {
          const dx = p.x - this.lastX;
          const dy = p.y - this.lastY;
          if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
          scene.moveNode(this.dragNode, this.dragNode.x + dx, this.dragNode.y + dy);
          this.lastX = p.x;
          this.lastY = p.y;
          this.inertia = { vx: dx, vy: dy, node: this.dragNode };
        }
        break;
      }
      case "pointerup": {
        this.pointers.delete(e.pointerId);
        if (!this.moved && this.pointers.size === 0) {
          const hit = this.app.scene.hitTest(
            e.clientX - rect.left,
            e.clientY - rect.top
          );
          this.app.emitClick(hit, e.clientX - rect.left, e.clientY - rect.top);
        }
        if (this.pointers.size === 0 && this.inertia && this.moved) {
          this.app.startInertia(this.inertia.node, this.inertia.vx, this.inertia.vy);
        }
        if (this.pointers.size === 0) {
          this.dragNode = null;
          this.inertia = null;
        }
        break;
      }
      case "pointercancel": {
        this.pointers.delete(e.pointerId);
        if (!this.moved && this.pointers.size === 0) {
          const hit = this.app.scene.hitTest(
            e.clientX - rect.left,
            e.clientY - rect.top
          );
          this.app.emitClick(hit, e.clientX - rect.left, e.clientY - rect.top);
        }
        break;
      }
      case "wheel": {
        const dy = normalizeWheelDelta(e);
        this.lastX = e.clientX * dpr;
        this.lastY = e.clientY * dpr;
        scene.applyZoom(dy, 0, 0);
        break;
      }
      default:
        break;
    }
  }
  dispose() {
    this.pointers.clear();
    this.dragNode = null;
    this.inertia = null;
  }
}
