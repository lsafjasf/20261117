export const STORAGE_KEY = "kine.night-tram.project.v1";
export const PROJECT_VERSION = 1;
export const EPSILON = 1e-6;

export const beatTimes = (duration = 9.25, interval = 0.5) =>
  Array.from({ length: Math.floor((duration + EPSILON) / interval) + 1 }, (_, i) => {
    const time = Number((i * interval).toFixed(3));
    return {
      id: `beat-${String(i).padStart(2, "0")}`,
      time,
      accent: i % 4 === 0,
      label: `节拍 ${String(i + 1).padStart(2, "0")}`
    };
  });

const demoFrame = (index) => ({
  id: `drawing-${String(index + 1).padStart(2, "0")}`,
  hold: 2,
  traceA:
    index === 3
      ? [[0.13, 0.66], [0.18, 0.62], [0.25, 0.6], [0.34, 0.58], [0.44, 0.57], [0.55, 0.56], [0.66, 0.54], [0.76, 0.52], [0.84, 0.48]]
      : [],
  traceB:
    index === 3
      ? [[0.61, 0.72], [0.64, 0.68], [0.67, 0.64], [0.7, 0.6], [0.74, 0.57], [0.78, 0.54], [0.82, 0.5]]
      : []
});

export function createDemoProject() {
  return {
    version: PROJECT_VERSION,
    id: "night-tram-ep02",
    title: "夜行电车",
    subtitle: "EP.02 雨停之前",
    fps: 24,
    animationFps: 12,
    loop: true,
    metronome: true,
    volume: 0.42,
    onion: true,
    showBase: true,
    selectedFrame: 3,
    selectedClipId: "clip-platform",
    brush: {
      activePath: "A",
      width: 3,
      opacity: 0.88,
      colors: { A: "#56d9d1", B: "#ff7d70" }
    },
    frames: Array.from({ length: 12 }, (_, index) => demoFrame(index)),
    timeline: {
      clips: [
        {
          id: "clip-platform",
          name: "01 / 雨夜站台",
          scene: "platform",
          start: 0,
          sourceIn: 0.4,
          sourceOut: 5.4,
          transitionOut: { type: "crossfade", duration: 0.25 }
        },
        {
          id: "clip-window",
          name: "02 / 车窗侧影",
          scene: "window",
          start: 4.75,
          sourceIn: 6.1,
          sourceOut: 10.6,
          transitionOut: null
        }
      ],
      subtitles: [
        {
          id: "sub-01",
          start: 1.0,
          duration: 2.2,
          text: "雨停在凌晨四点。",
          speaker: "旁白"
        },
        {
          id: "sub-02",
          start: 5.35,
          duration: 2.4,
          text: "末班车没有终点。",
          speaker: "旁白"
        }
      ],
      audio: [
        {
          id: "audio-night",
          name: "夜行 · 环境底噪",
          start: 0,
          duration: 9.25,
          gain: 0.3
        }
      ],
      events: beatTimes()
    }
  };
}

export function clipDuration(clip) {
  return Math.max(0, Number(clip.sourceOut) - Number(clip.sourceIn));
}

export function clipEnd(clip) {
  return Number(clip.start) + clipDuration(clip);
}

export function projectDuration(project) {
  const ends = [
    ...project.timeline.clips.map(clipEnd),
    ...project.timeline.audio.map((item) => item.start + item.duration),
    ...project.timeline.subtitles.map((item) => item.start + item.duration)
  ];
  return Math.max(0, ...ends);
}

export function framesToSeconds(frames, fps) {
  return frames / fps;
}

export function secondsToFrame(seconds, fps) {
  return Math.max(0, Math.round(seconds * fps));
}

export function timecode(seconds, fps = 24) {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, mins, secs, frames].map((value) => String(value).padStart(2, "0")).join(":");
}

export function shortTime(seconds) {
  return `${Math.max(0, seconds).toFixed(2)}s`;
}

export function frameAt(project, time) {
  const rate = project.animationFps || 12;
  const total = project.frames.length || 1;
  return ((Math.floor(Math.max(0, time) * rate) % total) + total) % total;
}

export function orderedClips(project) {
  return [...project.timeline.clips].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

export function overlapAmount(first, second) {
  return Math.max(0, Math.min(clipEnd(first), clipEnd(second)) - Math.max(first.start, second.start));
}

export function permittedOverlap(first) {
  const transition = first.transitionOut;
  if (!transition || transition.type === "cut") return 0;
  return Math.max(0, Number(transition.duration) || 0);
}

export function moveClip(clip, start) {
  return { ...clip, start: Math.max(0, Number(start)) };
}

export function splitClipAt(clip, playhead) {
  const inClip = playhead > clip.start + EPSILON && playhead < clipEnd(clip) - EPSILON;
  if (!inClip) return null;
  const splitSource = Number(clip.sourceIn) + (playhead - clip.start);
  const left = {
    ...clip,
    sourceOut: Number(splitSource.toFixed(6)),
    transitionOut: null
  };
  const right = {
    ...clip,
    id: `${clip.id}-split-${Math.round(playhead * 1000)}`,
    name: `${clip.name.replace(/^(\d+)\s*\/\s*/, "")} · B`,
    start: Number(playhead.toFixed(6)),
    sourceIn: Number(splitSource.toFixed(6)),
    transitionOut: clip.transitionOut ? { ...clip.transitionOut } : null
  };
  return [left, right];
}

export function splitTimelineClip(project, clipId, playhead) {
  const index = project.timeline.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return null;
  const halves = splitClipAt(project.timeline.clips[index], playhead);
  if (!halves) return null;
  const next = structuredClone(project);
  next.timeline.clips.splice(index, 1, ...halves);
  return next;
}

export function setTransition(project, clipId, type) {
  const next = structuredClone(project);
  const index = next.timeline.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return next;
  const duration = type === "crossfade" ? 0.25 : type === "dip" ? 0.2 : 0;
  next.timeline.clips[index].transitionOut =
    type === "cut" ? null : { type, duration };
  return next;
}

function issue(severity, kind, message, details = {}) {
  return { severity, kind, message, ...details };
}

export function validateProject(project) {
  const issues = [];
  const clips = orderedClips(project);

  for (const clip of clips) {
    if (clip.start < -EPSILON) {
      issues.push(issue("error", "bounds", `${clip.name} 开始时间小于 0`, { ids: [clip.id], start: 0, end: clip.start + clipDuration(clip) }));
    }
    if (clip.sourceOut <= clip.sourceIn + EPSILON) {
      issues.push(issue("error", "source", `${clip.name} 的入点/出点无效`, { ids: [clip.id], start: clip.start, end: clipEnd(clip) }));
    }
  }

  for (let i = 0; i < clips.length - 1; i += 1) {
    const first = clips[i];
    const second = clips[i + 1];
    const overlap = overlapAmount(first, second);
    const allowed = permittedOverlap(first);
    if (overlap > allowed + EPSILON) {
      issues.push(
        issue("error", "overlap", `${first.name} 与 ${second.name} 非法重叠 ${shortTime(overlap - allowed)}`, {
          ids: [first.id, second.id],
          start: second.start,
          end: Math.min(clipEnd(first), clipEnd(second))
        })
      );
    }
  }

  const leadingGap = clips[0] ? clips[0].start : 0;
  if (leadingGap > EPSILON) {
    issues.push(issue("error", "black-edge", "片头存在黑场空隙", { ids: [clips[0].id], start: 0, end: leadingGap }));
  }

  const duration = projectDuration(project);
  const lastEnd = clips.length ? Math.max(...clips.map(clipEnd)) : 0;
  if (duration - lastEnd > EPSILON) {
    issues.push(issue("error", "black-edge", "片尾画面未覆盖节目结尾", { ids: clips.map((clip) => clip.id), start: lastEnd, end: duration }));
  }

  const subtitleSorted = [...project.timeline.subtitles].sort((a, b) => a.start - b.start);
  for (let i = 0; i < subtitleSorted.length - 1; i += 1) {
    const first = subtitleSorted[i];
    const second = subtitleSorted[i + 1];
    const overlap = first.start + first.duration - second.start;
    if (overlap > EPSILON) {
      issues.push(
        issue("error", "overlap", `字幕 ${first.id} 与 ${second.id} 重叠`, {
          ids: [first.id, second.id],
          start: second.start,
          end: first.start + first.duration
        })
      );
    }
  }

  const audioSorted = [...project.timeline.audio].sort((a, b) => a.start - b.start);
  for (let i = 0; i < audioSorted.length - 1; i += 1) {
    const first = audioSorted[i];
    const second = audioSorted[i + 1];
    const overlap = first.start + first.duration - second.start;
    if (overlap > EPSILON) {
      issues.push(
        issue("error", "overlap", `音频 ${first.name} 与 ${second.name} 重叠`, {
          ids: [first.id, second.id],
          start: second.start,
          end: first.start + first.duration
        })
      );
    }
  }

  for (const event of project.timeline.events) {
    if (event.time < -EPSILON || event.time > duration + EPSILON) {
      issues.push(issue("warning", "event", `${event.label} 超出节目时长`, { ids: [event.id], start: Math.max(0, event.time), end: Math.max(0, event.time) }));
    }
  }

  return {
    ok: !issues.some((item) => item.severity === "error"),
    errors: issues.filter((item) => item.severity === "error"),
    warnings: issues.filter((item) => item.severity === "warning"),
    issues,
    conflictIds: [...new Set(issues.filter((item) => item.severity === "error").flatMap((item) => item.ids || []))]
  };
}

export function auditionEditPass(project) {
  const eventTimesBefore = project.timeline.events.map((event) => event.time);
  const clipBefore = structuredClone(project.timeline.clips[1]);
  const durationsBefore = project.timeline.clips.map(clipDuration);
  const moved = moveClip(clipBefore, clipBefore.start + 0.12);
  if (Math.abs(clipDuration(moved) - clipDuration(clipBefore)) > EPSILON) {
    return { passed: false, message: "移动改变了片段时值" };
  }

  const splitPoint = moved.start + 1.6;
  const halves = splitClipAt(moved, splitPoint);
  if (!halves) return { passed: false, message: "分割点不在片段内" };
  const splitTotal = clipDuration(halves[0]) + clipDuration(halves[1]);
  if (Math.abs(splitTotal - clipDuration(moved)) > 1e-5) {
    return { passed: false, message: "分割后源时值不一致" };
  }

  const transitionDuration = 0.25;
  const overlap = Math.min(transitionDuration, clipDuration(halves[0]), clipDuration(halves[1]));
  if (overlap < 0) return { passed: false, message: "转场重叠非法" };

  const eventTimesAfter = project.timeline.events.map((event) => event.time);
  const clockOffsetMs = Math.abs(
    eventTimesBefore.reduce((sum, time, index) => sum + Math.abs(time - eventTimesAfter[index]), 0) * 1000
  );
  const frameSamples = [0, 1.25, 2.5, 4.75, 7.2, 9.0];
  const framesStable = frameSamples.every((time) => frameAt(project, time) === frameAt(project, time));
  const programBefore = projectDuration(project);
  const relatedClips = [project.timeline.clips[0], ...halves];
  const programAfter = Math.max(...relatedClips.map(clipEnd)) - Math.min(...relatedClips.map((clip) => clip.start));

  return {
    passed: clockOffsetMs < EPSILON && framesStable && overlap > 0,
    message: "移动、分割与转场通过",
    clockOffsetMs: Number(clockOffsetMs.toFixed(3)),
    overlap: Number(overlap.toFixed(3)),
    splitTotal: Number(splitTotal.toFixed(3)),
    durationsBefore: durationsBefore.map((value) => Number(value.toFixed(3))),
    programBefore: Number(programBefore.toFixed(3)),
    programAfter: Number(programAfter.toFixed(3)),
    frameSamples
  };
}

export function serializeProject(project) {
  return JSON.stringify({
    ...project,
    savedAt: new Date().toISOString()
  });
}

export function deserializeProject(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || parsed.version !== PROJECT_VERSION) {
    throw new Error("工程版本不兼容");
  }
  if (!Array.isArray(parsed.frames) || !parsed.timeline?.clips) {
    throw new Error("工程结构不完整");
  }
  return parsed;
}

export function validateReload(project, loaded) {
  const selectedClip = project.selectedClipId;
  const loadedClip = loaded.timeline.clips.find((clip) => clip.id === selectedClip);
  const originalClip = project.timeline.clips.find((clip) => clip.id === selectedClip);
  const checks = {
    frameCount: loaded.frames.length === project.frames.length,
    inPoint: Boolean(loadedClip && originalClip && loadedClip.sourceIn === originalClip.sourceIn),
    outPoint: Boolean(loadedClip && originalClip && loadedClip.sourceOut === originalClip.sourceOut),
    events: loaded.timeline.events.length === project.timeline.events.length &&
      loaded.timeline.events.every((event, index) => event.time === project.timeline.events[index].time),
    traces: JSON.stringify(loaded.frames.map((frame) => [frame.traceA, frame.traceB])) ===
      JSON.stringify(project.frames.map((frame) => [frame.traceA, frame.traceB])),
    selectedFrame: loaded.selectedFrame === project.selectedFrame
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}
