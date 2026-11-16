import { SoftwareDevice, diffSnapshots, tracesAreSafe } from './framebuffer.js';
import { TextureRegistry, TextCache } from './resource.js';
import {
  validateScene, SceneValidationError, buildSpriteRegistry
} from './scene.js';
import { prepareRenderList, countCandidateCollisions, summarizeNodes } from './prepare.js';
import { renderFrameBaseline } from './render-baseline.js';
import { renderFrameBatched } from './render-batched.js';
import { renderFrameUnsafe } from './render-unsafe.js';
import { measureFrames, collectStructuralMetrics, compareRuns } from './metrics.js';
import { formatValidationErrors } from './logger.js';

function assertValid(scene, logger) {
  const errors = validateScene(scene);
  if (errors.length > 0) {
    logger.error('scene.validation_failed', { scene: scene.name, errors });
    throw new SceneValidationError(errors);
  }
}

function buildEnvironment(scene) {
  const registry = new TextureRegistry();
  buildSpriteRegistry(scene, registry);
  const ordered = prepareRenderList(scene);
  const summary = summarizeNodes(ordered);
  const candidatePairs = countCandidateCollisions(ordered);
  return { registry, ordered, summary, candidatePairs };
}

function makeDevice(scene) {
  return new SoftwareDevice({ width: scene.width, height: scene.height });
}

// Runs both pipelines over the same fixed scene and enforces bit-identical
// framebuffers. Also runs the deliberately unsafe renderer as a negative
// control and asserts that the consistency gate DOES detect its reordering.
export function runConsistencyScenario(scene, { frameCount = 30 }, logger) {
  assertValid(scene, logger);
  const env = buildEnvironment(scene);
  logger.info('scenario.start', { scene: scene.name, frames: frameCount, nodes: env.summary.total });

  const baseDevice = makeDevice(scene);
  const optDevice = makeDevice(scene);
  const optCache = new TextCache(env.registry);

  const baseTiming = measureFrames('baseline', frameCount, () =>
    renderFrameBaseline(baseDevice, scene, env.ordered, env.registry));
  const optTiming = measureFrames('batched', frameCount, () =>
    renderFrameBatched(optDevice, scene, env.ordered, env.registry, optCache));

  const baseSnapshot = baseDevice.snapshot();
  const optSnapshot = optDevice.snapshot();
  const diff = diffSnapshots(baseSnapshot, optSnapshot);
  const frameFingerprint = baseDevice.fingerprint();
  const traceEqual = tracesAreSafe(baseDevice.trace, optDevice.trace);

  const baseMetrics = collectStructuralMetrics(
    baseTiming.last.deviceStats, env.summary, env.candidatePairs, env.registry, null);
  const optMetrics = collectStructuralMetrics(
    optTiming.last.deviceStats, env.summary, env.candidatePairs, env.registry, optCache);
  const comparison = compareRuns(
    { ...baseMetrics, avgFrameMs: baseTiming.avgFrameMs },
    { ...optMetrics, avgFrameMs: optTiming.avgFrameMs });

  if (!diff.equal) {
    logger.error('consistency.failed', { scene: scene.name, diff });
    throw new Error(`pixel mismatch in scene ${scene.name}: ${diff.differingPixels} pixels`);
  }
  if (!traceEqual) {
    logger.error('consistency.trace_mismatch', { scene: scene.name });
    throw new Error(`submission trace mismatch in scene ${scene.name}`);
  }

  // Negative control: unsafe grouping must produce a different framebuffer on
  // an overlapping transparent scene, proving the gate has teeth.
  const unsafeDevice = makeDevice(scene);
  const unsafeRegistry = new TextureRegistry();
  buildSpriteRegistry(scene, unsafeRegistry);
  renderFrameUnsafe(unsafeDevice, scene, env.ordered, unsafeRegistry, new TextCache(unsafeRegistry));
  const unsafeDiff = diffSnapshots(baseSnapshot, unsafeDevice.snapshot());
  const unsafeTraceEqual = tracesAreSafe(baseDevice.trace, unsafeDevice.trace);
  if (unsafeDiff.equal && unsafeTraceEqual) {
    logger.warn('consistency.negative_control_inconclusive', { scene: scene.name });
  } else {
    logger.info('consistency.negative_control_detected', {
      scene: scene.name,
      differingPixels: unsafeDiff.differingPixels,
      traceReordered: !unsafeTraceEqual
    });
  }
  unsafeDevice.dispose();
  unsafeRegistry.dispose();

  logger.info('scenario.metrics', {
    scene: scene.name,
    baseline: { ...baseMetrics, avgFrameMs: baseTiming.avgFrameMs, p95FrameMs: baseTiming.p95FrameMs },
    batched: { ...optMetrics, avgFrameMs: optTiming.avgFrameMs, p95FrameMs: optTiming.p95FrameMs },
    comparison
  });

  baseDevice.dispose();
  optDevice.dispose();
  return {
    scene: scene.name,
    frameFingerprint,
    pixelEqual: diff.equal,
    traceEqual,
    negativeControlDetected: !unsafeDiff.equal || !unsafeTraceEqual,
    negativeControlDiff: unsafeDiff,
    baseline: { timing: baseTiming, metrics: baseMetrics },
    batched: { timing: optTiming, metrics: optMetrics },
    comparison,
    registry: env.registry,
    textCache: optCache
  };
}

// Full lifecycle check: build -> run -> dispose, repeated. Structural metrics
// must stay identical across generations and no texture may remain live after
// dispose. Timing jitter is allowed but must not trend upward beyond tolerance.
export function runReleaseStability(scene, { generations = 3, frameCount = 12 }, logger) {
  assertValid(scene, logger);
  const generationsReport = [];

  for (let generation = 0; generation < generations; generation += 1) {
    const env = buildEnvironment(scene);
    const device = makeDevice(scene);
    const cache = new TextCache(env.registry);
    const timing = measureFrames(`batched-gen-${generation}`, frameCount, () =>
      renderFrameBatched(device, scene, env.ordered, env.registry, cache));
    const fingerprint = device.fingerprint();
    const metrics = collectStructuralMetrics(
      timing.last.deviceStats, env.summary, env.candidatePairs, env.registry, cache);

    device.dispose();
    const liveBeforeRegistryDispose = env.registry.liveCount;
    env.registry.dispose();
    const liveAfterRegistryDispose = env.registry.liveCount;

    logger.info('stability.generation', {
      generation, fingerprint, metrics, liveBeforeRegistryDispose, liveAfterRegistryDispose
    });
    generationsReport.push({
      generation,
      fingerprint,
      metrics,
      avgFrameMs: timing.avgFrameMs,
      liveBeforeRegistryDispose,
      liveAfterRegistryDispose,
      cacheSnapshot: cache.snapshot()
    });
  }

  const anchor = generationsReport[0].metrics;
  const structuralDrift = generationsReport.filter((report) =>
    JSON.stringify(report.metrics) !== JSON.stringify(anchor));
  const fingerprintDrift = generationsReport
    .some((report) => report.fingerprint !== generationsReport[0].fingerprint);
  const leak = generationsReport
    .some((report) => report.liveAfterRegistryDispose !== 0);
  const disposedAllTracked = generationsReport
    .every((report) => report.liveBeforeRegistryDispose > 0);

  const timings = generationsReport.map((report) => report.avgFrameMs);
  const monotonicWorse = timings.every((value, index) => index === 0 || value >= timings[index - 1])
    && timings[timings.length - 1] > timings[0] * 1.25;

  const stable = structuralDrift.length === 0 && !fingerprintDrift && !leak
    && disposedAllTracked && !monotonicWorse;
  logger.info('stability.summary', {
    stable, structuralDrift: structuralDrift.length, fingerprintDrift, leak,
    disposedAllTracked, timings
  });
  if (!stable) {
    throw new Error('release stability regression detected');
  }
  return { stable, generations: generationsReport, timings };
}

// Invalid input path: validation rejects the scene before any device work.
// Diagnostics are returned and logged; nothing is silently skipped.
export function runInvalidScenario(scene, logger) {
  const errors = validateScene(scene);
  if (errors.length === 0) {
    throw new Error('invalid scene unexpectedly passed validation');
  }
  logger.error('scenario.invalid_input_rejected', {
    scene: scene.name,
    errorCount: errors.length,
    errors
  });
  return {
    scene: scene.name,
    rejected: true,
    errorCount: errors.length,
    errors,
    rendered: false,
    diagnosticText: formatValidationErrors(errors)
  };
}
