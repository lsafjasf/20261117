import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDocument } from "../src/validate.js";
import { createDocument, createElement } from "../src/store.js";
import { MockContext } from "./mock-context.js";

async function loadCase(name) {
  const raw = await readFile(new URL(`../cases/${name}`, import.meta.url), "utf8");
  return JSON.parse(raw);
}

test("standard case passes safe-margin, overlap and crop checks", async () => {
  const doc = await loadCase("standard.poster.json");
  const report = validateDocument(doc, new MockContext());
  const hard = report.issues.filter((i) => i.level === "error");
  assert.deepEqual(hard, [], "standard case must have no blocking errors");
  const warnings = report.issues.filter((i) => i.rule === "SAFE_MARGIN");
  assert.deepEqual(warnings, []);
});

test("extreme case flags tiny size, out-of-canvas and text overflow with fix hints", async () => {
  const doc = await loadCase("extreme.poster.json");
  const report = validateDocument(doc, new MockContext());
  const rules = report.issues.map((i) => i.rule);
  assert.ok(rules.includes("MIN_SIZE"));
  assert.ok(rules.includes("OUT_OF_CANVAS"));
  assert.ok(rules.includes("TEXT_OVERFLOW"));
  for (const issue of report.issues) {
    assert.ok(issue.fix.length > 8, `issue ${issue.rule} must explain how to fix it`);
    assert.ok(issue.message.length > 8);
  }
  assert.equal(report.ok, false);
});

test("out-of-canvas reports how many pixels must move back", () => {
  const doc = createDocument({
    elements: [createElement("rect", { x: -30, y: 10, width: 100, height: 100 })],
  });
  const report = validateDocument(doc);
  const issue = report.issues.find((i) => i.rule === "OUT_OF_CANVAS");
  assert.ok(issue);
  assert.match(issue.message, /水平越界 30px/);
});

test("invalid crop range is rejected with CROP_RANGE rule", () => {
  const doc = createDocument({
    elements: [createElement("rect", {
      x: 10, y: 10, width: 100, height: 100,
      crop: { x: 80, y: 80, width: 60, height: 60 },
    })],
  });
  const report = validateDocument(doc);
  assert.ok(report.issues.some((i) => i.rule === "CROP_RANGE"));
});

test("overlap detection reports both elements and coverage ratio", () => {
  const doc = createDocument({
    elements: [
      createElement("rect", { id: "a", x: 0, y: 0, width: 100, height: 100 }),
      createElement("rect", { id: "b", x: 50, y: 50, width: 100, height: 100 }),
    ],
  });
  const report = validateDocument(doc);
  const overlap = report.issues.find((i) => i.rule === "OVERLAP");
  assert.ok(overlap);
  assert.match(overlap.id, /a\|b/);
  assert.match(overlap.message, /%/);
});
