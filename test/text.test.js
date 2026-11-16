import test from "node:test";
import assert from "node:assert/strict";
import { layoutText, fontString } from "../src/text.js";
import { createElement } from "../src/store.js";
import { MockContext } from "./mock-context.js";

test("CJK text wraps per character when a single token exceeds box width", () => {
  const el = createElement("text", {
    width: 120,
    height: 400,
    fontSize: 20,
    text: "一二三四五六七八九十一二三四五六七八九十",
  });
  const layout = layoutText(el, new MockContext());
  assert.ok(layout.lines.length > 1, "expected wrapping into multiple lines");
  assert.equal(layout.lines.join(""), el.text);
});

test("explicit newlines create paragraph breaks and are preserved", () => {
  const el = createElement("text", { width: 500, height: 200, fontSize: 20, text: "第一行\n\n第三行" });
  const layout = layoutText(el, new MockContext());
  assert.deepEqual(layout.lines, ["第一行", "", "第三行"]);
});

test("autoFit shrinks font until long text fits inside the box", () => {
  const el = createElement("text", {
    width: 160,
    height: 80,
    fontSize: 24,
    autoFit: true,
    text: "超长标题超长标题超长标题超长标题超长标题超长标题",
  });
  const layout = layoutText(el, new MockContext());
  assert.ok(layout.fontSize < 24);
  assert.equal(layout.overflowY, false);
  assert.ok(layout.blockHeight <= el.height + 0.5);
});

test("without autoFit overflow is reported instead of silently clipping", () => {
  const el = createElement("text", {
    width: 120,
    height: 24,
    fontSize: 20,
    autoFit: false,
    text: "固定字号内容很多很多很多很多",
  });
  const layout = layoutText(el, new MockContext());
  assert.equal(layout.overflowY, true);
  assert.equal(layout.fontSize, 20);
});

test("fontString always carries weight, size and a generic family fallback", () => {
  const el = createElement("text", { fontSize: 18, fontFamily: "mono", fontWeight: 400, fontStyle: "italic" });
  const font = fontString(el);
  assert.match(font, /italic 400 18px/);
  assert.match(font, /monospace/);
});
