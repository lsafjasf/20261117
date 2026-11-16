import assert from "node:assert/strict";
import test from "node:test";
import { buildSvg, escapeXml, safeFilename } from "../src/exporter.js";
import {
  createExtremeProject,
  createStandardProject,
  getActiveScheme,
  normalizeProject,
  projectFingerprint
} from "../src/model.js";
import {
  applyPaletteRule,
  deriveSchemes,
  hexToHsl,
  normalizeHex,
  setPaletteLock,
  setPrimaryColor
} from "../src/palette.js";
import {
  approximateTextWidth,
  buildScene,
  layoutText,
  wrapText
} from "../src/render.js";
import { validateScene } from "../src/validation.js";

test("locked primary color synchronizes all three schemes and survives reload", () => {
  const project = createStandardProject();
  assert.equal(project.palette.locked, true);
  setPrimaryColor(project, 1, "#2a6f97");
  assert.deepEqual(
    project.palette.schemes.map((scheme) => scheme.colors.primary),
    ["#2A6F97", "#2A6F97", "#2A6F97"]
  );

  const reloaded = normalizeProject(JSON.parse(JSON.stringify(project)));
  assert.equal(reloaded.palette.locked, true);
  assert.deepEqual(
    reloaded.palette.schemes.map((scheme) => scheme.colors.primary),
    ["#2A6F97", "#2A6F97", "#2A6F97"]
  );
});

test("unlocking primary colors restores independent editing", () => {
  const project = createStandardProject();
  setPaletteLock(project, false);
  setPrimaryColor(project, 2, "#7B3F91");
  assert.equal(project.palette.schemes[0].colors.primary, "#C95135");
  assert.equal(project.palette.schemes[2].colors.primary, "#7B3F91");
  setPaletteLock(project, true);
  assert.equal(project.palette.schemes[0].colors.primary, project.palette.schemes[2].colors.primary);
});

test("palette rules preserve locked primary and replace the other roles", () => {
  const project = createStandardProject();
  const before = project.palette.schemes.map((scheme) => ({ ...scheme.colors }));
  project.palette.rule = "complementary";
  applyPaletteRule(project);
  assert.deepEqual(
    project.palette.schemes.map((scheme) => scheme.colors.primary),
    ["#C95135", "#C95135", "#C95135"]
  );
  assert.notEqual(project.palette.schemes[0].colors.secondary, before[0].secondary);
  assert.equal(project.palette.schemes[0].colors.background.startsWith("#"), true);
});

test("palette parsing handles short and invalid colors deterministically", () => {
  assert.equal(normalizeHex("#abc"), "#AABBCC");
  assert.equal(normalizeHex("not-a-color", "#123456"), "#123456");
  const hsl = hexToHsl("#2A6F97");
  assert.ok(hsl.h > 190 && hsl.h < 220);
  const schemes = deriveSchemes("#2A6F97", "monochrome");
  assert.equal(schemes.length, 3);
  assert.ok(schemes.every((scheme) => scheme.colors.primary === "#2A6F97"));
});

test("standard preset passes safety margin, overlap and clipping checks", () => {
  const project = createStandardProject();
  const scene = buildScene(project, getActiveScheme(project), approximateTextWidth);
  const report = validateScene(project, scene);
  assert.deepEqual(report.issues, []);
  assert.equal(report.hasErrors, false);
  assert.ok(scene.text.block.x >= project.canvas.safeMargin);
  assert.ok(
    scene.text.block.x + scene.text.block.width <=
      project.canvas.width - project.canvas.safeMargin
  );
});

test("extreme long text case reports each concrete layout violation without mutation", () => {
  const project = createExtremeProject();
  const originalTitle = project.text.title;
  const scene = buildScene(project, getActiveScheme(project), approximateTextWidth);
  const report = validateScene(project, scene);
  const codes = new Set(report.issues.map((issue) => issue.code));
  assert.ok(codes.has("MAX_WIDTH_EXCEEDS_SAFE_AREA"));
  assert.ok(codes.has("TEXT_CLIPPED"));
  assert.ok(codes.has("SAFE_MARGIN_VIOLATED"));
  assert.ok(codes.has("TEXT_MOTIF_OVERLAP"));
  assert.equal(project.text.title, originalTitle);
  assert.ok(report.errors.every((item) => item.detail && item.fix));
  assert.match(report.errors.find((item) => item.code === "SAFE_MARGIN_VIOLATED").fix, /字号|行宽|中心/);
});

test("text wrapping keeps long unbroken input and supports CJK and Latin runs", () => {
  const text = "连续纹样ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789甲乙丙丁";
  const lines = wrapText(text, 80, "700 18px serif", approximateTextWidth);
  assert.ok(lines.length > 2);
  assert.equal(lines.join(""), text);
  assert.ok(lines.every((line) => approximateTextWidth(line, "700 18px serif") <= 80.001));
});

test("layout remains in tile coordinates regardless of viewport zoom preference", () => {
  const project = createStandardProject();
  const measure = approximateTextWidth;
  const before = layoutText(project, getActiveScheme(project).colors, measure);
  project.canvas.zoom = 225;
  const after = layoutText(project, getActiveScheme(project).colors, measure);
  assert.deepEqual(after.block, before.block);
  assert.deepEqual(after.lines, before.lines);
});

test("SVG export retains editable text and native shape elements", () => {
  const project = createStandardProject();
  project.text.title = "A&B <纹样>";
  const svg = buildSvg(project, getActiveScheme(project), approximateTextWidth);
  assert.match(svg, /<svg[^>]+width="512"[^>]+height="512"/);
  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.match(svg, /<text /);
  assert.match(svg, /A&amp;B &lt;纹样&gt;/);
  assert.match(svg, /<ellipse /);
  assert.match(svg, /<circle /);
  assert.match(svg, /<path /);
  assert.doesNotMatch(svg, /<image /);
  assert.match(svg, /clip-path="url\(#tile-clip\)"/);
  assert.match(svg, /fonts\.googleapis\.com\/css2\?family=Noto\+Serif\+SC/);
  assert.match(svg, /id="shape-layer-0"/);
  assert.match(svg, /id="text-layer-0"/);
});

test("export metadata names the active locked primary and tidy filenames", () => {
  const project = createExtremeProject();
  setPrimaryColor(project, 0, "#803D2F");
  const svg = buildSvg(project, getActiveScheme(project), approximateTextWidth);
  assert.match(svg, /&quot;locked&quot;:true/);
  assert.match(svg, /&quot;primary&quot;:&quot;#803D2F&quot;/);
  assert.equal(safeFilename('a/b: "c"'), "a-b-c");
  assert.equal(escapeXml("<x>"), "&lt;x&gt;");
});

test("project fingerprints ignore transient zoom while tracking content", () => {
  const project = createStandardProject();
  const first = projectFingerprint(project);
  project.canvas.zoom = 240;
  project.canvas.showSeams = true;
  assert.equal(projectFingerprint(project), first);
  project.text.title = "新标题";
  assert.notEqual(projectFingerprint(project), first);
});
