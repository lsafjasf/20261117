import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoftwareDevice, diffSnapshots, tracesAreSafe } from '../src/framebuffer.js';
import { TextureRegistry, TextCache } from '../src/resource.js';
import {
  buildFixedScene, buildBoundaryScene, buildInvalidScene,
  buildSpriteRegistry, validateScene, SceneValidationError
} from '../src/scene.js';
import { prepareRenderList, countCandidateCollisions, summarizeNodes } from '../src/prepare.js';
import { renderFrameBaseline } from '../src/render-baseline.js';
import { renderFrameBatched } from '../src/render-batched.js';
import { renderFrameUnsafe } from '../src/render-unsafe.js';

function renderPair(scene) {
  const registryA = new TextureRegistry();
  const registryB = new TextureRegistry();
  buildSpriteRegistry(scene, registryA);
  buildSpriteRegistry(scene, registryB);
  const ordered = prepareRenderList(scene);
  const deviceA = new SoftwareDevice({ width: scene.width, height: scene.height });
  const deviceB = new SoftwareDevice({ width: scene.width, height: scene.height });
  renderFrameBaseline(deviceA, scene, ordered, registryA);
  const result = renderFrameBatched(
    deviceB, scene, ordered, registryB, new TextCache(registryB));
  return {
    deviceA, deviceB, registryA, registryB, ordered,
    diff: diffSnapshots(deviceA.snapshot(), deviceB.snapshot()),
    result
  };
}

test('batched output is pixel-identical to baseline on the fixed scene', () => {
  const pair = renderPair(buildFixedScene());
  assert.equal(pair.diff.equal, true);
  assert.equal(pair.diff.differingPixels, 0);
  assert.equal(tracesAreSafe(pair.deviceA.trace, pair.deviceB.trace), true);
});

test('batching strictly reduces draw calls without changing blended pixels', () => {
  const scene = buildFixedScene();
  const pair = renderPair(scene);
  assert.ok(pair.result.deviceStats.drawCalls < pair.deviceA.stats.drawCalls);
  assert.equal(pair.result.deviceStats.pixelsBlended, pair.deviceA.stats.pixelsBlended);
});

test('boundary scene stays pixel-identical including culled zero-alpha nodes', () => {
  const scene = buildBoundaryScene();
  const pair = renderPair(scene);
  const summary = summarizeNodes(pair.ordered);
  assert.equal(summary.culled, 2);
  assert.equal(pair.diff.equal, true);
});

test('stable sort preserves (z, id) transparency order', () => {
  const scene = buildFixedScene();
  const ordered = prepareRenderList(scene);
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    assert.ok(prev.z < curr.z || (prev.z === curr.z && prev.id <= curr.id));
  }
});

test('text cache reports hits and serves identical texture content', () => {
  const registry = new TextureRegistry();
  const cache = new TextCache(registry);
  const color = { r: 1, g: 2, b: 3 };
  const first = cache.acquire('READY', color, 2);
  const second = cache.acquire('READY', color, 2);
  assert.equal(first.hit, false);
  assert.equal(second.hit, true);
  assert.equal(first.texture.key, second.texture.key);
  assert.ok(cache.hitRate > 0);
});

test('unsafe renderer is rejected by the consistency gate', () => {
  const scene = buildFixedScene();
  const pair = renderPair(scene);
  const unsafeRegistry = new TextureRegistry();
  buildSpriteRegistry(scene, unsafeRegistry);
  const unsafeDevice = new SoftwareDevice({ width: scene.width, height: scene.height });
  renderFrameUnsafe(unsafeDevice, scene, pair.ordered, unsafeRegistry, new TextCache(unsafeRegistry));
  const unsafeDiff = diffSnapshots(pair.deviceA.snapshot(), unsafeDevice.snapshot());
  assert.ok(!unsafeDiff.equal || !tracesAreSafe(pair.deviceA.trace, unsafeDevice.trace));
});

test('invalid scene is rejected with per-node diagnostics', () => {
  const errors = validateScene(buildInvalidScene());
  assert.ok(errors.length >= 3);
  assert.ok(errors.some((item) => item.field === 'blend'));
  assert.ok(errors.some((item) => item.field === 'alpha'));
  assert.throws(() => {
    if (errors.length > 0) throw new SceneValidationError(errors);
  }, SceneValidationError);
});

test('dispose releases every texture and repeated runs do not leak', () => {
  const scene = buildBoundaryScene();
  for (let generation = 0; generation < 3; generation += 1) {
    const registry = new TextureRegistry();
    buildSpriteRegistry(scene, registry);
    const device = new SoftwareDevice({ width: scene.width, height: scene.height });
    renderFrameBatched(device, scene, prepareRenderList(scene), registry, new TextCache(registry));
    assert.ok(registry.liveCount > 0);
    device.dispose();
    registry.dispose();
    assert.equal(registry.liveCount, 0);
    assert.equal(registry.liveBytes, 0);
  }
});

test('candidate collision count is deterministic for a fixed scene', () => {
  const ordered = prepareRenderList(buildFixedScene());
  assert.equal(countCandidateCollisions(ordered), countCandidateCollisions(ordered));
  assert.ok(countCandidateCollisions(ordered) > 0);
});
