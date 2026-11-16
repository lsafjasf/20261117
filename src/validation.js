import { SIZE_LIMITS } from "./constants.js";

const RULE_LABELS = {
  size: "画布尺寸",
  safe: "安全边距",
  clip: "画布裁切",
  overlap: "元素重叠",
  titleOverflow: "标题溢出",
  authorOverflow: "作者溢出",
  empty: "内容缺失",
  contrast: "文字对比度",
  grid: "网格设置",
  legibility: "缩略可读性",
};

function issue(severity, element, rule, title, detail, fix) {
  return {
    id: `${severity}-${element}-${rule}`,
    severity,
    element,
    rule,
    ruleLabel: RULE_LABELS[rule] ?? rule,
    title,
    detail,
    fix,
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function parseHex(color) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(color));
  if (!match) return null;
  return [match[1], match[2], match[3]].map((part) => Number.parseInt(part, 16));
}

function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const channels = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function overlaps(first, second) {
  const width = Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x);
  const height = Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y);
  return width > 0.75 && height > 0.75 ? { width, height } : null;
}

function outside(box, bounds) {
  return (
    box.x < bounds.x - 0.5 ||
    box.y < bounds.y - 0.5 ||
    box.x + box.w > bounds.x + bounds.w + 0.5 ||
    box.y + box.h > bounds.y + bounds.h + 0.5
  );
}

function describeOutside(box, bounds) {
  const sides = [];
  if (box.x < bounds.x - 0.5) sides.push(`左侧 ${round(bounds.x - box.x)} px`);
  if (box.y < bounds.y - 0.5) sides.push(`顶部 ${round(bounds.y - box.y)} px`);
  if (box.x + box.w > bounds.x + bounds.w + 0.5) {
    sides.push(`右侧 ${round(box.x + box.w - bounds.x - bounds.w)} px`);
  }
  if (box.y + box.h > bounds.y + bounds.h + 0.5) {
    sides.push(`底部 ${round(box.y + box.h - bounds.y - bounds.h)} px`);
  }
  return sides.join("、");
}

function addBoundsIssues(issues, design, layout, element, label, box) {
  if (!box || box.w <= 0 || box.h <= 0) return;
  const canvas = { x: 0, y: 0, w: layout.width, h: layout.height };

  if (outside(box, canvas)) {
    issues.push(
      issue(
        "error",
        element,
        "clip",
        `${label}超出画布边界`,
        `${label}越过画布 ${describeOutside(box, canvas)}，导出时会被裁切。`,
        `将${label}向画布内移动，或缩小${label}后重新检查。`,
      ),
    );
    return;
  }

  if (outside(box, layout.safe)) {
    issues.push(
      issue(
        "error",
        element,
        "safe",
        `${label}越过安全边距`,
        `${label}超出安全区 ${describeOutside(box, layout.safe)}。当前安全边距为 ${round(
          design.grid.margin * 100,
        )}%。`,
        `把${label}移回虚线安全区内，或在“网格与尺寸”中减小安全边距。`,
      ),
    );
  }
}

function addOverlapIssue(issues, first, second, firstLabel, secondLabel, saveFix) {
  if (!first.visible || !second.visible) return;
  const overlap = overlaps(first.box, second.box);
  if (!overlap) return;
  issues.push(
    issue(
      "error",
      first.element,
      "overlap",
      `${firstLabel}与${secondLabel}重叠`,
      `两个元素重叠约 ${round(overlap.width)} × ${round(overlap.height)} px，导出后文字会压在图形上。`,
      saveFix,
    ),
  );
}

export function validateDesign(design, layout) {
  const issues = [];
  const width = Number(design.size.width);
  const height = Number(design.size.height);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < SIZE_LIMITS.minWidth ||
    width > SIZE_LIMITS.maxWidth ||
    height < SIZE_LIMITS.minHeight ||
    height > SIZE_LIMITS.maxHeight
  ) {
    issues.push(
      issue(
        "error",
        "canvas",
        "size",
        "画布尺寸不在可用范围",
        `当前为 ${width || "空"} × ${height || "空"} px。宽必须为 ${SIZE_LIMITS.minWidth}–${
          SIZE_LIMITS.maxWidth
        } px，高必须为 ${SIZE_LIMITS.minHeight}–${SIZE_LIMITS.maxHeight} px。`,
        "修正宽高数值后再导出；现有封面内容不会因尺寸错误被清除。",
      ),
    );
  }

  const columns = Number(design.grid.columns);
  const rows = Number(design.grid.rows);
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 1 ||
    rows < 1 ||
    columns > 40 ||
    rows > 60
  ) {
    issues.push(
      issue(
        "error",
        "canvas",
        "grid",
        "网格行列数无效",
        `当前网格为 ${columns || "空"} 列 × ${rows || "空"} 行。网格必须是 1–40 列、1–60 行的整数。`,
        "使用网格滑块重新选择行列数，标题与插图的位置会保留。",
      ),
    );
  }

  const titleEmpty = !String(design.title ?? "").trim();
  if (titleEmpty) {
    issues.push(
      issue(
        "error",
        "title",
        "empty",
        "书名为空",
        "画布中没有可排版的标题文字，因此无法导出完整书封。",
        "在左侧“书名”输入框填写内容；已填写的作者、配色和位置均会保留。",
      ),
    );
  } else if (layout.title.overflow) {
    issues.push(
      issue(
        "error",
        "title",
        "titleOverflow",
        "标题在最小字号下仍然溢出",
        `标题自动排成 ${layout.title.lines.length} 行，在 ${round(
          layout.title.fontSize,
        )} px 字号下需要 ${round(layout.title.contentHeight)} px 高度，而标题框只有 ${round(
          layout.title.box.h,
        )} px。`,
        "缩短书名，或增大“标题框高度/宽度”，也可降低“书名大小”后重试。",
      ),
    );
  }

  const authorEmpty = !String(design.author ?? "").trim();
  if (authorEmpty) {
    issues.push(
      issue(
        "warning",
        "author",
        "empty",
        "作者名为空",
        "封面仍可导出，但作者信息为空。",
        "如需署名，请在左侧“作者”输入框补充；无需署名时可忽略此提示。",
      ),
    );
  } else if (layout.author.overflow) {
    issues.push(
      issue(
        "error",
        "author",
        "authorOverflow",
        "作者名超出文字框",
        `作者名排成 ${layout.author.lines.length} 行，在 ${round(
          layout.author.fontSize,
        )} px 字号下需要 ${round(layout.author.contentHeight)} px 高度，而文字框只有 ${round(
          layout.author.box.h,
        )} px。`,
        "缩短作者名，或将作者文字框向下/向外移动并增加宽度。",
      ),
    );
  }

  if (!titleEmpty) {
    addBoundsIssues(issues, design, layout, "title", "标题文字", layout.title.contentBox);
  }
  if (!authorEmpty) {
    addBoundsIssues(issues, design, layout, "author", "作者文字", layout.author.contentBox);
  }
  if (layout.illustration.visible) {
    addBoundsIssues(
      issues,
      design,
      layout,
      "illustration",
      "插图",
      layout.illustration.box,
    );
  }

  const elements = [
    {
      element: "title",
      label: "标题",
      visible: !titleEmpty,
      box: layout.title.contentBox,
    },
    {
      element: "author",
      label: "作者",
      visible: !authorEmpty,
      box: layout.author.contentBox,
    },
    {
      element: "illustration",
      label: "插图",
      visible: layout.illustration.visible,
      box: layout.illustration.box,
    },
  ];

  for (let index = 0; index < elements.length; index += 1) {
    for (let inner = index + 1; inner < elements.length; inner += 1) {
      const first = elements[index];
      const second = elements[inner];
      addOverlapIssue(
        issues,
        first,
        second,
        first.label,
        second.label,
        `移动${second.label}以避开${first.label}，或缩小${second.label}、缩短${first.label}。`,
      );
    }
  }

  const titleContrast = contrastRatio(design.theme.ink, design.theme.background);
  if (titleContrast !== null && titleContrast < 3) {
    issues.push(
      issue(
        "warning",
        "title",
        "contrast",
        "文字与底色对比度偏低",
        `当前文字对比度为 ${round(titleContrast)}:1，低于 3:1，缩略图中可能难以辨认。`,
        "加深底色或提亮文字颜色；可先尝试右侧预设配色。",
      ),
    );
  }

  if (Math.min(width, height) < 200) {
    issues.push(
      issue(
        "warning",
        "canvas",
        "legibility",
        "画布尺寸过小",
        `短边只有 ${round(Math.min(width, height))} px，细线与小字号在缩略或印刷时可能丢失。`,
        "至少使用 240 × 360 px；若用于印刷，建议恢复 1200 × 1800 px。",
      ),
    );
  }

  return issues;
}

export function hasBlockingErrors(issues) {
  return issues.some((item) => item.severity === "error");
}

export function issueCounts(issues) {
  return issues.reduce(
    (counts, item) => {
      counts[item.severity] += 1;
      return counts;
    },
    { error: 0, warning: 0 },
  );
}
