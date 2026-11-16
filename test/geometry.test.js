import test from "node:test";
import assert from "node:assert/strict";
import {
  boundingBox,
  getCrop,
  hitTest,
  rectsIntersect,
  shapePath,
  visibleRect,
} from "../src/geometry.js";
import { createElement } from "../src/store.js";

test("shapePath emits editable path data for every shape type", () => {
  for (const type of ["rect", "ellipse", "triangle", "hexagon", "star"]) {
    const el = createElement(type, { width: 100, height: 80 });
    const d = shapePath(el);
    assert.match(d, /^M/);
    assert.match(d, /Z$/);
  }
  const rounded = shapePath(createElement("rect", { width: 100, height: 100, cornerRadius: 20 }));
  assert.match(rounded, /A20 20/);
});

test("rotation expands the axis-aligned bounding box around the center", () => {
  const el = createElement("rect", { x: 100, y: 100, width: 100, height: 40, rotation: 90 });
  const box = boundingBox(el);
  assert.ok(Math.abs(box.width - 40) < 0.01);
  assert.ok(Math.abs(box.height - 100) < 0.01);
  assert.ok(Math.abs(box.x - 130) < 0.01);
  assert.ok(Math.abs(box.y - 70) < 0.01);
});

test("visibleRect honors crop and rectsIntersect detects overlap", () => {
  const el = createElement("rect", { x: 10, y: 20, width: 100, height: 100, crop: { x: 20, y: 30, width: 40, height: 50 } });
  assert.deepEqual(visibleRect(el), { x: 30, y: 50, width: 40, height: 50 });
  assert.deepEqual(getCrop({ ...el, crop: null }), { x: 0, y: 0, width: 100, height: 100 });
  assert.equal(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), true);
  assert.equal(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 }), false);
});

test("hitTest respects ellipse geometry and rotation transform", () => {
  const circle = createElement("ellipse", { x: 0, y: 0, width: 100, height: 100 });
  assert.equal(hitTest(circle, 10, 50), true);
  assert.equal(hitTest(circle, 2, 2), false);
  const rotated = createElement("rect", { x: 0, y: 0, width: 100, height: 40, rotation: 90 });
  assert.equal(hitTest(rotated, 50, -20), true);
  assert.equal(hitTest(rotated, 90, 50), false);
  assert.equal(hitTest(rotated, 50, 60), true);
});
