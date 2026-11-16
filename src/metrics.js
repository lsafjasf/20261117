import { performance } from 'node:perf_hooks';

export function measureFrames(label, frameCount, render) {
  const perFrameMs = [];
  let last = null;
  // Warmup frame so JIT and cache population do not skew timed frames.
  last = render(0);
  const start = performance.now();
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameStart = performance.now();
    last = render(frame);
    perFrameMs.push(performance.now() - frameStart);
  }
  const totalMs = performance.now() - start;
  const sorted = perFrameMs.slice().sort((a, b) => a - b);
  return {
    label,
    frameCount,
    totalMs: round(totalMs),
    avgFrameMs: round(totalMs / frameCount),
    p50FrameMs: round(sorted[Math.floor(sorted.length * 0.5)]),
    p95FrameMs: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
    last
  };
}

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function collectStructuralMetrics(deviceStats, nodeSummary, candidatePairs, registry, textCache) {
  return {
    drawCalls: deviceStats.drawCalls,
    stateChanges: deviceStats.stateChanges,
    pixelsBlended: deviceStats.pixelsBlended,
    activeNodes: nodeSummary.visible,
    culledNodes: nodeSummary.culled,
    candidateCollisionPairs: candidatePairs,
    liveTextures: registry.liveCount,
    liveTextureBytes: registry.liveBytes,
    textCacheHitRate: textCache ? round(textCache.hitRate) : null
  };
}

export function compareRuns(base, optimized) {
  const ratio = (after, before) => (before === 0 ? null : round((after - before) / before, 4));
  return {
    drawCallDelta: optimized.drawCalls - base.drawCalls,
    drawCallChangeRatio: ratio(optimized.drawCalls, base.drawCalls),
    stateChangeDelta: optimized.stateChanges - base.stateChanges,
    avgFrameMsDelta: round(optimized.avgFrameMs - base.avgFrameMs),
    avgFrameMsChangeRatio: ratio(optimized.avgFrameMs, base.avgFrameMs)
  };
}
