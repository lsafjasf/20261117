import {
  containsRect,
  elementLabel,
  getGeometry,
  isTextElement,
  measureTextElement,
  rect,
  rectsOverlap,
} from "./geometry.js";

const SIDE_LABELS = { front: "正面", back: "背面" };

function overlapSize(a, b) {
  return {
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)),
  };
}

function formatMm(value) {
  return `${Math.max(0, value).toFixed(1)} mm`;
}

function issueBase(severity, code, side, elementId, title, detail, hint) {
  return {
    id: `${code}-${side || "all"}-${elementId || "global"}`,
    severity,
    code,
    side,
    elementId,
    title,
    detail,
    hint,
  };
}

function inspectSafeMargin(project, geom, side, element, issues) {
  const box = rect(element);
  const sm = geom.safeMargin;
  const overflows = {
    left: Math.max(0, sm - box.x),
    top: Math.max(0, sm - box.y),
    right: Math.max(0, box.x + box.w - (geom.width - sm)),
    bottom: Math.max(0, box.y + box.h - (geom.height - sm)),
  };
  const worst = Math.max(...Object.values(overflows));
  if (worst <= 0.05) return;
  const directions = Object.entries(overflows)
    .filter(([, amount]) => amount > 0.05)
    .map(([direction]) => ({ left: "左", right: "右", top: "上", bottom: "下" })[direction]);
  issues.push(
    issueBase(
      "error",
      "safe-margin",
      side,
      element.id,
      `「${elementLabel(element)}」越过 ${formatMm(worst)} 安全边距`,
      `${SIDE_LABELS[side]}元素超出${directions.join("、")}侧安全边距（要求距裁切线至少 ${sm} mm）。`,
      "将元素拖回画布中部或缩小尺寸，确保整个元素框都在 6 mm 安全边距以内。",
    ),
  );
}

function inspectText(project, geom, side, element, issues) {
  if (!isTextElement(element)) return;
  const metrics = measureTextElement(element);
  const label = elementLabel(element);
  if (metrics.overflow) {
    const parts = [];
    if (metrics.overflowX > 0.08) parts.push(`横向 ${formatMm(metrics.overflowX)}`);
    if (metrics.overflowY > 0.08) parts.push(`纵向 ${formatMm(metrics.overflowY)}`);
    issues.push(
      issueBase(
        "error",
        "text-overflow",
        side,
        element.id,
        `「${label}」文字溢出文本框`,
        `${SIDE_LABELS[side]}文字${parts.join("、")}超出文本框，即使缩至 ${metrics.fontSize.toFixed(1)} mm 仍无法完整容纳。`,
        "精简文案、增大文本框，或适当提高行距空间后再导出。内容不会被自动截断。",
      ),
    );
  } else if (metrics.shrunk) {
    issues.push(
      issueBase(
        "warning",
        "text-shrunk",
        side,
        element.id,
        `「${label}」已自动缩小以容纳文本`,
        `字号从 ${metrics.requestedSize.toFixed(1)} mm 缩至 ${metrics.fontSize.toFixed(1)} mm，导出会保持当前效果。`,
        "如需更大字号，请精简文字或扩大文本框。",
      ),
    );
  }
  if (metrics.tooSmall) {
    issues.push(
      issueBase(
        "warning",
        "text-tiny",
        side,
        element.id,
        `「${label}」字号较小`,
        `实际字号 ${metrics.fontSize.toFixed(1)} mm，低于建议的 2.1 mm。`,
        "放大文本框、减少文字，或改用更大的明信片规格。",
      ),
    );
  }

  if (side !== "back") return;
  const zoneTargets = [];
  if (element.kind === "address") {
    if (!containsRect(geom.zones.address, element)) {
      const overlap = overlapSize(rect(element), geom.zones.address);
      issues.push(
        issueBase(
          "error",
          "address-outside-zone",
          side,
          element.id,
          "地址文字越出地址安全区",
          `地址框只有 ${formatMm(overlap.w)} × ${formatMm(overlap.h)} 位于地址安全区内。`,
          "将地址框移回右侧（横版）或下方（竖版）的绿色虚线地址区，并缩小到安全区以内。",
        ),
      );
    }
    zoneTargets.push({ key: "barcode", label: "条码安全区", rect: geom.zones.barcode });
  } else {
    zoneTargets.push(
      { key: "address", label: "地址安全区", rect: geom.zones.address },
      { key: "barcode", label: "条码安全区", rect: geom.zones.barcode },
    );
  }

  for (const zone of zoneTargets) {
    if (!rectsOverlap(element, zone.rect, 0.12)) continue;
    const overlap = overlapSize(rect(element), zone.rect);
    issues.push(
      issueBase(
        "error",
        `text-entry-${zone.key}-zone`,
        side,
        element.id,
        `「${label}」进入${zone.label}`,
        `${SIDE_LABELS[side]}文字框与${zone.label}重叠 ${formatMm(overlap.w)} × ${formatMm(overlap.h)}。`,
        `将文字框移出${zone.label}；地址与条码周围必须保留完整的无文字区域。`,
      ),
    );
  }
}

function inspectBarcode(project, geom, element, issues) {
  if (!containsRect(geom.zones.barcode, element)) {
    issues.push(
      issueBase(
        "error",
        "barcode-outside-zone",
        "back",
        element.id,
        "条码图形越出条码安全区",
        "条码必须完整位于底部条码安全区内，避免被邮局标签遮挡或裁切。",
        "将条码移回黄色虚线区域，或重置背面布局。",
      ),
    );
  }
}

function inspectStamp(project, geom, element, issues) {
  if (!containsRect(geom.zones.stamp, element, 0.15)) {
    issues.push(
      issueBase(
        "warning",
        "stamp-outside-zone",
        "back",
        element.id,
        "邮票超出建议贴票区",
        "邮票框没有完整落在右上角贴票区，打印后可能难以粘贴或压住地址文字。",
        "将邮票移回右上角贴票区，或减少了邮票尺寸。",
      ),
    );
  }
}

export function validateProject(project) {
  const issues = [];
  const geom = getGeometry(project);

  if (!Number.isFinite(project.width) || !Number.isFinite(project.height)) {
    issues.push(
      issueBase(
        "error",
        "invalid-size",
        null,
        null,
        "画布尺寸无效",
        "画布宽度或高度不是有效数字。",
        "重新选择标准、方形或迷你规格。",
      ),
    );
    return { issues, errors: issues, warnings: [], ok: false, geometry: geom };
  }
  if (project.width < 60 || project.height < 45) {
    issues.push(
      issueBase(
        "warning",
        "tiny-canvas",
        null,
        null,
        "画布尺寸非常小",
        `当前画布为 ${project.width} × ${project.height} mm，文字与地址线可能接近印刷极限。`,
        "优先精简文字；如需邮寄，建议改用至少 90 × 60 mm 的规格。",
      ),
    );
  }

  for (const side of ["front", "back"]) {
    const elements = project.sides?.[side] || [];
    for (const element of elements) {
      inspectSafeMargin(project, geom, side, element, issues);
      inspectText(project, geom, side, element, issues);
      if (side === "back" && element.kind === "barcode") {
        inspectBarcode(project, geom, element, issues);
      }
      if (side === "back" && element.kind === "stamp") {
        inspectStamp(project, geom, element, issues);
      }
    }

    for (let first = 0; first < elements.length; first += 1) {
      for (let second = first + 1; second < elements.length; second += 1) {
        const a = elements[first];
        const b = elements[second];
        if (!rectsOverlap(a, b, 0.18)) continue;
        const overlap = overlapSize(rect(a), rect(b));
        if (overlap.w * overlap.h < 0.25) continue;
        issues.push(
          issueBase(
            "error",
            "element-overlap",
            side,
            a.id,
            `「${elementLabel(a)}」与「${elementLabel(b)}」重叠`,
            `${SIDE_LABELS[side]}两个元素重叠 ${formatMm(overlap.w)} × ${formatMm(overlap.h)}。`,
            "拖动其中一个元素，使两者之间留出至少 1 mm 间隔后再导出。",
          ),
        );
      }
    }
  }

  if (!project.sides.back.some((element) => element.kind === "address")) {
    issues.push(
      issueBase(
        "warning",
        "missing-address",
        "back",
        null,
        "背面还没有地址区",
        "这仍可导出为装饰卡，但无法按标准明信片寄送。",
        "从左侧添加“地址线”，版面会自动放入地址安全区。",
      ),
    );
  }
  if (!project.sides.back.some((element) => element.kind === "barcode")) {
    issues.push(
      issueBase(
        "warning",
        "missing-barcode",
        "back",
        null,
        "背面还没有条码预留位",
        "邮政处理可能需要条码区域。",
        "载入标准案例或重新放置条码区域。",
      ),
    );
  }

  const severityOrder = { error: 0, warning: 1 };
  issues.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      String(a.side).localeCompare(String(b.side)),
  );
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");
  return {
    issues,
    errors,
    warnings,
    ok: errors.length === 0,
    geometry: geom,
  };
}

export function issueSummary(result) {
  if (result.errors.length) {
    return {
      className: "has-error",
      badge: `${result.errors.length} 项阻塞`,
      mark: "!",
      title: "需要修复后才能导出",
      detail: `${result.errors.length} 项排版错误，${result.warnings.length} 项提醒。当前内容完整保留。`,
    };
  }
  if (result.warnings.length) {
    return {
      className: "has-warning",
      badge: `${result.warnings.length} 项提醒`,
      mark: "!",
      title: "可以导出，建议检查提醒",
      detail: "安全区与裁切检查通过；以下提醒不会阻止导出。",
    };
  }
  return {
    className: "is-ok",
    badge: "通过",
    mark: "✓",
    title: "可以导出",
    detail: "安全边距、安全区与文本框均通过。",
  };
}
