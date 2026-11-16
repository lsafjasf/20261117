function round(value) {
  return Math.round(value * 10) / 10;
}

export function rectWithin(rect, bounds) {
  return (
    rect.x >= bounds.x &&
    rect.y >= bounds.y &&
    rect.x + rect.width <= bounds.x + bounds.width &&
    rect.y + rect.height <= bounds.y + bounds.height
  );
}

export function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function distanceToRect(px, py, rect) {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.width));
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function furthestCornerDistance(rect, center) {
  const cx = center.cx ?? center.x;
  const cy = center.cy ?? center.y;
  return Math.max(
    Math.hypot(rect.x - cx, rect.y - cy),
    Math.hypot(rect.x + rect.width - cx, rect.y - cy),
    Math.hypot(rect.x - cx, rect.y + rect.height - cy),
    Math.hypot(
      rect.x + rect.width - cx,
      rect.y + rect.height - cy
    )
  );
}

function issue(code, severity, title, detail, fix, fields = []) {
  return { code, severity, title, detail, fix, fields };
}

export function validateScene(project, scene) {
  const issues = [];
  const { width, height, safeMargin } = project.canvas;
  const text = project.text;
  const layout = scene.text;
  if (Math.abs(width - height) > 0.5) {
    issues.push(
      issue(
        "NON_SQUARE_TILE",
        "warning",
        "画布不是正方形",
        `当前画布为 ${width} × ${height}px，矩形单元仍可平铺，但三宫格预览会按矩形拉伸。`,
        "将画布宽高设为相同数值，以获得最直观的无缝平铺预览。",
        ["canvas.width", "canvas.height"]
      )
    );
  }
  const smallest = Math.min(width, height);
  if (smallest < 96) {
    issues.push(
      issue(
        "TILE_TOO_SMALL",
        "warning",
        "单元尺寸偏小",
        `当前最小边仅 ${smallest}px，细节和文字在缩略图中可能无法辨认。`,
        "建议将单元尺寸提高到 96px 以上，或减少装饰点与文字层级。",
        ["canvas.width", "canvas.height"]
      )
    );
  }
  if (safeMargin * 2 >= smallest) {
    issues.push(
      issue(
        "SAFE_MARGIN_TOO_LARGE",
        "error",
        "安全边距过大",
        `左右安全边距合计 ${safeMargin * 2}px，已不小于画布 ${smallest}px。`,
        `把安全边距降到 ${Math.max(0, Math.floor(smallest / 2) - 1)}px 以下。`,
        ["canvas.safeMargin"]
      )
    );
  }
  if (!text.enabled) return summarize(issues);

  const layoutWidth = Math.max(1, width - safeMargin * 2);
  const layoutHeight = Math.max(1, height - safeMargin * 2);
  if (text.maxWidth > layoutWidth) {
    issues.push(
      issue(
        "MAX_WIDTH_EXCEEDS_SAFE_AREA",
        "error",
        "文字最大宽度超出安全区",
        `文字最大宽度为 ${text.maxWidth}px，但扣除 ${safeMargin}px 安全边距后只有 ${layoutWidth}px 可用。`,
        `把“最大行宽”调整为 ${Math.floor(layoutWidth)}px 或更小。`,
        ["text.maxWidth", "canvas.safeMargin"]
      )
    );
  }
  const block = layout.block;
  if (block) {
    const tileBounds = { x: 0, y: 0, width, height };
    const safeBounds = {
      x: safeMargin,
      y: safeMargin,
      width: Math.max(0, width - safeMargin * 2),
      height: Math.max(0, height - safeMargin * 2)
    };
    if (!rectWithin(block, tileBounds)) {
      const overflow = {
        left: Math.max(0, -block.x),
        right: Math.max(0, block.x + block.width - width),
        top: Math.max(0, -block.y),
        bottom: Math.max(0, block.y + block.height - height)
      };
      const sides = Object.entries(overflow)
        .filter(([, amount]) => amount > 0.5)
        .map(([side, amount]) => `${side} ${round(amount)}px`)
        .join("、");
      issues.push(
        issue(
          "TEXT_CLIPPED",
          "error",
          "文字组超出画布并被裁切",
          `文字包围盒比画布多出：${sides}；导出后会与预览一样被画布边缘裁掉。`,
          "减小字号或最大行宽，增加文字中心上下留白，或切换到更大的单元尺寸。",
          [
            "text.titleSize",
            "text.subtitleSize",
            "text.maxWidth",
            "text.y",
            "canvas.width",
            "canvas.height"
          ]
        )
      );
    }
    if (!rectWithin(block, safeBounds)) {
      const violations = [];
      if (block.x < safeBounds.x) violations.push(`左 ${round(safeBounds.x - block.x)}px`);
      if (block.y < safeBounds.y) violations.push(`上 ${round(safeBounds.y - block.y)}px`);
      if (block.x + block.width > safeBounds.x + safeBounds.width) {
        violations.push(
          `右 ${round(block.x + block.width - safeBounds.x - safeBounds.width)}px`
        );
      }
      if (block.y + block.height > safeBounds.y + safeBounds.height) {
        violations.push(
          `下 ${round(block.y + block.height - safeBounds.y - safeBounds.height)}px`
        );
      }
      issues.push(
        issue(
          "SAFE_MARGIN_VIOLATED",
          "error",
          "文字进入安全边距",
          `文字包围盒越过安全区：${violations.join("、")}。平铺时文字会贴边或跨接缝。`,
          "缩小字号/行宽，或将文字中心移回单元中央，使四周至少保留安全边距。",
          ["text.titleSize", "text.subtitleSize", "text.maxWidth", "text.y", "text.x"]
        )
      );
    }
    if (project.motif.showPlate && block) {
      const nearest = distanceToRect(scene.center.x, scene.center.y, block);
      const furthest = furthestCornerDistance(block, scene.center);
      if (nearest < scene.clearZone.r && furthest > scene.clearZone.r * 0.9) {
        issues.push(
          issue(
            "TEXT_MOTIF_OVERLAP",
            "error",
            "文字与中心图形留白区重叠",
            `文字组需完整落在半径 ${round(scene.clearZone.r)}px 的中心留白区内，当前最远角超出 ${round(
              furthest - scene.clearZone.r * 0.9
            )}px。`,
            "减小字号或最大行宽，减少标题行数；也可关闭中心留白底板并重新检查对比度。",
            [
              "text.titleSize",
              "text.subtitleSize",
              "text.maxWidth",
              "motif.showPlate",
              "motif.scale"
            ]
          )
        );
      }
    }
    const titleBox = layout.titleBlock;
    const subtitleBox = layout.subtitleBlock;
    if (titleBox && subtitleBox && rectsOverlap(titleBox, subtitleBox)) {
      issues.push(
        issue(
          "TEXT_BLOCK_OVERLAP",
          "error",
          "标题与副标题重叠",
          `标题底部与副标题顶部的行间距不足 ${text.lineGap}px。`,
          "增大标题/副标题间距，或减小字号让两组文字重新分开。",
          ["text.lineGap", "text.titleSize", "text.subtitleSize"]
        )
      );
    }
  }
  const minFont = Math.max(7, Math.min(12, smallest * 0.055));
  if (text.titleSize < minFont) {
    issues.push(
      issue(
        "TITLE_FONT_TOO_SMALL",
        "warning",
        "标题字号过小",
        `标题 ${text.titleSize}px 低于该单元建议的最小字号 ${round(minFont)}px。`,
        `把标题字号提高到 ${Math.ceil(minFont)}px 以上。`,
        ["text.titleSize"]
      )
    );
  }
  if (text.subtitleSize < minFont) {
    issues.push(
      issue(
        "SUBTITLE_FONT_TOO_SMALL",
        "warning",
        "副标题字号过小",
        `副标题 ${text.subtitleSize}px 低于该单元建议的最小字号 ${round(minFont)}px。`,
        `把副标题字号提高到 ${Math.ceil(minFont)}px 以上。`,
        ["text.subtitleSize"]
      )
    );
  }
  if (!text.title.trim() && !text.subtitle.trim()) {
    issues.push(
      issue(
        "TEXT_EMPTY",
        "warning",
        "文字层为空",
        "标题和副标题均为空，导出中不会包含文字元素。",
        "输入标题或副标题，或关闭文字层后导出纯图形纹样。",
        ["text.title", "text.subtitle"]
      )
    );
  }
  return summarize(issues);
}

function summarize(issues) {
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");
  return {
    issues,
    errors,
    warnings,
    hasErrors: errors.length > 0
  };
}

export function firstErrorInstruction(report) {
  if (!report?.errors?.length) return "";
  const first = report.errors[0];
  return `${first.title}：${first.fix}`;
}
