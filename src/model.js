export const PROJECT_VERSION = 1;
export const PROJECT_KEY = "frame08-project-v1";
export const FPS = 30;
export const EPSILON = 0.001;

export const EASINGS = {
  linear: "线性",
  easeOutCubic: "缓出",
  easeInOutCubic: "缓入缓出",
  easeInOutQuint: "柔和",
};

export function clone(value) {
  return structuredClone(value);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundTime(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function ease(name, t) {
  const x = clamp(t, 0, 1);
  if (name === "easeOutCubic") return 1 - (1 - x) ** 3;
  if (name === "easeInOutCubic") {
    return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
  }
  if (name === "easeInOutQuint") {
    return x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2;
  }
  return x;
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultProject() {
  return {
    version: PROJECT_VERSION,
    meta: {
      name: "FORM / FLOW",
      subtitle: "CAMERA STUDY 08",
      createdAt: "2026-11-17T00:00:00.000Z",
    },
    stage: { width: 1200, height: 675, fps: FPS },
    timeline: {
      inPoint: 0,
      outPoint: 8,
      playhead: 0,
      loop: true,
      videoClips: [
        {
          id: "video-a",
          groupId: "shot-a",
          name: "SHOT A",
          start: 0,
          duration: 4.2,
          sourceIn: 0.4,
          variant: "form",
        },
        {
          id: "video-b",
          groupId: "shot-b",
          name: "SHOT B",
          start: 3.8,
          duration: 4.2,
          sourceIn: 5.1,
          variant: "flow",
        },
      ],
      audioClips: [
        {
          id: "audio-a",
          groupId: "shot-a",
          name: "MIX A",
          start: 0,
          duration: 4.2,
          sourceIn: 0.4,
          gain: 0.72,
          tone: "warm",
        },
        {
          id: "audio-b",
          groupId: "shot-b",
          name: "MIX B",
          start: 3.8,
          duration: 4.2,
          sourceIn: 5.1,
          gain: 0.66,
          tone: "bright",
        },
      ],
      subtitleClips: [
        {
          id: "subtitle-a",
          start: 0.7,
          duration: 2.35,
          text: "形状先于语言发生",
          kicker: "01 / FORM",
        },
        {
          id: "subtitle-b",
          start: 4.5,
          duration: 2.55,
          text: "让运动穿过画面",
          kicker: "02 / FLOW",
        },
      ],
      animationTrack: { name: "CAMERA 01", keyframeIds: ["kf-1", "kf-2", "kf-3", "kf-4"] },
      transitions: [
        {
          id: "transition-ab",
          kind: "crossfade",
          fromGroup: "shot-a",
          toGroup: "shot-b",
          start: 3.8,
          duration: 0.4,
          label: "WARM CROSSFADE",
        },
      ],
      audioEvents: [
        { id: "event-1", at: 0.7, label: "PULSE", type: "pulse", gain: 0.36, groupId: "shot-a" },
        { id: "event-2", at: 2.35, label: "TICK", type: "tick", gain: 0.2, groupId: "shot-a" },
        { id: "event-3", at: 4.0, label: "IMPACT", type: "impact", gain: 0.3, groupId: "shot-b" },
        { id: "event-4", at: 6.45, label: "RISE", type: "rise", gain: 0.24, groupId: "shot-b" },
      ],
    },
    camera: {
      keyframes: [
        { id: "kf-1", time: 0, x: 414, y: 382, rotation: -7, zoom: 1.06, easing: "easeOutCubic" },
        { id: "kf-2", time: 2.1, x: 536, y: 312, rotation: 4, zoom: 1.14, easing: "easeInOutCubic" },
        { id: "kf-3", time: 4.7, x: 714, y: 360, rotation: -5, zoom: 1.22, easing: "easeInOutCubic" },
        { id: "kf-4", time: 7.15, x: 606, y: 296, rotation: 6, zoom: 1.08, easing: "easeInOutQuint" },
      ],
    },
  };
}

export function clipEnd(clip) {
  return clip.start + clip.duration;
}

export function sortedKeyframes(project) {
  return [...project.camera.keyframes].sort((a, b) => a.time - b.time);
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

export function cameraAt(project, time) {
  const frames = sortedKeyframes(project);
  if (!frames.length) return { x: project.stage.width / 2, y: project.stage.height / 2, rotation: 0, zoom: 1 };
  if (time <= frames[0].time) return { ...frames[0], time };
  if (time >= frames.at(-1).time) return { ...frames.at(-1), time };

  let index = 0;
  while (index < frames.length - 2 && time >= frames[index + 1].time) index += 1;
  const first = frames[index];
  const second = frames[index + 1];
  const before = frames[Math.max(0, index - 1)];
  const after = frames[Math.min(frames.length - 1, index + 2)];
  const raw = (time - first.time) / Math.max(EPSILON, second.time - first.time);
  const t = ease(first.easing, raw);
  const values = {};
  for (const key of ["x", "y", "rotation", "zoom"]) {
    values[key] = catmullRom(before[key], first[key], second[key], after[key], t);
  }
  return {
    x: values.x,
    y: values.y,
    rotation: values.rotation,
    zoom: clamp(values.zoom, 0.55, 2.6),
    time,
    easing: first.easing,
  };
}

export function viewfinderFrame(project, camera) {
  const width = (project.stage.width * 0.66) / camera.zoom;
  const height = width * (9 / 16);
  const angle = (camera.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfW = width / 2;
  const halfH = height / 2;
  const corners = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ].map(([x, y]) => ({
    x: camera.x + x * cos - y * sin,
    y: camera.y + x * sin + y * cos,
  }));
  return { x: camera.x, y: camera.y, width, height, rotation: camera.rotation, corners };
}

export function sampleCameraPath(project, steps = 180) {
  const { inPoint, outPoint } = project.timeline;
  const samples = [];
  for (let index = 0; index <= steps; index += 1) {
    const time = inPoint + ((outPoint - inPoint) * index) / steps;
    const camera = cameraAt(project, time);
    samples.push({ time, camera, frame: viewfinderFrame(project, camera) });
  }
  return samples;
}

export function findPathViolations(project) {
  const violations = [];
  for (const sample of sampleCameraPath(project, 240)) {
    const bad = sample.frame.corners.find(
      (point) =>
        point.x < -EPSILON ||
        point.y < -EPSILON ||
        point.x > project.stage.width + EPSILON ||
        point.y > project.stage.height + EPSILON,
    );
    if (bad) {
      violations.push({ time: sample.time, point: { x: bad.x, y: bad.y } });
    }
  }
  if (!violations.length) return [];
  const times = violations.map((item) => item.time);
  return [{
    id: "path-out-of-stage",
    severity: "warning",
    track: "canvas",
    start: Math.min(...times),
    end: Math.max(...times),
    message: "取景框越出舞台边界",
    point: violations[0].point,
  }];
}

function overlapOf(a, b) {
  const start = Math.max(a.start, b.start);
  const end = Math.min(clipEnd(a), clipEnd(b));
  return { start, end, duration: end - start };
}

function transitionFor(project, groupA, groupB) {
  return project.timeline.transitions.find(
    (transition) =>
      (transition.fromGroup === groupA && transition.toGroup === groupB) ||
      (transition.fromGroup === groupB && transition.toGroup === groupA),
  );
}

function pairOverlaps(project, clips, track) {
  const conflicts = [];
  for (let left = 0; left < clips.length; left += 1) {
    for (let right = left + 1; right < clips.length; right += 1) {
      const first = clips[left];
      const second = clips[right];
      const overlap = overlapOf(first, second);
      if (overlap.duration <= EPSILON) continue;
      const transition = track === "video"
        ? transitionFor(project, first.groupId, second.groupId)
        : transitionFor(project, first.groupId, second.groupId);
      const covered =
        transition &&
        transition.start <= overlap.start + EPSILON &&
        transition.start + transition.duration >= overlap.end - EPSILON;
      if (!covered) {
        conflicts.push({
          id: `${track}-overlap-${first.id}-${second.id}`,
          severity: "error",
          track,
          start: overlap.start,
          end: overlap.end,
          message: `${first.name} 与 ${second.name} 存在非法重叠`,
          ids: [first.id, second.id],
        });
      }
    }
  }
  return conflicts;
}

export function validateProject(project, options = {}) {
  const conflicts = [];
  const timeline = project.timeline;
  const frames = sortedKeyframes(project);
  const projectLength = project.timeline.outPoint - project.timeline.inPoint;

  if (!(timeline.inPoint >= 0) || !(timeline.outPoint > timeline.inPoint)) {
    conflicts.push({
      id: "timeline-range",
      severity: "error",
      track: "timeline",
      start: 0,
      end: Math.max(0, timeline.outPoint || 0),
      message: "节目入点与出点无效",
    });
  }
  if (Math.abs((timeline.outPoint - timeline.inPoint) - 8) > EPSILON && !options.allowVariableDuration) {
    conflicts.push({
      id: "timeline-duration",
      severity: "error",
      track: "timeline",
      start: timeline.inPoint,
      end: timeline.outPoint,
      message: "导出窗口必须为 8.000 秒",
    });
  }
  if (frames.length < 2) {
    conflicts.push({
      id: "camera-keyframes",
      severity: "error",
      track: "animation",
      start: 0,
      end: 8,
      message: "至少需要两个相机关键帧",
    });
  }
  frames.forEach((frame, index) => {
    if (frame.time < timeline.inPoint - EPSILON || frame.time > timeline.outPoint + EPSILON) {
      conflicts.push({
        id: `camera-outside-${frame.id}`,
        severity: "error",
        track: "animation",
        start: frame.time,
        end: frame.time,
        message: `相机关键帧 ${index + 1} 超出节目范围`,
      });
    }
    if (index > 0 && Math.abs(frame.time - frames[index - 1].time) < EPSILON) {
      conflicts.push({
        id: `camera-duplicate-${frame.id}`,
        severity: "error",
        track: "animation",
        start: frame.time,
        end: frame.time,
        message: "相机关键帧时间重复",
      });
    }
  });

  const groups = new Set([
    ...timeline.videoClips.map((clip) => clip.groupId),
    ...timeline.audioClips.map((clip) => clip.groupId),
  ]);
  for (const groupId of groups) {
    const videos = timeline.videoClips.filter((clip) => clip.groupId === groupId);
    const audios = timeline.audioClips.filter((clip) => clip.groupId === groupId);
    if (videos.length !== audios.length) {
      conflicts.push({
        id: `linked-count-${groupId}`,
        severity: "error",
        track: "audio",
        start: Math.min(...[...videos, ...audios].map((clip) => clip.start)),
        end: Math.max(...[...videos, ...audios].map(clipEnd)),
        message: `音画组 ${groupId} 的片段数量不一致`,
      });
      continue;
    }
    videos.forEach((video) => {
      const audio = audios.find(
        (item) => Math.abs(item.start - video.start) < EPSILON &&
          Math.abs(item.duration - video.duration) < EPSILON,
      );
      if (!audio) {
        conflicts.push({
          id: `linked-sync-${video.id}`,
          severity: "error",
          track: "audio",
          start: video.start,
          end: clipEnd(video),
          message: `${video.name} 的音频入点或时长未对齐`,
        });
      }
    });
  }

  const videoConflicts = pairOverlaps(project, timeline.videoClips, "video");
  const audioConflicts = pairOverlaps(project, timeline.audioClips, "audio");
  conflicts.push(...videoConflicts, ...audioConflicts);

  for (let left = 0; left < timeline.subtitleClips.length; left += 1) {
    for (let right = left + 1; right < timeline.subtitleClips.length; right += 1) {
      const overlap = overlapOf(timeline.subtitleClips[left], timeline.subtitleClips[right]);
      if (overlap.duration > EPSILON) {
        conflicts.push({
          id: `subtitle-overlap-${left}-${right}`,
          severity: "error",
          track: "subtitle",
          start: overlap.start,
          end: overlap.end,
          message: "字幕片段重叠",
        });
      }
    }
  }

  for (const event of timeline.audioEvents) {
    if (event.at < timeline.inPoint - EPSILON || event.at > timeline.outPoint + EPSILON) {
      conflicts.push({
        id: `event-outside-${event.id}`,
        severity: "error",
        track: "audio",
        start: event.at,
        end: event.at,
        message: `音频事件 ${event.label} 超出节目范围`,
      });
    }
  }

  for (const clip of [...timeline.videoClips, ...timeline.audioClips, ...timeline.subtitleClips]) {
    if (clip.start < timeline.inPoint - EPSILON || clipEnd(clip) > timeline.outPoint + EPSILON) {
      conflicts.push({
        id: `clip-outside-${clip.id}`,
        severity: "error",
        track: timeline.videoClips.includes(clip) ? "video" : timeline.audioClips.includes(clip) ? "audio" : "subtitle",
        start: Math.max(0, clip.start),
        end: clipEnd(clip),
        message: `${clip.name || clip.text} 超出节目范围`,
      });
    }
  }

  for (const transition of timeline.transitions) {
    const from = timeline.videoClips.filter((clip) => clip.groupId === transition.fromGroup);
    const to = timeline.videoClips.filter((clip) => clip.groupId === transition.toGroup);
    if (transition.duration <= EPSILON || !from.length || !to.length) {
      conflicts.push({
        id: `transition-invalid-${transition.id}`,
        severity: "error",
        track: "video",
        start: transition.start,
        end: transition.start + transition.duration,
        message: "转场引用的片段无效",
      });
    }
  }

  const report = durationReport(project);
  if (!report.aligned) {
    conflicts.push({
      id: "program-sync",
      severity: "error",
      track: "audio",
      start: report.audioStart,
      end: report.audioEnd,
      message: "节目音轨与视频轨时长不一致",
    });
  }
  conflicts.push(...findPathViolations(project));
  const deduped = [...new Map(conflicts.map((item) => [item.id, item])).values()];
  return {
    conflicts: deduped,
    errors: deduped.filter((item) => item.severity === "error"),
    warnings: deduped.filter((item) => item.severity === "warning"),
    exportable: deduped.every((item) => item.severity !== "error"),
    projectLength,
  };
}

export function durationReport(project) {
  const videos = project.timeline.videoClips;
  const audios = project.timeline.audioClips;
  const videoStart = videos.length ? Math.min(...videos.map((clip) => clip.start)) : 0;
  const videoEnd = videos.length ? Math.max(...videos.map(clipEnd)) : 0;
  const audioStart = audios.length ? Math.min(...audios.map((clip) => clip.start)) : 0;
  const audioEnd = audios.length ? Math.max(...audios.map(clipEnd)) : 0;
  const timelineStart = project.timeline.inPoint;
  const timelineEnd = project.timeline.outPoint;
  return {
    videoStart,
    videoEnd,
    audioStart,
    audioEnd,
    videoDuration: videoEnd - videoStart,
    audioDuration: audioEnd - audioStart,
    programStart: timelineStart,
    programEnd: timelineEnd,
    programDuration: timelineEnd - timelineStart,
    contentStart: Math.min(videoStart, audioStart),
    contentEnd: Math.max(videoEnd, audioEnd),
    contentDuration: Math.max(videoEnd, audioEnd) - Math.min(videoStart, audioStart),
    delta: audioEnd - videoEnd,
    aligned:
      Math.abs(videoStart - audioStart) < EPSILON &&
      Math.abs(videoEnd - audioEnd) < EPSILON,
    clips: videos.map((clip) => ({
      id: clip.id,
      groupId: clip.groupId,
      name: clip.name,
      start: clip.start,
      end: clipEnd(clip),
      duration: clip.duration,
    })),
    transitions: project.timeline.transitions.map((transition) => ({
      ...transition,
      end: transition.start + transition.duration,
    })),
    transitionDuration: project.timeline.transitions.reduce(
      (total, transition) => total + transition.duration,
      0,
    ),
    assembledVideoDuration:
      videos.reduce((total, clip) => total + clip.duration, 0) -
      project.timeline.transitions.reduce((total, transition) => total + transition.duration, 0),
  };
}

function syncTransitionToGroups(project, transition) {
  const outgoing = project.timeline.videoClips.filter(
    (clip) => clip.groupId === transition.fromGroup,
  );
  const incoming = project.timeline.videoClips.filter(
    (clip) => clip.groupId === transition.toGroup,
  );
  if (!outgoing.length || !incoming.length) {
    transition.duration = 0;
    return;
  }
  const overlaps = outgoing
    .flatMap((from) => incoming.map((to) => overlapOf(from, to)))
    .filter((overlap) => overlap.duration > EPSILON)
    .sort((a, b) => b.duration - a.duration);
  if (!overlaps.length) {
    transition.duration = 0;
    return;
  }
  transition.start = overlaps[0].start;
  transition.duration = overlaps[0].duration;
}

export function moveGroup(project, groupId, delta) {
  const videos = project.timeline.videoClips.filter((clip) => clip.groupId === groupId);
  const audios = project.timeline.audioClips.filter((clip) => clip.groupId === groupId);
  if (!videos.length || !audios.length) {
    throw new Error("找不到可移动的联动音画组");
  }
  for (const clip of [...videos, ...audios]) clip.start = roundTime(clip.start + delta);
  for (const transition of project.timeline.transitions) {
    if (transition.fromGroup === groupId || transition.toGroup === groupId) {
      syncTransitionToGroups(project, transition);
    }
  }
  return project;
}

function transitionTouchesSplit(project, groupId, at) {
  return project.timeline.transitions.find(
    (transition) =>
      (transition.fromGroup === groupId || transition.toGroup === groupId) &&
      at > transition.start + EPSILON &&
      at < transition.start + transition.duration - EPSILON,
  );
}

function remapTransitionsAfterSplit(project, oldGroup, newGroup, at) {
  for (const transition of project.timeline.transitions) {
    if (transition.fromGroup === oldGroup && transition.start >= at - EPSILON) {
      transition.fromGroup = newGroup;
    }
    if (transition.toGroup === oldGroup && transition.start >= at - EPSILON) {
      transition.toGroup = newGroup;
    }
  }
}

function splitClip(clip, at, suffix) {
  const leftDuration = roundTime(at - clip.start);
  const rightDuration = roundTime(clip.duration - leftDuration);
  const left = { ...clip, id: `${clip.id}-${suffix}l`, duration: leftDuration };
  const right = {
    ...clip,
    id: `${clip.id}-${suffix}r`,
    start: roundTime(at),
    duration: rightDuration,
    sourceIn: roundTime(clip.sourceIn + leftDuration),
    groupId: `${clip.groupId}-${suffix}`,
  };
  if (clip.name) {
    left.name = `${clip.name} / L`;
    right.name = `${clip.name} / R`;
  }
  return [left, right];
}

export function splitGroupAt(project, groupId, at) {
  const videos = project.timeline.videoClips.filter((clip) => clip.groupId === groupId);
  const audios = project.timeline.audioClips.filter((clip) => clip.groupId === groupId);
  if (!videos.length || !audios.length) throw new Error("片段没有完整的音画联动组");
  const sample = videos[0];
  if (at <= sample.start + EPSILON || at >= clipEnd(sample) - EPSILON) {
    throw new Error("分割点必须位于片段内部");
  }
  if (transitionTouchesSplit(project, groupId, at)) {
    throw new Error("不能在转场区间内分割片段");
  }
  const suffix = uid("cut");
  const newGroup = `${groupId}-${suffix}`;
  const nextVideo = [];
  const nextAudio = [];
  for (const clip of project.timeline.videoClips) {
    if (clip.groupId !== groupId) nextVideo.push(clip);
    else nextVideo.push(...splitClip(clip, at, suffix));
  }
  for (const clip of project.timeline.audioClips) {
    if (clip.groupId !== groupId) nextAudio.push(clip);
    else nextAudio.push(...splitClip(clip, at, suffix).map((item) => ({ ...item, id: `${item.id}-aud` })));
  }
  project.timeline.videoClips = nextVideo.sort((a, b) => a.start - b.start);
  project.timeline.audioClips = nextAudio.sort((a, b) => a.start - b.start);
  const right = nextVideo.find((clip) => clip.start === roundTime(at) && clip.id.endsWith(`${suffix}r`));
  if (right) remapTransitionsAfterSplit(project, groupId, right.groupId, at);
  return project;
}

export function setTimelineRange(project, inPoint, outPoint) {
  project.timeline.inPoint = roundTime(inPoint);
  project.timeline.outPoint = roundTime(outPoint);
  project.timeline.playhead = clamp(project.timeline.playhead, inPoint, outPoint);
  return project;
}

export function setKeyframe(project, keyframeId, patch) {
  const frame = project.camera.keyframes.find((item) => item.id === keyframeId);
  if (!frame) throw new Error("找不到相机关键帧");
  Object.assign(frame, patch);
  return frame;
}

export function serializeProject(project) {
  return JSON.stringify({
    format: "frame08-project",
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    project,
  });
}

export function hydrateProject(serialized) {
  const parsed = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  const candidate = parsed?.project ?? parsed;
  if (!candidate?.timeline?.videoClips || !candidate?.camera?.keyframes) {
    throw new Error("工程文件结构无效");
  }
  if (candidate.version !== PROJECT_VERSION) {
    throw new Error(`不支持的工程版本：${candidate.version}`);
  }
  return clone(candidate);
}

export function buildKeyframeExport(project, validation = validateProject(project, { allowVariableDuration: true })) {
  const report = durationReport(project);
  return {
    format: "frame08-camera-keyframes",
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    canvas: {
      width: project.stage.width,
      height: project.stage.height,
      fps: project.stage.fps,
    },
    timebase: {
      inPoint: project.timeline.inPoint,
      outPoint: project.timeline.outPoint,
      duration: project.timeline.outPoint - project.timeline.inPoint,
      fps: project.stage.fps,
    },
    camera: {
      keyframes: clone(project.camera.keyframes),
      interpolation: "catmull-rom",
    },
    tracks: {
      video: clone(project.timeline.videoClips),
      audio: clone(project.timeline.audioClips),
      subtitle: clone(project.timeline.subtitleClips),
      animation: clone(project.timeline.animationTrack),
      audioEvents: clone(project.timeline.audioEvents),
      transitions: clone(project.timeline.transitions),
    },
    durationReport: report,
    validation: {
      exportable: validation.exportable,
      conflicts: validation.conflicts,
    },
  };
}

export function runEditSelfTest(project) {
  const initialEvents = project.timeline.audioEvents.map((event) => ({
    id: event.id,
    at: event.at,
  }));
  const results = [];
  const working = clone(project);
  const before = durationReport(working);
  results.push({
    label: "初始音画范围",
    pass: before.aligned && Math.abs(before.delta) < EPSILON,
    detail: `视频 ${before.videoStart.toFixed(2)}–${before.videoEnd.toFixed(2)}s / 音频 ${before.audioStart.toFixed(2)}–${before.audioEnd.toFixed(2)}s`,
  });

  moveGroup(working, "shot-a", 0.12);
  const moved = durationReport(working);
  const movedValidation = validateProject(working);
  results.push({
    label: "移动片段后对齐",
    pass: moved.aligned && movedValidation.errors.length === 0,
    detail: `A 组整体 +0.12s，音画 Δ ${Math.round(moved.delta * 1000)}ms`,
  });

  splitGroupAt(working, "shot-b", 6.25);
  const split = durationReport(working);
  const splitValidation = validateProject(working);
  results.push({
    label: "分割后联动",
    pass: split.aligned && splitValidation.errors.length === 0,
    detail: `${working.timeline.videoClips.length} 个视频段 / ${working.timeline.audioClips.length} 个音频段`,
  });

  const eventsStable = initialEvents.every((event) => {
    const current = working.timeline.audioEvents.find((item) => item.id === event.id);
    return current && Math.abs(current.at - event.at) < EPSILON;
  });
  results.push({
    label: "事件时间锚定",
    pass: eventsStable,
    detail: `${initialEvents.length} 个事件位置保持绝对时间不变`,
  });

  results.push({
    label: "转场时长核算",
    pass: Math.abs(split.assembledVideoDuration - split.contentDuration) < EPSILON,
    detail: `两段合计 ${split.assembledVideoDuration.toFixed(2)}s = 内容 ${split.contentDuration.toFixed(2)}s`,
  });

  return {
    pass: results.every((result) => result.pass),
    results,
    report: split,
  };
}
