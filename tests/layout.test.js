import test from "node:test";
import assert from "node:assert/strict";
import { createDesign } from "../src/constants.js";
import { computeLayout, estimateTextWidth, wrapText } from "../src/layout.js";
import { parseProject, serializeProject } from "../src/storage.js";
import { designToSvg } from "../src/svg.js";
import {
  hasBlockingErrors,
  issueCounts,
  validateDesign,
} from "../src/validation.js";

function layoutFor(design) {
  const layout = computeLayout(design, estimateTextWidth);
  return { layout, issues: validateDesign(design, layout) };
}

function inside(box, bounds) {
  return (
    box.x >= bounds.x - 0.01 &&
    box.y >= bounds.y - 0.01 &&
    box.x + box.w <= bounds.x + bounds.w + 0.01 &&
    box.y + box.h <= bounds.y + bounds.h + 0.01
  );
}

test("标准案例换行且不越过安全边距", () => {
  const design = createDesign("standard");
  const { layout, issues } = layoutFor(design);

  assert.ok(layout.title.lines.length >= 2);
  assert.equal(layout.title.overflow, false);
  assert.equal(hasBlockingErrors(issues), false);
  assert.ok(inside(layout.title.contentBox, layout.safe));
  assert.ok(inside(layout.author.contentBox, layout.safe));
  assert.ok(inside(layout.illustration.box, layout.safe));
});

test("极长文本自动缩小字号并完成自动换行", () => {
  const design = createDesign("long");
  const { layout, issues } = layoutFor(design);

  assert.ok(design.title.length > 60);
  assert.ok(layout.title.lines.length > 4);
  assert.ok(layout.title.fontSize < layout.title.baseSize);
  assert.equal(layout.title.fitted, true);
  assert.equal(layout.title.overflow, false);
  assert.equal(hasBlockingErrors(issues), false);
  assert.ok(inside(layout.title.contentBox, layout.safe));
});

test("极小尺寸案例保持安全边距与统一比例", () => {
  const design = createDesign("mini");
  const { layout, issues } = layoutFor(design);

  assert.equal(layout.width, 240);
  assert.equal(layout.height, 360);
  assert.equal(hasBlockingErrors(issues), false);
  assert.ok(inside(layout.title.contentBox, layout.safe));
  assert.ok(inside(layout.author.contentBox, layout.safe));
  assert.ok(inside(layout.illustration.box, layout.safe));

  const scaled = createDesign("mini", {
    size: { width: 1200, height: 1800, preset: "custom" },
  });
  const scaledLayout = computeLayout(scaled, estimateTextWidth);
  const normalizedTitleX = layout.title.contentBox.x / layout.width;
  const normalizedScaledX = scaledLayout.title.contentBox.x / scaledLayout.width;
  assert.ok(Math.abs(normalizedTitleX - normalizedScaledX) < 0.01);
});

test("超出标题框时报告标题溢出而不是裁掉文字", () => {
  const design = createDesign("standard", {
    title: "这是一段用于验证极端溢出规则的长标题。".repeat(20),
    typography: { autoFit: false },
    positions: {
      title: { x: 0.02, y: 0.02, w: 0.5, h: 0.2 },
    },
  });
  const { layout, issues } = layoutFor(design);

  assert.equal(layout.title.overflow, true);
  const overflow = issues.find((item) => item.rule === "titleOverflow");
  assert.ok(overflow);
  assert.equal(overflow.severity, "error");
  assert.match(overflow.fix, /标题框|书名|字号/);
  assert.equal(design.title.includes("极端溢出"), true);
});

test("元素重叠与安全边距违规会分别报告", () => {
  const overlapDesign = createDesign("standard", {
    typography: { align: "left" },
    positions: {
      illustration: { x: 0.05, y: 0.08, w: 0.4, h: 0.3 },
    },
  });
  const overlapIssues = layoutFor(overlapDesign).issues;
  assert.ok(overlapIssues.some((item) => item.rule === "overlap"));

  const safeDesign = createDesign("standard", {
    positions: {
      author: { x: 0.95, y: 0.9, w: 0.4, h: 0.08 },
    },
  });
  const safeIssues = layoutFor(safeDesign).issues;
  assert.ok(safeIssues.some((item) => item.rule === "safe" || item.rule === "clip"));
});

test("SVG 保留可编辑文字与原生图形，并与布局基线一致", () => {
  const design = createDesign("standard", {
    title: "A & B < editable >",
  });
  const { layout, issues } = layoutFor(design);
  assert.equal(hasBlockingErrors(issues), false);

  const svg = designToSvg(layout, design);
  assert.match(svg, /<g id="title" data-editable="title"/);
  assert.match(svg, /<text id="title-text"/);
  assert.match(svg, /data-editable="illustration-shape"/);
  assert.match(svg, /A &amp; B &lt; editable &gt;/);
  assert.doesNotMatch(svg, /SAFE AREA/);
  assert.doesNotMatch(svg, /canvas-grid/);
  assert.equal((svg.match(/<tspan/g) ?? []).length, layout.title.lines.length + layout.author.lines.length);

  for (const line of layout.title.lines) {
    assert.ok(svg.includes(`x="${Math.round(line.x * 100) / 100}"`));
    assert.ok(svg.includes(`y="${Math.round(line.baseline * 100) / 100}"`));
  }
});

test("SVG 可内嵌当前字体以避免外部查看时文字换形", () => {
  const design = createDesign("standard");
  const { layout } = layoutFor(design);
  const svg = designToSvg(layout, design, {
    fontEmbed: {
      family: "Folio Serif",
      dataUrl: "data:font/woff2;base64,AAAA",
    },
  });

  assert.match(svg, /<style>/);
  assert.match(svg, /@font-face/);
  assert.match(svg, /font-family: "Folio Serif"/);
  assert.match(svg, /data:font\/woff2;base64,AAAA/);
  assert.match(svg, /<text id="title-text"/);
});

test("错误项目文件被拒绝且给出原因", () => {
  const broken = parseProject("{ not json");
  assert.equal(broken.ok, false);
  assert.match(broken.error, /JSON/);
  assert.match(broken.error, /未被更改/);

  const missingSize = parseProject(JSON.stringify({ title: "保留我", author: "A" }));
  assert.equal(missingSize.ok, false);
  assert.match(missingSize.error, /宽高/);
});

test("有效项目可保存并重新解析", () => {
  const design = createDesign("long");
  const parsed = parseProject(serializeProject(design));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.design.title, design.title);
  assert.equal(parsed.design.size.width, 1200);
});

test("长单词可被逐字符断开而不丢失内容", () => {
  const text = "Supercalifragilisticexpialidocious";
  const lines = wrapText(text, {
    maxWidth: 95,
    font: "700 40px sans-serif",
  });
  assert.ok(lines.length > 1);
  assert.equal(lines.join(""), text);
});

test("校验结果同时区分错误与提示", () => {
  const design = createDesign("standard", {
    title: "",
    author: "",
    theme: { ink: "#dedede", background: "#ffffff" },
  });
  const issues = layoutFor(design).issues;
  const counts = issueCounts(issues);
  assert.ok(counts.error >= 1);
  assert.ok(counts.warning >= 1);
});
