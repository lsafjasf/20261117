import {
  PRESETS,
  STORAGE_KEY,
  addElement,
  createExtremeProject,
  createStandardProject,
  deepClone,
  duplicateElement,
  findElement,
  parseProject,
  removeElement,
  serializeProject,
  setProjectOrientation,
  setProjectPreset,
  updateElement,
} from "./model.js";
import {
  elementLabel,
  getSheetLayout,
  measureTextElement,
  rect,
} from "./geometry.js";
import { drawEditor, preloadProjectImages } from "./render.js";
import { downloadProjectFile, exportProjectPng } from "./export.js";
import { issueSummary, validateProject } from "./validate.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const dom = {
  canvas: $("#editorCanvas"),
  canvasScroll: $("#canvasScroll"),
  canvasMount: $("#canvasMount"),
  projectName: $("#projectName"),
  saveStatus: $("#saveStatus"),
  undoBtn: $("#undoBtn"),
  redoBtn: $("#redoBtn"),
  saveBtn: $("#saveBtn"),
  loadBtn: $("#loadBtn"),
  exportTop: $("#exportBtnTop"),
  exportBtn: $("#exportBtn"),
  dimensionBadge: $("#dimensionBadge"),
  activeSideLabel: $("#activeSideLabel"),
  inspectorContent: $("#inspectorContent"),
  selectionBadge: $("#selectionBadge"),
  issueSummary: $("#issueSummary"),
  issueList: $("#issueList"),
  checkBadge: $("#checkBadge"),
  guidesToggle: $("#guidesToggle"),
  zoomLabel: $("#zoomLabel"),
  toast: $("#toast"),
  errorDialog: $("#errorDialog"),
  errorDialogList: $("#errorDialogList"),
  errorDialogIntro: $("#errorDialogIntro"),
  imageFileInput: $("#imageFileInput"),
  projectFileInput: $("#projectFileInput"),
};

let project;
let past = [];
let future = [];
let selected = null;
let activeSide = "front";
let validation = null;
let errorKeys = new Set();
let zoomMode = "fit";
let zoomFactor = 1;
let canvasMetrics = { cssWidth: 0, cssHeight: 0, dpr: 1 };
let renderFrame = 0;
let saveTimer = 0;
let toastTimer = 0;
let drag = null;
let lastPointer = null;
let isExporting = false;
let restoredFromStorage = false;
let storageLoadFailed = false;

const MAX_HISTORY = 80;
const canvasContext = dom.canvas.getContext("2d");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, tone = "default", duration = 2600) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.className = `toast is-visible${tone === "error" ? " is-error" : tone === "success" ? " is-success" : ""}`;
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, duration);
}

function setSaveStatus(text, state = "") {
  dom.saveStatus.textContent = text;
  dom.saveStatus.className = `save-status${state ? ` is-${state}` : ""}`;
}

function currentElement() {
  return selected ? findElement(project, selected.side, selected.id) : null;
}

function initialProject() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createStandardProject();
    const restored = parseProject(saved);
    restoredFromStorage = true;
    return restored;
  } catch (error) {
    console.warn("Local project could not be restored:", error);
    storageLoadFailed = true;
    setTimeout(() => {
      showToast(`本机保存版本无法恢复：${error.message}。已打开标准案例，原保存内容未被覆盖。`, "error", 5200);
    }, 0);
    return createStandardProject();
  }
}

function saveToStorage({ quiet = false } = {}) {
  clearTimeout(saveTimer);
  try {
    setSaveStatus("正在保存…", "saving");
    localStorage.setItem(STORAGE_KEY, serializeProject(project));
    const now = new Date();
    const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    setSaveStatus(`已保存 · ${time}`);
    if (!quiet) showToast("项目已保存到本机，可随时点击“载入”恢复。", "success");
  } catch (error) {
    setSaveStatus("本机保存失败", "error");
    showToast(
      `无法写入本机存储：${error.message}。当前编辑内容仍在画布中，请点击“下载项目”保存文件。`,
      "error",
      6000,
    );
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setSaveStatus("等待自动保存…", "saving");
  saveTimer = setTimeout(() => saveToStorage({ quiet: true }), 220);
}

function pushPast(snapshot) {
  past.push(snapshot);
  if (past.length > MAX_HISTORY) past.shift();
  future = [];
}

function commit(nextProject, message = "", options = {}) {
  const snapshot = deepClone(project);
  pushPast(snapshot);
  project = nextProject;
  project.updatedAt = new Date().toISOString();
  if (options.clearSelection) selected = null;
  if (selected && !findElement(project, selected.side, selected.id)) selected = null;
  afterMutation();
  if (options.rebuildInspector !== false) renderInspector();
  if (message) showToast(message);
  scheduleSave();
}

function finishLiveMutation(before, message = "") {
  if (JSON.stringify(before) === JSON.stringify(project)) return;
  pushPast(before);
  project.updatedAt = new Date().toISOString();
  if (selected && !findElement(project, selected.side, selected.id)) selected = null;
  afterMutation();
  renderInspector();
  if (message) showToast(message);
  scheduleSave();
}

function afterMutation() {
  updateHeaderState();
  updateCanvasSize();
  refreshChecks();
  updateHistoryButtons();
}

function undo() {
  if (!past.length) return;
  future.push(deepClone(project));
  project = past.pop();
  if (selected && !findElement(project, selected.side, selected.id)) selected = null;
  if (project.orientation === "portrait" && activeSide === "front") activeSide = "front";
  afterMutation();
  renderInspector();
  updateHistoryButtons();
  scheduleSave();
  showToast("已撤销上一步。");
}

function redo() {
  if (!future.length) return;
  past.push(deepClone(project));
  project = future.pop();
  if (selected && !findElement(project, selected.side, selected.id)) selected = null;
  afterMutation();
  renderInspector();
  updateHistoryButtons();
  scheduleSave();
  showToast("已重做。");
}

function updateHistoryButtons() {
  dom.undoBtn.disabled = past.length === 0;
  dom.redoBtn.disabled = future.length === 0;
}

function updateHeaderState() {
  if (document.activeElement !== dom.projectName) dom.projectName.value = project.name;
  dom.dimensionBadge.textContent = `${project.width} × ${project.height} mm`;
  dom.activeSideLabel.textContent = activeSide === "front" ? "正面 / FRONT" : "背面 / BACK";
  $$(".preset-card").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === project.preset);
  });
  $("#landscapeBtn").classList.toggle("is-active", project.orientation !== "portrait");
  $("#portraitBtn").classList.toggle("is-active", project.orientation === "portrait");
}

function fitScale() {
  const sheet = getSheetLayout(project.width, project.height);
  const availableWidth = Math.max(160, dom.canvasScroll.clientWidth - 56);
  const availableHeight = Math.max(180, dom.canvasScroll.clientHeight - 48);
  return {
    scale: Math.min(availableWidth / sheet.width, availableHeight / sheet.height),
    sheet,
  };
}

function updateCanvasSize() {
  const { scale: baseScale, sheet } = fitScale();
  const scale = baseScale * (zoomMode === "fit" ? 1 : zoomFactor);
  const cssWidth = Math.max(80, Math.round(sheet.width * scale));
  const cssHeight = Math.max(60, Math.round(sheet.height * scale));
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvasMetrics = { cssWidth, cssHeight, dpr };
  dom.canvas.style.width = `${cssWidth}px`;
  dom.canvas.style.height = `${cssHeight}px`;
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);
  if (dom.canvas.width !== pixelWidth || dom.canvas.height !== pixelHeight) {
    dom.canvas.width = pixelWidth;
    dom.canvas.height = pixelHeight;
  }
  dom.zoomLabel.textContent = zoomMode === "fit" ? "适应" : `${Math.round(zoomFactor * 100)}%`;
  scheduleRender();
}

function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    if (!canvasMetrics.cssWidth || !canvasMetrics.cssHeight) return;
    drawEditor(
      canvasContext,
      project,
      canvasMetrics.cssWidth,
      canvasMetrics.cssHeight,
      canvasMetrics.dpr,
      {
        selected,
        activeSide,
        guides: dom.guidesToggle.checked,
        errorKeys,
        showEditorChrome: true,
      },
    );
  });
}

function setZoom(nextMode, factor = zoomFactor) {
  zoomMode = nextMode;
  zoomFactor = Math.max(0.5, Math.min(3, factor));
  updateCanvasSize();
  requestAnimationFrame(() => {
    const maxLeft = Math.max(0, dom.canvasScroll.scrollWidth - dom.canvasScroll.clientWidth);
    const maxTop = Math.max(0, dom.canvasScroll.scrollHeight - dom.canvasScroll.clientHeight);
    dom.canvasScroll.scrollLeft = maxLeft / 2;
    dom.canvasScroll.scrollTop = maxTop / 2;
  });
}

function pointFromEvent(event) {
  const bounds = dom.canvas.getBoundingClientRect();
  const cssX = event.clientX - bounds.left;
  const cssY = event.clientY - bounds.top;
  const sheet = getSheetLayout(project.width, project.height);
  const sheetX = (cssX / bounds.width) * sheet.width;
  const sheetY = (cssY / bounds.height) * sheet.height;
  const side = sheetX >= sheet.back.x && sheetX <= sheet.back.x + sheet.back.w ? "back" : "front";
  const card = side === "back" ? sheet.back : sheet.front;
  if (sheetX < card.x || sheetX > card.x + card.w || sheetY < card.y || sheetY > card.y + card.h) {
    return null;
  }
  return {
    side,
    x: sheetX - card.x,
    y: sheetY - card.y,
    clientX: event.clientX,
    clientY: event.clientY,
  };
}

function hitElement(side, x, y) {
  const list = project.sides[side] || [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const element = list[index];
    const box = rect(element);
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
      return element;
    }
  }
  return null;
}

function selectElement(side, id, options = {}) {
  if (!id) {
    selected = null;
  } else {
    selected = { side, id };
    activeSide = side;
  }
  updateHeaderState();
  renderInspector();
  scheduleRender();
  if (options.reveal) {
    const element = currentElement();
    if (element) showToast(`已定位：${elementLabel(element)}`);
  }
}

function refreshChecks() {
  validation = validateProject(project);
  errorKeys = new Set(
    validation.errors.filter((issue) => issue.elementId).map((issue) => `${issue.side}:${issue.elementId}`),
  );
  const summary = issueSummary(validation);
  dom.issueSummary.className = `issue-summary ${summary.className}`;
  dom.issueSummary.innerHTML = `<span class="summary-mark">${summary.mark}</span><span><strong>${summary.title}</strong><small>${summary.detail}</small></span>`;
  dom.checkBadge.className = `check-badge ${summary.className}`;
  dom.checkBadge.textContent = summary.badge;
  const visibleIssues = validation.issues.slice(0, 7);
  dom.issueList.innerHTML = visibleIssues
    .map(
      (issue) => `
        <button class="issue-item is-${issue.severity}" type="button" data-side="${escapeHtml(issue.side || "")}" data-id="${escapeHtml(issue.elementId || "")}">
          <span class="issue-icon">${issue.severity === "error" ? "!" : "i"}</span>
          <span><strong>${escapeHtml(issue.title)}</strong><small>${escapeHtml(issue.hint)}</small></span>
        </button>`,
    )
    .join("");
  if (validation.issues.length > visibleIssues.length) {
    dom.issueList.insertAdjacentHTML(
      "beforeend",
      `<div class="more-issues">另有 ${validation.issues.length - visibleIssues.length} 项问题，导出前会完整列出。</div>`,
    );
  }
  scheduleRender();
}

function updateExportBusy(busy) {
  isExporting = busy;
  dom.exportBtn.disabled = busy;
  dom.exportTop.disabled = busy;
  dom.exportBtn.querySelector("span:first-child").textContent = busy ? "正在渲染 PNG…" : "导出双面 PNG";
  dom.exportTop.childNodes[0].textContent = busy ? "导出中… " : "导出 PNG";
}

const KIND_META = {
  photo: { icon: "P", label: "照片框", side: "FRONT" },
  stamp: { icon: "S", label: "邮票", side: "BACK" },
  address: { icon: "AD", label: "地址线", side: "BACK" },
  text: { icon: "Aa", label: "短句", side: "TEXT" },
  barcode: { icon: "||", label: "条码", side: "BACK" },
};

function fieldInput(label, field, value, options = {}) {
  const suffix = options.suffix ? `<span>${escapeHtml(options.suffix)}</span>` : "";
  return `
    <div class="form-field">
      <label><span>${escapeHtml(label)}</span>${suffix}</label>
      <input type="text" value="${escapeHtml(value)}" data-live-field="${field}" ${options.maxlength ? `maxlength="${options.maxlength}"` : ""} />
    </div>`;
}

function textArea(field, value, maxLengthHint = 240) {
  return `
    <div class="form-field">
      <label><span>文字内容</span><span>支持换行</span></label>
      <textarea data-live-field="${field}" spellcheck="false">${escapeHtml(value)}</textarea>
      <div class="char-count ${String(value).length > maxLengthHint ? "is-over" : ""}" data-char-count>${String(value).length} 字 · 排版时自动换行</div>
    </div>`;
}

function rangeField(label, field, value, min, max, step, unit = "mm") {
  return `
    <div class="form-field">
      <label><span>${escapeHtml(label)}</span><span class="range-value" data-range-value="${field}">${Number(value).toFixed(1)} ${unit}</span></label>
      <div class="range-row">
        <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-live-field="${field}" />
      </div>
    </div>`;
}

function geometryFields(element) {
  return `
    <div class="form-divider"></div>
    <div class="field-caption"><span>位置与尺寸</span><span>单位 mm</span></div>
    <div class="geometry-grid">
      <label><span>X</span><input class="number-input" type="number" step="0.1" value="${Number(element.x).toFixed(1)}" data-change-field="x" /></label>
      <label><span>Y</span><input class="number-input" type="number" step="0.1" value="${Number(element.y).toFixed(1)}" data-change-field="y" /></label>
      <label><span>W</span><input class="number-input" type="number" step="0.1" min="1" value="${Number(element.w).toFixed(1)}" data-change-field="w" /></label>
      <label><span>H</span><input class="number-input" type="number" step="0.1" min="1" value="${Number(element.h).toFixed(1)}" data-change-field="h" /></label>
    </div>`;
}

function inspectorFooter() {
  return `
    <div class="inspector-footer">
      <button type="button" data-action="duplicate">复制元素</button>
      <button class="is-danger" type="button" data-action="delete">删除</button>
    </div>`;
}

function renderInspector() {
  const element = currentElement();
  if (!element) {
    dom.selectionBadge.textContent = "未选择";
    dom.inspectorContent.innerHTML = `
      <div class="empty-inspector">
        <span class="empty-icon" aria-hidden="true"></span>
        <strong>选择画布中的元素</strong>
        <p>可编辑文字、照片、位置与尺寸。所有修改都可撤销。</p>
      </div>`;
    return;
  }
  const meta = KIND_META[element.kind] || KIND_META.text;
  dom.selectionBadge.textContent = elementLabel(element);
  const style = element.style || {};
  const sideLabel = selected.side === "front" ? "正面" : "背面";
  let specific = "";

  if (element.kind === "photo") {
    specific = `
      <div class="form-field">
        <label><span>照片</span><span>${element.image ? "已载入" : "示例占位"}</span></label>
        <div class="photo-actions">
          <button type="button" data-action="choose-photo">${element.image ? "更换照片" : "选择照片"}</button>
          <button type="button" data-action="clear-photo">清除</button>
        </div>
      </div>
      ${fieldInput("照片说明", "text", element.text, { suffix: "显示于框内" })}
      ${rangeField("说明字号", "captionSize", style.captionSize || 2.1, 1.2, 4, 0.1)}`;
  } else if (element.kind === "stamp") {
    specific = `
      ${fieldInput("票面文字", "text", element.text, { suffix: "可改面值" })}
      <div class="form-field">
        <label><span>邮票颜色</span><span class="range-value">${escapeHtml(style.color || "#3b5545")}</span></label>
        <input class="color-input" type="color" value="${escapeHtml(style.color || "#3b5545")}" data-live-field="color" />
      </div>`;
  } else if (element.kind === "address") {
    const metrics = measureTextElement(element);
    specific = `
      ${textArea("text", element.text, 150)}
      ${rangeField("地址字号", "fontSize", style.fontSize || 2.4, 1.2, 5, 0.1)}
      ${rangeField("行高", "lineHeight", style.lineHeight || 1.9, 1.1, 2.6, 0.05, "×")}
      <div class="rail-hint">当前 ${metrics.lines.length} 行 · 实际 ${metrics.fontSize.toFixed(1)} mm${metrics.overflow ? " · 已溢出" : ""}</div>`;
  } else if (element.kind === "barcode") {
    specific = `
      ${fieldInput("条码内容", "text", element.text, { suffix: "保留可编辑" })}
      ${rangeField("条码字号", "fontSize", style.fontSize || 1.5, 0.8, 2.4, 0.1)}
      <div class="rail-hint">条码位于安全区时才会通过预检。</div>`;
  } else {
    const metrics = measureTextElement(element);
    specific = `
      ${textArea("text", element.text)}
      ${rangeField("字号", "fontSize", style.fontSize || 3, 1.2, 10, 0.1)}
      ${rangeField("行高", "lineHeight", style.lineHeight || 1.55, 1.05, 2.6, 0.05, "×")}
      <div class="form-field">
        <label><span>字体</span><span>Canvas 可编辑文本</span></label>
        <div class="format-row">
          <button class="format-btn ${style.fontFamily !== "serif" && style.fontFamily !== "mono" ? "is-active" : ""}" type="button" data-action="fontFamily" data-value="sans">黑体</button>
          <button class="format-btn ${style.fontFamily === "serif" ? "is-active" : ""}" type="button" data-action="fontFamily" data-value="serif">宋体</button>
          <button class="format-btn ${style.fontFamily === "mono" ? "is-active" : ""}" type="button" data-action="fontFamily" data-value="mono">等宽</button>
        </div>
      </div>
      <div class="form-field">
        <label><span>字重与对齐</span><span>${metrics.lines.length} 行 · ${metrics.fontSize.toFixed(1)} mm</span></label>
        <div class="format-row">
          <button class="format-btn ${Number(style.fontWeight) < 550 ? "is-active" : ""}" type="button" data-action="fontWeight" data-value="400">常规</button>
          <button class="format-btn ${Number(style.fontWeight) >= 550 ? "is-active" : ""}" type="button" data-action="fontWeight" data-value="600">加粗</button>
          <button class="format-btn ${style.align !== "center" && style.align !== "right" ? "is-active" : ""}" type="button" data-action="align" data-value="left">左</button>
          <button class="format-btn ${style.align === "center" ? "is-active" : ""}" type="button" data-action="align" data-value="center">中</button>
          <button class="format-btn ${style.align === "right" ? "is-active" : ""}" type="button" data-action="align" data-value="right">右</button>
        </div>
      </div>
      <div class="form-field">
        <label><span>文字颜色</span><span class="range-value">${escapeHtml(style.color || "#25382e")}</span></label>
        <input class="color-input" type="color" value="${escapeHtml(style.color || "#25382e")}" data-live-field="color" />
      </div>`;
  }

  dom.inspectorContent.innerHTML = `
    <div class="inspector-head">
      <div class="element-identity">
        <span class="element-kind-icon">${escapeHtml(meta.icon)}</span>
        <span><strong>${escapeHtml(meta.label)}</strong><small>${sideLabel} · ${escapeHtml(element.id)}</small></span>
      </div>
      <span class="eyebrow">${escapeHtml(meta.side)}</span>
    </div>
    ${specific}
    ${geometryFields(element)}
    ${inspectorFooter()}`;
}

function updateFieldIndicators(target, field, value, element) {
  const form = target.closest(".form-field");
  const valueLabel = form?.querySelector(`[data-range-value="${field}"]`);
  if (valueLabel) {
    const unit = field === "lineHeight" ? "×" : "mm";
    valueLabel.textContent = `${Number(value).toFixed(field === "lineHeight" ? 2 : 1)} ${unit}`;
  }
  const count = form?.querySelector("[data-char-count]");
  if (count) {
    count.textContent = `${element.text.length} 字 · 排版时自动换行`;
    count.classList.toggle("is-over", element.text.length > 240);
  }
}

function applyLiveField(target) {
  const field = target.dataset.liveField;
  const element = currentElement();
  if (!field || !element) return;
  const raw = target.value;
  const next = updateElement(project, selected.side, selected.id, (draft) => {
    if (field === "text") {
      draft.text = raw;
      return;
    }
    if (field === "color") {
      draft.style.color = raw;
      return;
    }
    const numeric = Number.parseFloat(raw);
    if (!Number.isFinite(numeric)) return;
    if (field === "fontSize") draft.style.fontSize = Math.max(0.5, Math.min(20, numeric));
    else if (field === "lineHeight") draft.style.lineHeight = Math.max(0.8, Math.min(3, numeric));
    else if (field === "captionSize") draft.style.captionSize = Math.max(0.8, Math.min(8, numeric));
  });
  const updated = findElement(next, selected.side, selected.id);
  commit(next, "", { rebuildInspector: false });
  updateFieldIndicators(target, field, target.value, updated);
  if (updated) dom.selectionBadge.textContent = elementLabel(updated);
}

function applyGeometryField(target) {
  const field = target.dataset.changeField;
  const element = currentElement();
  if (!field || !element) return;
  const numeric = Number.parseFloat(target.value);
  if (!Number.isFinite(numeric)) {
    showToast("位置与尺寸必须填写有效数字；本次修改未应用，其他内容未丢失。", "error");
    target.value = Number(element[field]).toFixed(1);
    return;
  }
  if ((field === "w" || field === "h") && numeric < 1) {
    showToast("元素宽度与高度至少为 1 mm；本次修改未应用。", "error");
    target.value = Number(element[field]).toFixed(1);
    return;
  }
  if (Math.abs(numeric - Number(element[field])) < 0.001) return;
  const next = updateElement(project, selected.side, selected.id, (draft) => {
    draft[field] = numeric;
  });
  commit(next, "", { rebuildInspector: true });
}

function applyFormatAction(action, value) {
  const element = currentElement();
  if (!element) return;
  const next = updateElement(project, selected.side, selected.id, (draft) => {
    if (action === "fontFamily") draft.style.fontFamily = value;
    else if (action === "fontWeight") draft.style.fontWeight = Number(value);
    else if (action === "align") draft.style.align = value;
  });
  commit(next, "", { rebuildInspector: true });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("浏览器无法读取这个文件。"));
    reader.readAsDataURL(file);
  });
}

async function loadPhoto(file) {
  const element = currentElement();
  if (!element || element.kind !== "photo") return;
  if (!file.type.startsWith("image/")) {
    showToast("请选择 JPG、PNG、WebP 等图片文件；当前照片与文字均未改变。", "error");
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    showToast("图片超过 15 MB，可能无法写入项目文件。请先压缩图片；当前内容未改变。", "error", 5000);
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const next = updateElement(project, selected.side, selected.id, (draft) => {
      draft.image = dataUrl;
    });
    commit(next, "照片已载入。", { rebuildInspector: true });
    await preloadProjectImages(project);
    scheduleRender();
  } catch (error) {
    showToast(`照片载入失败：${error.message}。原有内容已保留。`, "error", 5000);
  }
}

function handleInspectorClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || !dom.inspectorContent.contains(button)) return;
  const action = button.dataset.action;
  const value = button.dataset.value;
  if (action === "choose-photo") {
    dom.imageFileInput.click();
    return;
  }
  if (action === "clear-photo") {
    const next = updateElement(project, selected.side, selected.id, (draft) => {
      draft.image = null;
    });
    commit(next, "已清除照片，保留照片框和说明文字。", { rebuildInspector: true });
    return;
  }
  if (action === "duplicate") {
    const source = currentElement();
    if (!source) return;
    const result = duplicateElement(project, selected.side, source.id);
    if (!result.element) return;
    commit(result.project, "已复制元素。", { rebuildInspector: false });
    selectElement(selected.side, result.element.id);
    return;
  }
  if (action === "delete") {
    const source = currentElement();
    if (!source) return;
    const next = removeElement(project, selected.side, source.id);
    selected = null;
    commit(next, "元素已删除，可撤销恢复。", { rebuildInspector: true });
    return;
  }
  if (["fontFamily", "fontWeight", "align"].includes(action)) {
    applyFormatAction(action, value);
  }
}

function loadProjectFromSaved() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    showToast("本机还没有已保存版本。可先点击“保存”，或使用“载入文件”。", "error");
    return;
  }
  try {
    const loaded = parseProject(saved);
    dom.projectName.blur();
    commit(loaded, "已重新载入本机保存版本。", { clearSelection: true });
    activeSide = "front";
    setZoom("fit", 1);
    updateHeaderState();
    preloadProjectImages(project).then(scheduleRender);
  } catch (error) {
    showToast(`无法载入本机版本：${error.message}。当前画布内容完整保留。`, "error", 6000);
  }
}

async function importProjectFile(file) {
  try {
    const text = await file.text();
    const loaded = parseProject(text);
    dom.projectName.blur();
    commit(loaded, `已载入项目「${loaded.name}」。`, { clearSelection: true });
    activeSide = "front";
    setZoom("fit", 1);
    updateHeaderState();
    await preloadProjectImages(project);
    scheduleRender();
  } catch (error) {
    showToast(`载入失败：${error.message}。当前项目与输入内容均未改变。`, "error", 6500);
  }
}

function openExportErrors() {
  const errors = validation?.errors || [];
  dom.errorDialogIntro.textContent =
    `当前内容已完整保留，没有自动删除或截断任何文字。修复以下 ${errors.length} 项阻塞问题后再导出：`;
  dom.errorDialogList.innerHTML = errors
    .map(
      (issue, index) => `
        <div class="dialog-list-item">
          <strong>${index + 1}. ${escapeHtml(issue.title)}</strong>
          <small>${escapeHtml(issue.detail)} ${escapeHtml(issue.hint)}</small>
        </div>`,
    )
    .join("");
  if (!dom.errorDialog.open) dom.errorDialog.showModal();
}

async function runExport() {
  refreshChecks();
  if (validation.errors.length) {
    openExportErrors();
    return;
  }
  if (isExporting) return;
  updateExportBusy(true);
  const warningText = validation.warnings.length ? `，包含 ${validation.warnings.length} 项提醒` : "";
  showToast(`正在以 300 DPI 渲染双面与裁切线${warningText}…`, "default", 1800);
  try {
    const result = await exportProjectPng(project);
    showToast(`PNG 已导出：${result.width} × ${result.height} px。`, "success", 4200);
  } catch (error) {
    showToast(`导出失败：${error.message}。当前项目仍完整保留。`, "error", 6500);
  } finally {
    updateExportBusy(false);
  }
}

function changePreset(preset) {
  if (!PRESETS[preset] || preset === project.preset) return;
  const next = setProjectPreset(project, preset);
  commit(next, `已切换为${PRESETS[preset].label}规格（${next.width} × ${next.height} mm），元素已重排。可撤销。`, {
    rebuildInspector: true,
  });
  updateHeaderState();
  setZoom("fit", 1);
}

function changeOrientation(orientation) {
  if (project.preset === "square") {
    showToast("方形画布横竖尺寸相同，无需切换。");
    return;
  }
  if (orientation === project.orientation) return;
  const next = setProjectOrientation(project, orientation);
  commit(
    next,
    `已切换为${orientation === "portrait" ? "竖版" : "横版"}并重新布局（${next.width} × ${next.height} mm）。可撤销。`,
    { rebuildInspector: true },
  );
  updateHeaderState();
  setZoom("fit", 1);
}

function addFromToolbar(kind) {
  if (kind === "address") activeSide = "back";
  const previousSide = activeSide;
  const result = addElement(project, activeSide, kind);
  updateHeaderState();
  if (result.existingAddress) {
    const existing = project.sides.back.find((element) => element.kind === "address");
    selectElement("back", existing.id);
    showToast("背面已有地址区，已选中现有地址线。可编辑文字或复制元素。");
    return;
  }
  const messages = {
    photo: "已添加照片框，可在右侧更换照片。",
    stamp: "已添加邮票。",
    address: "已在背面添加地址线。",
    text: "已添加短句，可在右侧输入文字。",
  };
  activeSide = previousSide;
  commit(result.project, messages[kind] || "已添加元素。", { rebuildInspector: false });
  selectElement(activeSide, result.element.id);
}

function loadExample(kind) {
  const next = kind === "extreme" ? createExtremeProject() : createStandardProject();
  commit(
    next,
    kind === "extreme"
      ? "已载入 90 × 60 mm 极限长文案例。排版检查会验证换行、安全区与最小尺寸。"
      : "已载入标准旅行卡案例。",
    { clearSelection: true },
  );
  activeSide = "front";
  setZoom("fit", 1);
  updateHeaderState();
  preloadProjectImages(project).then(scheduleRender);
}

function deleteSelected() {
  const element = currentElement();
  if (!element) return;
  const next = removeElement(project, selected.side, element.id);
  selected = null;
  commit(next, "元素已删除，可撤销恢复。", { rebuildInspector: true });
}

function nudgeSelected(dx, dy) {
  const element = currentElement();
  if (!element) return;
  const next = updateElement(project, selected.side, selected.id, (draft) => {
    draft.x = Math.round((draft.x + dx) * 10) / 10;
    draft.y = Math.round((draft.y + dy) * 10) / 10;
  });
  commit(next, "", { rebuildInspector: true });
}

function beginCanvasInteraction(event) {
  if (event.button !== 0) return;
  const point = pointFromEvent(event);
  lastPointer = point;
  if (!point) {
    selected = null;
    renderInspector();
    scheduleRender();
    return;
  }
  activeSide = point.side;
  const element = hitElement(point.side, point.x, point.y);
  if (!element) {
    selected = null;
    updateHeaderState();
    renderInspector();
    scheduleRender();
    return;
  }
  selectElement(point.side, element.id);
  drag = {
    side: point.side,
    id: element.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    origin: { x: element.x, y: element.y },
    before: deepClone(project),
    moved: false,
  };
  dom.canvas.setPointerCapture?.(event.pointerId);
  dom.canvas.classList.add("is-dragging");
}

function moveCanvasInteraction(event) {
  const point = pointFromEvent(event);
  lastPointer = point;
  if (!drag) {
    if (point) {
      const hover = hitElement(point.side, point.x, point.y);
      dom.canvas.classList.toggle("can-drag", Boolean(hover));
    } else {
      dom.canvas.classList.remove("can-drag");
    }
    return;
  }
  const bounds = dom.canvas.getBoundingClientRect();
  const sheet = getSheetLayout(project.width, project.height);
  const dx = ((event.clientX - drag.startClientX) / bounds.width) * sheet.width;
  const dy = ((event.clientY - drag.startClientY) / bounds.height) * sheet.height;
  if (Math.abs(dx) + Math.abs(dy) < 0.1) return;
  drag.moved = true;
  const target = findElement(project, drag.side, drag.id);
  if (!target) return;
  target.x = Math.round((drag.origin.x + dx) * 10) / 10;
  target.y = Math.round((drag.origin.y + dy) * 10) / 10;
  scheduleRender();
  const xInput = dom.inspectorContent.querySelector('[data-change-field="x"]');
  const yInput = dom.inspectorContent.querySelector('[data-change-field="y"]');
  if (xInput) xInput.value = target.x.toFixed(1);
  if (yInput) yInput.value = target.y.toFixed(1);
}

function endCanvasInteraction(event) {
  dom.canvas.classList.remove("is-dragging");
  if (drag?.moved) {
    const before = drag.before;
    drag = null;
    finishLiveMutation(before, "位置已更新，可撤销。");
  } else {
    drag = null;
    scheduleRender();
  }
  if (event?.pointerId != null && dom.canvas.hasPointerCapture?.(event.pointerId)) {
    dom.canvas.releasePointerCapture(event.pointerId);
  }
}

function focusSelectedText() {
  const element = currentElement();
  if (!element) return;
  requestAnimationFrame(() => {
    const field = dom.inspectorContent.querySelector("textarea[data-live-field='text'], input[data-live-field='text']");
    field?.focus();
    if (field?.select && field.tagName === "TEXTAREA") {
      field.setSelectionRange(field.value.length, field.value.length);
    }
  });
}

function bindEvents() {
  dom.undoBtn.addEventListener("click", undo);
  dom.redoBtn.addEventListener("click", redo);
  dom.saveBtn.addEventListener("click", () => saveToStorage());
  dom.loadBtn.addEventListener("click", loadProjectFromSaved);
  $("#restoreSavedBtn").addEventListener("click", loadProjectFromSaved);
  $("#downloadProjectBtn").addEventListener("click", () => {
    downloadProjectFile(project, serializeProject);
    showToast("项目文件已下载，包含当前全部可编辑元素。", "success");
  });
  $("#importProjectBtn").addEventListener("click", () => dom.projectFileInput.click());
  dom.exportBtn.addEventListener("click", runExport);
  dom.exportTop.addEventListener("click", runExport);

  $$(".preset-card").forEach((button) => {
    button.addEventListener("click", () => changePreset(button.dataset.preset));
  });
  $("#landscapeBtn").addEventListener("click", () => changeOrientation("landscape"));
  $("#portraitBtn").addEventListener("click", () => changeOrientation("portrait"));
  $$("[data-add]").forEach((button) => {
    button.addEventListener("click", () => addFromToolbar(button.dataset.add));
  });
  $("#standardExampleBtn").addEventListener("click", () => loadExample("standard"));
  $("#extremeExampleBtn").addEventListener("click", () => loadExample("extreme"));

  dom.guidesToggle.addEventListener("change", scheduleRender);
  $("#zoomInBtn").addEventListener("click", () => {
    zoomFactor = Math.min(3, (zoomMode === "fit" ? 1 : zoomFactor) * 1.2);
    setZoom("manual", zoomFactor);
  });
  $("#zoomOutBtn").addEventListener("click", () => {
    zoomFactor = Math.max(0.5, (zoomMode === "fit" ? 1 : zoomFactor) / 1.2);
    setZoom("manual", zoomFactor);
  });
  $("#zoomFitBtn").addEventListener("click", () => setZoom("fit", 1));

  dom.projectName.addEventListener("input", () => {
    const next = deepClone(project);
    next.name = dom.projectName.value || "未命名明信片";
    commit(next, "", { rebuildInspector: false });
  });

  dom.inspectorContent.addEventListener("input", (event) => {
    if (event.target.matches("[data-live-field]")) applyLiveField(event.target);
  });
  dom.inspectorContent.addEventListener("change", (event) => {
    if (event.target.matches("[data-change-field]")) applyGeometryField(event.target);
  });
  dom.inspectorContent.addEventListener("click", handleInspectorClick);

  dom.imageFileInput.addEventListener("change", async () => {
    const file = dom.imageFileInput.files?.[0];
    dom.imageFileInput.value = "";
    if (file) await loadPhoto(file);
  });
  dom.projectFileInput.addEventListener("change", async () => {
    const file = dom.projectFileInput.files?.[0];
    dom.projectFileInput.value = "";
    if (file) await importProjectFile(file);
  });

  dom.issueList.addEventListener("click", (event) => {
    const button = event.target.closest(".issue-item");
    if (!button) return;
    const side = button.dataset.side;
    const id = button.dataset.id;
    if (id && (side === "front" || side === "back")) {
      selectElement(side, id, { reveal: true });
    }
  });

  dom.canvas.addEventListener("pointerdown", beginCanvasInteraction);
  dom.canvas.addEventListener("pointermove", moveCanvasInteraction);
  dom.canvas.addEventListener("pointerup", endCanvasInteraction);
  dom.canvas.addEventListener("pointercancel", endCanvasInteraction);
  dom.canvas.addEventListener("pointerleave", () => {
    if (!drag) dom.canvas.classList.remove("can-drag");
  });
  dom.canvas.addEventListener("dblclick", (event) => {
    const point = pointFromEvent(event);
    if (!point) return;
    const element = hitElement(point.side, point.x, point.y);
    if (!element) return;
    selectElement(point.side, element.id);
    focusSelectedText();
  });

  $("#closeErrorDialogBtn").addEventListener("click", () => dom.errorDialog.close());
  $("#dialogFixBtn").addEventListener("click", () => {
    dom.errorDialog.close();
    const first = validation?.errors.find((issue) => issue.elementId);
    if (first) selectElement(first.side, first.elementId, { reveal: true });
  });

  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", updateCanvasSize);
  const resizeObserver = new ResizeObserver(() => updateCanvasSize());
  resizeObserver.observe(dom.canvasScroll);
}

function handleKeydown(event) {
  const target = event.target;
  const editing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveToStorage();
    return;
  }
  if (dom.errorDialog.open) {
    if (event.key === "Escape") dom.errorDialog.close();
    return;
  }
  if (editing) return;
  if ((event.key === "Delete" || event.key === "Backspace") && selected) {
    event.preventDefault();
    deleteSelected();
    return;
  }
  if (event.key === "Escape" && selected) {
    selected = null;
    renderInspector();
    scheduleRender();
    return;
  }
  if (selected && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    const step = event.shiftKey ? 2 : 0.5;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    nudgeSelected(dx, dy);
  }
}

function init() {
  project = initialProject();
  bindEvents();
  updateHeaderState();
  updateHistoryButtons();
  renderInspector();
  refreshChecks();
  updateCanvasSize();
  if (restoredFromStorage) {
    setSaveStatus("已恢复本机保存");
    showToast("已恢复上次自动保存的项目。所有元素仍可编辑。", "success");
  } else if (storageLoadFailed) {
    setSaveStatus("未覆盖损坏存档", "error");
  } else {
    setSaveStatus("本机自动保存");
    scheduleSave();
  }
  preloadProjectImages(project).then(scheduleRender);
  if (document.fonts) {
    Promise.all([
      document.fonts.load('400 16px "Postcard Sans"', "明信片"),
      document.fonts.load('600 16px "Postcard Serif"', "明信片"),
      document.fonts.load('400 16px "Postcard Mono"', "POSTCARD"),
    ])
      .then(() => document.fonts.ready)
      .then(() => {
        renderInspector();
        refreshChecks();
        scheduleRender();
      })
      .catch(() => {});
  }
}

init();
