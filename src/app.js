import {
  CASES,
  PALETTES,
  SIZE_PRESETS,
  cloneDesign,
  createDesign,
  getSizePreset,
} from "./constants.js";
import { hitTest, createTextMeasurer, renderCoverCanvas } from "./canvas.js";
import { loadFontEmbed } from "./font-embed.js";
import { History } from "./history.js";
import {
  clampNormalizedPosition,
  computeLayout,
} from "./layout.js";
import {
  loadFromLocalStorage,
  saveToLocalStorage,
} from "./storage.js";
import { designToSvg } from "./svg.js";
import {
  hasBlockingErrors,
  issueCounts,
  validateDesign,
} from "./validation.js";

const $ = (id) => document.getElementById(id);
const elements = {
  title: $("titleInput"),
  author: $("authorInput"),
  background: $("backgroundInput"),
  ink: $("inkInput"),
  accent: $("accentInput"),
  paletteList: $("paletteList"),
  sizePreset: $("sizePreset"),
  width: $("widthInput"),
  height: $("heightInput"),
  columns: $("columnsInput"),
  rows: $("rowsInput"),
  margin: $("marginInput"),
  columnsOutput: $("columnsOutput"),
  rowsOutput: $("rowsOutput"),
  marginOutput: $("marginOutput"),
  showGrid: $("showGridInput"),
  showSafe: $("showSafeInput"),
  font: $("fontInput"),
  titleScale: $("titleScaleInput"),
  titleScaleOutput: $("titleScaleOutput"),
  lineHeight: $("lineHeightInput"),
  lineHeightOutput: $("lineHeightOutput"),
  letterSpacing: $("letterSpacingInput"),
  letterSpacingOutput: $("letterSpacingOutput"),
  alignButtons: $("alignButtons"),
  autoFit: $("autoFitInput"),
  illustrationStyle: $("illustrationStyle"),
  illustrationScale: $("illustrationScaleInput"),
  illustrationScaleOutput: $("illustrationScaleOutput"),
  titleWidth: $("titleWidthInput"),
  titleWidthOutput: $("titleWidthOutput"),
  titleHeight: $("titleHeightInput"),
  titleHeightOutput: $("titleHeightOutput"),
  canvas: $("coverCanvas"),
  thumb: $("thumbCanvas"),
  canvasStage: $("canvasStage"),
  canvasBezel: document.querySelector(".canvas-bezel"),
  dimensionLabel: $("dimensionLabel"),
  zoomOutput: $("zoomOutput"),
  zoomIn: $("zoomInButton"),
  zoomOut: $("zoomOutButton"),
  zoomFit: $("zoomFitButton"),
  diagnosticsTitle: $("diagnosticsTitle"),
  issueSummary: $("issueSummary"),
  issueList: $("issueList"),
  diagnosticsOk: $("diagnosticsOk"),
  selectionName: $("selectionName"),
  selectionActions: $("selectionActions"),
  selectionHint: $("selectionHint"),
  undo: $("undoButton"),
  redo: $("redoButton"),
  save: $("saveButton"),
  reload: $("reloadButton"),
  exportSvg: $("exportSvgButton"),
  exportPng: $("exportPngButton"),
  saveState: $("saveState"),
  toastRegion: $("toastRegion"),
  caseList: $("caseList"),
};

const restored = loadFromLocalStorage();
let state = restored.ok ? restored.design : createDesign("standard");
let savedSnapshot = restored.ok ? JSON.stringify(state) : null;
let savedAt = restored.ok ? restored.savedAt : null;
let layout = null;
let issues = [];
let selected = null;
let issueElement = null;
let zoom = 0.84;
let drag = null;
let fieldErrorTimer = null;
const history = new History();
const measureText = createTextMeasurer();
const ELEMENT_LABELS = {
  title: "书名",
  author: "作者",
  illustration: "插图",
  canvas: "画布",
};

function requestRender() {
  recompute();
  drawMainCanvas();
  drawThumbnail();
  renderDiagnostics();
  syncControls();
  updateHistoryButtons();
  updateSaveState();
}

function recompute() {
  layout = computeLayout(state, measureText);
  issues = validateDesign(state, layout);
}

function fitDimensions() {
  const stageWidth = Math.max(220, elements.canvasStage.clientWidth - 56);
  const stageHeight = Math.max(260, elements.canvasStage.clientHeight - 56);
  const aspect = layout.width / layout.height;
  const baseWidth = Math.max(80, Math.min(stageWidth, stageHeight * aspect));
  return {
    width: Math.round(baseWidth * zoom),
    height: Math.max(1, Math.round((baseWidth * zoom) / aspect)),
  };
}

function drawMainCanvas() {
  const dimensions = fitDimensions();
  const ratio = Math.min(2.25, window.devicePixelRatio || 1);
  elements.canvas.style.width = `${dimensions.width}px`;
  elements.canvas.style.height = `${dimensions.height}px`;
  renderCoverCanvas(elements.canvas, layout, state, {
    pixelWidth: Math.max(1, dimensions.width * ratio),
    pixelHeight: Math.max(1, dimensions.height * ratio),
    showGuides: true,
    selected,
    issueElement,
  });
}

function drawThumbnail() {
  const ratio = layout.width / layout.height;
  const pixelWidth = Math.max(120, Math.round((layout.width / Math.max(layout.width, layout.height)) * 360));
  renderCoverCanvas(elements.thumb, layout, state, {
    pixelWidth,
    pixelHeight: Math.round(pixelWidth / ratio),
    showGuides: false,
  });
}

function issueNode(item) {
  const node = document.createElement("div");
  node.className = `issue severity-${item.severity}`;
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-label", `${item.title}。${item.fix}`);

  const tag = document.createElement("span");
  tag.className = "issue-tag";
  tag.textContent = `${item.ruleLabel} · ${item.severity === "error" ? "错误" : "提示"}`;

  const body = document.createElement("span");
  body.className = "issue-body";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const detail = document.createElement("p");
  detail.textContent = item.detail;
  const fix = document.createElement("p");
  fix.className = "issue-fix";
  fix.textContent = `修复：${item.fix}`;
  body.append(title, detail, fix);
  node.append(tag, body);

  const openIssue = () => {
    issueElement = item.element === "canvas" ? null : item.element;
    if (issueElement) selected = issueElement;
    requestRender();
    showToast(`${item.ruleLabel}：${item.fix}`);
  };
  node.addEventListener("click", openIssue);
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openIssue();
  });
  return node;
}

function renderDiagnostics() {
  const counts = issueCounts(issues);
  elements.issueList.replaceChildren(...issues.map(issueNode));
  elements.diagnosticsOk.hidden = issues.length > 0;
  elements.issueList.hidden = issues.length === 0;

  if (counts.error) {
    elements.diagnosticsTitle.textContent = `有 ${counts.error} 项会阻止导出`;
    elements.issueSummary.textContent = `${counts.error} 错误${
      counts.warning ? ` · ${counts.warning} 提示` : ""
    }`;
    elements.issueSummary.className = "issue-summary has-errors";
  } else if (counts.warning) {
    elements.diagnosticsTitle.textContent = "可以导出，建议检查提示";
    elements.issueSummary.textContent = `${counts.warning} 提示`;
    elements.issueSummary.className = "issue-summary has-warnings";
  } else {
    elements.diagnosticsTitle.textContent = "排版检查通过";
    elements.issueSummary.textContent = "0 问题";
    elements.issueSummary.className = "issue-summary";
  }
}

function updateHistoryButtons() {
  elements.undo.disabled = !history.canUndo;
  elements.redo.disabled = !history.canRedo;
}

function updateSaveState() {
  const dirty = savedSnapshot !== JSON.stringify(state);
  if (dirty) {
    elements.saveState.textContent = savedSnapshot ? "有未保存更改" : "尚未保存";
    elements.saveState.className = "save-state dirty";
    return;
  }

  elements.saveState.textContent = savedAt
    ? `已保存 ${new Date(savedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "尚未保存";
  elements.saveState.className = "save-state";
}

function syncControls() {
  const active = document.activeElement;
  const setValue = (input, value) => {
    if (input !== active) input.value = value;
  };

  setValue(elements.title, state.title);
  setValue(elements.author, state.author);
  setValue(elements.background, state.theme.background);
  setValue(elements.ink, state.theme.ink);
  setValue(elements.accent, state.theme.accent);
  setValue(elements.sizePreset, state.size.preset);
  setValue(elements.width, state.size.width);
  setValue(elements.height, state.size.height);
  setValue(elements.columns, state.grid.columns);
  setValue(elements.rows, state.grid.rows);
  setValue(elements.margin, Math.round(state.grid.margin * 100));
  elements.showGrid.checked = state.grid.showGrid;
  elements.showSafe.checked = state.grid.showSafe;
  setValue(elements.font, state.typography.font);
  setValue(elements.titleScale, Math.round(state.typography.titleScale * 100));
  setValue(elements.lineHeight, Math.round(state.typography.lineHeight * 100));
  setValue(elements.letterSpacing, state.typography.letterSpacing);
  elements.autoFit.checked = state.typography.autoFit;
  setValue(elements.illustrationStyle, state.illustration.style);
  setValue(elements.illustrationScale, Math.round(state.illustration.scale * 100));
  setValue(elements.titleWidth, Math.round(state.positions.title.w * 100));
  setValue(elements.titleHeight, Math.round(state.positions.title.h * 100));

  elements.columnsOutput.value = state.grid.columns;
  elements.rowsOutput.value = state.grid.rows;
  elements.marginOutput.value = `${Math.round(state.grid.margin * 100)}%`;
  elements.titleScaleOutput.value = `${Math.round(state.typography.titleScale * 100)}%`;
  elements.lineHeightOutput.value = state.typography.lineHeight.toFixed(2);
  elements.letterSpacingOutput.value = `${state.typography.letterSpacing}px`;
  elements.illustrationScaleOutput.value = `${Math.round(state.illustration.scale * 100)}%`;
  elements.titleWidthOutput.value = `${Math.round(state.positions.title.w * 100)}%`;
  elements.titleHeightOutput.value = `${Math.round(state.positions.title.h * 100)}%`;
  elements.dimensionLabel.textContent = `${layout.width} × ${layout.height} px`;
  elements.zoomOutput.value = `${Math.round(zoom * 100)}%`;

  for (const button of elements.alignButtons.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.align === state.typography.align);
  }

  const label = selected ? ELEMENT_LABELS[selected] : null;
  elements.selectionName.textContent = label ? `已选：${label}` : "未选择元素";
  elements.selectionActions.hidden = !selected;
  elements.selectionHint.textContent = selected
    ? "拖动移动，方向键微调；网格开启时按一格吸附。"
    : "点击画布上的文字或插图即可移动。";
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " is-error" : ""}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), type === "error" ? 6500 : 3800);
}

function applyChange(mutator, { label = "编辑", coalesceKey = null } = {}) {
  const before = cloneDesign(state);
  mutator(state);
  history.record(before, { label, coalesceKey });
  issueElement = null;
  requestRender();
}

function setSelected(element) {
  selected = element;
  requestRender();
}

function bindInput(input, handler, eventName = "input") {
  input.addEventListener(eventName, (event) => handler(event.target, event));
}

function showFieldError(input, message) {
  input.setAttribute("aria-invalid", "true");
  input.setCustomValidity(message);
  if (input.dataset.lastFieldError !== message) {
    input.dataset.lastFieldError = message;
    showToast(`${message} 当前封面内容保持不变。`, "error");
  }
  window.clearTimeout(fieldErrorTimer);
  fieldErrorTimer = window.setTimeout(() => {
    delete input.dataset.lastFieldError;
  }, 1800);
}

function clearFieldError(input) {
  input.removeAttribute("aria-invalid");
  input.setCustomValidity("");
  delete input.dataset.lastFieldError;
}

function bindPositiveNumber(input, fieldLabel, mutate) {
  input.addEventListener("input", () => {
    const raw = input.value.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0) {
      showFieldError(input, `${fieldLabel}必须是大于 0 的数字。`);
      return;
    }
    clearFieldError(input);
    applyChange(
      (draft) => {
        mutate(draft, value);
        draft.size.preset = getSizePreset(draft.size.width, draft.size.height);
      },
      { label: `修改${fieldLabel}`, coalesceKey: `number-${input.id}` },
    );
  });

  input.addEventListener("blur", () => {
    if (input.getAttribute("aria-invalid") !== "true") return;
    const fallback = input.id === "widthInput" ? state.size.width : state.size.height;
    input.value = fallback;
    clearFieldError(input);
    showToast(`${fieldLabel}未应用无效值，已恢复为 ${fallback} px。`);
  });
}

function buildPalettes() {
  for (const palette of PALETTES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-swatch";
    button.title = palette.name;
    button.setAttribute("aria-label", `使用${palette.name}配色`);
    for (const color of [palette.background, palette.ink, palette.accent]) {
      const segment = document.createElement("span");
      segment.style.background = color;
      button.append(segment);
    }
    button.addEventListener("click", () => {
      applyChange(
        (draft) => {
          draft.theme.background = palette.background;
          draft.theme.ink = palette.ink;
          draft.theme.accent = palette.accent;
        },
        { label: `配色：${palette.name}` },
      );
      showToast(`已应用“${palette.name}”配色。`);
    });
    elements.paletteList.append(button);
  }
}

function bindControls() {
  bindInput(elements.title, (input) => {
    applyChange((draft) => {
      draft.title = input.value;
    }, { label: "修改书名", coalesceKey: "title" });
  });

  bindInput(elements.author, (input) => {
    applyChange((draft) => {
      draft.author = input.value;
    }, { label: "修改作者", coalesceKey: "author" });
  });

  for (const [input, key] of [
    [elements.background, "background"],
    [elements.ink, "ink"],
    [elements.accent, "accent"],
  ]) {
    bindInput(input, (target) => {
      applyChange(
        (draft) => {
          draft.theme[key] = target.value;
        },
        { label: "修改主题色", coalesceKey: `color-${key}` },
      );
    });
  }

  bindInput(
    elements.sizePreset,
    (input) => {
      if (input.value === "custom") return;
      const preset = SIZE_PRESETS[input.value];
      if (!preset) return;
      applyChange(
        (draft) => {
          draft.size = { preset: input.value, ...preset };
        },
        { label: "切换画布尺寸" },
      );
    },
    "change",
  );

  bindPositiveNumber(elements.width, "画布宽度", (draft, value) => {
    draft.size.width = value;
  });
  bindPositiveNumber(elements.height, "画布高度", (draft, value) => {
    draft.size.height = value;
  });

  bindInput(elements.columns, (input) => {
    applyChange((draft) => {
      draft.grid.columns = Number(input.value);
    }, { label: "调整网格列数", coalesceKey: "grid-columns" });
  });
  bindInput(elements.rows, (input) => {
    applyChange((draft) => {
      draft.grid.rows = Number(input.value);
    }, { label: "调整网格行数", coalesceKey: "grid-rows" });
  });
  bindInput(elements.margin, (input) => {
    applyChange((draft) => {
      draft.grid.margin = Number(input.value) / 100;
    }, { label: "调整安全边距", coalesceKey: "margin" });
  });

  bindInput(
    elements.showGrid,
    (input) => {
      applyChange((draft) => {
        draft.grid.showGrid = input.checked;
      }, { label: "切换网格" });
    },
    "change",
  );
  bindInput(
    elements.showSafe,
    (input) => {
      applyChange((draft) => {
        draft.grid.showSafe = input.checked;
      }, { label: "切换安全边距" });
    },
    "change",
  );

  bindInput(
    elements.font,
    (input) => {
      applyChange((draft) => {
        draft.typography.font = input.value;
      }, { label: "更换字体" });
    },
    "change",
  );
  bindInput(elements.titleScale, (input) => {
    applyChange((draft) => {
      draft.typography.titleScale = Number(input.value) / 100;
    }, { label: "调整书名大小", coalesceKey: "title-scale" });
  });
  bindInput(elements.lineHeight, (input) => {
    applyChange((draft) => {
      draft.typography.lineHeight = Number(input.value) / 100;
    }, { label: "调整行高", coalesceKey: "line-height" });
  });
  bindInput(elements.letterSpacing, (input) => {
    applyChange((draft) => {
      draft.typography.letterSpacing = Number(input.value);
    }, { label: "调整字距", coalesceKey: "letter-spacing" });
  });
  bindInput(
    elements.autoFit,
    (input) => {
      applyChange((draft) => {
        draft.typography.autoFit = input.checked;
      }, { label: "切换标题自动适配" });
    },
    "change",
  );

  elements.alignButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-align]");
    if (!button) return;
    applyChange((draft) => {
      draft.typography.align = button.dataset.align;
    }, { label: "修改文字对齐" });
  });

  bindInput(
    elements.illustrationStyle,
    (input) => {
      applyChange((draft) => {
        draft.illustration.style = input.value;
      }, { label: "更换插图" });
    },
    "change",
  );
  bindInput(elements.illustrationScale, (input) => {
    applyChange((draft) => {
      draft.illustration.scale = Number(input.value) / 100;
    }, { label: "调整插图大小", coalesceKey: "illustration-scale" });
  });
  bindInput(elements.titleWidth, (input) => {
    applyChange((draft) => {
      const width = Number(input.value) / 100;
      draft.positions.title.w = width;
      draft.positions.title.x = Math.min(
        draft.positions.title.x,
        Math.max(0, 1 - width),
      );
    }, { label: "调整标题框宽度", coalesceKey: "title-width" });
  });
  bindInput(elements.titleHeight, (input) => {
    applyChange((draft) => {
      const height = Number(input.value) / 100;
      draft.positions.title.h = height;
      draft.positions.title.y = Math.min(
        draft.positions.title.y,
        Math.max(0, 1 - height),
      );
    }, { label: "调整标题框高度", coalesceKey: "title-height" });
  });
}

function canvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * layout.width,
    y: ((event.clientY - rect.top) / rect.height) * layout.height,
  };
}

function finishDrag(event) {
  if (!drag) return;
  const current = drag;
  drag = null;
  elements.canvas.classList.remove("is-dragging");
  elements.canvasBezel.classList.remove("is-dragging");
  if (elements.canvas.hasPointerCapture?.(event.pointerId)) {
    elements.canvas.releasePointerCapture(event.pointerId);
  }
  if (current.moved) {
    history.record(current.before, { label: `移动${ELEMENT_LABELS[current.element]}` });
    updateHistoryButtons();
    updateSaveState();
  }
}

function bindCanvasInteraction() {
  elements.canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const element = hitTest(layout, canvasPoint(event));
    selected = element;
    issueElement = null;
    if (!element) {
      requestRender();
      return;
    }

    drag = {
      element,
      before: cloneDesign(state),
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: { ...state.positions[element] },
      moved: false,
    };
    elements.canvas.setPointerCapture?.(event.pointerId);
    elements.canvas.classList.add("is-dragging");
    elements.canvasBezel.classList.add("is-dragging");
    requestRender();
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const rect = elements.canvas.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.startClientX) / rect.width) * layout.width;
    const deltaY = ((event.clientY - drag.startClientY) / rect.height) * layout.height;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 0.5) drag.moved = true;

    const next = {
      ...drag.startPosition,
      x: drag.startPosition.x + deltaX / layout.safe.w,
      y: drag.startPosition.y + deltaY / layout.safe.h,
    };
    state.positions[drag.element] = clampNormalizedPosition(
      next,
      state.grid.showGrid ? layout.grid : null,
    );
    requestRender();
  });

  elements.canvas.addEventListener("pointerup", finishDrag);
  elements.canvas.addEventListener("pointercancel", finishDrag);
}

function nudgeSelected(stepX, stepY) {
  if (!selected) return;
  applyChange(
    (draft) => {
      const position = draft.positions[selected];
      position.x += stepX;
      position.y += stepY;
      Object.assign(
        position,
        clampNormalizedPosition(position, null),
      );
    },
    { label: `微调${ELEMENT_LABELS[selected]}`, coalesceKey: `nudge-${selected}` },
  );
}

function undo() {
  const result = history.undo(state);
  if (!result) {
    showToast("没有可撤销的操作。");
    return;
  }
  state = result.state;
  issueElement = null;
  requestRender();
  showToast(`已撤销：${result.label}`);
}

function redo() {
  const result = history.redo(state);
  if (!result) {
    showToast("没有可重做的操作。");
    return;
  }
  state = result.state;
  issueElement = null;
  requestRender();
  showToast(`已重做：${result.label}`);
}

function saveProject() {
  const result = saveToLocalStorage(state);
  if (!result.ok) {
    showToast(result.error, "error");
    return;
  }
  savedSnapshot = JSON.stringify(state);
  savedAt = result.savedAt;
  updateSaveState();
  showToast("项目已保存到本机，可随时点击“重新载入”。");
}

function reloadProject() {
  const loaded = loadFromLocalStorage();
  if (!loaded.ok) {
    showToast(loaded.error, "error");
    return;
  }

  const before = cloneDesign(state);
  state = loaded.design;
  savedSnapshot = JSON.stringify(state);
  savedAt = loaded.savedAt;
  selected = null;
  issueElement = null;
  history.record(before, { label: "重新载入项目" });
  requestRender();
  showToast("已重新载入最近保存的项目。");
}

function blockExport(action) {
  const errors = issues.filter((item) => item.severity === "error");
  if (!errors.length) return false;
  const first = errors[0];
  if (first.element !== "canvas") {
    selected = first.element;
    issueElement = first.element;
  }
  requestRender();
  const count = errors.length > 1 ? `另有 ${errors.length - 1} 项错误。` : "";
  showToast(
    `无法${action}：${first.title}。${first.detail} 修复：${first.fix}${count}`,
    "error",
  );
  return true;
}

function safeFileName(design = state) {
  const base = String(design.title || "book-cover")
    .trim()
    .slice(0, 48)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-");
  return base || "book-cover";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportSvg() {
  recompute();
  if (blockExport("导出 SVG")) return;
  const designSnapshot = cloneDesign(state);
  const layoutSnapshot = layout;
  const fileName = safeFileName(designSnapshot);
  elements.exportSvg.disabled = true;
  const originalLabel = elements.exportSvg.textContent;
  elements.exportSvg.textContent = "嵌入字体…";
  try {
    const fontEmbed = await loadFontEmbed(designSnapshot.typography.font);
    const svg = designToSvg(layoutSnapshot, designSnapshot, { fontEmbed });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, `${fileName}.svg`);
    showToast(
      "SVG 已导出并内嵌字体。文字和插图均为可编辑元素，不含预览辅助线。",
    );
  } catch (error) {
    showToast(
      `SVG 未导出：无法内嵌字体（${
        error?.message || "未知错误"
      }）。当前封面内容仍保留；请通过本地服务器打开应用后重试。`,
      "error",
    );
  } finally {
    elements.exportSvg.disabled = false;
    elements.exportSvg.textContent = originalLabel;
  }
}

function exportPng() {
  recompute();
  if (blockExport("导出 PNG")) return;
  try {
    const canvas = document.createElement("canvas");
    renderCoverCanvas(canvas, layout, state, {
      pixelWidth: Math.round(layout.width),
      pixelHeight: Math.round(layout.height),
      showGuides: false,
    });
    canvas.toBlob((blob) => {
      if (!blob) {
        showToast(
          "浏览器未能生成 PNG，可能是画布过大或内存不足。当前封面内容仍保留，请降低画布尺寸后重试。",
          "error",
        );
        return;
      }
      downloadBlob(blob, `${safeFileName()}.png`);
      showToast(
        `PNG 已按 ${Math.round(layout.width)} × ${Math.round(layout.height)} px 导出，与无辅助线预览一致。`,
      );
    }, "image/png");
  } catch {
    showToast(
      "PNG 渲染失败。当前封面内容仍保留，请降低画布尺寸或关闭其他占用内存的页面后重试。",
      "error",
    );
  }
}

function setZoom(nextZoom) {
  zoom = Math.min(1.5, Math.max(0.4, Math.round(nextZoom * 100) / 100));
  drawMainCanvas();
  elements.zoomOutput.value = `${Math.round(zoom * 100)}%`;
}

function bindActions() {
  elements.undo.addEventListener("click", undo);
  elements.redo.addEventListener("click", redo);
  elements.save.addEventListener("click", saveProject);
  elements.reload.addEventListener("click", reloadProject);
  elements.exportSvg.addEventListener("click", exportSvg);
  elements.exportPng.addEventListener("click", exportPng);
  elements.zoomIn.addEventListener("click", () => setZoom(zoom + 0.1));
  elements.zoomOut.addEventListener("click", () => setZoom(zoom - 0.1));
  elements.zoomFit.addEventListener("click", () => setZoom(1));

  elements.selectionActions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-nudge]");
    if (!button) return;
    const step = state.grid.showGrid ? 1 / Math.max(1, state.grid.columns) : 0.01;
    const verticalStep = state.grid.showGrid ? 1 / Math.max(1, state.grid.rows) : 0.01;
    const directions = {
      left: [-step, 0],
      right: [step, 0],
      up: [0, -verticalStep],
      down: [0, verticalStep],
    };
    nudgeSelected(...directions[button.dataset.nudge]);
  });

  elements.caseList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-case]");
    if (!button) return;
    const name = button.dataset.case;
    const testCase = CASES[name];
    if (!testCase) return;
    const before = cloneDesign(state);
    state = createDesign(name);
    selected = null;
    issueElement = null;
    history.record(before, { label: `载入${testCase.label}` });
    requestRender();
    showToast(`已载入${testCase.label}：${testCase.description}。`);
  });
}

function isTextEntryTarget(target) {
  return Boolean(
    target?.closest?.("input, textarea, select, [contenteditable='true']"),
  );
}

function bindKeyboard() {
  window.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
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
      saveProject();
      return;
    }
    if (event.key === "Escape" && !isTextEntryTarget(event.target)) {
      selected = null;
      issueElement = null;
      requestRender();
      return;
    }
    if (!selected || isTextEntryTarget(event.target)) return;

    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const multiplier = event.shiftKey ? 5 : 1;
    const stepX = state.grid.showGrid ? 1 / state.grid.columns : 0.01;
    const stepY = state.grid.showGrid ? 1 / state.grid.rows : 0.01;
    nudgeSelected(direction[0] * stepX * multiplier, direction[1] * stepY * multiplier);
  });

  window.addEventListener("beforeunload", (event) => {
    if (savedSnapshot === JSON.stringify(state)) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

let resizeFrame = 0;
function handleResize() {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    if (!layout) return;
    drawMainCanvas();
    drawThumbnail();
  });
}

function init() {
  buildPalettes();
  bindControls();
  bindCanvasInteraction();
  bindActions();
  bindKeyboard();
  requestRender();

  window.addEventListener("resize", handleResize);
  if ("ResizeObserver" in window) {
    new ResizeObserver(handleResize).observe(elements.canvasStage);
  }

  if (restored.ok) {
    showToast("已恢复上次保存到本机的项目。");
  }

  document.fonts?.ready.then(() => {
    requestRender();
  });
}

init();
