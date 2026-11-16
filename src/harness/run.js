// Scenario runner: baseline (legacy), fixed (state machine), boundary
// inputs, and a dispose-and-rerun resource check. Writes JSON artifacts
// and prints a comparison table.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildApp,
  gestureScript,
  boundaryScript,
  runScript,
  IMPLS,
} from "./scenarios.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "artifacts", "results");
mkdirSync(outDir, { recursive: true });

function snapshot(app, extra = {}) {
  return {
    metrics: app.metrics.summary(),
    logCounts: app.logs.counts(),
    clicks: app.clickEvents,
    export: app.export(),
    frameDigest: app.renderer.digest(),
    resources: app.resourceCounts(),
    ...extra,
  };
}

function runGesture(implName, dpr) {
  const app = buildApp(IMPLS[implName], { dpr });
  runScript(app, gestureScript());
  const snap = snapshot(app, { impl: implName, dpr });
  app.dispose();
  snap.resourcesAfterDispose = app.resourceCounts();
  return snap;
}

// Release check: run, dispose, verify zero resources, rerun fresh and
// confirm metrics do not continuously degrade.
function runReleaseCheck() {
  const first = runGesture("fsm", 2);
  const second = runGesture("fsm", 2);
  const ratio = (a, b) => (b === 0 ? (a === 0 ? 1 : Infinity) : a / b);
  return {
    first,
    second,
    degradation: {
      frameTimeAvgRatio: Number(
        ratio(second.metrics.frameTimeAvgMs, first.metrics.frameTimeAvgMs).toFixed(3)
      ),
      cacheHitRateDelta: Number(
        (second.metrics.cacheHitRate - first.metrics.cacheHitRate).toFixed(4)
      ),
    },
  };
}

const results = {
  generatedAt: new Date().toISOString(),
  baseline: {
    legacy_dpr1: runGesture("legacy", 1),
    legacy_dpr2: runGesture("legacy", 2),
  },
  fixed: {
    fsm_dpr1: runGesture("fsm", 1),
    fsm_dpr2: runGesture("fsm", 2),
    fsm_dpr3: runGesture("fsm", 3),
  },
  boundary: {
    fsm_boundary_dpr2: runBoundary("fsm", 2),
    legacy_boundary_dpr2: runBoundary("legacy", 2),
  },
  release: runReleaseCheck(),
};

writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));

function row(label, s) {
  const m = s.metrics;
  const b = s.export.nodes.find((n) => n.id === "B");
  return [
    label.padEnd(22),
    `frames=${m.frames}`,
    `frameAvg=${m.frameTimeAvgMs}ms`,
    `p95=${m.frameTimeP95Ms}ms`,
    `cacheHit=${m.cacheHitRate}`,
    `active=${m.activeNodes}`,
    `cand=${m.collisionCandidates}`,
    `clicks=${s.clicks.length}`,
    `B=(${b.x},${b.y})`,
    `warn=${s.logCounts.warn}`,
  ].join(" ");
}

console.log("== gesture scenario ==");
console.log(row("legacy dpr=1 (baseline)", results.baseline.legacy_dpr1));
console.log(row("legacy dpr=2 (baseline)", results.baseline.legacy_dpr2));
console.log(row("fsm dpr=1 (fixed)", results.fixed.fsm_dpr1));
console.log(row("fsm dpr=2 (fixed)", results.fixed.fsm_dpr2));
console.log(row("fsm dpr=3 (fixed)", results.fixed.fsm_dpr3));
console.log("== boundary scenario ==");
console.log(row("fsm boundary dpr=2", results.boundary.fsm_boundary_dpr2));
console.log(row("legacy boundary dpr=2", results.boundary.legacy_boundary_dpr2));
console.log("== release check ==");
console.log(
  "resources after dispose:",
  JSON.stringify(results.release.first.resourcesAfterDispose)
);
console.log("degradation:", JSON.stringify(results.release.degradation));
console.log(`wrote ${join(outDir, "results.json")}`);

function runBoundary(implName, dpr = 2) {
  const app = buildApp(IMPLS[implName], { dpr });
  let threw = null;
  try {
    runScript(app, boundaryScript());
  } catch (err) {
    threw = String(err && err.stack ? err.stack : err);
  }
  const snap = snapshot(app, { impl: implName, dpr, threw });
  snap.warnings = app.logs.entries.filter((e) => e.level !== "info");
  app.dispose();
  snap.resourcesAfterDispose = app.resourceCounts();
  return snap;
}
