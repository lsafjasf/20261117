import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toSvg } from "../src/svg.js";
import { drawDocument, renderToCanvas } from "../src/renderer.js";
import { layoutText } from "../src/text.js";
import { MockCanvas, MockContext } from "./mock-context.js";

async function loadCase(name) {
  return JSON.parse(await readFile(new URL(`../cases/${name}`, import.meta.url), "utf8"));
}

test("SVG keeps text as <text>/<tspan> and shapes as editable <path>", async () => {
  const doc = await loadCase("standard.poster.json");
  const svg = toSvg(doc, new MockContext());
  assert.match(svg, /<svg[^>]*width="800"[^>]*height="600"/);
  assert.match(svg, /<text[^>]*>[\s\S]*<tspan/);
  assert.match(svg, /<path[^>]*d="M/);
  assert.doesNotMatch(svg, /<image/);
  assert.doesNotMatch(svg, /base64/);
  assert.doesNotMatch(svg, /NaN/);
  assert.match(svg, /<tspan x="\d+(\.\d+)?"/);
  for (const el of doc.elements) {
    assert.match(svg, new RegExp(`data-id="${el.id}"`));
  }
});

test("cropped elements emit a clipPath in both SVG vocabulary and canvas calls", async () => {
  const doc = await loadCase("extreme.poster.json");
  const svg = toSvg(doc, new MockContext());
  assert.match(svg, /<clipPath id="clip-cropped-star">/);
  const ctx = new MockContext();
  drawDocument(ctx, doc);
  assert.ok(ctx.calls.some((c) => c.name === "clip"));
});

test("canvas and SVG use identical wrapped lines for every text element", async () => {
  const doc = await loadCase("extreme.poster.json");
  const ctx = new MockContext();
  for (const el of doc.elements.filter((e) => e.type === "text")) {
    const layout = layoutText(el, ctx);
    const svg = toSvg({ ...doc, elements: [el] }, ctx);
    for (const line of layout.lines) {
      if (line) assert.ok(svg.includes(`>${escapeForHtml(line)}<`), `line "${line}" must appear in SVG`);
    }
    const tspanCount = (svg.match(/<tspan/g) || []).length;
    assert.equal(tspanCount, layout.lines.length);
  }
});

test("renderToCanvas draws background plus one fill per shape and one fillText per text line", async () => {
  const doc = await loadCase("standard.poster.json");
  const mock = new MockCanvas();
  renderToCanvas(doc, mock);
  assert.equal(mock.width, 800);
  assert.equal(mock.height, 600);
  const calls = mock.context.calls;
  assert.ok(calls.some((c) => c.name === "fillRect" && c.args[2] === 800));
  const shapes = doc.elements.filter((e) => e.type !== "text");
  const fillCalls = calls.filter((c) => c.name === "fill").length;
  assert.equal(fillCalls, shapes.length);
  const textLines = doc.elements
    .filter((e) => e.type === "text")
    .reduce((sum, el) => sum + layoutText(el, mock.context).lines.filter((l) => l).length, 0);
  const fillTextCalls = calls.filter((c) => c.name === "fillText").length;
  assert.equal(fillTextCalls, textLines);
});

test("re-rendering the same document produces an identical call sequence (deterministic preview/export)", async () => {
  const doc = await loadCase("standard.poster.json");
  const a = new MockContext();
  const b = new MockContext();
  drawDocument(a, doc);
  drawDocument(b, doc);
  assert.deepEqual(a.calls, b.calls);
});

function escapeForHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
