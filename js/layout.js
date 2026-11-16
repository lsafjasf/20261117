import { PAPER_TONES, isAllergenTag } from "./schema.js";

const FONT_FAMILY = '"Mise Sans", "PingFang SC", "Microsoft YaHei", sans-serif';
const FIT_STEPS = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5];
const ROLE_LABELS = {
  restaurant: "餐厅名称",
  headline: "菜单主标题",
  subheading: "副标题",
  note: "页脚说明",
  "page-number": "页码",
  "decorative-motif": "装饰图形",
  "dish-name": "菜名",
  "dish-price": "价格",
  "dish-description": "菜品描述",
  "allergen-tag": "过敏原标签",
  "dietary-tag": "饮食标签",
};

let measureCanvas;
let measureContext;

function context() {
  if (!measureContext) {
    measureCanvas = document.createElement("canvas");
    measureContext = measureCanvas.getContext("2d");
  }
  return measureContext;
}

function fontFor(size, weight = 400) {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

function measure(text, size, weight = 400) {
  const ctx = context();
  ctx.font = fontFor(size, weight);
  return ctx.measureText(String(text)).width;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function contrastingInk(hex, dark = "#17211c", light = "#fff8f1") {
  const value = String(hex).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return light;
  const number = Number.parseInt(value, 16);
  const channels = [(number >> 16) & 255, (number >> 8) & 255, number & 255].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.46 ? dark : light;
}

function cleanText(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

export function wrapText(value, maxWidth, size, weight = 400) {
  const text = cleanText(value);
  if (!text) return [];

  const lines = [];
  const width = Math.max(12, maxWidth);
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    const chars = Array.from(paragraph);
    let line = "";
    for (const char of chars) {
      const candidate = line + char;
      if (line && measure(candidate, size, weight) > width) {
        lines.push(line.trimEnd());
        line = char === " " ? "" : char;
      } else {
        line = candidate;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  return lines.length ? lines : [];
}

function typeScale(page) {
  const area = Math.max(1, page.width * page.height);
  const areaScale = Math.sqrt(area / (1240 * 1754));
  return clamp(areaScale, 0.52, 1.12);
}

function typography(page, fitScale) {
  const s = typeScale(page) * fitScale;
  return {
    scale: s,
    restaurant: {
      size: Math.max(9.5, 14 * s),
      lineHeight: Math.max(12, 18 * s),
      weight: 700,
    },
    headline: {
      size: Math.max(24, 62 * s),
      lineHeight: Math.max(28, 68 * s),
      weight: 700,
    },
    subheading: {
      size: Math.max(8.5, 16.5 * s),
      lineHeight: Math.max(12, 25 * s),
      weight: 400,
    },
    name: {
      size: Math.max(13, 30 * s),
      lineHeight: Math.max(16, 37 * s),
      weight: 700,
    },
    price: {
      size: Math.max(12.5, 25 * s),
      lineHeight: Math.max(15, 30 * s),
      weight: 700,
    },
    description: {
      size: Math.max(8.7, 16 * s),
      lineHeight: Math.max(12, 24 * s),
      weight: 400,
    },
    tag: {
      size: Math.max(8, 12.4 * s),
      lineHeight: Math.max(10, 16.5 * s),
      weight: 700,
    },
    note: {
      size: Math.max(7.8, 11 * s),
      lineHeight: Math.max(11, 17 * s),
      weight: 400,
    },
    pageNumber: {
      size: Math.max(7, 10 * s),
      lineHeight: Math.max(10, 14 * s),
      weight: 700,
    },
  };
}

function textBlock(value, x, y, maxWidth, type, color, options = {}) {
  const lines = wrapText(value, maxWidth, type.size, type.weight);
  const lineHeight = options.lineHeight || type.lineHeight;
  return {
    kind: "text",
    role: options.role || "text",
    x,
    y,
    maxWidth,
    lines,
    fontSize: type.size,
    lineHeight,
    fontWeight: type.weight,
    color,
    align: options.align || "left",
    baselineOffset: type.size * 0.82,
    height: Math.max(lines.length * lineHeight, type.size),
  };
}

function textRegion(block, role, id) {
  return {
    id,
    role,
    x: block.x,
    y: block.y,
    width: Math.max(...block.lines.map((line) => measure(line, block.fontSize, block.fontWeight)), 0),
    height: block.height,
  };
}

function buildHeader(doc, page, colors, type) {
  const { width, height, margin } = page;
  const availWidth = width - margin * 2;
  const s = type.scale;
  const motifWidth = doc.theme.motif === "none"
    ? 0
    : clamp(availWidth * 0.18, 42, 178 * s);
  const titleWidth = Math.max(80, availWidth - motifWidth - (motifWidth ? 20 * s : 0));
  const x = margin;
  let y = margin;

  const restaurant = textBlock(
    doc.restaurant || "未命名餐厅",
    x,
    y,
    titleWidth,
    type.restaurant,
    colors.accent,
    { role: "restaurant" },
  );
  y += restaurant.height + Math.max(8, 12 * s);

  const headline = textBlock(
    doc.headline || "菜 单",
    x,
    y,
    titleWidth,
    type.headline,
    colors.ink,
    { role: "headline" },
  );
  y += headline.height + Math.max(5, 9 * s);

  const subheading = doc.subheading
    ? textBlock(doc.subheading, x, y, Math.max(80, titleWidth), type.subheading, colors.muted, {
        role: "subheading",
      })
    : null;
  if (subheading) y += subheading.height;

  const motif = motifWidth
    ? {
        kind: "motif",
        type: doc.theme.motif,
        x: width - margin - motifWidth,
        y: margin + 2 * s,
        width: motifWidth,
        height: motifWidth,
        color: colors.motif,
        accent: colors.accent,
      }
    : null;

  const textBottom = Math.max(y, margin + type.restaurant.size);
  const motifBottom = motif ? motif.y + motif.height : margin;
  const dividerY = Math.max(textBottom, motifBottom) + Math.max(12, 18 * s);
  const contentTop = dividerY + Math.max(14, 20 * s);

  return {
    restaurant,
    headline,
    subheading,
    motif,
    divider: { x1: margin, y1: dividerY, x2: width - margin, y2: dividerY },
    contentTop,
  };
}

function buildFooter(doc, page, colors, type) {
  const { width, height, margin } = page;
  const availWidth = width - margin * 2;
  const s = type.scale;
  const noteWidth = Math.max(80, availWidth - 78 * s);
  const note = doc.note
    ? textBlock(doc.note, margin, 0, noteWidth, type.note, colors.muted, { role: "note" })
    : null;
  const pageText = "MISE · 01";
  const pageNumber = {
    kind: "text",
    role: "page-number",
    x: width - margin - measure(pageText, type.pageNumber.size, type.pageNumber.weight),
    y: 0,
    maxWidth: 80 * s,
    lines: [pageText],
    fontSize: type.pageNumber.size,
    lineHeight: type.pageNumber.lineHeight,
    fontWeight: type.pageNumber.weight,
    color: colors.muted,
    align: "right",
    baselineOffset: type.pageNumber.size * 0.82,
    height: type.pageNumber.lineHeight,
  };

  const noteHeight = note ? note.height : 0;
  const dividerGap = Math.max(8, 12 * s);
  const footerHeight = Math.max(noteHeight, pageNumber.height);
  const dividerY = height - margin - footerHeight - dividerGap;
  const top = dividerY + dividerGap;

  if (note) note.y = top;
  pageNumber.y = top;

  return {
    note,
    pageNumber,
    divider: { x1: margin, y1: dividerY, x2: width - margin, y2: dividerY },
    top,
    height: footerHeight + dividerGap,
    contentBottom: dividerY - Math.max(12, 18 * s),
  };
}

function priceLabel(document, item) {
  const amount = cleanText(item.price);
  if (!amount) return `${document.currency}—`;
  if (/^(时价|mp|market price)$/i.test(amount)) return `${document.currency}${amount}`;
  return `${document.currency}${amount}`;
}

function buildBadges(item, x, y, width, type, colors, s) {
  const font = type.tag;
  const padX = Math.max(3, 7 * s);
  const padY = Math.max(2, 4 * s);
  const gapX = Math.max(3, 5 * s);
  const gapY = Math.max(3, 5 * s);
  const maxBadgeWidth = width;
  const maxTextWidth = Math.max(16, maxBadgeWidth - padX * 2);
  const prepared = item.tags.map((tag, index) => {
    const allergen = isAllergenTag(tag);
    const lines = wrapText(tag, maxTextWidth, font.size, font.weight);
    const widestLine = Math.max(...lines.map((line) => measure(line, font.size, font.weight)), 0);
    const textWidth = Math.min(maxTextWidth, widestLine);
    const badgeWidth = Math.min(maxBadgeWidth, Math.max(textWidth + padX * 2, 20 * s));
    const badgeHeight = Math.max(
      font.lineHeight * Math.max(1, lines.length) + padY * 2,
      Math.max(13, 21 * s),
    );
    return {
      kind: "badge",
      id: `${item.id}-tag-${index}`,
      text: tag,
      allergen,
      x,
      y,
      width: badgeWidth,
      height: badgeHeight,
      lines,
      fontSize: font.size,
      lineHeight: font.lineHeight,
      fontWeight: font.weight,
      padX,
      padY,
      color: allergen ? contrastingInk(colors.accent) : colors.ink,
      background: allergen ? colors.accent : `${colors.soft}E0`,
      border: allergen ? colors.accent : colors.line,
    };
  });

  const rows = [];
  let row = [];
  let cursorX = 0;
  for (const badge of prepared) {
    const nextWidth = row.length ? badge.width + gapX : badge.width;
    if (row.length && cursorX + nextWidth > width) {
      rows.push(row);
      row = [];
      cursorX = 0;
    }
    row.push(badge);
    cursorX += nextWidth;
  }
  if (row.length) rows.push(row);

  let cursorY = y;
  for (const badges of rows) {
    const rowHeight = Math.max(...badges.map((badge) => badge.height));
    let currentX = x;
    for (const badge of badges) {
      badge.x = currentX;
      badge.y = cursorY;
      badge.height = rowHeight;
      currentX += badge.width + gapX;
    }
    cursorY += rowHeight + gapY;
  }

  return {
    badges: prepared,
    height: cursorY > y ? cursorY - y - gapY : 0,
  };
}

function measureItem(doc, item, index, width, colors, type, s) {
  const price = priceLabel(doc, item);
  const priceWidth = measure(price, type.price.size, type.price.weight);
  const priceReserve = Math.min(width * 0.48, priceWidth + 2 * s);
  const nameWidth = Math.max(24, width - priceReserve - Math.max(7, 12 * s));
  const name = textBlock(item.name || "未命名菜品", 0, 0, nameWidth, type.name, colors.ink, {
    role: "dish-name",
  });
  const tagY = name.height + Math.max(5, 8 * s);
  const tagGroup = buildBadges(item, 0, tagY, width, type, colors, s);
  const tagsHeight = tagGroup.height;
  const descriptionY = tagY + (tagsHeight ? tagsHeight + Math.max(5, 8 * s) : 0);
  const description = item.description
    ? textBlock(item.description, 0, descriptionY, width, type.description, colors.muted, {
        role: "dish-description",
      })
    : null;
  const contentBottom = description ? descriptionY + description.height : tagY + tagsHeight;
  const bottomPad = Math.max(10, 24 * s);

  return {
    id: item.id,
    index,
    width,
    height: contentBottom + bottomPad,
    contentHeight: contentBottom,
    bottomPad,
    name,
    price: {
      kind: "text",
      role: "dish-price",
      x: width - priceWidth,
      y: 0,
      maxWidth: priceWidth,
      lines: [price],
      fontSize: type.price.size,
      lineHeight: type.price.lineHeight,
      fontWeight: type.price.weight,
      color: colors.accent,
      align: "right",
      baselineOffset: type.price.size * 0.82,
      width: priceWidth,
      height: type.price.lineHeight,
    },
    tags: tagGroup.badges,
    description,
    hasLongName: name.lines.length > 3,
    descriptionLineCount: description?.lines.length || 0,
    nameLineCount: name.lines.length,
  };
}

function prefixHeights(items) {
  const prefix = [0];
  for (const item of items) prefix.push(prefix[prefix.length - 1] + item.height);
  return prefix;
}

function partitionItems(items, columnCount) {
  const n = items.length;
  if (!n) return Array.from({ length: columnCount }, () => []);
  const prefix = prefixHeights(items);
  const actualColumns = Math.min(columnCount, n);
  const dp = Array.from({ length: actualColumns + 1 }, () => Array(n + 1).fill(Infinity));
  const previous = Array.from({ length: actualColumns + 1 }, () => Array(n + 1).fill(-1));
  dp[0][0] = 0;

  for (let c = 1; c <= actualColumns; c += 1) {
    for (let end = c; end <= n; end += 1) {
      for (let start = c - 1; start < end; start += 1) {
        if (!Number.isFinite(dp[c - 1][start])) continue;
        const columnHeight = prefix[end] - prefix[start];
        const score = Math.max(dp[c - 1][start], columnHeight);
        if (score < dp[c][end]) {
          dp[c][end] = score;
          previous[c][end] = start;
        }
      }
    }
  }

  const groups = [];
  let end = n;
  for (let c = actualColumns; c >= 1; c -= 1) {
    const start = previous[c][end];
    groups.unshift(items.slice(start, end));
    end = start;
  }
  while (groups.length < columnCount) groups.push([]);
  return groups;
}

function layoutCandidate(doc, page, colors, type, columns, contentTop, contentBottom) {
  const { width, margin } = page;
  const s = type.scale;
  const availWidth = width - margin * 2;
  const gap = Math.max(10, 30 * s);
  const columnWidth = (availWidth - gap * (columns - 1)) / columns;
  const measured = doc.items.map((item, index) => measureItem(doc, item, index, columnWidth, colors, type, s));
  const groups = partitionItems(measured, columns);
  const columnsData = groups.map((items, index) => {
    let y = contentTop;
    const block = {
      index,
      x: margin + index * (columnWidth + gap),
      y,
      width: columnWidth,
      items: items.map((item) => {
        const placed = {
          ...item,
          x: margin + index * (columnWidth + gap),
          y,
        };
        placed.name = { ...item.name, x: placed.x, y: placed.y };
        placed.price = { ...item.price, x: placed.x + columnWidth - item.price.width, y: placed.y };
        placed.tags = item.tags.map((badge) => ({
          ...badge,
          x: placed.x + badge.x - (item.x || 0),
          y: placed.y + badge.y - (item.y || 0),
        }));
        if (item.description) {
          placed.description = { ...item.description, x: placed.x, y: placed.y + item.description.y };
        }
        placed.height = item.height;
        y += item.height;
        return placed;
      }),
      height: y - contentTop,
    };
    return block;
  });

  const maxNameLines = Math.max(0, ...measured.map((item) => item.nameLineCount));
  const maxDescriptionLines = Math.max(0, ...measured.map((item) => item.descriptionLineCount));
  return {
    columns,
    columnWidth,
    gap,
    columnsData,
    measured,
    contentHeight: Math.max(0, ...columnsData.map((column) => column.height)),
    availableHeight: contentBottom - contentTop,
    maxNameLines,
    maxDescriptionLines,
  };
}

function usesLongForm(doc, threeColumnCandidate) {
  const items = doc.items;
  if (!items.length) return false;
  const avgName = items.reduce((sum, item) => sum + Array.from(cleanText(item.name)).length, 0) / items.length;
  const avgDescription =
    items.reduce((sum, item) => sum + Array.from(cleanText(item.description)).length, 0) / items.length;
  return (
    avgName > 14 ||
    avgDescription > 42 ||
    threeColumnCandidate.maxNameLines >= 3 ||
    threeColumnCandidate.maxDescriptionLines >= 4
  );
}

function chooseCandidate(doc, page, colors, type, contentTop, contentBottom) {
  const availWidth = page.width - page.margin * 2;
  const two = layoutCandidate(doc, page, colors, type, 2, contentTop, contentBottom);
  const canUseThree = availWidth >= 620 && availWidth / 3 >= 170;
  if (!canUseThree) {
    return {
      candidate: two,
      fitError: Math.max(0, two.contentHeight - two.availableHeight),
    };
  }

  const three = layoutCandidate(doc, page, colors, type, 3, contentTop, contentBottom);
  const twoOverflow = Math.max(0, two.contentHeight - two.availableHeight);
  const threeOverflow = Math.max(0, three.contentHeight - three.availableHeight);
  const longForm = usesLongForm(doc, three);
  let candidate;

  if (twoOverflow > 0.5 && threeOverflow <= 0.5) {
    candidate = three;
  } else if (twoOverflow > 0.5 && threeOverflow > 0.5 && threeOverflow < twoOverflow && !longForm) {
    candidate = three;
  } else if (threeOverflow <= 0.5 && !longForm) {
    candidate = three;
  } else {
    candidate = two;
  }

  return {
    candidate,
    fitError: Math.max(0, candidate.contentHeight - candidate.availableHeight),
    alternatives: { twoOverflow, threeOverflow, longForm },
  };
}

function stretchCandidate(candidate, contentTop, availableHeight, typeScaleValue) {
  const maxItems = Math.max(0, ...candidate.columnsData.map((column) => column.items.length));
  if (maxItems < 2 || availableHeight <= 0 || candidate.contentHeight > availableHeight * 0.82) {
    return;
  }
  const target = Math.min(
    availableHeight * 0.7,
    candidate.contentHeight + availableHeight * 0.28,
  );
  const extraGap = Math.min(
    (target - candidate.contentHeight) / (maxItems - 1),
    Math.max(18, 112 * typeScaleValue),
  );
  if (extraGap < 5) return;

  for (const column of candidate.columnsData) {
    let y = contentTop;
    column.items.forEach((item, index) => {
      if (index > 0) y += extraGap;
      const delta = y - item.y;
      item.y = y;
      item.name = { ...item.name, y: item.name.y + delta };
      item.price = { ...item.price, y: item.price.y + delta };
      item.tags = item.tags.map((badge) => ({ ...badge, y: badge.y + delta }));
      if (item.description) item.description = { ...item.description, y: item.description.y + delta };
      y += item.height;
    });
    column.height = y - contentTop;
  }
  candidate.contentHeight = Math.max(0, ...candidate.columnsData.map((column) => column.height));
}

function effectivePage(page) {
  const width = clamp(Number(page.width), 300, 2400);
  const height = clamp(Number(page.height), 320, 3200);
  const maxMargin = Math.max(8, Math.min((width - 80) / 2, (height - 80) / 2));
  const margin = clamp(Number(page.margin), 8, maxMargin);
  return { ...page, width, height, margin };
}

function issue(code, severity, title, detail, fix, extra = {}) {
  return { code, severity, title, detail, fix, ...extra };
}

function validateDocument(doc, layout) {
  const issues = [];
  const rawPage = doc.page;
  if (rawPage.width < 300 || rawPage.width > 2400) {
    issues.push(
      issue(
        "E-PAGE-01",
        "error",
        "画布宽度超出范围",
        `当前宽度 ${rawPage.width}px，支持的排版范围是 300–2400px。`,
        "将宽度调整到 300–2400px；现有菜品不会被删除。",
        { field: "pageWidth" },
      ),
    );
  }
  if (rawPage.height < 320 || rawPage.height > 3200) {
    issues.push(
      issue(
        "E-PAGE-02",
        "error",
        "画布高度超出范围",
        `当前高度 ${rawPage.height}px，支持的排版范围是 320–3200px。`,
        "将高度调整到 320–3200px；现有菜品不会被删除。",
        { field: "pageHeight" },
      ),
    );
  }
  if (rawPage.margin < 8 || rawPage.margin > 300) {
    issues.push(
      issue(
        "E-MARGIN-01",
        "error",
        "安全边距超出范围",
        `当前安全边距 ${rawPage.margin}px，可设置范围为 8–300px。`,
        "将边距调整到 8–300px；建议至少保留画布短边的 5%。",
        { field: "margin" },
      ),
    );
  } else if (rawPage.margin * 2 > Math.min(rawPage.width, rawPage.height) * 0.62) {
    issues.push(
      issue(
        "E-MARGIN-02",
        "error",
        "安全边距挤占了内容区",
        "左右或上下边距超过画布短边的 31%，无法稳定容纳菜单内容。",
        "减小安全边距，或增大画布尺寸。当前输入仍完整保留。",
        { field: "margin" },
      ),
    );
  }

  if (!doc.items.length) {
    issues.push(
      issue(
        "W-ITEMS-01",
        "warning",
        "菜单还没有菜品",
        "当前画布只显示餐厅标题和页脚。",
        "点击“添加菜品”补充内容。",
      ),
    );
  }

  doc.items.forEach((item, index) => {
    const label = `第 ${index + 1} 道菜`;
    if (!cleanText(item.name)) {
      issues.push(
        issue(
          "E-DISH-01",
          "error",
          `${label}缺少菜名`,
          "预览使用“未命名菜品”占位，原输入为空且不会丢失。",
          "补全菜名后再导出。",
          { itemId: item.id, field: "name" },
        ),
      );
    }
    const price = cleanText(item.price);
    if (!price) {
      issues.push(
        issue(
          "E-PRICE-01",
          "error",
          `${label}缺少价格`,
          "预览以破折号占位；菜品和已有输入仍保留。",
          "填写数字价格，或输入“时价”。",
          { itemId: item.id, field: "price" },
        ),
      );
    } else if (!/^\d+(\.\d{1,2})?$/.test(price) && !/^(时价|mp|market price)$/i.test(price)) {
      issues.push(
        issue(
          "E-PRICE-02",
          "error",
          `${label}价格格式无效`,
          `“${price}”不是有效数字或“时价”。`,
          "使用数字（最多两位小数）或“时价”；请输入后重新导出。",
          { itemId: item.id, field: "price" },
        ),
      );
    }
    if (item.tags.some((tag) => Array.from(tag).length > 30)) {
      issues.push(
        issue(
          "W-TAG-01",
          "warning",
          `${label}有过长的标签`,
          "长标签会自动换行并占用独立行，不会覆盖菜名。",
          "建议将标签缩短为“含坚果”等短语，以减少内容高度。",
          { itemId: item.id, field: "tags" },
        ),
      );
    }
  });

  if (!cleanText(doc.headline)) {
    issues.push(
      issue(
        "W-TITLE-01",
        "warning",
        "菜单主标题为空",
        "预览使用“菜 单”作为显示占位。",
        "填写主标题，或保留占位后继续编辑。",
        { field: "headline" },
      ),
    );
  }

  if (layout.content.overflow > 0.5) {
    issues.push(
      issue(
        "E-CLIP-01",
        "error",
        "菜品内容被页脚裁切",
        `内容需要 ${Math.ceil(layout.content.requiredHeight)}px，可安全使用的区域只有 ${Math.floor(
          layout.content.availableHeight,
        )}px。`,
        "缩短菜名或描述、减少菜品，或增大画布高度。也可以减少安全边距后重新排版。",
        { severity: "error" },
      ),
    );
  }

  const pageBounds = {
    x: layout.page.margin,
    y: layout.page.margin,
    width: layout.page.width - layout.page.margin * 2,
    height: layout.page.height - layout.page.margin * 2,
  };
  for (const region of layout.regions) {
    if (
      region.x < pageBounds.x - 0.6 ||
      region.y < pageBounds.y - 0.6 ||
      region.x + region.width > pageBounds.x + pageBounds.width + 0.6 ||
      region.y + region.height > pageBounds.y + pageBounds.height + 0.6
    ) {
      issues.push(
        issue(
          "E-SAFE-01",
          "error",
          "内容超出安全边距",
          `“${ROLE_LABELS[region.role] || region.role}”触及画布安全区外沿。`,
          "减小文字尺寸、缩短该段文字，或减小安全边距后重试。",
          { regionId: region.id },
        ),
      );
      break;
    }
  }

  const overlap = findOverlap(layout.regions);
  if (overlap) {
    issues.push(
      issue(
        "E-OVERLAP-01",
        "error",
        "检测到文字区域重叠",
        `“${ROLE_LABELS[overlap[0].role] || overlap[0].role}”与“${
          ROLE_LABELS[overlap[1].role] || overlap[1].role
        }”的边界相交，可能遮挡内容。`,
        "缩短菜名、价格或标签；系统会自动重新换行并重新分配栏位。",
        { regionId: overlap[0].id },
      ),
    );
  }

  if (layout.fitScale < 0.9) {
    issues.push(
      issue(
        "W-FIT-01",
        "warning",
        "为容纳内容自动缩小了字号",
        `当前字号为基准的 ${Math.round(layout.fitScale * 100)}%。`,
        "若字号过小，可缩短描述或增加画布高度，让排版恢复到更舒适的字号。",
      ),
    );
  }

  return dedupeIssues(issues);
}

function findOverlap(regions) {
  const textRegions = regions.filter((region) => region.width > 0.5 && region.height > 0.5);
  for (let i = 0; i < textRegions.length; i += 1) {
    for (let j = i + 1; j < textRegions.length; j += 1) {
      const a = textRegions[i];
      const b = textRegions[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > 1 && overlapY > 1) return [a, b];
    }
  }
  return null;
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((item) => {
    const key = `${item.code}:${item.itemId || ""}:${item.field || ""}:${item.regionId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectRegions(layout) {
  const regions = [];
  const addText = (block, role, id) => {
    if (!block) return;
    const region = textRegion(block, role, id);
    if (region.width > 0.5 && region.height > 0.5) regions.push(region);
  };

  addText(layout.header.restaurant, "restaurant", "restaurant");
  addText(layout.header.headline, "headline", "headline");
  addText(layout.header.subheading, "subheading", "subheading");
  if (layout.header.motif) {
    regions.push({
      id: "motif",
      role: "decorative-motif",
      x: layout.header.motif.x,
      y: layout.header.motif.y,
      width: layout.header.motif.width,
      height: layout.header.motif.height,
    });
  }
  addText(layout.footer.note, "note", "note");
  addText(layout.footer.pageNumber, "page-number", "page-number");

  for (const column of layout.columnsData) {
    for (const item of column.items) {
      addText(item.name, "dish-name", `${item.id}-name`);
      addText(item.price, "dish-price", `${item.id}-price`);
      if (item.description) addText(item.description, "dish-description", `${item.id}-description`);
      for (const badge of item.tags) {
        regions.push({
          id: badge.id,
          role: badge.allergen ? "allergen-tag" : "dietary-tag",
          x: badge.x,
          y: badge.y,
          width: badge.width,
          height: badge.height,
        });
      }
    }
  }
  return regions;
}

export function buildLayout(doc) {
  const page = effectivePage(doc.page);
  const paper = PAPER_TONES[doc.theme.paper] || PAPER_TONES.cream;
  const colors = {
    ...paper,
    accent: doc.theme.accent,
  };
  let fitScale = FIT_STEPS[FIT_STEPS.length - 1];
  let type;
  let header;
  let footer;
  let selection;

  for (const step of FIT_STEPS) {
    fitScale = step;
    type = typography(page, step);
    header = buildHeader(doc, page, colors, type);
    footer = buildFooter(doc, page, colors, type);
    selection = chooseCandidate(doc, page, colors, type, header.contentTop, footer.contentBottom);
    if (selection.fitError <= 0.5) break;
  }

  const candidate = selection.candidate;
  const availableHeight = Math.max(0, footer.contentBottom - header.contentTop);
  stretchCandidate(candidate, header.contentTop, availableHeight, type.scale);
  const overflow = Math.max(0, candidate.contentHeight - availableHeight);
  const layout = {
    page,
    rawPage: { ...doc.page },
    colors,
    type,
    fitScale,
    header,
    footer,
    columns: candidate.columns,
    columnsData: candidate.columnsData,
    columnWidth: candidate.columnWidth,
    columnGap: candidate.gap,
    content: {
      top: header.contentTop,
      bottom: footer.contentBottom,
      availableHeight,
      requiredHeight: candidate.contentHeight,
      overflow,
    },
    autoChoice: {
      longForm: selection.alternatives?.longForm || false,
      twoOverflow: selection.alternatives?.twoOverflow ?? overflow,
      threeOverflow: selection.alternatives?.threeOverflow ?? null,
    },
  };
  layout.regions = collectRegions(layout);
  layout.issues = validateDocument(doc, layout);
  layout.hasBlockingErrors = layout.issues.some((entry) => entry.severity === "error");
  return layout;
}

export function measureLayoutText(text, size, weight = 400) {
  return measure(text, size, weight);
}
