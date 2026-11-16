// Layout validation. Every issue carries a rule id, human-readable message and
// a concrete fix hint so the editor never silently drops user input.

import { boundingBox, MIN_ELEMENT_SIZE, rectsIntersect, visibleRect } from "./geometry.js";
import { layoutText } from "./text.js";

export const SAFE_MARGIN = 24;

export function validateDocument(doc, ctx = null) {
  const issues = [];
  const safe = {
    x: SAFE_MARGIN,
    y: SAFE_MARGIN,
    width: doc.width - SAFE_MARGIN * 2,
    height: doc.height - SAFE_MARGIN * 2,
  };

  for (const el of doc.elements) {
    const name = el.name || el.id;
    const box = boundingBox(el);

    if (el.width < MIN_ELEMENT_SIZE || el.height < MIN_ELEMENT_SIZE) {
      issues.push({
        level: "error",
        rule: "MIN_SIZE",
        id: el.id,
        message: `“${name}” 尺寸为 ${Math.round(el.width)}×${Math.round(el.height)}px，低于最小可编辑尺寸 ${MIN_ELEMENT_SIZE}px。`,
        fix: `在右侧属性面板把宽、高都调整到 ≥ ${MIN_ELEMENT_SIZE}px，或删除该元素后重新添加。`,
      });
    }

    const outside =
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > doc.width ||
      box.y + box.height > doc.height;
    if (outside) {
      const dx = Math.max(0, -box.x, box.x + box.width - doc.width);
      const dy = Math.max(0, -box.y, box.y + box.height - doc.height);
      issues.push({
        level: "error",
        rule: "OUT_OF_CANVAS",
        id: el.id,
        message: `“${name}” 超出画布边界（水平越界 ${Math.round(dx)}px，垂直越界 ${Math.round(dy)}px），导出会被裁切。`,
        fix: "将元素拖回画布内，或使用对齐工具栏的“水平居中 / 垂直居中”。",
      });
    } else if (!rectsIntersect(box, safe)) {
      issues.push({
        level: "warning",
        rule: "SAFE_MARGIN",
        id: el.id,
        message: `“${name}” 位于 ${SAFE_MARGIN}px 安全边距之外，打印或二次裁切时内容可能被切掉。`,
        fix: `把元素向内移动，使其包围盒距离画布四边至少 ${SAFE_MARGIN}px。`,
      });
    }

    const crop = el.crop;
    if (crop) {
      if (crop.x < 0 || crop.y < 0 || crop.x + crop.width > el.width || crop.y + crop.height > el.height) {
        issues.push({
          level: "error",
          rule: "CROP_RANGE",
          id: el.id,
          message: `“${name}” 的裁切区域超出元素自身范围。`,
          fix: "在裁切模式下把裁切框四角拖回元素内部，或点击“重置裁切”。",
        });
      }
      if (crop.width < MIN_ELEMENT_SIZE || crop.height < MIN_ELEMENT_SIZE) {
        issues.push({
          level: "error",
          rule: "CROP_TOO_SMALL",
          id: el.id,
          message: `“${name}” 裁切后的可见区域不足 ${MIN_ELEMENT_SIZE}px。`,
          fix: "放大裁切框，或重置裁切恢复完整元素。",
        });
      }
    }

    if (el.type === "text") {
      if (!String(el.text || "").trim()) {
        issues.push({
          level: "warning",
          rule: "EMPTY_TEXT",
          id: el.id,
          message: `“${name}” 文本为空，画布上不会显示任何内容。`,
          fix: "双击元素输入文字，或删除该空文本层。",
        });
      }
      const layout = layoutText(el, ctx);
      if (!el.autoFit && layout.overflowY) {
        issues.push({
          level: "warning",
          rule: "TEXT_OVERFLOW",
          id: el.id,
          message: `“${name}” 文字高度超出文本框 ${Math.round(layout.blockHeight - el.height)}px，底部会被裁切（共 ${layout.lines.length} 行）。`,
          fix: "勾选“自动缩小字号”、增大文本框高度，或减小字号。",
        });
      }
      if (el.autoFit && layout.fontSize <= 6) {
        issues.push({
          level: "warning",
          rule: "TEXT_SHRUNK_LIMIT",
          id: el.id,
          message: `“${name}” 已自动缩小到 ${layout.fontSize}px 下限，文字可能仍然放不下。`,
          fix: "增大文本框尺寸、精简文案，或提高自动缩小的最小字号限制。",
        });
      }
    }
  }

  // Pairwise overlap check on visible (cropped) boxes; transparent fills still
  // count because the user explicitly asked for overlap detection.
  for (let i = 0; i < doc.elements.length; i += 1) {
    for (let j = i + 1; j < doc.elements.length; j += 1) {
      const a = doc.elements[i];
      const b = doc.elements[j];
      const ra = visibleRect(a);
      const rb = visibleRect(b);
      if (rectsIntersect(ra, rb)) {
        const overlapW = Math.min(ra.x + ra.width, rb.x + rb.width) - Math.max(ra.x, rb.x);
        const overlapH = Math.min(ra.y + ra.height, rb.y + rb.height) - Math.max(ra.y, rb.y);
        const area = Math.max(0, overlapW) * Math.max(0, overlapH);
        const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
        const ratio = smaller > 0 ? area / smaller : 0;
        issues.push({
          level: ratio > 0.35 ? "warning" : "info",
          rule: "OVERLAP",
          id: `${a.id}|${b.id}`,
          message: `“${a.name || a.id}” 与 “${b.name || b.id}” 存在重叠（覆盖较小元素约 ${Math.round(ratio * 100)}%）。`,
          fix: ratio > 0.35 ? "在图层面板调整层级，或移动元素减少遮挡。" : "轻微重叠通常可接受，确认这是预期的排版效果即可。",
        });
      }
    }
  }

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return { issues, errors, warnings, ok: errors.length === 0 };
}

export function blockingIssues(report) {
  return report.issues.filter((i) => i.level === "error");
}
