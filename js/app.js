import {
  STORAGE_KEY,
  SAVED_KEY,
  PAGE_PRESETS,
  makeDocument,
  makeSample,
  makeItem,
  normalizeDocument,
  serializedExport,
} from "./schema.js";
import { buildLayout } from "./layout.js";
import { renderCanvas, renderCanvasToPng, buildSvg } from "./renderer.js";

const canvas = document.querySelector("#menuCanvas");
const stage = document.querySelector("#previewStage");
const pageShadow = document.querySelector("#pageShadow");
const itemsList = document.querySelector("#itemsList");
const saveStatus = document.querySelector("#saveStatus");
const saveDot = document.querySelector("#saveDot");
const validationDock = document.querySelector("#validationDock");
const validationList = document.querySelector("#validationList");
const validationToggle = document.querySelector("#validationToggle");
const validationTitle = document.querySelector("#validationTitle");
const validationSubtitle = document.querySelector("#validationSubtitle");
const validationIcon = document.querySelector("#validationIcon");
const exportMenu = document.querySelector("#exportMenu");
const exportBtn = document.querySelector("#exportBtn");
const importInput = document.querySelector("#importInput");
const confirmModal = document.querySelector("#confirmModal");

const dom = {
  restaurant: document.querySelector("#restaurantInput"),
  currency: document.querySelector("#currencyInput"),
  headline: document.querySelector("#headlineInput"),
  subheading: document.querySelector("#subheadingInput"),
  note: document.querySelector("#noteInput"),
  pagePreset: document.querySelector("#pagePreset"),
  width: document.querySelector("#widthInput"),
  height: document.querySelector("#heightInput"),
  margin: document.querySelector("#marginInput"),
  pageMeta: document.querySelector("#pageMeta"),
  motif: document.querySelector("#motifSelect"),
  paper: document.querySelector("#paperSelect"),
  accentPicker: document.querySelector("#accentPicker"),
  itemCount: document.querySelector("#itemCount"),
  layoutSummary: document.querySelector("#layoutSummary"),
  layoutDetail: document.querySelector("#layoutDetail"),
  zoomLabel: document.querySelector("#zoomLabel"),
  safeMargin: document.querySelector("#safeMarginToggle"),
  undo: document.querySelector("#undoBtn"),
  redo: document.querySelector("#redoBtn"),
  save: document.querySelector("#saveBtn"),
  reload: document.querySelector("#reloadBtn"),
  sample: document.querySelector("#sampleSelect"),
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const snapshotOf = (value) => JSON.stringify(value);
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

let doc;
let layout;
let selectedId = null;
let expandedItemId = null;
let zoomMode = "fit";
let zoomValue = 0.5;
let safeMargin = false;
let history = [];
let historyIndex = -1;
let historyTimer = null;
let autosaveTimer = null;
let renderFrame = null;
let inputError = null;
let confirmResolver = null;
let toastCounter = 0;

function loadInitialDocument() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeDocument(JSON.parse(stored));
  } catch (error) {
    console.warn("无法恢复自动存档", error);
  }
  return makeDocument();
}

function resetHistory() {
  clearTimeout(historyTimer);
  historyTimer = null;
  history = [clone(doc)];
  historyIndex = 0;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const current = snapshotOf(doc || {});
  const pendingChange = Boolean(historyTimer) || current !== snapshotOf(history[historyIndex] || {});
  dom.undo.disabled = historyIndex <= 0 && !pendingChange;
  dom.redo.disabled = Boolean(historyTimer) || historyIndex >= history.length - 1;
}

function queueHistory() {
  if (!historyTimer) {
    history = history.slice(0, historyIndex + 1);
  }
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    historyTimer = null;
    const next = snapshotOf(doc);
    if (next !== snapshotOf(history[historyIndex])) {
      history.push(clone(doc));
      historyIndex = history.length - 1;
      if (history.length > 80) {
        history.shift();
        historyIndex -= 1;
      }
    }
    updateHistoryButtons();
  }, 420);
  updateHistoryButtons();
}

function commitHistory() {
  clearTimeout(historyTimer);
  historyTimer = null;
  const next = snapshotOf(doc);
  if (next === snapshotOf(history[historyIndex])) {
    updateHistoryButtons();
    return;
  }
  history = history.slice(0, historyIndex + 1);
  history.push(clone(doc));
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function applyDocument(next, options = {}) {
  doc = normalizeDocument(next);
  selectedId = null;
  if (!doc.items.some((item) => item.id === expandedItemId)) {
    expandedItemId = doc.items[0]?.id || null;
  }
  if (options.history === "push") commitHistory();
  else if (options.history !== "none") queueHistory();
  syncForm();
  recompute({ fullEditor: true });
  autosaveSoon();
}

function undo() {
  const current = snapshotOf(doc);
  if (current !== snapshotOf(history[historyIndex])) {
    commitHistory();
  }
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  applyHistorySnapshot(history[historyIndex]);
}

function redo() {
  if (historyTimer || historyIndex >= history.length - 1) return;
  historyIndex += 1;
  applyHistorySnapshot(history[historyIndex]);
}

function applyHistorySnapshot(snapshot) {
  doc = clone(snapshot);
  if (!doc.items.some((item) => item.id === selectedId)) selectedId = null;
  if (!doc.items.some((item) => item.id === expandedItemId)) {
    expandedItemId = doc.items[0]?.id || null;
  }
  inputError = null;
  syncForm();
  recompute({ fullEditor: true });
  autosaveSoon();
  updateHistoryButtons();
}

function autosaveSoon() {
  clearTimeout(autosaveTimer);
  saveStatus.textContent = "保存中…";
  saveDot.parentElement?.classList.add("unsaved");
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, snapshotOf(doc));
      saveStatus.textContent = "已自动保存";
      saveDot.parentElement?.classList.remove("unsaved");
    } catch {
      saveStatus.textContent = "本地存储不可用";
      saveDot.parentElement?.classList.add("unsaved");
    }
  }, 280);
}

function syncForm() {
  for (const field of ["restaurant", "currency", "headline", "subheading", "note"]) {
    dom[field].value = doc[field];
  }
  dom.pagePreset.value = doc.page.preset;
  dom.width.value = doc.page.width;
  dom.height.value = doc.page.height;
  dom.margin.value = doc.page.margin;
  dom.motif.value = doc.theme.motif;
  dom.paper.value = doc.theme.paper;
  dom.accentPicker.value = doc.theme.accent;
  dom.itemCount.textContent = String(doc.items.length);
  document.querySelectorAll("[data-accent]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.accent.toLowerCase() === doc.theme.accent.toLowerCase(),
    );
  });
  renderItemsEditor();
}

function renderItemsEditor() {
  itemsList.innerHTML = doc.items
    .map((item, index) => {
      const expanded = item.id === expandedItemId;
      return `<article class="item-editor ${expanded ? "selected" : ""}" data-editor-id="${escapeHtml(
        item.id,
      )}">
        <div class="item-editor-head">
          <span class="item-index">${String(index + 1).padStart(2, "0")}</span>
          <button class="item-name-preview" data-action="toggle-item" type="button">${escapeHtml(
            item.name || "未命名菜品",
          )}</button>
          <div class="item-tools">
            <button class="item-tool" data-action="move-up" title="上移" aria-label="上移" ${
              index === 0 ? "disabled" : ""
            }>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg>
            </button>
            <button class="item-tool" data-action="move-down" title="下移" aria-label="下移" ${
              index === doc.items.length - 1 ? "disabled" : ""
            }>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
            </button>
            <button class="item-tool" data-action="duplicate" title="复制" aria-label="复制">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="10" height="10" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
            </button>
            <button class="item-tool danger" data-action="delete" title="删除" aria-label="删除">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>
            </button>
          </div>
        </div>
        <div class="item-editor-body">
          <label class="field">
            <span>菜名</span>
            <input data-item-id="${escapeHtml(item.id)}" data-item-field="name" value="${escapeHtml(
              item.name,
            )}" autocomplete="off" />
          </label>
          <div class="price-field">
            <label class="field">
              <span>价格</span>
              <input data-item-id="${escapeHtml(item.id)}" data-item-field="price" value="${escapeHtml(
                item.price,
              )}" placeholder="例如 128 或 时价" autocomplete="off" />
            </label>
            <span class="field tag-field">
              <span>标签</span>
              <input data-item-id="${escapeHtml(item.id)}" data-item-field="tags" value="${escapeHtml(
                item.tags.join("、"),
              )}" placeholder="含麸质、纯素" autocomplete="off" />
            </span>
          </div>
          <label class="field">
            <span>描述</span>
            <textarea data-item-id="${escapeHtml(item.id)}" data-item-field="description" rows="2">${escapeHtml(
              item.description,
            )}</textarea>
          </label>
          <p class="tag-hint">用逗号或顿号分隔标签。含 <b>乳、蛋、鱼、麸质、坚果、芝麻</b> 等关键词的标签会自动显示为醒目的过敏原徽标，并独占一行。</p>
        </div>
      </article>`;
    })
    .join("");
  dom.itemCount.textContent = String(doc.items.length);
  applyFieldErrors();
}

function updateItemPreview(itemId) {
  const item = doc.items.find((entry) => entry.id === itemId);
  const card = itemsList.querySelector(`[data-editor-id="${CSS.escape(itemId)}"]`);
  if (!item || !card) return;
  const preview = card.querySelector(".item-name-preview");
  if (preview) preview.textContent = item.name || "未命名菜品";
}

function updateItemField(itemId, field, rawValue) {
  const item = doc.items.find((entry) => entry.id === itemId);
  if (!item) return;
  inputError = null;
  if (field === "tags") {
    item.tags = rawValue
      .split(/[,，、]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  } else {
    item[field] = rawValue;
  }
  if (field === "name") updateItemPreview(itemId);
  recompute();
  queueHistory();
  autosaveSoon();
}

function addItem() {
  inputError = null;
  const item = makeItem();
  doc.items.push(item);
  expandedItemId = item.id;
  selectedId = item.id;
  commitHistory();
  recompute({ fullEditor: true });
  autosaveSoon();
  requestAnimationFrame(() => {
    const card = itemsList.querySelector(`[data-editor-id="${CSS.escape(item.id)}"]`);
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card?.querySelector('[data-item-field="name"]')?.focus();
    card?.querySelector('[data-item-field="name"]')?.select();
  });
}

function recompute({ fullEditor = false } = {}) {
  layout = buildLayout(doc);
  if (fullEditor) renderItemsEditor();
  renderPreview();
  updateValidationUI();
  updateLayoutSummary();
  updatePageMeta();
  applyFieldErrors();
  updateHistoryButtons();
}

function updatePageMeta() {
  const names = {
    "a4-portrait": "A4 纵向",
    "a4-landscape": "A4 横向",
    "a5-portrait": "A5 纵向",
    square: "方形",
    custom: "自定义",
  };
  dom.pageMeta.textContent = `${names[doc.page.preset] || "自定义"} · ${doc.page.width} × ${doc.page.height}`;
}

function updateLayoutSummary() {
  const errors = layout.issues.filter((entry) => entry.severity === "error").length + (inputError ? 1 : 0);
  const warnings = layout.issues.filter((entry) => entry.severity === "warning").length;
  const fill = Math.round((layout.content.requiredHeight / Math.max(1, layout.content.availableHeight)) * 100);
  dom.layoutSummary.textContent = `自动 ${layout.columns} 栏 · ${doc.items.length} 道菜`;
  const parts = [
    `字号 ${Math.round(layout.fitScale * 100)}%`,
    `内容占安全区 ${Math.max(0, fill)}%`,
    `${doc.page.width} × ${doc.page.height}px`,
  ];
  if (errors) parts.push(`${errors} 项需修复`);
  else if (warnings) parts.push(`${warnings} 项提醒`);
  dom.layoutDetail.textContent = parts.join(" · ");
}

function combinedIssues() {
  const layoutIssues = layout?.issues || [];
  return [...(inputError ? [inputError] : []), ...layoutIssues].sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "error" ? -1 : 1;
  });
}

function updateValidationUI() {
  const issues = combinedIssues();
  const errors = issues.filter((entry) => entry.severity === "error");
  const warnings = issues.filter((entry) => entry.severity === "warning");
  validationDock.classList.toggle("has-errors", errors.length > 0);
  validationDock.classList.toggle("has-warnings", errors.length === 0 && warnings.length > 0);

  if (errors.length) {
    validationTitle.textContent = `发现 ${errors.length} 个导出阻断问题`;
    validationSubtitle.textContent = `${errors[0].code} · ${errors[0].title}`;
    validationIcon.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3v.1M10.3 4.5 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0Z"/></svg>';
  } else if (warnings.length) {
    validationTitle.textContent = `版式可导出，有 ${warnings.length} 项提醒`;
    validationSubtitle.textContent = `${warnings[0].code} · ${warnings[0].title}`;
    validationIcon.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3v.1"/><circle cx="12" cy="12" r="9"/></svg>';
  } else {
    validationTitle.textContent = "版式检查通过";
    validationSubtitle.textContent = "安全边距、文字重叠与页脚裁切均正常";
    validationIcon.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
  }

  validationList.innerHTML = issues.length
    ? issues
        .map(
          (entry) => `<li class="validation-issue">
            <em>${entry.severity === "error" ? "阻断" : "提醒"}</em>
            <div>
              <strong>${escapeHtml(entry.code)} · ${escapeHtml(entry.title)}</strong>
              <p>${escapeHtml(entry.detail)}</p>
              <p><b>修复：</b>${escapeHtml(entry.fix)}</p>
            </div>
          </li>`,
        )
        .join("")
    : '<li class="validation-issue"><em>通过</em><div><strong>所有内容均位于安全边距内</strong><p>没有检测到文字或过敏原标签重叠，也没有裁切。</p></div></li>';
}

function applyFieldErrors() {
  document.querySelectorAll(".field.invalid").forEach((field) => field.classList.remove("invalid"));
  const issues = combinedIssues().filter((entry) => entry.severity === "error");
  for (const entry of issues) {
    let input;
    if (entry.itemId && entry.field) {
      const selector = `[data-item-id="${CSS.escape(entry.itemId)}"][data-item-field="${entry.field}"]`;
      input = document.querySelector(selector);
    } else if (entry.field) {
      const fieldMap = {
        pageWidth: dom.width,
        pageHeight: dom.height,
        margin: dom.margin,
      };
      input = fieldMap[entry.field] || document.querySelector(`[data-doc="${entry.field}"]`);
    }
    input?.closest(".field")?.classList.add("invalid");
    input?.closest(".tag-field")?.classList.add("invalid");
  }
}

let lastStageSize = "";
function renderPreview() {
  if (!layout) return;
  const stageWidth = Math.max(320, stage.clientWidth - 84);
  const stageHeight = Math.max(260, stage.clientHeight - 84);
  lastStageSize = `${stage.clientWidth}x${stage.clientHeight}`;
  if (zoomMode === "fit") {
    zoomValue = Math.min(stageWidth / layout.page.width, stageHeight / layout.page.height, 1.15);
  }
  zoomValue = Math.min(2, Math.max(0.12, zoomValue));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = Math.round(layout.page.width * zoomValue);
  const cssHeight = Math.round(layout.page.height * zoomValue);
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  pageShadow.style.width = `${cssWidth}px`;
  pageShadow.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale((cssWidth / layout.page.width) * dpr, (cssHeight / layout.page.height) * dpr);
  renderCanvas(ctx, layout, {
    safeMargin,
    selectedId,
  });
  dom.zoomLabel.textContent = `${Math.round(zoomValue * 100)}%`;
  dom.zoomLabel.title = zoomMode === "fit" ? "适应窗口 · 点击复位" : "点击适应窗口";
}

function schedulePreviewRender() {
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    if (zoomMode === "fit") renderPreview();
  });
}

function showToast(message, type = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.dataset.toastId = String(++toastCounter);
  toast.textContent = message;
  document.querySelector("#toastStack").append(toast);
  setTimeout(() => toast.remove(), type === "error" ? 6200 : 3600);
}

function askConfirm(title, text, acceptLabel = "放弃并载入") {
  document.querySelector("#confirmTitle").textContent = title;
  document.querySelector("#confirmText").textContent = text;
  document.querySelector("#confirmAccept").textContent = acceptLabel;
  confirmModal.hidden = false;
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  confirmResolver = null;
  confirmModal.hidden = true;
  resolve(result);
}

function saveDocument() {
  try {
    clearTimeout(autosaveTimer);
    const serialized = snapshotOf(doc);
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(SAVED_KEY, serialized);
    saveStatus.textContent = "已保存快照";
    saveDot.parentElement?.classList.remove("unsaved");
    commitHistory();
    showToast("菜单已保存到本机，可用“重新载入”恢复这个版本。", "success");
  } catch {
    showToast("保存失败：浏览器本地存储不可用。请改用“导出 → 版式 JSON”备份。", "error");
  }
}

async function reloadSavedDocument() {
  let saved;
  try {
    saved = localStorage.getItem(SAVED_KEY);
  } catch {
    showToast("无法读取本地存储，请检查浏览器隐私设置。", "error");
    return;
  }
  if (!saved) {
    showToast("还没有手动保存的版本。请先点击“保存”，或导入一份版式 JSON。", "error");
    return;
  }
  let next;
  try {
    next = normalizeDocument(JSON.parse(saved));
  } catch (error) {
    showToast(`无法重新载入：${error.message} 当前内容保持不变。`, "error");
    return;
  }
  if (snapshotOf(doc) !== snapshotOf(next)) {
    const accepted = await askConfirm(
      "重新载入已保存版本？",
      "当前画布与上次手动保存的版本不同。重新载入会替换当前编辑，但随后仍可用撤销恢复。",
      "重新载入",
    );
    if (!accepted) return;
  }
  commitHistory();
  applyDocument(next, { history: "push" });
  showToast("已重新载入保存版本。按 ⌘/Ctrl Z 可撤销这次操作。", "success");
}

function handleImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const next = normalizeDocument(parsed);
      inputError = null;
      commitHistory();
      applyDocument(next, { history: "push" });
      showToast(`已载入 ${next.items.length} 道菜；文字、标签和版式均可继续编辑。`, "success");
    } catch (error) {
      inputError = {
        code: "E-IMPORT-01",
        severity: "error",
        title: "JSON 导入失败",
        detail: `${error.message} 现有画布与输入均未改变。`,
        fix: "确认文件是 Mise 版式 JSON，且包含 items 数组；修复后重新导入。",
      };
      updateValidationUI();
      applyFieldErrors();
      validationDock.classList.remove("collapsed");
      validationToggle.setAttribute("aria-expanded", "true");
      showToast(`导入失败：${error.message} 当前内容已完整保留。`, "error");
    }
  };
  reader.onerror = () => {
    showToast("文件读取失败，当前内容未改变。请重新选择文件。", "error");
  };
  reader.readAsText(file);
}

function makeFilename(extension) {
  const base = `${doc.restaurant || "menu"}-${doc.headline || "menu"}`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "")
    .slice(0, 48);
  return `${base || "menu"}.${extension}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportFile(kind) {
  exportMenu.hidden = true;
  const blocking = combinedIssues().filter((entry) => entry.severity === "error");
  if (blocking.length) {
    validationDock.classList.remove("collapsed");
    validationToggle.setAttribute("aria-expanded", "true");
    showToast(`无法导出：${blocking[0].title}。${blocking[0].fix}`, "error");
    return;
  }

  try {
    if (kind === "png") {
      const exportCanvas = renderCanvasToPng(layout, 2);
      const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("浏览器无法生成 PNG 图像。");
      downloadBlob(blob, makeFilename("png"));
      showToast("PNG 已导出：2× 分辨率，使用与预览完全相同的排版坐标。", "success");
    } else if (kind === "svg") {
      const svg = await buildSvg(layout, doc);
      downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), makeFilename("svg"));
      showToast("SVG 已导出：文字、标签与装饰图形均为独立矢量元素。", "success");
    } else if (kind === "json") {
      const payload = serializedExport(doc, layout);
      downloadBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }),
        makeFilename("json"),
      );
      showToast("版式 JSON 已导出，可通过“导入 JSON”重新载入并继续编辑。", "success");
    }
  } catch (error) {
    showToast(`导出失败：${error.message} 现有内容没有改变，请重试或改用其他格式。`, "error");
  }
}

function loadSample(kind) {
  if (!kind) return;
  try {
    commitHistory();
    const sample = makeSample(kind);
    applyDocument(sample, { history: "push" });
    expandedItemId = sample.items[0]?.id || null;
    selectedId = null;
    syncForm();
    recompute({ fullEditor: true });
    const labels = { standard: "标准案例", extreme: "极端长文本案例", tiny: "极小尺寸案例" };
    showToast(`已载入${labels[kind]}。按 ⌘/Ctrl Z 可回到载入前内容。`, "success");
  } catch (error) {
    showToast(`示例载入失败：${error.message}`, "error");
  } finally {
    dom.sample.value = "";
  }
}

function bindEvents() {
  document.querySelectorAll("[data-doc]").forEach((input) => {
    input.addEventListener("input", () => {
      const field = input.dataset.doc;
      doc[field] = input.value;
      inputError = null;
      recompute();
      queueHistory();
      autosaveSoon();
    });
  });

  itemsList.addEventListener("input", (event) => {
    const input = event.target.closest("[data-item-id]");
    if (!input) return;
    updateItemField(input.dataset.itemId, input.dataset.itemField, input.value);
  });

  itemsList.addEventListener("click", (event) => {
    const card = event.target.closest(".item-editor");
    if (!card) return;
    const itemId = card.dataset.editorId;
    const actionButton = event.target.closest("[data-action]");
    const action = actionButton?.dataset.action;
    const index = doc.items.findIndex((item) => item.id === itemId);
    if (index < 0) return;

    if (action === "toggle-item" || (!action && event.target.closest(".item-editor-head"))) {
      expandedItemId = expandedItemId === itemId ? null : itemId;
      selectedId = expandedItemId;
      renderItemsEditor();
      renderPreview();
      return;
    }
    if (action === "move-up" && index > 0) {
      [doc.items[index - 1], doc.items[index]] = [doc.items[index], doc.items[index - 1]];
      commitHistory();
      recompute({ fullEditor: true });
      autosaveSoon();
    } else if (action === "move-down" && index < doc.items.length - 1) {
      [doc.items[index + 1], doc.items[index]] = [doc.items[index], doc.items[index + 1]];
      commitHistory();
      recompute({ fullEditor: true });
      autosaveSoon();
    } else if (action === "duplicate") {
      const copy = clone(doc.items[index]);
      copy.id = `dish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      doc.items.splice(index + 1, 0, copy);
      expandedItemId = copy.id;
      selectedId = copy.id;
      commitHistory();
      recompute({ fullEditor: true });
      autosaveSoon();
      showToast("已复制菜品，文字和标签仍可编辑。", "success");
    } else if (action === "delete") {
      const [removed] = doc.items.splice(index, 1);
      if (expandedItemId === itemId) expandedItemId = doc.items[Math.min(index, doc.items.length - 1)]?.id || null;
      if (selectedId === itemId) selectedId = null;
      commitHistory();
      recompute({ fullEditor: true });
      autosaveSoon();
      showToast(`已删除“${removed.name || "未命名菜品"}”。按 ⌘/Ctrl Z 可恢复。`, "success");
    }
  });

  document.querySelector("#addItemBtn").addEventListener("click", addItem);
  document.querySelector("#addItemWideBtn").addEventListener("click", addItem);

  dom.pagePreset.addEventListener("change", () => {
    inputError = null;
    const preset = PAGE_PRESETS[dom.pagePreset.value];
    doc.page.preset = dom.pagePreset.value;
    if (preset) {
      doc.page.width = preset.width;
      doc.page.height = preset.height;
      doc.page.margin = preset.margin;
      dom.width.value = preset.width;
      dom.height.value = preset.height;
      dom.margin.value = preset.margin;
    }
    recompute();
    commitHistory();
    autosaveSoon();
  });

  for (const [input, key, custom] of [
    [dom.width, "width", true],
    [dom.height, "height", true],
    [dom.margin, "margin", false],
  ]) {
    input.addEventListener("input", () => {
      inputError = null;
      doc.page[key] = input.value === "" ? 0 : Number(input.value);
      if (custom) {
        doc.page.preset = "custom";
        dom.pagePreset.value = "custom";
      }
      recompute();
      queueHistory();
      autosaveSoon();
    });
  }

  document.querySelector("#accentSwatches").addEventListener("click", (event) => {
    const button = event.target.closest("[data-accent]");
    if (!button) return;
    inputError = null;
    doc.theme.accent = button.dataset.accent;
    dom.accentPicker.value = doc.theme.accent;
    syncAccentSwatches();
    recompute();
    commitHistory();
    autosaveSoon();
  });
  dom.accentPicker.addEventListener("input", () => {
    inputError = null;
    doc.theme.accent = dom.accentPicker.value;
    syncAccentSwatches();
    recompute();
    queueHistory();
    autosaveSoon();
  });
  dom.accentPicker.addEventListener("change", commitHistory);

  for (const [select, key] of [
    [dom.motif, "motif"],
    [dom.paper, "paper"],
  ]) {
    select.addEventListener("change", () => {
      inputError = null;
      doc.theme[key] = select.value;
      recompute();
      commitHistory();
      autosaveSoon();
    });
  }

  dom.undo.addEventListener("click", undo);
  dom.redo.addEventListener("click", redo);
  dom.save.addEventListener("click", saveDocument);
  dom.reload.addEventListener("click", reloadSavedDocument);
  dom.sample.addEventListener("change", () => loadSample(dom.sample.value));
  document.querySelector("#importBtn").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => {
    handleImport(importInput.files?.[0]);
    importInput.value = "";
  });

  validationToggle.addEventListener("click", () => {
    const collapsed = validationDock.classList.toggle("collapsed");
    validationToggle.setAttribute("aria-expanded", String(!collapsed));
  });

  exportBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    exportMenu.hidden = !exportMenu.hidden;
  });
  exportMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-export]");
    if (button) exportFile(button.dataset.export);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".export-wrap")) exportMenu.hidden = true;
  });

  document.querySelector("#confirmCancel").addEventListener("click", () => closeConfirm(false));
  document.querySelector("#confirmAccept").addEventListener("click", () => closeConfirm(true));
  confirmModal.addEventListener("click", (event) => {
    if (event.target === confirmModal) closeConfirm(false);
  });

  document.querySelector("#zoomIn").addEventListener("click", () => {
    zoomMode = "manual";
    zoomValue = Math.min(2, zoomValue + 0.1);
    renderPreview();
  });
  document.querySelector("#zoomOut").addEventListener("click", () => {
    zoomMode = "manual";
    zoomValue = Math.max(0.12, zoomValue - 0.1);
    renderPreview();
  });
  document.querySelector("#fitBtn").addEventListener("click", fitToStage);
  dom.zoomLabel.addEventListener("click", fitToStage);
  dom.safeMargin.addEventListener("change", () => {
    safeMargin = dom.safeMargin.checked;
    renderPreview();
  });

  canvas.addEventListener("click", handleCanvasClick);
  canvas.addEventListener("mousemove", handleCanvasMove);

  document.addEventListener("keydown", handleKeyboard);
  window.addEventListener("resize", schedulePreviewRender);
  window.addEventListener("pagehide", () => {
    try {
      localStorage.setItem(STORAGE_KEY, snapshotOf(doc));
    } catch {
      // The explicit export flow remains available if local storage is blocked.
    }
  });

  new ResizeObserver((entries) => {
    const size = `${Math.round(entries[0].contentRect.width)}x${Math.round(entries[0].contentRect.height)}`;
    if (zoomMode === "fit" && size !== lastStageSize) schedulePreviewRender();
  }).observe(stage);
}

function syncAccentSwatches() {
  document.querySelectorAll("[data-accent]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.accent.toLowerCase() === doc.theme.accent.toLowerCase(),
    );
  });
}

function fitToStage() {
  zoomMode = "fit";
  renderPreview();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * layout.page.width,
    y: ((event.clientY - rect.top) / rect.height) * layout.page.height,
  };
}

function hitTest(point) {
  for (const column of layout.columnsData) {
    for (const item of column.items) {
      if (
        point.x >= item.x &&
        point.x <= item.x + item.width &&
        point.y >= item.y &&
        point.y <= item.y + item.height
      ) {
        return { type: "item", itemId: item.id };
      }
    }
  }
  for (const region of layout.regions) {
    if (
      point.x >= region.x &&
      point.x <= region.x + region.width &&
      point.y >= region.y &&
      point.y <= region.y + region.height
    ) {
      return { type: "region", role: region.role };
    }
  }
  return null;
}

function handleCanvasClick(event) {
  if (!layout) return;
  const hit = hitTest(canvasPoint(event));
  if (!hit) {
    selectedId = null;
    renderPreview();
    return;
  }
  if (hit.type === "item") {
    expandedItemId = hit.itemId;
    selectedId = hit.itemId;
    renderItemsEditor();
    renderPreview();
    const card = itemsList.querySelector(`[data-editor-id="${CSS.escape(hit.itemId)}"]`);
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  const focusMap = {
    restaurant: dom.restaurant,
    headline: dom.headline,
    subheading: dom.subheading,
    note: dom.note,
    "page-number": dom.note,
    "decorative-motif": dom.motif,
  };
  const target = focusMap[hit.role];
  if (target) {
    target.focus({ preventScroll: false });
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function handleCanvasMove(event) {
  if (!layout) return;
  canvas.classList.toggle("pointer", Boolean(hitTest(canvasPoint(event))));
}

function handleKeyboard(event) {
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (modifier && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (modifier && key === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (modifier && key === "s") {
    event.preventDefault();
    saveDocument();
    return;
  }
  if (key === "escape") {
    if (!confirmModal.hidden) {
      closeConfirm(false);
      return;
    }
    if (!exportMenu.hidden) {
      exportMenu.hidden = true;
      return;
    }
    if (selectedId) {
      selectedId = null;
      renderPreview();
    }
  }
}

async function loadFonts() {
  if (!document.fonts) return;
  saveStatus.textContent = "字体载入中…";
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('400 16px "Mise Sans"', "菜单排版"),
        document.fonts.load('700 16px "Mise Sans"', "菜单排版"),
      ]),
      new Promise((resolve) => setTimeout(resolve, 9000)),
    ]);
    await document.fonts.ready;
  } catch (error) {
    console.warn("字体载入不完整，将使用系统回退字体。", error);
  }
}

async function init() {
  let restored = false;
  try {
    restored = Boolean(localStorage.getItem(STORAGE_KEY));
  } catch {
    restored = false;
  }
  doc = loadInitialDocument();
  expandedItemId = doc.items[0]?.id || null;
  selectedId = null;
  resetHistory();
  syncForm();
  bindEvents();
  saveStatus.textContent = "正在排版…";
  await loadFonts();
  recompute({ fullEditor: true });
  saveStatus.textContent = restored ? "已恢复自动保存" : "已自动保存";
  autosaveSoon();
  if (restored) {
    setTimeout(() => showToast("已恢复上次自动保存；手动保存的版本可用“重新载入”打开。"), 500);
  }
}

init().catch((error) => {
  console.error(error);
  saveStatus.textContent = "初始化失败";
  showToast(`编辑器初始化失败：${error.message}`, "error");
});
