import { FPS, BEAT_INTERVAL, snapTimeToFrame, isOnBeat } from "./timebase.mjs";

export const CAMERAS = Object.freeze([
  { id: "camA", label: "机位 A · 全景", hue: 205 },
  { id: "camB", label: "机位 B · 中景", hue: 335 },
  { id: "camC", label: "机位 C · 特写", hue: 145 }
]);

export const TRANSITIONS = Object.freeze({
  cut: { id: "cut", label: "硬切", duration: 0 },
  dissolve: { id: "dissolve", label: "短叠化", duration: 0.4 },
  dip: { id: "dip", label: "黑场过渡", duration: 0.3 }
});

export const CONFLICT = Object.freeze({
  OVERLAP: "illegal_overlap",
  GAP: "uncovered_gap",
  OFF_BEAT: "off_beat_cut",
  RANGE: "out_of_range"
});

const EPS = 1e-6;

export function uid(prefix = "id", seed) {
  if (seed !== undefined) return `${prefix}_${seed}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nextId(project, prefix) {
  project.idSeq = (project.idSeq ?? 0) + 1;
  return uid(prefix, project.idSeq);
}

export function clipEnd(clip) {
  return clip.start + clip.duration;
}

export function sortedClips(project) {
  return [...project.clips].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

export function projectDuration(project) {
  return project.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

export function makeClip({ cameraId, start, sourceIn = 0, duration, transition = "cut" }) {
  return {
    id: uid("clip"),
    cameraId,
    start: snapTimeToFrame(start),
    sourceIn: snapTimeToFrame(sourceIn),
    duration: snapTimeToFrame(duration),
    transition: { type: transition, duration: TRANSITIONS[transition]?.duration ?? 0 }
  };
}

export function createProject() {
  return {
    version: 1,
    fps: FPS,
    beatInterval: BEAT_INTERVAL,
    idSeq: 0,
    clips: [],
    audioClips: [],
    subtitles: []
  };
}

// 允许的重叠量 = 后一个片段的入点转场时长（叠化区间内两条素材共存）。
function allowedOverlap(prev, next) {
  return next.transition?.type === "cut" ? 0 : next.transition.duration;
}

function findOverlapConflicts(clips) {
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  const conflicts = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const next = ordered[i];
    const overlap = clipEnd(prev) - next.start;
    const allowed = allowedOverlap(prev, next);
    if (overlap > allowed + EPS) {
      conflicts.push({
        type: CONFLICT.OVERLAP,
        severity: "error",
        clipIds: [prev.id, next.id],
        at: next.start,
        message: `片段非法重叠 ${(overlap - allowed).toFixed(3)}s（仅允许 ${allowed.toFixed(3)}s 转场重叠）`
      });
    }
  }
  return conflicts;
}

function findGapConflicts(clips) {
  const ordered = [...clips].sort((a, b) => a.start - b.start);
  const conflicts = [];
  if (ordered.length && ordered[0].start > EPS) {
    conflicts.push({
      type: CONFLICT.GAP,
      severity: "error",
      clipIds: [ordered[0].id],
      at: 0,
      message: "时间线起点未被片段覆盖，导出会出现黑帧"
    });
  }
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const next = ordered[i];
    const gap = next.start - clipEnd(prev);
    if (gap > EPS) {
      conflicts.push({
        type: CONFLICT.GAP,
        severity: "error",
        clipIds: [prev.id, next.id],
        at: clipEnd(prev),
        message: `切点之间存在 ${gap.toFixed(3)}s 空隙，导出会出现黑帧`
      });
    }
  }
  return conflicts;
}

function findOffBeatCuts(project) {
  const ordered = sortedClips(project);
  const warnings = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const cutAt = ordered[i].start;
    if (!isOnBeat(cutAt, project.beatInterval)) {
      warnings.push({
        type: CONFLICT.OFF_BEAT,
        severity: "warning",
        clipIds: [ordered[i].id],
        at: cutAt,
        message: `切点 ${cutAt.toFixed(3)}s 未对齐节拍网格`
      });
    }
  }
  return warnings;
}

export function validateProject(project) {
  const conflicts = [
    ...findOverlapConflicts(project.clips),
    ...findGapConflicts(project.clips),
    ...findOffBeatCuts(project)
  ];
  return {
    conflicts,
    errors: conflicts.filter((c) => c.severity === "error"),
    exportable: conflicts.every((c) => c.severity !== "error")
  };
}

function cloneWith(clips, id, patch) {
  return clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

function attempt(project, mutate, op) {
  const draft = {
    ...project,
    clips: project.clips.map((c) => ({ ...c, transition: { ...c.transition } })),
    audioClips: project.audioClips.map((c) => ({ ...c })),
    subtitles: project.subtitles.map((c) => ({ ...c }))
  };
  try {
    mutate(draft);
  } catch (error) {
    return { ok: false, error: error.message, conflicts: [] };
  }
  const check = validateProject(draft);
  if (!check.exportable) {
    return { ok: false, error: check.errors[0].message, conflicts: check.errors };
  }
  draft.lastOp = op;
  return { ok: true, project: draft, conflicts: check.conflicts };
}

function requireClip(project, id) {
  const clip = project.clips.find((c) => c.id === id);
  if (!clip) throw new Error(`片段不存在: ${id}`);
  return clip;
}

// 所有编辑都走同一 reducer，保证可回放、可重做、可持久化。
export function applyOp(project, op) {
  switch (op.type) {
    case "addClip": {
      return attempt(project, (draft) => {
        const clip = { ...makeClip(op), id: nextId(draft, "clip") };
        draft.clips.push(clip);
      }, op);
    }
    case "moveClip": {
      return attempt(project, (draft) => {
        const clip = requireClip(draft, op.id);
        const target = snapTimeToFrame(op.start);
        const delta = target - clip.start;
        if (Math.abs(delta) < EPS) return;
        const ordered = sortedClips(draft);
        const index = ordered.findIndex((c) => c.id === op.id);
        if (target < -EPS || (index === 0 && Math.abs(target) > EPS)) {
          throw new Error("第一个片段必须从 0 开始");
        }
        // 向后移动：目标及其后所有片段整体后移（总时长增加）；
        // 向前移动：目标之前（含目标）的片段整体前移（总时长缩短）。
        const fromIndex = delta > 0 ? index : 0;
        const toIndex = delta > 0 ? ordered.length : index + 1;
        // 为保持时间线无缝，移动方向上的邻接片段同步伸缩。
        if (delta > 0 && index > 0) {
          ordered[index - 1].duration = snapTimeToFrame(
            ordered[index - 1].duration + delta
          );
        }
        if (delta < 0 && index + 1 < ordered.length) {
          ordered[index + 1].duration = snapTimeToFrame(
            ordered[index + 1].duration - delta
          );
        }
        for (let i = fromIndex; i < toIndex; i += 1) {
          ordered[i].start = snapTimeToFrame(ordered[i].start + delta);
        }
        if (ordered[0].start < -EPS) throw new Error("移动会越过时间线起点");
      }, op);
    }
    case "overlapClip": {
      // 直接摆放（不做波纹），用于演示非法重叠被校验拦截。
      return attempt(project, (draft) => {
        const clip = requireClip(draft, op.id);
        clip.start = snapTimeToFrame(op.start);
      }, op);
    }
    case "splitClip": {
      return attempt(project, (draft) => {
        const clip = requireClip(draft, op.id);
        const at = snapTimeToFrame(op.at);
        if (at <= clip.start + EPS || at >= clipEnd(clip) - EPS) {
          throw new Error("分割点必须位于片段内部");
        }
        const left = {
          ...clip,
          id: nextId(draft, "clip"),
          duration: snapTimeToFrame(at - clip.start),
          transition: { ...clip.transition }
        };
        const right = {
          ...clip,
          id: nextId(draft, "clip"),
          start: at,
          sourceIn: snapTimeToFrame(clip.sourceIn + (at - clip.start)),
          duration: snapTimeToFrame(clipEnd(clip) - at),
          transition: { type: "cut", duration: 0 }
        };
        draft.clips = draft.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c]));
      }, op);
    }
    case "trimClip": {
      return attempt(project, (draft) => {
        const clip = requireClip(draft, op.id);
        const start = op.start !== undefined ? snapTimeToFrame(op.start) : clip.start;
        const end = op.end !== undefined ? snapTimeToFrame(op.end) : clipEnd(clip);
        if (end - start <= EPS) throw new Error("片段时长必须大于 0");
        const ordered = sortedClips(draft);
        const index = ordered.findIndex((c) => c.id === clip.id);
        const prev = index > 0 ? ordered[index - 1] : null;
        const next = index + 1 < ordered.length ? ordered[index + 1] : null;
        // 裁切入点：前段同步伸缩填补；裁切出点：后段起点跟随，保持时间线无缝。
        if (prev && start !== clip.start) {
          prev.duration = snapTimeToFrame(prev.duration + (start - clip.start));
        }
        if (next && end !== clipEnd(clip)) {
          next.start = end;
          next.duration = snapTimeToFrame(next.duration - (end - clipEnd(clip)));
        }
        clip.sourceIn = snapTimeToFrame(clip.sourceIn + (start - clip.start));
        clip.start = start;
        clip.duration = snapTimeToFrame(end - start);
      }, op);
    }
    case "setTransition": {
      return attempt(project, (draft) => {
        const clip = requireClip(draft, op.id);
        const preset = TRANSITIONS[op.transition];
        if (!preset) throw new Error(`未知转场: ${op.transition}`);
        const ordered = sortedClips(draft);
        if (ordered[0]?.id === clip.id) throw new Error("第一个片段不能设置入点转场");
        const duration = op.duration !== undefined ? snapTimeToFrame(op.duration) : preset.duration;
        const maxDuration = Math.min(clip.duration, (() => {
          const index = ordered.findIndex((c) => c.id === clip.id);
          return ordered[index - 1].duration;
        })());
        if (duration > maxDuration + EPS) {
          throw new Error(`转场时长 ${duration}s 超过相邻片段可承受的 ${maxDuration}s`);
        }
        clip.transition = { type: preset.id, duration: preset.id === "cut" ? 0 : duration };
      }, op);
    }
    case "removeClip": {
      return attempt(project, (draft) => {
        draft.clips = draft.clips.filter((c) => c.id !== op.id);
      }, op);
    }
    case "addSubtitle": {
      const subId = nextId(project, "sub");
      const entry = {
        id: subId,
        start: snapTimeToFrame(op.start),
        end: snapTimeToFrame(op.end),
        text: op.text
      };
      const draft = {
        ...project,
        idSeq: project.idSeq ?? 0,
        subtitles: [...project.subtitles, entry]
      };
      return { ok: true, project: draft, conflicts: validateProject(draft).conflicts };
    }
    case "addAudioClip": {
      const audId = nextId(project, "aud");
      const entry = {
        id: audId,
        kind: op.kind ?? "beat",
        start: snapTimeToFrame(op.start),
        duration: snapTimeToFrame(op.duration)
      };
      const draft = {
        ...project,
        idSeq: project.idSeq ?? 0,
        audioClips: [...project.audioClips, entry]
      };
      return { ok: true, project: draft, conflicts: validateProject(draft).conflicts };
    }
    default:
      throw new Error(`未知操作: ${op.type}`);
  }
}

// 镜头表：与导出节目使用同一份片段数据。
export function buildShotList(project) {
  return sortedClips(project).map((clip, index) => ({
    shot: index + 1,
    camera: CAMERAS.find((c) => c.id === clip.cameraId)?.label ?? clip.cameraId,
    inPoint: clip.start,
    outPoint: clipEnd(clip),
    duration: clip.duration,
    sourceIn: clip.sourceIn,
    transition: clip.transition.type,
    transitionDuration: clip.transition.duration
  }));
}
