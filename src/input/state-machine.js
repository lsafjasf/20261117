// Unified input state machine. All pointer/wheel events enter through a
// single ordered dispatch, so click/drag/wheel/pinch can no longer race.
//
// States: IDLE -> DOWN -> DRAG -> INERTIA -> IDLE
//              \-> PINCH -> LIFT -> IDLE
// Click is emitted ONLY from DOWN on a fast, small, unsuppressed release.
import { toLogical, isFinitePoint, normalizeWheelDelta } from "./coords.js";

const CLICK_MAX_MS = 250;
const CLICK_MAX_DIST = 4; // logical px
const DRAG_THRESHOLD = 4;

export class InputStateMachine {
  constructor(app) {
    this.app = app;
    this.state = "IDLE";
    this.pointers = new Map();
    this.dragNode = null;
    this.downInfo = null;
    this.pinchDist = 0;
    this.velocity = { vx: 0, vy: 0 };
  }
  log() {
    return this.app.logs;
  }
  // Single ordered entry point for every input event.
  handle(e) {
    if (!e || typeof e.type !== "string") {
      this.log().warn("input.malformed", "event without type rejected", { e: String(e) });
      return;
    }
    if (e.type.startsWith("pointer") && e.type !== "pointercancel") {
      if (!isFinitePoint(e)) {
        this.log().warn("input.badcoords", "non-finite coordinates rejected", {
          type: e.type,
          clientX: String(e.clientX),
          clientY: String(e.clientY),
        });
        return;
      }
    }
    const handler = this["on_" + e.type];
    if (!handler) {
      this.log().warn("input.unknown", "unknown event type ignored", { type: e.type });
      return;
    }
    handler.call(this, e);
  }
  on_pointerdown(e) {
    if (this.pointers.has(e.pointerId)) {
      this.log().warn("input.dupdown", "duplicate pointerdown ignored", {
        pointerId: e.pointerId,
        state: this.state,
      });
      return;
    }
    this.cancelInertia("pointerdown");
    const pt = toLogical(e, this.app.rect);
    this.pointers.set(e.pointerId, pt);
    if (this.pointers.size === 2) {
      const pair = [...this.pointers.values()];
      this.pinchDist = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      this.transition("PINCH");
      this.dragNode = null;
      this.downInfo = null; // a second finger voids any pending click
      return;
    }
    if (this.pointers.size > 2) return;
    const hit = this.app.scene.hitTest(pt.x, pt.y);
    this.dragNode = hit;
    this.downInfo = { x: pt.x, y: pt.y, t: e.timeStamp, pointerId: e.pointerId };
    this.transition("DOWN");
  }
  on_pointermove(e) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      if (this.state !== "IDLE" || this.pointers.size > 0) {
        this.log().warn("input.straymove", "move for unknown pointer ignored", {
          pointerId: e.pointerId,
          state: this.state,
        });
      }
      return;
    }
    const pt = toLogical(e, this.app.rect);
    this.pointers.set(e.pointerId, pt);
    if (this.state === "PINCH" && this.pointers.size >= 2) {
      const pair = [...this.pointers.values()];
      const d = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      this.app.scene.applyZoom((this.pinchDist - d) * 2, pt.x, pt.y);
      this.pinchDist = d;
      return;
    }
    if (this.state === "LIFT") return; // post-pinch cool-down, no drag jump
    if (!this.downInfo || e.pointerId !== this.downInfo.pointerId) return;
    const dxFromDown = pt.x - this.downInfo.x;
    const dyFromDown = pt.y - this.downInfo.y;
    if (this.state === "DOWN") {
      if (Math.hypot(dxFromDown, dyFromDown) < DRAG_THRESHOLD) return;
      this.transition("DRAG");
    }
    if (this.state === "DRAG" && this.dragNode) {
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      this.app.scene.moveNode(
        this.dragNode,
        this.dragNode.x + dx,
        this.dragNode.y + dy
      );
      this.velocity = { vx: dx, vy: dy };
    }
  }
  on_pointerup(e) {
    if (!this.pointers.has(e.pointerId)) {
      this.log().warn("input.strayup", "pointerup without pointerdown ignored", {
        pointerId: e.pointerId,
        state: this.state,
      });
      return;
    }
    const pt = toLogical(e, this.app.rect);
    this.pointers.delete(e.pointerId);
    if (this.state === "PINCH") {
      // One finger lifted: re-anchor, suppress click, wait for full release.
      this.transition("LIFT");
      return;
    }
    if (this.state === "LIFT") {
      if (this.pointers.size === 0) this.transition("IDLE");
      return;
    }
    if (this.state === "DOWN" && this.downInfo) {
      const dt = e.timeStamp - this.downInfo.t;
      const dist = Math.hypot(pt.x - this.downInfo.x, pt.y - this.downInfo.y);
      if (dt <= CLICK_MAX_MS && dist <= CLICK_MAX_DIST) {
        const hit = this.app.scene.hitTest(pt.x, pt.y);
        this.app.emitClick(hit, pt.x, pt.y);
      }
      this.downInfo = null;
      this.dragNode = null;
      this.transition("IDLE");
      return;
    }
    if (this.state === "DRAG") {
      const { vx, vy } = this.velocity;
      if (Math.hypot(vx, vy) > 0.5 && this.dragNode) {
        this.app.startInertia(this.dragNode, vx, vy);
        this.transition("INERTIA");
      } else {
        this.transition("IDLE");
      }
      this.downInfo = null;
      this.dragNode = null;
      this.velocity = { vx: 0, vy: 0 };
    }
  }
  on_pointercancel(e) {
    if (!this.pointers.has(e.pointerId)) {
      this.log().warn("input.straycancel", "cancel for unknown pointer ignored", {
        pointerId: e.pointerId,
        state: this.state,
      });
      return;
    }
    this.pointers.delete(e.pointerId);
    this.log().info("input.cancel", "pointer cancelled, gesture aborted cleanly", {
      pointerId: e.pointerId,
      state: this.state,
    });
    this.downInfo = null; // cancel never emits click
    this.dragNode = null;
    this.velocity = { vx: 0, vy: 0 };
    this.transition(this.pointers.size === 0 ? "IDLE" : "LIFT");
  }
  on_wheel(e) {
    if (!Number.isFinite(e.deltaY)) {
      this.log().warn("input.badwheel", "non-finite wheel delta rejected", {
        deltaY: String(e.deltaY),
      });
      return;
    }
    this.cancelInertia("wheel");
    const pt = isFinitePoint(e) ? toLogical(e, this.app.rect) : { x: 0, y: 0 };
    this.app.scene.applyZoom(normalizeWheelDelta(e), pt.x, pt.y);
  }
  // Called by the app when inertia decay finishes.
  onInertiaEnd() {
    if (this.state === "INERTIA") this.transition("IDLE");
  }
  cancelInertia(reason) {
    if (this.state === "INERTIA") {
      this.app.stopInertia();
      this.transition("IDLE");
      this.log().info("input.inertia.cancel", "inertia cancelled", { reason });
    }
  }
  transition(next) {
    if (next === this.state) return;
    this.log().info("fsm.transition", `${this.state} -> ${next}`, {});
    this.state = next;
  }
  dispose() {
    this.pointers.clear();
    this.dragNode = null;
    this.downInfo = null;
    this.state = "IDLE";
  }
}
