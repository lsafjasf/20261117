import { TimelineModel, createClip } from './model.js';

// 初始节目：两段 4000ms 场景，默认在切点处预留可添加转场。
export function buildDemoProject() {
  const model = new TimelineModel();
  const a = createClip({
    id: 'clipA', kind: 'scene', source: 'sceneA', color: '#ff8a3d',
    inPoint: 0, outPoint: 4000, srcIn: 0, srcOut: 4000,
  });
  const b = createClip({
    id: 'clipB', kind: 'scene', source: 'sceneB', color: '#c86bd6',
    inPoint: 4000, outPoint: 8000, srcIn: 0, srcOut: 4000,
  });
  model.addClip(a);
  model.addClip(b);

  model.addAudioEvent({ id: 'aud1', atMs: 300, durationMs: 900, freq: 320, wave: 'sine', gain: 0.18 });
  model.addAudioEvent({ id: 'aud2', atMs: 3600, durationMs: 1400, freq: 520, wave: 'triangle', gain: 0.16, fadeInMs: 200, fadeOutMs: 300 });
  model.addAudioEvent({ id: 'aud3', atMs: 6800, durationMs: 900, freq: 240, wave: 'square', gain: 0.1 });

  model.addSubtitle({ id: 'sub1', startMs: 400, endMs: 3600, text: '第一场景 · Scene A' });
  model.addSubtitle({ id: 'sub2', startMs: 4400, endMs: 7600, text: '第二场景 · Scene B（从自身起点继续）' });
  return model;
}

// 时长对比：记录操作前后节目/片段时长，用于验证裁切与转场后的时长变化。
export function measureDurations(model) {
  const clips = Object.fromEntries(
    model.clips.map((c) => [c.id, {
      inPoint: c.inPoint, outPoint: c.outPoint,
      clipMs: c.outPoint - c.inPoint,
      sourceMs: c.srcOut - c.srcIn,
    }]));
  return { programMs: model.durationMs, clips };
}

export function diffDurations(before, after) {
  const changes = [];
  for (const id of Object.keys(after.clips)) {
    const b = before.clips[id];
    const a = after.clips[id];
    if (b && b.clipMs !== a.clipMs) {
      changes.push({ id, beforeMs: b.clipMs, afterMs: a.clipMs, deltaMs: a.clipMs - b.clipMs });
    }
  }
  return {
    programBeforeMs: before.programMs,
    programAfterMs: after.programMs,
    programDeltaMs: after.programMs - before.programMs,
    clips: changes,
  };
}
