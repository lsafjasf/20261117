import { COLOR_LABELS, COLOR_ROLES, PALETTE_RULES } from "./palette.js";
import { escapeHtml } from "./utils.js";

function section(number, title, hint, body, open = false) {
  return `
    <details class="sidebar-section" ${open ? "open" : ""}>
      <summary>
        <span class="section-number">${number}</span>
        <span class="section-heading-copy"><strong>${title}</strong><small>${hint}</small></span>
      </summary>
      <div class="section-body">${body}</div>
    </details>`;
}

function numberField(label, field, min, max, step, note = "") {
  return `
    <label class="field">
      <span>${label}</span>
      <input type="number" data-field="${field}" min="${min}" max="${max}" step="${step}" />
      ${note ? `<small>${note}</small>` : ""}
    </label>`;
}

function rangeField(label, field, min, max, step, scale = 1) {
  return `
    <label class="field">
      <span>${label}</span>
      <span class="range-field">
        <input type="range" data-field="${field}" data-value-scale="${scale}" min="${min}" max="${max}" step="${step}" />
        <output data-output-for="${field}"></output>
      </span>
    </label>`;
}

function selectField(label, field, options) {
  return `
    <label class="field">
      <span>${label}</span>
      <select data-field="${field}">
        ${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}
      </select>
    </label>`;
}

function toggleField(label, field, className = "check-row") {
  return `
    <label class="${className}">
      <input type="checkbox" data-field="${field}" />
      <span class="${className === "check-row" ? "check-box" : "switch-track"}"></span>
      <span>${label}</span>
    </label>`;
}

export function buildSchemeCards(project) {
  return project.palette.schemes
    .map((scheme, index) => {
      const colors = COLOR_ROLES.map((role) => {
        const locked = role === "primary" && project.palette.locked;
        return `
          <label class="color-field" data-locked="${locked}">
            <input type="color" data-scheme-index="${index}" data-color-role="${role}"
              value="${escapeHtml(scheme.colors[role])}" aria-label="${escapeHtml(
                `${scheme.name}${COLOR_LABELS[role]}`
              )}" />
            <span>${COLOR_LABELS[role]}</span>
          </label>`;
      }).join("");
      return `
        <article class="scheme-card" data-scheme-card="${index}" data-active="${
          project.palette.active === index
        }">
          <button class="scheme-card-head" type="button" data-scheme-activate="${index}"
            aria-label="切换到${escapeHtml(scheme.name)}配色"
            aria-pressed="${project.palette.active === index}">
            <span class="scheme-letter">${String.fromCharCode(65 + index)}</span>
            <span class="scheme-name">${escapeHtml(scheme.name)}</span>
            <span class="scheme-mode">${escapeHtml(scheme.mode)}</span>
          </button>
          <div class="scheme-swatches">${colors}</div>
        </article>`;
    })
    .join("");
}

export function buildSidebarMarkup(project) {
  const paletteRules = Object.entries(PALETTE_RULES).map(([value, rule]) => [
    value,
    rule.label
  ]);
  const colorRoles = COLOR_ROLES.map((role) => [role, COLOR_LABELS[role]]);
  const paletteBody = `
    <div class="section-toolbar">
      <label class="lock-switch">
        <input id="paletteLock" type="checkbox" data-field="palette.locked" />
        <span class="switch-track"></span>
        <span>锁定三套主色</span>
      </label>
      <p>锁定后改一处，三套同步</p>
    </div>
    <div id="paletteSchemes" class="palette-schemes">${buildSchemeCards(project)}</div>
    <div class="inline-actions">
      <label class="field">
        <span>其余颜色替换规则</span>
        <select data-field="palette.rule">
          ${paletteRules
            .map(([value, label]) => `<option value="${value}">${label}</option>`)
            .join("")}
        </select>
      </label>
      <button class="apply-button" type="button" data-action="apply-palette-rule">应用规则</button>
    </div>`;

  const presetBody = `
    <div class="preset-grid">
      <button class="preset-button" type="button" data-preset="standard">
        <strong>标准案例</strong><span>512px · 标题与副标题完整落在安全区</span>
      </button>
      <button class="preset-button" type="button" data-preset="extreme">
        <strong>极端长文本</strong><span>96px · 超长无断点文本与最小字号</span>
      </button>
    </div>`;

  const motifBody = `
    <div class="field-grid">
      ${selectField("中心图形", "motif.kind", [
        ["bloom", "花瓣"],
        ["diamond", "叠菱"],
        ["orbit", "同心环"]
      ])}
      ${rangeField("整体旋转", "motif.rotation", -180, 180, 1, 1)}
    </div>
    <div class="field-grid">
      ${rangeField("图形大小", "motif.scale", 20, 120, 1, 100)}
      ${numberField("花瓣/环点", "motif.petals", 3, 24, 1)}
    </div>
    <div class="field-grid">
      ${rangeField("环绕半径", "motif.orbitRadius", 20, 65, 1, 100)}
      ${rangeField("环绕点大小", "motif.orbitDot", 0.4, 8, 0.2, 100)}
    </div>
    <div class="field-grid">
      ${numberField("环绕点数量", "motif.orbitCount", 0, 32, 1)}
      ${toggleField("保留中心留白底板", "motif.showPlate")}
    </div>`;

  const textBody = `
    <div class="section-toolbar">
      <p>文字保持为文本节点，导出后仍可编辑。</p>
      ${toggleField("显示文字层", "text.enabled")}
    </div>
    <label class="field">
      <span>主标题</span>
      <textarea data-field="text.title" rows="2"></textarea>
    </label>
    <label class="field">
      <span>副标题</span>
      <textarea data-field="text.subtitle" rows="2"></textarea>
    </label>
    <div class="field-grid field-grid--3">
      ${numberField("标题字号", "text.titleSize", 6, 240, 1)}
      ${numberField("副标题字号", "text.subtitleSize", 6, 120, 1)}
      ${numberField("行间距", "text.lineGap", 0, 80, 1)}
    </div>
    <div class="field-grid">
      ${numberField("最大行宽", "text.maxWidth", 20, 2048, 1)}
      ${selectField("对齐", "text.align", [
        ["center", "居中"],
        ["left", "左对齐"],
        ["right", "右对齐"]
      ])}
    </div>
    <div class="field-grid">
      ${rangeField("文字中心 X", "text.x", 10, 90, 1, 100)}
      ${rangeField("文字中心 Y", "text.y", 10, 90, 1, 100)}
    </div>
    <div class="field-grid">
      ${selectField("标题颜色", "text.titleColorRole", colorRoles)}
      ${selectField("副标题颜色", "text.subtitleColorRole", colorRoles)}
    </div>`;

  const canvasBody = `
    <div class="field-grid">
      ${numberField("单元尺寸（宽=高）", "canvas.width", 64, 2048, 1)}
      ${numberField("安全边距", "canvas.safeMargin", 0, 512, 1)}
    </div>
    <p class="field small" style="margin:10px 0 0;color:var(--ink-faint)">
      修改尺寸不会拉伸文字；请重新检查裁切与安全边距提示。
    </p>`;

  const validationBody = `<div id="validationPanel" aria-live="polite"></div>`;

  return [
    section("01", "三套配色", "锁定主色，规则替换其余颜色", paletteBody, true),
    section("02", "验收案例", "标准与极端尺寸一键切换", presetBody, true),
    section("03", "排版检查", "安全边距 · 重叠 · 裁切", validationBody, true),
    section("04", "图形结构", "中心纹样与环绕节点", motifBody, true),
    section("05", "文字排版", "内容、字号与色彩角色", textBody, true),
    section("06", "画布规则", "平铺单元与安全区", canvasBody, false)
  ].join("");
}
