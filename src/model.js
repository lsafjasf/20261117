// 核心工程模型：纯数据 + 纯函数，不依赖 DOM / Web Audio，Node 与浏览器共用。
// 所有时间单位均为秒，时间线坐标为节目时间（timeline），素材坐标为源时间（source）。

export const FPS = 30;
export const FRAME = 1 / FPS;
export const SOURCE_DURATION = 20;
export const SNAP = FRAME;
export const DEFAULT_FLASH_COUNT = 12;

let idCounter = 0;
export function nextId(prefix = 'id') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// 十二次闪光 / 鼓点默认落在每个 20/12 区间的起点（0 与结尾处各一个，共 12 个）。
export function defaultEvents(count = DEFAULT_FLASH_COUNT, duration = SOURCE_DURATION) {
  const step = duration / count;
  return Array.from({ length: count }, (_, index) => round3(index * step));
}

export function createProject() {
  return {
    version: 1,
    sourceDuration: SOURCE_DURATION,
    fps: FPS,
    audioOffset: 0, // 用户整体偏移音频（秒）：负值提前，正值延后
    inPoint: 0,
    outPoint: round3(SOURCE_DURATION),
    videoTracks: [
      {
        id: nextId('vtrack'),
        kind: 'video',
        clips: [
          {
            id: nextId('clip'),
            sourceStart: 0,
            sourceEnd: SOURCE_DURATION,
            timelineStart: 0,
            timelineEnd: SOURCE_DURATION,
            transitionIn: null,
            transitionOut: null,
          },
        ],
      },
    ],
    audioTracks: [
      {
        id: nextId('atrack'),
        kind: 'audio',
        events: defaultEvents().map((sourceTime, index) => ({
          id: nextId('drum'),
          index,
          sourceTime,
        })),
      },
    ],
    log: [],
  };
}

export function getVideoTrack(project) {
  return project.videoTracks[0];
}

export function getAudioTrack(project) {
  return project.audioTracks[0];
}

export function clipDuration(clip) {
  return round3(clip.timelineEnd - clip.timelineStart);
}

// 源时间 -> 节目时间。不在任何片段内时返回 null。
export function sourceToTimeline(project, sourceTime) {
  for (const clip of getVideoTrack(project).clips) {
    if (sourceTime >= clip.sourceStart - 1e-9 && sourceTime <= clip.sourceEnd + 1e-9) {
      const ratio = (clip.timelineEnd - clip.timelineStart) /
        (clip.sourceEnd - clip.sourceStart);
      return round3(clip.timelineStart + (sourceTime - clip.sourceStart) * ratio);
    }
  }
  return null;
}

// 节目时间 -> 源时间。用于渲染与音频调度。
export function timelineToSource(project, timelineTime) {
  for (const clip of getVideoTrack(project).clips) {
    if (timelineTime >= clip.timelineStart - 1e-9 && timelineTime <= clip.timelineEnd + 1e-9) {
      const ratio = (clip.sourceEnd - clip.sourceStart) /
        (clip.timelineEnd - clip.timelineStart);
      return round3(clip.sourceStart + (timelineTime - clip.timelineStart) * ratio);
    }
  }
  return null;
}

// 每个音频事件在节目时间线上的位置：画面事件时间 + 用户音频整体偏移。
export function mappedAudioEvents(project) {
  const track = getAudioTrack(project);
  return track.events
    .map((event) => {
      const visualTime = sourceToTimeline(project, event.sourceTime);
      if (visualTime === null) return null;
      return {
        ...event,
        visualTime,
        audioTime: round3(visualTime + project.audioOffset),
        delta: round3(project.audioOffset),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.audioTime - b.audioTime);
}

export function maxAbsDelta(project) {
  return mappedAudioEvents(project).reduce(
    (max, event) => Math.max(max, Math.abs(event.delta)),
    0,
  );
}

const EPS = 1e-6;

// 检测同轨非法重叠（相接不算冲突），返回冲突片段对与冲突区间。
export function findOverlaps(project) {
  const clips = [...getVideoTrack(project).clips].sort(
    (a, b) => a.timelineStart - b.timelineStart,
  );
  const conflicts = [];
  for (let i = 0; i < clips.length - 1; i += 1) {
    const left = clips[i];
    const right = clips[i + 1];
    const overlapStart = Math.max(left.timelineStart, right.timelineStart);
    const overlapEnd = Math.min(left.timelineEnd, right.timelineEnd);
    if (overlapEnd - overlapStart > EPS) {
      conflicts.push({
        type: 'overlap',
        clipAId: left.id,
        clipBId: right.id,
        start: round3(overlapStart),
        end: round3(overlapEnd),
      });
    }
  }
  return conflicts;
}

// 间隙（gap）不阻断编辑，但影响导出首尾完整性，单独报告。
export function findGaps(project) {
  const clips = [...getVideoTrack(project).clips].sort(
    (a, b) => a.timelineStart - b.timelineStart,
  );
  const gaps = [];
  for (let i = 0; i < clips.length - 1; i += 1) {
    const gapStart = clips[i].timelineEnd;
    const gapEnd = clips[i + 1].timelineStart;
    if (gapEnd - gapStart > EPS) {
      gaps.push({ type: 'gap', start: round3(gapStart), end: round3(gapEnd) });
    }
  }
  return gaps;
}

export function validateProject(project) {
  const conflicts = findOverlaps(project);
  const gaps = findGaps(project);
  const ordered = [...getVideoTrack(project).clips].sort(
    (a, b) => a.timelineStart - b.timelineStart,
  );
  const firstClip = ordered[0];
  const lastClip = ordered[ordered.length - 1];
  const errors = conflicts.map((conflict) => ({
    level: 'error',
    message: `片段重叠：${conflict.start.toFixed(3)}s - ${conflict.end.toFixed(3)}s`,
    ...conflict,
  }));
  if (firstClip && firstClip.timelineStart > EPS) {
    errors.push({
      level: 'error',
      type: 'head-gap',
      start: 0,
      end: round3(firstClip.timelineStart),
      message: `节目开头存在黑帧区间 0 - ${firstClip.timelineStart.toFixed(3)}s`,
    });
  }
  const warnings = gaps.map((gap) => ({
    level: 'warning',
    ...gap,
    message: `片段间隙：${gap.start.toFixed(3)}s - ${gap.end.toFixed(3)}s（导出时为黑帧）`,
  }));
  return { ok: errors.length === 0, errors, warnings };
}

function appendLog(project, action, before, after) {
  project.log.push({
    id: nextId('op'),
    at: new Date().toISOString(),
    action,
    before: structuredClone(before),
    after: structuredClone(after),
  });
}

// 移动片段（保持源映射与时长不变）。产生重叠时拒绝并返回失败原因。
export function moveClip(project, clipId, newTimelineStart) {
  const track = getVideoTrack(project);
  const clip = track.clips.find((item) => item.id === clipId);
  if (!clip) return { ok: false, reason: '片段不存在' };
  const duration = clip.timelineEnd - clip.timelineStart;
  const snapped = round3(Math.max(0, Math.round(newTimelineStart / SNAP) * SNAP));
  const before = structuredClone(clip);
  clip.timelineStart = snapped;
  clip.timelineEnd = round3(snapped + duration);
  if (findOverlaps(project).length > 0) {
    Object.assign(clip, before);
    return { ok: false, reason: '移动会造成非法重叠，已阻止' };
  }
  appendLog(project, 'moveClip', before, clip);
  return { ok: true };
}

// 在指定源时间处分割片段，两侧源映射无缝衔接。
export function splitClip(project, clipId, sourceTime) {
  const track = getVideoTrack(project);
  const index = track.clips.findIndex((item) => item.id === clipId);
  if (index < 0) return { ok: false, reason: '片段不存在' };
  const clip = track.clips[index];
  if (sourceTime <= clip.sourceStart + EPS || sourceTime >= clip.sourceEnd - EPS) {
    return { ok: false, reason: '分割点必须在片段内部' };
  }
  const ratio = (clip.timelineEnd - clip.timelineStart) /
    (clip.sourceEnd - clip.sourceStart);
  const cutTimeline = round3(clip.timelineStart + (sourceTime - clip.sourceStart) * ratio);
  const left = {
    ...clip,
    sourceEnd: round3(sourceTime),
    timelineEnd: cutTimeline,
    transitionOut: null,
  };
  const right = {
    ...clip,
    id: nextId('clip'),
    sourceStart: round3(sourceTime),
    timelineStart: cutTimeline,
    timelineEnd: clip.timelineEnd,
    sourceEnd: clip.sourceEnd,
    transitionIn: null,
  };
  track.clips.splice(index, 1, left, right);
  appendLog(project, 'splitClip', clip, { left, right });
  return { ok: true, clipIds: [left.id, right.id] };
}

// 相邻片段之间设置交叉淡化转场（仅元数据，不改变几何与事件映射）。
export function setTransition(project, leftClipId, durationSeconds) {
  const clips = getVideoTrack(project).clips;
  const leftIndex = clips.findIndex((clip) => clip.id === leftClipId);
  const left = clips[leftIndex];
  const right = clips
    .filter((clip) => clip.id !== leftClipId)
    .sort((a, b) => a.timelineStart - b.timelineStart)
    .find((clip) => Math.abs(clip.timelineStart - left.timelineEnd) <= EPS);
  if (!left || !right) return { ok: false, reason: '未找到相邻片段' };
  const maxDuration = Math.min(
    left.sourceEnd - left.sourceStart,
    right.sourceEnd - right.sourceStart,
  );
  const duration = round3(Math.min(Math.max(0, durationSeconds), maxDuration));
  const before = {
    left: structuredClone(left),
    right: structuredClone(right),
  };
  left.transitionOut = duration > 0 ? { type: 'fade', duration } : null;
  right.transitionIn = duration > 0 ? { type: 'fade', duration } : null;
  appendLog(project, 'setTransition', before, { left, right });
  return { ok: true, duration };
}

export function setInOut(project, inPoint, outPoint) {
  const before = { inPoint: project.inPoint, outPoint: project.outPoint };
  const nextIn = round3(Math.min(Math.max(0, inPoint), project.sourceDuration));
  const nextOut = round3(Math.min(Math.max(nextIn + FRAME, outPoint), project.sourceDuration));
  project.inPoint = nextIn;
  project.outPoint = nextOut;
  appendLog(project, 'setInOut', before, { inPoint: nextIn, outPoint: nextOut });
  return { ok: true, inPoint: nextIn, outPoint: nextOut };
}

export function setAudioOffset(project, offsetSeconds) {
  const before = { audioOffset: project.audioOffset };
  project.audioOffset = round3(offsetSeconds);
  appendLog(project, 'setAudioOffset', before, { audioOffset: project.audioOffset });
  return { ok: true };
}

export function programDuration(project) {
  return round3(project.outPoint - project.inPoint);
}

// 比较两次裁切/转场后的时长与事件分布，供界面与测试使用。
export function compareVariants(baseProject, variants) {
  const baseline = {
    name: '当前工程',
    duration: programDuration(baseProject),
    clips: getVideoTrack(baseProject).clips.length,
    events: mappedAudioEvents(baseProject).length,
  };
  const rows = variants.map((variant) => ({
    name: variant.name,
    duration: programDuration(variant.project),
    clips: getVideoTrack(variant.project).clips.length,
    events: mappedAudioEvents(variant.project).length,
    durationDelta: round3(programDuration(variant.project) - baseline.duration),
  }));
  return { baseline, rows };
}
