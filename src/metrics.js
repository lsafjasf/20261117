// Injectable clock so frame timing is deterministic in headless runs.
export class Clock {
  constructor(start = 0) {
    this.now = start;
  }
  advance(ms) {
    this.now += ms;
    return this.now;
  }
  time() {
    return this.now;
  }
}

// Observable metrics: frame time, spatial-cache hit rate,
// active node count, collision candidate count.
export class Metrics {
  constructor() {
    this.frames = 0;
    this.frameTimes = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.activeNodes = 0; // last rendered count
    this.activeNodesPeak = 0;
    this.collisionCandidates = 0; // total candidates examined
    this.collisionQueries = 0;
  }
  recordFrame(ms) {
    this.frames += 1;
    this.frameTimes.push(ms);
  }
  recordCache(hit) {
    if (hit) this.cacheHits += 1;
    else this.cacheMisses += 1;
  }
  recordActiveNodes(n) {
    this.activeNodes = n;
    if (n > this.activeNodesPeak) this.activeNodesPeak = n;
  }
  recordCollision(candidates) {
    this.collisionQueries += 1;
    this.collisionCandidates += candidates;
  }
  summary() {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const avg = sorted.length
      ? sorted.reduce((a, b) => a + b, 0) / sorted.length
      : 0;
    const p95 = sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
      : 0;
    const totalCache = this.cacheHits + this.cacheMisses;
    return {
      frames: this.frames,
      frameTimeAvgMs: Number(avg.toFixed(3)),
      frameTimeP95Ms: Number(p95.toFixed(3)),
      cacheHitRate: totalCache
        ? Number((this.cacheHits / totalCache).toFixed(4))
        : 0,
      cacheLookups: totalCache,
      activeNodes: this.activeNodes,
      activeNodesPeak: this.activeNodesPeak,
      collisionCandidates: this.collisionCandidates,
      collisionQueries: this.collisionQueries,
    };
  }
}

// Diagnosable log sink: entries are kept, never swallowed.
export class LogSink {
  constructor() {
    this.entries = [];
  }
  log(level, code, message, context = {}) {
    this.entries.push({ level, code, message, context });
  }
  info(code, message, context) {
    this.log("info", code, message, context);
  }
  warn(code, message, context) {
    this.log("warn", code, message, context);
  }
  error(code, message, context) {
    this.log("error", code, message, context);
  }
  counts() {
    const c = { info: 0, warn: 0, error: 0 };
    for (const e of this.entries) c[e.level] += 1;
    return c;
  }
}
