import test from "node:test";
import assert from "node:assert/strict";
import { Store, createDocument, createElement } from "../src/store.js";
import { parseDocument, projectJson } from "../src/persistence.js";

function freshStore() {
  return new Store(createDocument({
    elements: [
      createElement("rect", { id: "a", name: "A", x: 0, y: 0, width: 100, height: 100 }),
      createElement("rect", { id: "b", name: "B", x: 200, y: 0, width: 100, height: 100 }),
    ],
  }));
}

test("undo and redo restore every committed mutation", () => {
  const store = freshStore();
  assert.equal(store.canUndo(), false);
  store.updateElement("a", { x: 50 });
  assert.equal(store.doc.elements[0].x, 50);
  assert.equal(store.undo(), true);
  assert.equal(store.doc.elements[0].x, 0);
  assert.equal(store.redo(), true);
  assert.equal(store.doc.elements[0].x, 50);
});

test("a new mutation clears the redo stack", () => {
  const store = freshStore();
  store.updateElement("a", { x: 10 });
  store.undo();
  store.updateElement("b", { y: 20 });
  assert.equal(store.canRedo(), false);
});

test("layer move changes z-order and clamps impossible moves", () => {
  const store = freshStore();
  store.moveLayer("a", 1);
  assert.deepEqual(store.doc.elements.map((e) => e.id), ["b", "a"]);
  assert.throws(() => store.moveLayer("b", -1), /最底层/);
});

test("drag reorder places the layer at the dropped index", () => {
  const store = freshStore();
  store.reorderTo("a", 1);
  assert.deepEqual(store.doc.elements.map((e) => e.id), ["b", "a"]);
});

test("alignment moves selection to shared edges and canvas center", () => {
  const store = freshStore();
  store.align(["a", "b"], "left");
  assert.equal(store.doc.elements[0].x, store.doc.elements[1].x);
  store.align(["a"], "canvas-h");
  assert.equal(store.doc.elements[0].x, 800 / 2 - 50);
  store.align(["a"], "canvas-v");
  assert.equal(store.doc.elements[0].y, 600 / 2 - 50);
});

test("save -> JSON -> reload round trip keeps text and shapes editable", () => {
  const store = freshStore();
  store.updateElement("a", { fill: "#ff0000", crop: { x: 1, y: 2, width: 10, height: 20 } });
  const json = projectJson(store.doc);
  const result = parseDocument(json);
  assert.equal(result.ok, true);
  assert.deepEqual(result.doc, store.doc);
  assert.equal(typeof result.doc.elements[0].type, "string");
});

test("malformed JSON is rejected while caller keeps its current document", () => {
  const result = parseDocument("{ not valid json");
  assert.equal(result.ok, false);
  assert.match(result.error, /JSON 解析失败/);
});

test("schema violations name the exact field and rule instead of dropping content", () => {
  const broken = {
    width: -5,
    height: 600,
    elements: [
      { id: "x", type: "mystery", x: 0, y: 0, width: 0, height: 100 },
      { id: "x", type: "rect", x: 0, y: 0, width: 10, height: 10, crop: { x: 5, y: 5, width: 20, height: 20 } },
    ],
  };
  const result = parseDocument(broken);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("width 必须是正数")));
  assert.ok(result.violations.some((v) => v.includes("UNIQUE_ID")));
  assert.ok(result.violations.some((v) => v.includes("mystery")));
});

test("tiny elements and out-of-range crops still load so layout validation can flag them", () => {
  const result = parseDocument({
    width: 200,
    height: 200,
    elements: [
      { id: "tiny", type: "rect", x: 0, y: 0, width: 3, height: 3 },
      { id: "cropped", type: "rect", x: 0, y: 0, width: 50, height: 50, crop: { x: 40, y: 40, width: 40, height: 40 } },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.doc.elements.length, 2);
});

test("replaceDocument resets history so undo cannot reach discarded content", () => {
  const store = freshStore();
  store.updateElement("a", { x: 99 });
  store.replaceDocument(createDocument());
  assert.equal(store.canUndo(), false);
  assert.equal(store.doc.elements.length, 0);
});
