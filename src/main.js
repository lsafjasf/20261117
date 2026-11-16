// UI wiring: toolbar, property panel, layer list, validation list and export
// guard. All domain logic lives in the imported modules so this file only
// touches the DOM.

import { Store, createElement, createDocument } from "./store.js";
import { Editor } from "./editor.js";
import { drawPreview } from "./renderer.js";
import { exportPngBlob } from "./renderer.js";
import { toSvg } from "./svg.js";
import { validateDocument, blockingIssues } from "./validate.js";
import {
  download,
  loadLocal,
  parseDocument,
  projectJson,
  saveLocal,
} from "./persistence.js";
import { defaultCrop, getCrop } from "./geometry.js";

const $ = (sel) => document.querySelector(sel);

const state = {
  store: null,
  editor: null,
  ctx: null,
  report: null,
  autosaveTimer: null,
  dirty: false,
};

function boot(doc) {
  state.store = new Store(doc);
  const originalCommit = state.store.commit.bind(state.store);
  state.store.commit = (mutator, label) => {
    const result = originalCommit(mutator, label);
    state.dirty = true;
    return result;
  };
  const canvas = $("#canvas");
  state.ctx = canvas.getContext("2d");
  state.editor = new Editor(canvas, state.store, render);
  state.editor.onEditText = (id) => {
    state.store.select(id);
    render();
    const area = document.querySelector('#properties textarea[data-prop="text"]');
    if (area) {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
  };
  fit();
  bindUi();
  render();
}

function fit() {
  const canvas = $("#canvas");
  const wrap = $("#canvas-wrap");
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  state.editor.fitView(state.store.doc, canvas.width, canvas.height);
}

function render() {
  const { store, editor, ctx } = state;
  const canvas = $("#canvas");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPreview(ctx, store.doc, editor.view, store);
  state.report = validateDocument(store.doc, ctx);
  renderPanels();
  scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(state.autosaveTimer);
  if (!state.dirty) return;
  state.autosaveTimer = setTimeout(() => {
    const snapshot = structuredClone(state.store.doc);
    const result = saveLocal(snapshot);
    if (result.ok) state.dirty = false;
    setStatus(result.ok ? "已自动保存到浏览器本地" : result.error, !result.ok);
  }, 600);
}

function setStatus(message, isError = false) {
  const el = $("#status");
  el.textContent = message;
  el.className = isError ? "status error" : "status";
}

function commitAndRender(fn, fallback) {
  try {
    fn();
    state.dirty = true;
    render();
    clearTimeout(state.autosaveTimer);
    const result = saveLocal(state.store.doc);
    if (result.ok) state.dirty = false;
    else setStatus(result.error, true);
  } catch (err) {
    setStatus(`${fallback}：${err.message}`, true);
  }
}

export function bootWith(doc) {
  boot(doc);
}

export { createDocument };

function bindUi() {
  $("#add-shape").addEventListener("click", () => {
    const type = $("#shape-type").value;
    const el = createElement(type, {
      x: 120 + (state.store.doc.elements.length % 5) * 18,
      y: 100 + (state.store.doc.elements.length % 5) * 18,
    });
    state.store.addElement(el);
    render();
  });

  $("#add-text").addEventListener("click", () => {
    const el = createElement("text", {
      x: 96,
      y: 80,
      width: 320,
      height: 80,
      text: "海报标题",
    });
    state.store.addElement(el);
    render();
  });

  $("#undo").addEventListener("click", () => doUndoRedo("undo"));
  $("#redo").addEventListener("click", () => doUndoRedo("redo"));
  $("#delete").addEventListener("click", deleteSelected);
  $("#layer-up").addEventListener("click", () => moveLayer(1));
  $("#layer-down").addEventListener("click", () => moveLayer(-1));
  $("#crop-toggle").addEventListener("click", toggleCrop);
  $("#crop-reset").addEventListener("click", resetCrop);
  $("#margin-toggle").addEventListener("click", () => {
    state.store.showSafeMargin = !state.store.showSafeMargin;
    render();
  });
  $("#zoom-in").addEventListener("click", () => state.editor.zoomAt(1.2, canvasCenter()));
  $("#zoom-out").addEventListener("click", () => state.editor.zoomAt(1 / 1.2, canvasCenter()));
  $("#zoom-fit").addEventListener("click", () => {
    fit();
    render();
  });

  for (const mode of ["left", "right", "top", "bottom", "h-center", "v-center", "canvas-h", "canvas-v"]) {
    const btn = document.querySelector(`[data-align="${mode}"]`);
    if (btn) btn.addEventListener("click", () => alignSelection(mode));
  }

  $("#save-file").addEventListener("click", () => {
    const blob = new Blob([projectJson(state.store.doc)], { type: "application/json" });
    download(safeFileName(state.store.doc.name) + ".poster.json", blob);
    setStatus("工程 JSON 已导出，可稍后通过“载入工程”完整恢复（文字与图形均可编辑）。");
  });
  $("#reload-local").addEventListener("click", reloadLocalDoc);
  $("#load-file").addEventListener("change", loadFileDoc);
  $("#new-doc").addEventListener("click", newDocument);
  $("#export-svg").addEventListener("click", exportSvg);
  $("#export-png").addEventListener("click", exportPng);

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", () => {
    fit();
    render();
  });
}

function canvasCenter() {
  const canvas = $("#canvas");
  return { x: canvas.width / 2, y: canvas.height / 2 };
}

function doUndoRedo(kind) {
  const ok = kind === "undo" ? state.store.undo() : state.store.redo();
  if (!ok) setStatus(kind === "undo" ? "没有可撤销的操作了。" : "没有可重做的操作了。");
  clearTimeout(state.autosaveTimer);
  const result = saveLocal(state.store.doc);
  state.dirty = result.ok ? false : true;
  render();
  setStatus(result.ok ? (kind === "undo" ? "已撤销并保存。" : "已重做并保存。") : result.error, !result.ok);
}

function onKeyDown(event) {
  const tag = document.activeElement?.tagName;
  const mod = event.ctrlKey || event.metaKey;
  const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (mod && event.code === "KeyZ" && !event.shiftKey) {
    event.preventDefault();
    doUndoRedo("undo");
  } else if (mod && (event.code === "KeyY" || (event.shiftKey && event.code === "KeyZ"))) {
    event.preventDefault();
    doUndoRedo("redo");
  } else if (mod && event.code === "KeyS") {
    event.preventDefault();
    const result = saveLocal(state.store.doc);
    setStatus(result.ok ? "已保存到浏览器本地存储。" : result.error, !result.ok);
  } else if (!inField && (event.key === "Delete" || event.key === "Backspace") && state.store.selectedId) {
    event.preventDefault();
    deleteSelected();
  } else if (!inField && event.key === "Escape") {
    state.store.cropMode = false;
    state.store.select(null);
    render();
  }
}

function deleteSelected() {
  const id = state.store.selectedId;
  if (!id) return;
  commitAndRender(() => state.store.removeElement(id), "删除失败");
}

function moveLayer(direction) {
  const id = state.store.selectedId;
  if (!id) return;
  commitAndRender(() => state.store.moveLayer(id, direction), "图层移动失败");
}

function toggleCrop() {
  const el = state.store.selected;
  if (!el) {
    setStatus("请先选中一个元素再进入裁切模式。", true);
    return;
  }
  state.store.cropMode = !state.store.cropMode;
  if (state.store.cropMode && !el.crop) el.crop = defaultCrop(el);
  render();
}

function resetCrop() {
  const el = state.store.selected;
  if (!el) return;
  commitAndRender(() => state.store.resetCrop(el.id), "重置裁切失败");
  state.store.cropMode = false;
}

function alignSelection(mode) {
  const ids = state.store.selectedIds;
  if (!ids.length) {
    setStatus("请先选中至少一个元素再使用对齐。", true);
    return;
  }
  if (ids.length < 2 && !mode.startsWith("canvas-")) {
    setStatus("多元素对齐需要先按住 Shift 点击选中两个或以上元素；已为你改用相对画布对齐。", true);
  }
  commitAndRender(() => state.store.align(ids, mode), "对齐失败");
}

function safeFileName(name) {
  return String(name || "poster").replace(/[\\/:*?"<>|]+/g, "_");
}

function renderPanels() {
  renderLayers();
  renderProperties();
  renderIssues();
  $("#undo").disabled = !state.store.canUndo();
  $("#redo").disabled = !state.store.canRedo();
  const hasSelection = Boolean(state.store.selectedId);
  for (const id of ["delete", "layer-up", "layer-down", "crop-toggle", "crop-reset"]) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !hasSelection;
  }
  $("#zoom-label").textContent = `${Math.round(state.editor.view.scale * 100)}%`;
}

function renderLayers() {
  const list = $("#layers");
  list.innerHTML = "";
  [...state.store.doc.elements].reverse().forEach((el) => {
    const item = document.createElement("div");
    item.className = "layer-item" + (el.id === state.store.selectedId ? " active" : "");
    item.draggable = true;
    item.dataset.id = el.id;
    item.innerHTML = `<span class="layer-dot" style="background:${el.fill}"></span>
      <span class="layer-name">${escapeHtml(el.name || el.id)}</span>
      <span class="layer-type">${el.type}</span>`;
    item.addEventListener("click", () => {
      state.store.select(el.id);
      render();
    });
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", el.id);
    });
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData("text/plain");
      const targetIndex = state.store.doc.elements.findIndex((x) => x.id === el.id);
      if (draggedId && draggedId !== el.id) {
        commitAndRender(() => state.store.reorderTo(draggedId, targetIndex), "图层排序失败");
      }
    });
    list.appendChild(item);
  });
}

function renderProperties() {
  const panel = $("#properties");
  const el = state.store.selected;
  const ids = state.store.selectedIds;
  if (ids.length > 1) {
    panel.innerHTML = `<p class="muted">已选中 ${ids.length} 个元素，可使用顶部工具栏进行多元素对齐；点击单个元素可编辑其属性。</p>`;
    return;
  }
  if (!el) {
    panel.innerHTML = '<p class="muted">未选中元素。点击画布中的图形或文字，或从左侧添加新元素。</p>';
    return;
  }
  const fields = [];
  fields.push(section("位置与尺寸", numericGrid([
    ["x", "X", el.x], ["y", "Y", el.y],
    ["width", "宽", el.width], ["height", "高", el.height],
    ["rotation", "旋转°", el.rotation],
  ], el.id)));
  fields.push(colorRow("填充/文字颜色", "fill", el.fill, el.id));
  if (el.type !== "text") {
    fields.push(colorRow("描边颜色", "stroke", el.stroke || "#000000", el.id, true));
    fields.push(section("描边宽度", numericGrid([["strokeWidth", "宽度", el.strokeWidth || 0]], el.id)));
    if (el.type === "rect") {
      fields.push(section("圆角", numericGrid([["cornerRadius", "半径", el.cornerRadius || 0]], el.id)));
    }
    if (el.type === "star") {
      fields.push(section("角数", numericGrid([["starPoints", "点数", el.starPoints || 5]], el.id)));
    }
  }
  if (el.type === "text") {
    fields.push(textEditor(el));
  }
  if (el.crop) {
    const c = getCrop(el);
    fields.push(section("裁切区域（可在画布上拖动四角）", numericGrid([
      ["cropX", "X", c.x], ["cropY", "Y", c.y],
      ["cropW", "宽", c.width], ["cropH", "高", c.height],
    ], el.id, true)));
  }
  panel.innerHTML = fields.join("");
  bindPropertyInputs(el);
}

function section(title, inner) {
  return `<div class="prop-section"><h4>${escapeHtml(title)}</h4>${inner}</div>`;
}

function numericGrid(rows, id, isCrop = false) {
  return '<div class="grid">' + rows.map(([key, label, value]) => `
    <label>${label}<input data-prop="${key}" data-id="${id}" data-crop="${isCrop}"
      type="number" step="1" value="${Math.round(Number(value) * 100) / 100}"></label>`).join("") + "</div>";
}

function colorRow(label, key, value, id, allowEmpty = false) {
  const enabled = Boolean(allowEmpty && value);
  return section(label, `<input data-prop="${key}" data-id="${id}" type="color" value="${toHex(value || "#000000")}">
    ${allowEmpty ? '<label class="inline"><input data-prop="strokeEnabled" data-id="' + id + '" type="checkbox" ' + (enabled ? "checked" : "") + ">启用描边</label>" : ""}`);
}

function textEditor(el) {
  return section("文字内容", `
    <textarea data-prop="text" data-id="${el.id}" rows="3">${escapeHtml(el.text)}</textarea>
    <div class="grid">
      <label>字号<input data-prop="fontSize" data-id="${el.id}" type="number" min="6" value="${el.fontSize}"></label>
      <label>行高倍数<input data-prop="lineHeight" data-id="${el.id}" type="number" step="0.05" value="${el.lineHeight}"></label>
    </div>
    <div class="grid">
      <label>字体<select data-prop="fontFamily" data-id="${el.id}">
        ${["sans", "serif", "mono"].map((f) => `<option value="${f}" ${el.fontFamily === f ? "selected" : ""}>${f}</option>`).join("")}
      </select></label>
      <label>粗细<select data-prop="fontWeight" data-id="${el.id}">
        ${[400, 700, 900].map((w) => `<option value="${w}" ${el.fontWeight === w ? "selected" : ""}>${w}</option>`).join("")}
      </select></label>
    </div>
    <div class="grid">
      <label>水平<select data-prop="textAlign" data-id="${el.id}">
        ${["left", "center", "right"].map((a) => `<option value="${a}" ${el.textAlign === a ? "selected" : ""}>${a}</option>`).join("")}
      </select></label>
      <label>垂直<select data-prop="verticalAlign" data-id="${el.id}">
        ${["top", "middle", "bottom"].map((a) => `<option value="${a}" ${el.verticalAlign === a ? "selected" : ""}>${a}</option>`).join("")}
      </select></label>
    </div>
    <label class="inline"><input data-prop="autoFit" data-id="${el.id}" type="checkbox" ${el.autoFit ? "checked" : ""}>文字过多时自动缩小字号以适配文本框</label>
  `);
}

function bindPropertyInputs(el) {
  panelInputs().forEach((input) => {
    if (input.tagName === "TEXTAREA") {
      input.addEventListener("input", () => {
        clearTimeout(input.__debounce);
        input.__debounce = setTimeout(() => applyPropertyInput(liveInput(input), el), 350);
      });
      input.addEventListener("change", () => {
        clearTimeout(input.__debounce);
        applyPropertyInput(liveInput(input), el);
      });
    } else {
      input.addEventListener("change", () => applyPropertyInput(liveInput(input), el));
    }
  });
}

function liveInput(input) {
  return document.getElementById(input.id) || input;
}

function panelInputs() {
  return [...document.querySelectorAll("#properties [data-prop]")];
}

function applyPropertyInput(input, el) {
  const target = state.store.selected || el;
  if (!target) return;
  const key = input.dataset.prop;
  const numeric = input.type === "number";
  if (input.dataset.crop === "true") {
    const crop = { ...getCrop(target) };
    const map = { cropX: "x", cropY: "y", cropW: "width", cropH: "height" };
    crop[map[key]] = numeric ? Number(input.value) : input.value;
    commitAndRender(() => state.store.setCrop(target.id, crop), "裁切修改失败");
    return;
  }
  let value = numeric ? Number(input.value) : input.value;
  if (input.type === "checkbox") value = input.checked;
  if (key === "strokeEnabled") {
    value = input.checked ? el.stroke || "#000000" : "";
    commitAndRender(() => state.store.updateElement(target.id, { stroke: value, strokeWidth: value ? 2 : 0 }), "描边修改失败");
    return;
  }
  if (numeric && !Number.isFinite(value)) {
    setStatus(`“${input.previousElementSibling?.textContent || key}” 需要输入数字，已保留原值（规则 NUMERIC_REQUIRED）。`, true);
    render();
    return;
  }
  const current = target[key];
  if (current === value || (numeric && Number(current) === value)) {
    return;
  }
  commitAndRender(() => state.store.updateElement(target.id, { [key]: value }), "属性修改失败");
}

function renderIssues() {
  const box = $("#issues");
  if (!state.report.issues.length) {
    box.innerHTML = '<p class="ok">✓ 未发现排版问题，所有元素均在画布与安全边距内。</p>';
    return;
  }
  box.innerHTML = state.report.issues.map((issue) => `
    <div class="issue ${issue.level}">
      <strong>[${issue.rule}]</strong> ${escapeHtml(issue.message)}
      <span class="fix">修复建议：${escapeHtml(issue.fix)}</span>
    </div>`).join("");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function toHex(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#000000";
}

function confirmExport(kind) {
  const blockers = blockingIssues(state.report);
  if (!blockers.length) return true;
  const detail = blockers.map((b) => `• [${b.rule}] ${b.message}\n  修复：${b.fix}`).join("\n");
  const message =
    `导出${kind}前检测到 ${blockers.length} 个必须处理的排版问题，继续导出会导致内容被裁切或数据异常：\n\n${detail}\n\n` +
    "选择“确定”仍要按当前状态导出；选择“取消”返回修复（当前画布内容不会丢失）。";
  return window.confirm(message);
}

function exportSvg() {
  if (!confirmExport("SVG")) return;
  try {
    const svg = toSvg(state.store.doc, state.ctx);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    download(safeFileName(state.store.doc.name) + ".svg", blob);
    setStatus("SVG 已导出：文字保留为 <text>，图形保留为 <path>，可在矢量软件继续编辑。");
  } catch (err) {
    setStatus(`SVG 导出失败，画布内容已保留：${err.message}。请检查是否有空文本层或异常尺寸。`, true);
  }
}

async function exportPng() {
  if (!confirmExport("PNG")) return;
  try {
    const blob = await exportPngBlob(state.store.doc);
    download(safeFileName(state.store.doc.name) + ".png", blob);
    setStatus(`PNG 已导出（${state.store.doc.width}×${state.store.doc.height}px），与画布预览使用同一渲染管线。`);
  } catch (err) {
    setStatus(`PNG 导出失败，画布内容已保留：${err.message}`, true);
  }
}

function reloadLocalDoc() {
  const result = loadLocal();
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.store.replaceDocument(result.doc);
  state.dirty = false;
  fit();
  render();
  setStatus("已从浏览器本地存储重新载入工程。");
}

function loadFileDoc(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const result = parseDocument(reader.result);
    if (!result.ok) {
      setStatus(result.error, true);
      return;
    }
    state.store.replaceDocument(result.doc);
    state.dirty = false;
    fit();
    render();
    setStatus(`工程“${result.doc.name}”已载入，所有文字和图形保持可编辑。`);
  };
  reader.onerror = () => setStatus("文件读取失败，当前画布内容已保留。请重试或更换文件。", true);
  reader.readAsText(file);
  event.target.value = "";
}

function newDocument() {
  if (!window.confirm("新建空白海报将清空当前画布（可先撤销或导出工程 JSON 备份），确定继续？")) return;
  state.store.replaceDocument(createDocument({ width: state.store.doc.width, height: state.store.doc.height }));
  state.dirty = true;
  fit();
  render();
  setStatus("已新建空白海报。");
}

function bootDefault() {
  const local = loadLocal();
  if (local.ok) {
    boot(local.doc);
    setStatus("已自动恢复上次编辑的海报。");
    return;
  }
  boot(createDocument());
}

bootDefault();
