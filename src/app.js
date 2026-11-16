import { buildSvg, downloadBlob, renderPngBlob, safeFilename } from "./exporter.js";
import {
  createExtremeProject,
  createStandardProject,
  getActiveScheme,
  normalizeProject,
  projectFingerprint,
  STORAGE_KEY
} from "./model.js";
import {
  applyPaletteRule,
  normalizeHex,
  setPaletteLock,
  setPrimaryColor
} from "./palette.js";
import {
  buildScene,
  paintCanvasTiledPreview,
  paintCanvasTile
} from "./render.js";
import { buildSchemeCards, buildSidebarMarkup } from "./sidebar.js";
import { clamp, escapeHtml, formatNumber } from "./utils.js";
import { firstErrorInstruction, validateScene } from "./validation.js";

const dom = {
  projectName: document.querySelector("#projectName"),
  sidebarSections: document.querySelector("#sidebarSections"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  saveButton: document.querySelector("#saveButton"),
  reloadButton: document.querySelector("#reloadButton"),
  exportSvgButton: document.querySelector("#exportSvgButton"),
  exportPngButton: document.querySelector("#exportPngButton"),
  saveStatus: document.querySelector("#saveStatus"),
  saveStatusText: document.querySelector("#saveStatusText"),
  activeSchemeName: document.querySelector("#activeSchemeName"),
  tileDimensionLabel: document.querySelector("#tileDimensionLabel"),
  validationSummary: document.querySelector("#validationSummary"),
  zoomRange: document.querySelector("#zoomRange"),
  zoomOutput: document.querySelector("#zoomOutput"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  fitButton: document.querySelector("#fitButton"),
  tileStage: document.querySelector("#tileStage"),
  tileCanvas: document.querySelector("#tileCanvas"),
  previewStage: document.querySelector("#previewStage"),
  previewCanvas: document.querySelector("#previewCanvas"),
  showSeams: document.querySelector("#showSeams"),
  previewNote: document.querySelector("#previewNote"),
  lockFooterState: document.querySelector("#lockFooterState"),
  footerScheme: document.querySelector("#footerScheme"),
  historyCount: document.querySelector("#historyCount"),
  toastRegion: document.querySelector("#toastRegion")
};

const measureCanvas = document.createElement("canvas");
const measureContext = measureCanvas.getContext("2d");

function measureText(text, font) {
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

function getByPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setByPath(object, path, value) {
  const keys = path.split(".");
  let cursor = object;
  keys.slice(0, -1).forEach((key) => {
    cursor = cursor[key];
  });
  cursor[keys.at(-1)] = value;
}

function loadSavedProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { project: createStandardProject(), saved: false };
    return { project: normalizeProject(JSON.parse(raw)), saved: true };
  } catch (error) {
    return {
      project: createStandardProject(),
      saved: false,
      error: "本机保存数据无法读取。已载入标准案例，原数据未覆盖；请检查后重新保存。"
    };
  }
}

const initial = loadSavedProject();
let project = initial.project;
let lastSavedAt = project.updatedAt || null;
let savedFingerprint = initial.saved ? projectFingerprint(project) : null;
let report = null;
let scene = null;
let renderQueued = false;
let editBaseline = null;
let savedStatusMessage = initial.saved ? "已载入本机保存" : "尚未保存";

const history = {
  past: [],
  future: [],
  limit: 60
};

function setSavedStatus(message) {
  savedStatusMessage = message;
  updateDirtyStatus();
}

function updateDirtyStatus() {
  const dirty = savedFingerprint === null || projectFingerprint(project) !== savedFingerprint;
  dom.saveStatus.dataset.state = dirty ? "dirty" : "saved";
  if (dirty) {
    dom.saveStatusText.textContent = "有未保存修改";
  } else if (initial.error && !lastSavedAt) {
    dom.saveStatus.dataset.state = "error";
    dom.saveStatusText.textContent = "保存读取失败";
  } else {
    const time = lastSavedAt
      ? new Date(lastSavedAt).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit"
        })
      : "";
    dom.saveStatusText.textContent = time ? `已保存 ${time}` : savedStatusMessage;
  }
}

function beginEdit(source) {
  if (editBaseline) return;
  editBaseline = {
    source,
    state: JSON.parse(JSON.stringify(project))
  };
}

function commitEdit() {
  if (!editBaseline) return false;
  const before = editBaseline.state;
  editBaseline = null;
  if (projectFingerprint(before) === projectFingerprint(project)) return false;
  history.past.push(before);
  if (history.past.length > history.limit) history.past.shift();
  history.future = [];
  updateHistoryControls();
  updateDirtyStatus();
  return true;
}

function pushHistory(before) {
  if (projectFingerprint(before) === projectFingerprint(project)) return;
  history.past.push(before);
  if (history.past.length > history.limit) history.past.shift();
  history.future = [];
  updateHistoryControls();
  updateDirtyStatus();
}

function applyChange(mutator, label) {
  commitEdit();
  const before = JSON.parse(JSON.stringify(project));
  mutator(project);
  project.updatedAt = new Date().toISOString();
  pushHistory(before);
  renderSoon();
  return label;
}

function replaceProject(next, { clearHistory = false } = {}) {
  commitEdit();
  const before = JSON.parse(JSON.stringify(project));
  project = normalizeProject(next);
  if (clearHistory) {
    history.past = [];
    history.future = [];
  } else {
    pushHistory(before);
  }
  syncControls();
  renderNow();
}

function undo() {
  commitEdit();
  if (!history.past.length) return;
  history.future.unshift(JSON.parse(JSON.stringify(project)));
  project = history.past.pop();
  editBaseline = null;
  syncControls();
  renderNow();
  updateHistoryControls();
  updateDirtyStatus();
  toast("已撤销上一步。", "info", 1800);
}

function redo() {
  commitEdit();
  if (!history.future.length) return;
  history.past.push(JSON.parse(JSON.stringify(project)));
  project = history.future.shift();
  editBaseline = null;
  syncControls();
  renderNow();
  updateHistoryControls();
  updateDirtyStatus();
  toast("已重做。", "info", 1800);
}

function updateHistoryControls() {
  dom.undoButton.disabled = history.past.length === 0;
  dom.redoButton.disabled = history.future.length === 0;
  dom.historyCount.textContent = `${history.past.length} / ${history.future.length}`;
}

function toast(message, kind = "info", duration = 4200) {
  const item = document.createElement("div");
  item.className = "toast";
  item.dataset.kind = kind;
  item.textContent = message;
  dom.toastRegion.append(item);
  window.setTimeout(() => {
    item.dataset.leaving = "true";
    window.setTimeout(() => item.remove(), 180);
  }, duration);
}

function currentScheme() {
  return getActiveScheme(project);
}

function renderSoon() {
  if (renderQueued) return;
  renderQueued = true;
  window.requestAnimationFrame(() => {
    renderQueued = false;
    renderNow();
  });
}

function renderNow() {
  scene = buildScene(project, currentScheme(), measureText);
  report = validateScene(project, scene);
  renderTile();
  renderPreview();
  renderMeta();
  renderValidation();
  updateDirtyStatus();
  updateHistoryControls();
}

function renderTile() {
  const zoom = project.canvas.zoom / 100;
  const cssWidth = Math.max(80, project.canvas.width * zoom);
  const cssHeight = Math.max(80, project.canvas.height * zoom);
  paintCanvasTile(dom.tileCanvas, scene, {
    cssWidth,
    cssHeight,
    dpr: Math.min(window.devicePixelRatio || 1, 2.5)
  });
}

function renderPreview() {
  const available =
    dom.previewStage.clientWidth > 40 ? dom.previewStage.clientWidth - 42 : 500;
  const maxWidth = Math.min(560, Math.max(180, available));
  const ratio = project.canvas.height / project.canvas.width;
  paintCanvasTiledPreview(dom.previewCanvas, scene, {
    cssWidth: maxWidth,
    cssHeight: maxWidth * ratio,
    tiles: 3,
    showSeams: project.canvas.showSeams,
    dpr: Math.min(window.devicePixelRatio || 1, 2.5)
  });
}

function issueSummary() {
  if (!report) return { text: "检查中", state: "ok" };
  if (report.errors.length) {
    return {
      text: `${report.errors.length} 个阻塞错误`,
      state: "error"
    };
  }
  if (report.warnings.length) {
    return {
      text: `${report.warnings.length} 个提醒`,
      state: "warning"
    };
  }
  return { text: "排版检查通过", state: "ok" };
}

function renderMeta() {
  const scheme = currentScheme();
  dom.activeSchemeName.textContent = scheme.name;
  dom.tileDimensionLabel.textContent = `${project.canvas.width} × ${project.canvas.height} px`;
  dom.lockFooterState.textContent = project.palette.locked ? "已开启" : "已关闭";
  dom.footerScheme.textContent = scheme.name;
  dom.zoomRange.value = project.canvas.zoom;
  dom.zoomOutput.textContent = `${project.canvas.zoom}%`;
  dom.showSeams.checked = project.canvas.showSeams;
  dom.previewNote.textContent = project.canvas.showSeams
    ? "3 × 3 连续铺贴；虚线仅用于定位，不会进入导出文件。"
    : "3 × 3 连续铺贴；底色与图形在接缝两侧共用同一坐标。";
  const summary = issueSummary();
  dom.validationSummary.dataset.state = summary.state;
  dom.validationSummary.textContent = summary.text;
}

function renderValidation() {
  const panel = document.querySelector("#validationPanel");
  if (!panel || !report) return;
  document.querySelectorAll("[data-invalid]").forEach((input) => {
    input.removeAttribute("data-invalid");
  });
  if (!report.issues.length) {
    panel.innerHTML = `
      <div class="validation-ok">
        安全边距、中心图形留白和画布裁切均通过。SVG 与 PNG 可安全导出。
      </div>`;
    return;
  }
  panel.innerHTML = `
    <ul class="issue-list">
      ${report.issues
        .map(
          (item) => `
            <li class="issue-item" data-severity="${item.severity}" data-focus-field="${escapeHtml(
              item.fields[0] || ""
            )}" tabindex="0">
              <div class="issue-title"><span>${item.severity === "error" ? "!" : "△"}</span>${escapeHtml(
                item.title
              )}</div>
              <p class="issue-detail">${escapeHtml(item.detail)}</p>
              <p class="issue-fix">修复：${escapeHtml(item.fix)}</p>
            </li>`
        )
        .join("")}
    </ul>`;
  const fields = new Set(report.errors.flatMap((item) => item.fields));
  fields.forEach((field) => {
    const targets = document.querySelectorAll(`[data-field="${field}"]`);
    targets.forEach((target) => target.setAttribute("data-invalid", "true"));
  });
}

function syncRangeOutput(input) {
  const output = document.querySelector(`[data-output-for="${input.dataset.field}"]`);
  if (!output) return;
  const scale = Number(input.dataset.valueScale) || 1;
  const value = Number(input.value) / scale;
  output.value = scale === 100 ? `${formatNumber(value, 2)}` : formatNumber(value, 0);
  output.textContent = output.value;
}

function syncControls() {
  dom.projectName.value = project.name;
  document.querySelectorAll("[data-field]").forEach((control) => {
    const field = control.dataset.field;
    if (field.startsWith("palette.schemes.")) return;
    const value = getByPath(project, field);
    if (control.type === "checkbox") {
      control.checked = Boolean(value);
      return;
    }
    if (!control.matches("[data-scheme-index]")) {
      const scale = Number(control.dataset.valueScale) || 1;
      const next = control.type === "range" ? Number(value) * scale : value;
      if (document.activeElement !== control || control.value !== String(next)) {
        control.value = next;
      }
    }
    if (control.type === "range") syncRangeOutput(control);
  });
  syncSchemeControls();
  updateHistoryControls();
}

function syncSchemeControls() {
  document.querySelectorAll("[data-scheme-card]").forEach((card) => {
    const index = Number(card.dataset.schemeCard);
    const scheme = project.palette.schemes[index];
    const active = index === project.palette.active;
    card.dataset.active = String(active);
    const selector = card.querySelector("[data-scheme-activate]");
    selector?.setAttribute("aria-pressed", String(active));
    card.querySelectorAll("[data-color-role]").forEach((input) => {
      const role = input.dataset.colorRole;
      if (document.activeElement !== input) input.value = scheme.colors[role];
      const wrapper = input.closest(".color-field");
      if (wrapper) wrapper.dataset.locked = String(role === "primary" && project.palette.locked);
    });
  });
  document.querySelector("#paletteLock").checked = project.palette.locked;
}

function controlLabel(control) {
  const field = control.closest(".field");
  const label = field?.querySelector(":scope > span");
  if (label?.textContent) return label.textContent.trim();
  const checkboxLabel = control.closest("label")?.textContent?.trim();
  return checkboxLabel || control.dataset.field;
}

function restoreControl(control) {
  const scale = Number(control.dataset.valueScale) || 1;
  const value = getByPath(project, control.dataset.field);
  if (control.type === "checkbox") control.checked = Boolean(value);
  else control.value = control.type === "range" ? Number(value) * scale : value;
  if (control.type === "range") syncRangeOutput(control);
  control.removeAttribute("data-invalid");
}

function readControlValue(control) {
  const scale = Number(control.dataset.valueScale) || 1;
  if (control.type === "checkbox") return Boolean(control.checked);
  if (control.tagName === "SELECT") return control.value;
  if (control.type === "range" || control.type === "number") {
    const raw = Number(control.value);
    if (!Number.isFinite(raw)) return { error: "请输入有效数值" };
    const min = control.min === "" ? -Infinity : Number(control.min) / scale;
    const max = control.max === "" ? Infinity : Number(control.max) / scale;
    if (raw / scale < min || raw / scale > max) {
      return {
        error: `数值需在 ${formatNumber(min, 2)}–${formatNumber(max, 2)} 之间`
      };
    }
    return raw / scale;
  }
  return control.value;
}

function applyDataControl(control, announceError = false, restoreInvalid = true) {
  const field = control.dataset.field;
  if (!field) return false;
  const value = readControlValue(control);
  if (value && typeof value === "object" && value.error) {
    if (announceError) {
      toast(
        `${controlLabel(control)}${value.error}。本次修改未应用，原有内容已保留。`,
        "error"
      );
    }
    if (restoreInvalid) restoreControl(control);
    else control.setAttribute("data-invalid", "true");
    return false;
  }
  if (field === "palette.locked") {
    setPaletteLock(project, value);
  } else if (field === "canvas.width") {
    project.canvas.width = Math.round(value);
    project.canvas.height = Math.round(value);
  } else {
    setByPath(project, field, value);
  }
  project.updatedAt = new Date().toISOString();
  if (field.startsWith("palette.")) syncSchemeControls();
  renderSoon();
  return true;
}

function applyColorControl(input) {
  const index = Number(input.dataset.schemeIndex);
  const role = input.dataset.colorRole;
  const scheme = project.palette.schemes[index];
  if (!scheme || !role) return;
  const color = normalizeHex(input.value);
  scheme.colors[role] = color;
  if (role === "primary") setPrimaryColor(project, index, color);
  project.updatedAt = new Date().toISOString();
  syncSchemeControls();
  renderSoon();
}

function activateScheme(index) {
  if (project.palette.active === index) return;
  applyChange((draft) => {
    draft.palette.active = index;
  }, "切换配色");
  syncSchemeControls();
}

function applyRule() {
  applyChange((draft) => {
    applyPaletteRule(draft);
  }, "应用配色规则");
  syncControls();
  renderNow();
  toast(`已按“${currentRuleLabel()}”替换其余颜色${project.palette.locked ? "，主色保持锁定" : ""}。`, "success");
}

function currentRuleLabel() {
  const labels = {
    analogous: "邻近色",
    complementary: "互补色",
    monochrome: "同色明度"
  };
  return labels[project.palette.rule] || "邻近色";
}

function focusValidationField(field) {
  if (!field) return;
  let target = document.querySelector(`[data-field="${field}"]`);
  if (!target && field === "canvas.height") {
    target = document.querySelector('[data-field="canvas.width"]');
  }
  if (!target) return;
  const details = target.closest("details");
  if (details) details.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target.focus(), 180);
}

function showValidationDetails() {
  const panel = document.querySelector("#validationPanel");
  const details = panel?.closest("details");
  if (details) details.open = true;
  document.querySelector("#sidebarSections")?.scrollIntoView({ behavior: "smooth" });
  details?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function blockedExportMessage(format) {
  const detail = firstErrorInstruction(report);
  toast(
    `${format} 导出已取消；当前输入和画布内容均保留。${detail || "请先修复排版错误。"}`,
    "error",
    7000
  );
  if (report?.errors?.[0]?.fields?.[0]) {
    focusValidationField(report.errors[0].fields[0]);
  }
  showValidationDetails();
}

function ensureExportable(format) {
  if (!report) renderNow();
  if (report.hasErrors) {
    blockedExportMessage(format);
    return false;
  }
  return true;
}

function exportSvg() {
  commitEdit();
  renderNow();
  if (!ensureExportable("SVG")) return;
  try {
    const svg = buildSvg(project, currentScheme(), measureText);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("SVG 结构校验失败。");
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, `${safeFilename(project.name)}-${currentScheme().id}.svg`);
    toast("SVG 已导出，文字和图形节点仍可编辑。", "success");
  } catch (error) {
    toast(`SVG 导出失败：${error.message} 已保留当前内容，请重新导出或调整文字。`, "error", 6000);
  }
}

async function exportPng() {
  commitEdit();
  renderNow();
  if (!ensureExportable("PNG")) return;
  dom.exportPngButton.disabled = true;
  try {
    const blob = await renderPngBlob(project, currentScheme(), measureText, 1);
    downloadBlob(blob, `${safeFilename(project.name)}-${currentScheme().id}.png`);
    toast("PNG 已按单元尺寸导出，与当前预览使用同一场景。", "success");
  } catch (error) {
    toast(`PNG 导出失败：${error.message} 已保留当前内容，请重试。`, "error", 6000);
  } finally {
    dom.exportPngButton.disabled = false;
  }
}

function saveProject() {
  commitEdit();
  try {
    project.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    lastSavedAt = project.updatedAt;
    savedFingerprint = projectFingerprint(project);
    updateDirtyStatus();
    toast(
      `工程已保存。主色锁定${project.palette.locked ? "保持开启" : "当前关闭"}，重新载入后会恢复。`,
      "success"
    );
  } catch (error) {
    dom.saveStatus.dataset.state = "error";
    dom.saveStatusText.textContent = "保存失败";
    toast(
      `保存失败：${error.message}。当前编辑内容仍在页面中，请清理浏览器存储空间后重试。`,
      "error",
      7000
    );
  }
}

function reloadProject() {
  commitEdit();
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    toast(`无法读取本机保存：${error.message}。当前内容未改动。`, "error");
    return;
  }
  if (!raw) {
    toast("尚未找到本机保存。请先点击“保存”，当前内容不会被改动。", "warning");
    return;
  }
  try {
    const next = normalizeProject(JSON.parse(raw));
    const dirty = savedFingerprint === null || projectFingerprint(project) !== savedFingerprint;
    if (
      dirty &&
      !window.confirm("重新载入会丢弃尚未保存的修改。当前内容仍可先取消并保存。继续载入吗？")
    ) {
      return;
    }
    replaceProject(next, { clearHistory: true });
    lastSavedAt = next.updatedAt;
    savedFingerprint = projectFingerprint(project);
    setSavedStatus("已载入本机保存");
    renderNow();
    toast(
      `已重新载入。主色锁定${
        project.palette.locked ? "开启" : "关闭"
      }，当前主色 ${currentScheme().colors.primary}。`,
      "success"
    );
  } catch (error) {
    toast(
      `重新载入失败：${error.message}。当前编辑内容未改动；请确认保存数据完整后重试。`,
      "error",
      7000
    );
  }
}

function loadPreset(kind) {
  commitEdit();
  const next = kind === "extreme" ? createExtremeProject() : createStandardProject();
  replaceProject(next);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(fitCanvasIfNeeded);
  });
  const errorCount = report?.errors.length || 0;
  if (kind === "extreme") {
    toast(
      `已载入 96px 极端长文本案例。输入内容全部保留在编辑器中，当前检测到 ${errorCount} 个阻塞错误，请查看“排版检查”。`,
      errorCount ? "warning" : "success",
      7000
    );
  } else {
    toast("已载入 512px 标准案例，文字完整位于安全边距内。", "success");
  }
}

function setZoom(value) {
  project.canvas.zoom = Math.round(clamp(value, 25, 300));
  renderTile();
  renderMeta();
}

function fitCanvas() {
  const availableWidth = Math.max(120, dom.tileStage.clientWidth - 44);
  const availableHeight = Math.max(120, dom.tileStage.clientHeight - 44);
  const ratio = project.canvas.height / project.canvas.width;
  const fitted = Math.min(
    availableWidth / project.canvas.width,
    availableHeight / (project.canvas.width * ratio)
  );
  setZoom(fitted * 100);
}

function fitCanvasIfNeeded() {
  const availableWidth = dom.tileStage.clientWidth - 44;
  const renderedWidth = (project.canvas.width * project.canvas.zoom) / 100;
  if (availableWidth > 0 && renderedWidth > availableWidth) fitCanvas();
}

function bindEvents() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const control = event.target.closest("input, select, textarea");
      if (control) beginEdit(control);
    },
    true
  );
  document.addEventListener("focusin", (event) => {
    if (event.target.matches("input, select, textarea")) beginEdit(event.target);
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("[data-scheme-index][data-color-role]")) {
      applyColorControl(target);
      return;
    }
    if (target.matches("[data-field]")) {
      if (target.type === "range") syncRangeOutput(target);
      if (target.type !== "checkbox" && target.tagName !== "SELECT") {
        applyDataControl(target, false, false);
      }
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-scheme-index][data-color-role]")) {
      applyColorControl(target);
      commitEdit();
      return;
    }
    if (target.matches("[data-field]")) {
      applyDataControl(target, true, true);
      commitEdit();
    }
  });

  document.addEventListener("focusout", (event) => {
    if (event.target.matches("input, select, textarea")) commitEdit();
  });

  dom.sidebarSections.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-preset]");
    if (preset) {
      loadPreset(preset.dataset.preset);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (action?.dataset.action === "apply-palette-rule") {
      applyRule();
      return;
    }
    const issue = event.target.closest("[data-focus-field]");
    if (issue) {
      focusValidationField(issue.dataset.focusField);
      return;
    }
    const schemeButton = event.target.closest("[data-scheme-activate]");
    if (schemeButton) activateScheme(Number(schemeButton.dataset.schemeActivate));
  });

  dom.sidebarSections.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const issue = event.target.closest("[data-focus-field]");
    if (issue) {
      event.preventDefault();
      focusValidationField(issue.dataset.focusField);
    }
  });

  dom.undoButton.addEventListener("click", undo);
  dom.redoButton.addEventListener("click", redo);
  dom.saveButton.addEventListener("click", saveProject);
  dom.reloadButton.addEventListener("click", reloadProject);
  dom.exportSvgButton.addEventListener("click", exportSvg);
  dom.exportPngButton.addEventListener("click", exportPng);

  dom.validationSummary.addEventListener("click", showValidationDetails);
  dom.zoomRange.addEventListener("input", () => setZoom(Number(dom.zoomRange.value)));
  dom.zoomOutButton.addEventListener("click", () => setZoom(project.canvas.zoom - 10));
  dom.zoomInButton.addEventListener("click", () => setZoom(project.canvas.zoom + 10));
  dom.fitButton.addEventListener("click", fitCanvas);

  document.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (key === "y") {
      event.preventDefault();
      redo();
    } else if (key === "s") {
      event.preventDefault();
      saveProject();
    }
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      renderPreview();
      renderMeta();
    }, 100);
  });
}

function initialize() {
  dom.sidebarSections.innerHTML = buildSidebarMarkup(project);
  bindEvents();
  syncControls();
  renderNow();
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(fitCanvasIfNeeded);
  });
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => renderNow());
  }
  document.fonts?.addEventListener?.("loadingdone", () => renderNow());
  if (initial.error) toast(initial.error, "error", 8000);
  else if (initial.saved) {
    toast(
      `已恢复本机保存。主色锁定${project.palette.locked ? "开启" : "关闭"}，主色 ${
        currentScheme().colors.primary
      }。`,
      "success",
      4800
    );
  }
}

initialize();
