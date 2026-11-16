// 时间线领域模型：全部为纯函数，不依赖 DOM，浏览器与 Node 共用。
// 时间单位统一为秒；同一 groupId 的视频片段与音频事件共享源时间偏移，
// 任何编辑都以整组为单位移动/分割，保证音画对齐。

export const EPS = 1e-6;

export const clipEnd = (clip) => clip.start + clip.duration;

export function findClip(timeline, clipId) {
  return timeline.videos.find((clip) => clip.id === clipId) || null;
}

function sameTrackItems(timeline, track) {
  return [
    ...timeline.videos.filter((item) => item.track === track).map((item) => ({ ref: item, kind: "video" })),
    ...timeline.subtitles.filter((item) => item.track === track).map((item) => ({ ref: item, kind: "subtitle" })),
    ...timeline.animations.filter((item) => item.track === track).map((item) => ({ ref: item, kind: "animation" }))
  ];
}

function overlapRange(a, b) {
  const start = Math.max(a.start, b.start);
  const end = Math.min(clipEnd(a), clipEnd(b));
  return end - start > EPS ? { start, end } : null;
}

// 全量冲突扫描：同一轨道上任何非零时长重叠都是非法状态。
export function findConflicts(timeline) {
  const conflicts = [];
  const tracks = new Set([
    ...timeline.videos.map((item) => item.track),
    ...timeline.subtitles.map((item) => item.track),
    ...timeline.animations.map((item) => item.track)
  ]);
  for (const track of tracks) {
    const items = sameTrackItems(timeline, track).sort((a, b) => a.ref.start - b.ref.start);
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const range = overlapRange(items[i].ref, items[j].ref);
        if (range) {
          conflicts.push({
            track,
            start: range.start,
            end: range.end,
            aId: items[i].ref.id,
            bId: items[j].ref.id,
            kinds: [items[i].kind, items[j].kind]
          });
        }
      }
    }
  }
  return conflicts;
}

function groupDelta(timeline, groupId, delta) {
  const shift = (item) => ({ ...item, start: item.start + delta });
  return {
    ...timeline,
    videos: timeline.videos.map((item) => (item.groupId === groupId ? shift(item) : item)),
    audios: timeline.audios.map((item) => (item.groupId === groupId ? shift(item) : item)),
    subtitles: timeline.subtitles.map((item) => (item.groupId === groupId ? shift(item) : item)),
    animations: timeline.animations.map((item) => (item.groupId === groupId ? shift(item) : item))
  };
}

// 移动片段：整组平移，先做边界与重叠校验，非法移动被阻止并返回原因。
export function moveClip(timeline, clipId, newStart) {
  const clip = findClip(timeline, clipId);
  if (!clip) return { timeline, ok: false, error: `片段 ${clipId} 不存在` };
  const delta = newStart - clip.start;
  if (Math.abs(delta) <= EPS) return { timeline, ok: true };
  const moved = groupDelta(timeline, clip.groupId, delta);
  const outOfBounds = sameTrackItems(moved, clip.track).some(({ ref }) =>
    ref.groupId === clip.groupId && (ref.start < -EPS || clipEnd(ref) > timeline.duration + EPS)
  );
  if (outOfBounds) return { timeline, ok: false, error: "移动超出节目时间线边界" };
  const conflicts = findConflicts(moved).filter((conflict) =>
    conflict.aId !== clipId && conflict.bId !== clipId ? false : true
  );
  if (conflicts.length) return { timeline, ok: false, error: "移动会造成非法重叠", conflicts };
  return { timeline: moved, ok: true };
}

// 分割：视频与同组音频在对应源时间点同时切开，转场引用自动改挂到切开后的片段。
export function splitClip(timeline, clipId, atTime) {
  const clip = findClip(timeline, clipId);
  if (!clip) return { timeline, ok: false, error: `片段 ${clipId} 不存在` };
  if (atTime <= clip.start + EPS || atTime >= clipEnd(clip) - EPS) {
    return { timeline, ok: false, error: "分割点必须位于片段内部" };
  }
  const cutSrc = clip.srcIn + (atTime - clip.start);
  const left = { ...clip, duration: atTime - clip.start };
  const rightId = `${clipId}-b`;
  const right = {
    ...clip,
    id: rightId,
    start: atTime,
    srcIn: cutSrc,
    duration: clipEnd(clip) - atTime
  };
  const videos = [
    ...timeline.videos.filter((item) => item.id !== clipId),
    left,
    right
  ];
  const audios = [];
  for (const audio of timeline.audios) {
    if (audio.groupId !== clip.groupId) { audios.push(audio); continue; }
    const audioCut = audio.start + (cutSrc - clip.srcIn);
    audios.push({ ...audio, duration: audioCut - audio.start });
    audios.push({
      ...audio,
      id: `${audio.id}-b`,
      start: audioCut,
      srcIn: audio.srcIn + (audioCut - audio.start),
      duration: clipEnd(audio) - audioCut
    });
  }
  const transitions = timeline.transitions.map((transition) => {
    if (transition.fromClipId === clipId) return { ...transition, fromClipId: rightId };
    if (transition.toClipId === clipId) return { ...transition, toClipId: clipId };
    return transition;
  });
  return { timeline: { ...timeline, videos, audios, transitions }, ok: true, rightId };
}

// 转场：仅允许同轨道相邻片段，且两侧都需要足够的素材余量（handle）。
export function addTransition(timeline, fromClipId, toClipId, duration, sourceDurations) {
  const from = findClip(timeline, fromClipId);
  const to = findClip(timeline, toClipId);
  if (!from || !to) return { timeline, ok: false, error: "转场两端片段不存在" };
  if (from.track !== to.track) return { timeline, ok: false, error: "转场必须在同一轨道" };
  if (Math.abs(clipEnd(from) - to.start) > EPS) return { timeline, ok: false, error: "片段不相邻，无法添加转场" };
  if (duration <= 0 || duration > Math.min(from.duration, to.duration)) {
    return { timeline, ok: false, error: "转场时长非法" };
  }
  const fromHandle = (sourceDurations[from.sourceId] ?? Infinity) - (from.srcIn + from.duration);
  const toHandle = to.srcIn;
  if (fromHandle < duration / 2 - EPS || toHandle < duration / 2 - EPS) {
    return { timeline, ok: false, error: "素材余量不足，无法建立转场" };
  }
  const transition = { id: `tr-${fromClipId}-${toClipId}`, fromClipId, toClipId, duration };
  return { timeline: { ...timeline, transitions: [...timeline.transitions.filter((item) => item.toClipId !== toClipId), transition] }, ok: true };
}
