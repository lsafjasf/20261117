import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { JsonlLogger } from './logger.js';
import { buildFixedScene, buildBoundaryScene, buildInvalidScene } from './scene.js';
import { runConsistencyScenario, runReleaseStability, runInvalidScenario } from './harness.js';
import { formatValidationErrors } from './logger.js';

const RUN_ID = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const OUT_DIR = join(process.cwd(), 'artifacts', RUN_ID);
mkdirSync(OUT_DIR, { recursive: true });
const logger = new JsonlLogger(join(OUT_DIR, 'events.jsonl'), RUN_ID);

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function printMetrics(label, timing, metrics) {
  console.log(`[${label}]`);
  console.log(`  frame avg/p95 ms : ${timing.avgFrameMs} / ${timing.p95FrameMs}`);
  console.log(`  draw calls       : ${metrics.drawCalls}`);
  console.log(`  state changes    : ${metrics.stateChanges}`);
  console.log(`  pixels blended   : ${metrics.pixelsBlended}`);
  console.log(`  active nodes     : ${metrics.activeNodes} (culled ${metrics.culledNodes})`);
  console.log(`  candidate pairs  : ${metrics.candidateCollisionPairs}`);
  console.log(`  live textures    : ${metrics.liveTextures} (${metrics.liveTextureBytes} bytes)`);
  if (metrics.textCacheHitRate !== null) {
    console.log(`  text cache hit   : ${metrics.textCacheHitRate}`);
  }
}

function main() {
  logger.info('run.start', { runId: RUN_ID });
  const report = { runId: RUN_ID, scenarios: {} };

  printHeader('Scenario 1: fixed large scene (before vs after)');
  const fixedScene = buildFixedScene();
  const fixedResult = runConsistencyScenario(fixedScene, { frameCount: 30 }, logger);
  printMetrics('baseline (before)', fixedResult.baseline.timing, fixedResult.baseline.metrics);
  printMetrics('batched (after)', fixedResult.batched.timing, fixedResult.batched.metrics);
  console.log(`  text textures rebuilt/frame (baseline): ${fixedResult.baseline.timing.last.transientTexturesCreated}`);
  console.log(`  batches/layers (batched) : ${fixedResult.batched.timing.last.flushedBatches} / ${fixedResult.batched.timing.last.layers}`);
  console.log(`  pixel identical  : ${fixedResult.pixelEqual}`);
  console.log(`  unsafe batcher caught by gate: ${fixedResult.negativeControlDetected}`);
  console.log(`  draw-call delta  : ${fixedResult.comparison.drawCallDelta} (${(fixedResult.comparison.drawCallChangeRatio * 100).toFixed(1)}%)`);
  report.scenarios.fixed = fixedResult;

  printHeader('Scenario 2: boundary inputs (off-screen, alpha extremes, cache reuse)');
  const boundaryScene = buildBoundaryScene();
  const boundaryResult = runConsistencyScenario(boundaryScene, { frameCount: 8 }, logger);
  console.log(`  pixel identical  : ${boundaryResult.pixelEqual}`);
  console.log(`  active/culled    : ${boundaryResult.batched.metrics.activeNodes} / ${boundaryResult.batched.metrics.culledNodes}`);
  console.log(`  cache hit rate   : ${boundaryResult.batched.metrics.textCacheHitRate}`);
  const stability = runReleaseStability(boundaryScene, { generations: 3, frameCount: 8 }, logger);
  console.log(`  release stable   : ${stability.stable}`);
  report.scenarios.boundary = boundaryResult;
  report.scenarios.stability = stability;

  printHeader('Scenario 3: invalid input (must reject with diagnostics)');
  const invalidResult = runInvalidScenario(buildInvalidScene(), logger);
  console.log(`  rejected         : ${invalidResult.rejected}`);
  console.log(`  errors logged    : ${invalidResult.errorCount}`);
  console.log(invalidResult.diagnosticText);
  report.scenarios.invalid = invalidResult;

  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  logger.info('run.complete', {
    outDir: OUT_DIR,
    errorLogEntries: logger.count('error'),
    warnLogEntries: logger.count('warn')
  });
  console.log(`\nArtifacts: ${OUT_DIR}`);
}

try {
  main();
} catch (error) {
  logger.error('run.fatal', { name: error.name, message: error.message, stack: error.stack });
  console.error(`FATAL: ${error.message}`);
  if (error.errors) console.error(formatValidationErrors(error.errors));
  process.exitCode = 1;
}
