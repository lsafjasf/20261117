// Assertion suite: reruns all scenarios in-process and verifies the
// invariants from the task. Exits non-zero on any failure.
import {
  buildApp,
  gestureScript,
  boundaryScript,
  runScript,
  IMPLS,
} from "../src/harness/scenarios.js";
let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name} ${detail}`);
  }
}
function run(impl, dpr, script) {
  const app = buildApp(IMPLS[impl], { dpr });
  runScript(app, script());
  return {
    app,
    export: app.export(),
    clicks: app.clickEvents,
    metrics: app.metrics.summary(),
    logs: app.logs,
    digest: app.renderer.digest(),
  };
}
const pos = (exp, id) => exp.nodes.find((n) => n.id === id);

// --- 1. High-DPI coordinate correctness (fixed) ---
const fsm1 = run("fsm", 1, gestureScript);
const fsm2 = run("fsm", 2, gestureScript);
const fsm3 = run("fsm", 3, gestureScript);
check(
  "fsm export identical across dpr 1/2/3",
  JSON.stringify(fsm1.export) === JSON.stringify(fsm2.export) &&
    JSON.stringify(fsm2.export) === JSON.stringify(fsm3.export)
);
check(
  "fsm frame digest identical across dpr",
  fsm1.digest === fsm2.digest && fsm2.digest === fsm3.digest
);

// --- 2. Semantics preserved at dpr=1 (fix must not alter behavior) ---
const leg1 = run("legacy", 1, gestureScript);
const samePos = ["A", "B", "C"].every((id) => {
  const a = pos(leg1.export, id);
  const b = pos(fsm1.export, id);
  return a.x === b.x && a.y === b.y;
});
check("node positions unchanged vs baseline at dpr=1", samePos);
check(
  "viewport zoom unchanged vs baseline at dpr=1",
  leg1.export.viewport.zoom === fsm1.export.viewport.zoom
);

// --- 3. Baseline defect is reproduced (documented, not hidden) ---
const leg2 = run("legacy", 2, gestureScript);
const jump = Math.hypot(
  pos(leg2.export, "B").x - pos(fsm2.export, "B").x,
  pos(leg2.export, "B").y - pos(fsm2.export, "B").y
);
check("legacy dpr=2 reproduces object jump", jump > 50, `jump=${jump}`);
check("legacy dpr=2 emits spurious click", leg2.clicks.length > fsm2.clicks.length);

// --- 4. No click after inertia or pinch (fixed) ---
check(
  "fsm emits exactly the two legitimate clicks",
  fsm2.clicks.length === 2 &&
    fsm2.clicks[0].nodeId === "A" &&
    fsm2.clicks[1].nodeId === null,
  JSON.stringify(fsm2.clicks)
);

// --- 5. Boundary inputs: no throw, diagnosable logs, state intact ---
const bFsm = run("fsm", 2, boundaryScript);
check("boundary: no spurious clicks", bFsm.clicks.length === 0);
check(
  "boundary: rejections are logged",
  bFsm.logs.counts().warn >= 5,
  JSON.stringify(bFsm.logs.counts())
);
check(
  "boundary: nodes untouched",
  ["A", "B", "C"].every((id) => {
    const n = pos(bFsm.export, id);
    return Number.isFinite(n.x) && Number.isFinite(n.y);
  })
);
check(
  "boundary: zoom stays finite and clamped",
  Number.isFinite(bFsm.export.viewport.zoom) &&
    bFsm.export.viewport.zoom >= 0.25 &&
    bFsm.export.viewport.zoom <= 4
);
const bLeg = run("legacy", 2, boundaryScript);
check(
  "boundary: legacy corrupts viewport (baseline evidence)",
  !Number.isFinite(bLeg.export.viewport.zoom)
);

// --- 6. Resource release: zero leaks, rerun does not degrade ---
const rel1 = run("fsm", 2, gestureScript);
rel1.app.dispose();
const res = rel1.app.resourceCounts();
check(
  "dispose releases all resources",
  res.listeners === 0 && res.timers === 0 && res.gridCacheEntries === 0 &&
    res.gridCells === 0 && res.nodes === 0,
  JSON.stringify(res)
);
const rel2 = run("fsm", 2, gestureScript);
check(
  "rerun after dispose: same output",
  JSON.stringify(rel1.export) === JSON.stringify(rel2.export)
);
check(
  "rerun after dispose: cache hit rate not degraded",
  rel2.metrics.cacheHitRate >= rel1.metrics.cacheHitRate - 0.01,
  `${rel1.metrics.cacheHitRate} -> ${rel2.metrics.cacheHitRate}`
);
check(
  "rerun after dispose: frame time not continuously degrading",
  rel2.metrics.frameTimeAvgMs <= Math.max(1, rel1.metrics.frameTimeAvgMs * 3),
  `${rel1.metrics.frameTimeAvgMs} -> ${rel2.metrics.frameTimeAvgMs}`
);

// --- 7. Observable metrics present ---
const metricKeys = ["frameTimeAvgMs", "cacheHitRate", "activeNodes", "collisionCandidates"];
for (const key of metricKeys) {
  check(`metric present: ${key}`, key in fsm2.metrics);
}

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
