// Canvas interaction controller: selection, move, resize, rotate and crop
// gestures, plus zoom/pan. Every gesture ends in one store.commit() call so a
// single drag = a single undo step.

import { getCrop, hitTest } from "./geometry.js";

const HANDLE_HIT = 10;

export class Editor {
  constructor(canvas, store, onChange) {
    this.canvas = canvas;
    this.store = store;
    this.onChange = onChange;
    this.view = { scale: 1, offsetX: 0, offsetY: 0 };
    this.gesture = null;
    this.bind();
  }

  bind() {
    this.canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    this.canvas.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    this.canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
  }

  onDoubleClick(event) {
    const p = this.toDoc(event);
    const hit = [...this.store.doc.elements].reverse().find((el) => el.type === "text" && hitTest(el, p.x, p.y));
    if (hit && this.onEditText) this.onEditText(hit.id);
  }

  toDoc(event) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (event.clientX - rect.left - this.view.offsetX) / this.view.scale;
    const sy = (event.clientY - rect.top - this.view.offsetY) / this.view.scale;
    return { x: sx, y: sy };
  }

  fitView(doc, canvasWidth, canvasHeight, padding = 40) {
    const scale = Math.min(
      (canvasWidth - padding * 2) / doc.width,
      (canvasHeight - padding * 2) / doc.height,
      1.5
    );
    this.view.scale = scale;
    this.view.offsetX = (canvasWidth - doc.width * scale) / 2;
    this.view.offsetY = (canvasHeight - doc.height * scale) / 2;
  }

  zoomAt(factor, center) {
    const next = Math.min(4, Math.max(0.1, this.view.scale * factor));
    const ratio = next / this.view.scale;
    this.view.offsetX = center.x - (center.x - this.view.offsetX) * ratio;
    this.view.offsetY = center.y - (center.y - this.view.offsetY) * ratio;
    this.view.scale = next;
    this.onChange();
  }

  onWheel(event) {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const center = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, center);
  }

  pickHandle(el, p) {
    if (this.store.cropMode) {
      const crop = getCrop(el);
      const corners = {
        nw: [crop.x, crop.y],
        ne: [crop.x + crop.width, crop.y],
        sw: [crop.x, crop.y + crop.height],
        se: [crop.x + crop.width, crop.y + crop.height],
      };
      for (const [name, [x, y]] of Object.entries(corners)) {
        if (Math.abs(p.x - x) <= HANDLE_HIT / this.view.scale && Math.abs(p.y - y) <= HANDLE_HIT / this.view.scale) {
          return { kind: "crop", name };
        }
      }
      return null;
    }
    const handles = [
      ["nw", 0, 0],
      ["ne", el.width, 0],
      ["sw", 0, el.height],
      ["se", el.width, el.height],
      ["rotate", el.width / 2, -18],
    ];
    for (const [name, x, y] of handles) {
      if (Math.abs(p.x - x) <= HANDLE_HIT / this.view.scale && Math.abs(p.y - y) <= HANDLE_HIT / this.view.scale) {
        return { kind: name === "rotate" ? "rotate" : "resize", name };
      }
    }
    return null;
  }

  toLocal(el, p) {
    const angle = ((el.rotation || 0) * Math.PI) / 180;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    let x = p.x - cx;
    let y = p.y - cy;
    if (angle) {
      const cos = Math.cos(-angle);
      const sin = Math.sin(-angle);
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      x = rx;
      y = ry;
    }
    return { x: x + el.width / 2, y: y + el.height / 2 };
  }

  onDown(event) {
    if (event.button !== 0) {
      this.gesture = { kind: "pan", startX: event.clientX, startY: event.clientY, ox: this.view.offsetX, oy: this.view.offsetY };
      return;
    }
    const p = this.toDoc(event);
    const doc = this.store.doc;
    const topDown = [...doc.elements].reverse();
    let hit = null;
    for (const el of topDown) {
      if (hitTest(el, p.x, p.y)) {
        hit = el;
        break;
      }
    }
    const selected = this.store.selected;
    if (selected && hit && hit.id === selected.id) {
      const local = this.toLocal(selected, p);
      const handle = this.pickHandle(selected, local);
      if (handle) {
        this.gesture = {
          kind: handle.kind,
          id: selected.id,
          handle: handle.name,
          start: p,
          snapshot: structuredClone(selected),
        };
        return;
      }
    }
    if (hit) {
      if (event.shiftKey) {
        this.store.toggleMultiSelection(hit.id);
      } else if (!this.store.selectedIds.includes(hit.id)) {
        this.store.select(hit.id);
      }
      const ids = this.store.selectedIds;
      const snapshots = this.store.doc.elements
        .filter((el) => ids.includes(el.id))
        .map((el) => structuredClone(el));
      this.gesture = { kind: "move", ids, start: p, snapshots };
    } else {
      this.store.select(null);
      this.gesture = { kind: "pan", startX: event.clientX, startY: event.clientY, ox: this.view.offsetX, oy: this.view.offsetY };
    }
    this.onChange();
  }

  onMove(event) {
    if (!this.gesture) return;
    const g = this.gesture;
    if (g.kind === "pan") {
      this.view.offsetX = g.ox + (event.clientX - g.startX);
      this.view.offsetY = g.oy + (event.clientY - g.startY);
      this.onChange();
      return;
    }
    const p = this.toDoc(event);
    if (g.kind === "move") {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      for (const snap of g.snapshots) {
        const target = this.store.doc.elements.find((item) => item.id === snap.id);
        if (target) {
          target.x = snap.x + dx;
          target.y = snap.y + dy;
        }
      }
      this.onChange();
      return;
    }
    const el = this.store.doc.elements.find((item) => item.id === g.id);
    if (!el) return;
    const snap = g.snapshot;
    if (g.kind === "resize") {
      this.applyResize(el, snap, g.handle, p);
    } else if (g.kind === "rotate") {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      el.rotation = Math.round(deg);
    } else if (g.kind === "crop") {
      this.applyCrop(el, snap, g.handle, p);
    }
    this.onChange();
  }

  applyResize(el, snap, handle, p) {
    const local = this.toLocal(snap, p);
    const min = 4;
    let { x, y, width, height } = snap;
    if (handle.includes("w")) width = Math.max(min, local.x);
    if (handle.includes("e")) width = Math.max(min, local.x);
    if (handle.includes("n")) height = Math.max(min, local.y);
    if (handle.includes("s")) height = Math.max(min, local.y);
    if (handle.includes("w")) x = snap.x + snap.width - width;
    if (handle.includes("n")) y = snap.y + snap.height - height;
    Object.assign(el, { x, y, width, height });
  }

  applyCrop(el, snap, handle, p) {
    const local = this.toLocal(snap, p);
    const startCrop = getCrop(snap);
    const min = 4;
    let { x, y, width, height } = startCrop;
    if (handle.includes("w")) {
      width = Math.max(min, startCrop.x + startCrop.width - Math.max(0, Math.min(local.x, startCrop.x + startCrop.width - min)));
      x = Math.max(0, Math.min(local.x, startCrop.x + startCrop.width - min));
    }
    if (handle.includes("e")) width = Math.max(min, Math.min(local.x - startCrop.x, snap.width - startCrop.x));
    if (handle.includes("n")) {
      height = Math.max(min, startCrop.y + startCrop.height - Math.max(0, Math.min(local.y, startCrop.y + startCrop.height - min)));
      y = Math.max(0, Math.min(local.y, startCrop.y + startCrop.height - min));
    }
    if (handle.includes("s")) height = Math.max(min, Math.min(local.y - startCrop.y, snap.height - startCrop.y));
    el.crop = { x, y, width, height };
  }

  onUp() {
    if (!this.gesture) return;
    const g = this.gesture;
    this.gesture = null;
    if (g.kind === "move") {
      const nextPositions = g.snapshots.map((snap) => {
        const target = this.store.doc.elements.find((item) => item.id === snap.id);
        return { id: snap.id, x: target ? target.x : snap.x, y: target ? target.y : snap.y };
      });
      const changed = nextPositions.some((pos, i) => pos.x !== g.snapshots[i].x || pos.y !== g.snapshots[i].y);
      if (changed) {
        this.store.commit((doc) => {
          for (const pos of nextPositions) {
            const target = doc.elements.find((item) => item.id === pos.id);
            if (target) Object.assign(target, { x: pos.x, y: pos.y });
          }
        });
      } else {
        for (const snap of g.snapshots) {
          const target = this.store.doc.elements.find((item) => item.id === snap.id);
          if (target) Object.assign(target, { x: snap.x, y: snap.y });
        }
      }
      this.onChange();
      return;
    }
    if (["resize", "rotate", "crop"].includes(g.kind)) {
      const el = this.store.doc.elements.find((item) => item.id === g.id);
      if (el) {
        const patch = this.plain(el);
        Object.assign(el, g.snapshot);
        if (JSON.stringify(patch) !== JSON.stringify(this.plain(g.snapshot))) {
          this.store.updateElement(g.id, patch);
        }
      }
    }
    this.onChange();
  }

  plain(el) {
    const { x, y, width, height, rotation, crop } = el;
    return { x, y, width, height, rotation, crop: crop ? structuredClone(crop) : null };
  }
}
