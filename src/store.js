// Document store with snapshot-based undo/redo. Mutations go through commit()
// so every user action is reversible; imports validate the whole document and
// reject bad input without touching the current working copy.

const HISTORY_LIMIT = 100;

let idCounter = 0;
export function nextId(prefix = "el") {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createElement(type, partial = {}) {
  const base = {
    id: partial.id || nextId(type),
    type,
    name: partial.name || defaultName(type),
    x: 80,
    y: 80,
    width: 200,
    height: 120,
    rotation: 0,
    fill: type === "text" ? "#111111" : "#3b82f6",
    crop: null,
  };
  if (type === "text") {
    Object.assign(base, {
      text: partial.text ?? "双击编辑文字",
      fontSize: 28,
      fontWeight: 700,
      fontStyle: "normal",
      fontFamily: "sans",
      lineHeight: 1.25,
      textAlign: "left",
      verticalAlign: "top",
      autoFit: false,
    });
  } else if (type === "rect") {
    base.cornerRadius = partial.cornerRadius ?? 12;
  } else if (type === "star") {
    base.starPoints = partial.starPoints ?? 5;
  }
  if (type !== "text" && partial.stroke !== undefined) {
    base.stroke = partial.stroke;
    base.strokeWidth = partial.strokeWidth ?? 2;
  }
  return { ...base, ...partial, id: base.id, type: base.type };
}

function defaultName(type) {
  const labels = {
    rect: "矩形",
    ellipse: "椭圆",
    triangle: "三角形",
    hexagon: "六边形",
    star: "星形",
    text: "文本",
  };
  return labels[type] || type;
}

export function createDocument(partial = {}) {
  return {
    name: partial.name || "未命名海报",
    width: partial.width || 800,
    height: partial.height || 600,
    background: partial.background || "#ffffff",
    elements: partial.elements || [],
    version: 1,
  };
}

export class Store {
  constructor(doc) {
    const initial = structuredClone(doc);
    this.undoStack = [initial];
    this.redoStack = [];
    this.selectedId = null;
    this.selectionIds = new Set();
    this.cropMode = false;
    this.showSafeMargin = true;
  }

  get doc() {
    return this.undoStack[this.undoStack.length - 1];
  }

  canUndo() {
    return this.undoStack.length > 1;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  commit(mutator, label = "edit") {
    const next = structuredClone(this.doc);
    const result = mutator(next);
    this.undoStack.push(next);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    return result;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.redoStack.push(this.undoStack.pop());
    this.ensureSelectionValid();
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.undoStack.push(this.redoStack.pop());
    this.ensureSelectionValid();
    return true;
  }

  ensureSelectionValid() {
    if (this.selectedId && !this.doc.elements.some((el) => el.id === this.selectedId)) {
      this.selectedId = null;
      this.cropMode = false;
    }
  }

  select(id) {
    this.selectedId = id;
    if (!id) this.cropMode = false;
    this.selectionIds = id ? new Set([id]) : new Set();
  }

  toggleMultiSelection(id) {
    if (!this.selectionIds) this.selectionIds = new Set();
    if (this.selectionIds.has(id)) this.selectionIds.delete(id);
    else this.selectionIds.add(id);
    this.selectedId = this.selectionIds.size === 1 ? [...this.selectionIds][0] : id;
    if (this.selectionIds.size !== 1) this.cropMode = false;
  }

  get selectedIds() {
    const ids = this.selectionIds ? [...this.selectionIds] : [];
    const valid = ids.filter((id) => this.doc.elements.some((el) => el.id === id));
    return valid.length ? valid : this.selectedId ? [this.selectedId] : [];
  }

  get selected() {
    return this.doc.elements.find((el) => el.id === this.selectedId) || null;
  }

  // ---- element operations -------------------------------------------------

  addElement(el) {
    this.commit((doc) => {
      doc.elements.push(el);
    }, "add");
    this.selectedId = el.id;
    return el;
  }

  updateElement(id, patch) {
    this.commit((doc) => {
      const el = doc.elements.find((item) => item.id === id);
      if (!el) throw new Error(`元素 ${id} 不存在，修改已取消。`);
      Object.assign(el, patch);
    }, "update");
  }

  removeElement(id) {
    this.commit((doc) => {
      const idx = doc.elements.findIndex((el) => el.id === id);
      if (idx < 0) throw new Error(`元素 ${id} 不存在，删除已取消。`);
      doc.elements.splice(idx, 1);
    }, "delete");
    if (this.selectedId === id) {
      this.selectedId = null;
      this.cropMode = false;
    }
  }

  moveLayer(id, direction) {
    this.commit((doc) => {
      const idx = doc.elements.findIndex((el) => el.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= doc.elements.length) {
        throw new Error("图层已经位于最顶层或最底层，无法继续移动。");
      }
      const [item] = doc.elements.splice(idx, 1);
      doc.elements.splice(target, 0, item);
    }, "layer");
  }

 reorderTo(id, targetIndex) {
    this.commit((doc) => {
      const idx = doc.elements.findIndex((el) => el.id === id);
      if (idx < 0) throw new Error(`元素 ${id} 不存在，图层排序已取消。`);
      const [item] = doc.elements.splice(idx, 1);
      const clamped = Math.max(0, Math.min(targetIndex, doc.elements.length));
      doc.elements.splice(clamped, 0, item);
    }, "reorder");
  }

  align(ids, mode) {
    const targets = this.doc.elements.filter((el) => ids.includes(el.id));
    if (targets.length < 2 && !["canvas-h", "canvas-v"].includes(mode)) return;
    this.commit((doc) => {
      const live = doc.elements.filter((el) => ids.includes(el.id));
      alignElements(live, mode, doc);
    }, "align");
  }

  setCrop(id, crop) {
    this.commit((doc) => {
      const el = doc.elements.find((item) => item.id === id);
      if (!el) throw new Error(`元素 ${id} 不存在，裁切已取消。`);
      el.crop = structuredClone(crop);
    }, "crop");
  }

  resetCrop(id) {
    this.updateElement(id, { crop: null });
  }

  replaceDocument(doc) {
    this.undoStack = [structuredClone(doc)];
    this.redoStack = [];
    this.selectedId = null;
    this.cropMode = false;
  }
}

function alignElements(elements, mode, doc) {
  const boxes = elements.map((el) => ({
    el,
    left: el.x,
    right: el.x + el.width,
    top: el.y,
    bottom: el.y + el.height,
    cx: el.x + el.width / 2,
    cy: el.y + el.height / 2,
  }));
  const min = (key) => Math.min(...boxes.map((b) => b[key]));
  const max = (key) => Math.max(...boxes.map((b) => b[key]));
  for (const b of boxes) {
    switch (mode) {
      case "left":
        b.el.x = min("left");
        break;
      case "right":
        b.el.x = max("right") - b.el.width;
        break;
      case "top":
        b.el.y = min("top");
        break;
      case "bottom":
        b.el.y = max("bottom") - b.el.height;
        break;
      case "h-center":
        b.el.x = (min("left") + max("right")) / 2 - b.el.width / 2;
        break;
      case "v-center":
        b.el.y = (min("top") + max("bottom")) / 2 - b.el.height / 2;
        break;
      case "canvas-h":
        b.el.x = doc.width / 2 - b.el.width / 2;
        break;
      case "canvas-v":
        b.el.y = doc.height / 2 - b.el.height / 2;
        break;
      default:
        break;
    }
  }
}
