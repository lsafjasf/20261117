import { moveClip, splitClip, addTransition, findConflicts } from "./timeline.js";

export function createInitialState(project = {}) {
  return {
    timeline: {
      duration: project.duration ?? 120,
      videos: project.videos ?? [],
      audios: project.audios ?? [],
      subtitles: project.subtitles ?? [],
      animations: project.animations ?? [],
      transitions: project.transitions ?? []
    },
    sources: project.sources ?? {},
    clock: {
      time: 0,
      playing: false,
      loop: false,
      loopIn: 0,
      loopOut: project.duration ?? 120,
      rate: 1
    },
    view: {
      pxPerSecond: 20,
      scrollLeft: 0,
      cropAspect: "16:9"
    },
    thumbnails: { generation: 0, jobs: {}, results: {} },
    operations: [],
    lastError: null
  };
}

function applyTimelineResult(state, result, actionMeta) {
  const operation = { ...actionMeta, ok: result.ok, error: result.error ?? null, at: state.clock.time };
  if (!result.ok) {
    return { ...state, lastError: result.error, operations: [...state.operations, operation] };
  }
  const timeline = result.timeline;
  return {
    ...state,
    timeline,
    lastError: null,
    operations: [...state.operations, operation],
    clock: { ...state.clock, loopOut: Math.min(state.clock.loopOut, timeline.duration) }
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case "SET_PLAYHEAD": {
      const max = state.timeline.duration;
      const time = Math.min(Math.max(action.time, 0), max);
      return { ...state, clock: { ...state.clock, time } };
    }
    case "SET_PLAYING":
      return { ...state, clock: { ...state.clock, playing: action.playing } };
    case "SET_LOOP":
      return { ...state, clock: { ...state.clock, loop: action.loop } };
    case "SET_LOOP_REGION":
      return {
        ...state,
        clock: { ...state.clock, loopIn: action.loopIn, loopOut: action.loopOut }
      };
    case "TICK": {
      if (!state.clock.playing) return state;
      let time = state.clock.time + action.delta * state.clock.rate;
      let playing = true;
      if (state.clock.loop && time >= state.clock.loopOut) {
        time = state.clock.loopIn + (time - state.clock.loopOut);
      } else if (time >= state.timeline.duration) {
        time = state.timeline.duration;
        playing = false;
      }
      return { ...state, clock: { ...state.clock, time, playing } };
    }
    case "SET_ZOOM":
      return { ...state, view: { ...state.view, pxPerSecond: action.pxPerSecond } };
    case "SET_SCROLL":
      return { ...state, view: { ...state.view, scrollLeft: action.scrollLeft } };
    case "SET_CROP":
      return { ...state, view: { ...state.view, cropAspect: action.cropAspect } };
    case "MOVE_CLIP":
      return applyTimelineResult(state, moveClip(state.timeline, action.clipId, action.newStart), {
        type: "MOVE_CLIP", clipId: action.clipId, newStart: action.newStart
      });
    case "SPLIT_CLIP":
      return applyTimelineResult(state, splitClip(state.timeline, action.clipId, action.atTime), {
        type: "SPLIT_CLIP", clipId: action.clipId, atTime: action.atTime
      });
    case "ADD_TRANSITION":
      return applyTimelineResult(
        state,
        addTransition(state.timeline, action.fromClipId, action.toClipId, action.duration, action.sourceDurations ?? state.sources),
        { type: "ADD_TRANSITION", fromClipId: action.fromClipId, toClipId: action.toClipId, duration: action.duration }
      );
    case "THUMB_GEN_START":
      return { ...state, thumbnails: { ...state.thumbnails, generation: action.generation } };
    case "THUMB_JOB":
      return {
        ...state,
        thumbnails: {
          ...state.thumbnails,
          jobs: { ...state.thumbnails.jobs, [action.key]: { status: action.status, generation: action.generation, error: action.error ?? null } }
        }
      };
    case "THUMB_RESULT":
      if (action.generation !== state.thumbnails.generation) return state;
      return {
        ...state,
        thumbnails: {
          ...state.thumbnails,
          results: { ...state.thumbnails.results, [action.key]: { bitmap: action.bitmap, time: action.time, crop: action.crop } },
          jobs: { ...state.thumbnails.jobs, [action.key]: { status: "done", generation: action.generation } }
        }
      };
    case "LOAD_PROJECT":
      return { ...createInitialState(action.project), thumbnails: state.thumbnails, operations: state.operations };
    case "REPLACE_TIMELINE":
      return { ...state, timeline: action.timeline };
    case "RESET_OPERATIONS":
      return { ...state, operations: [] };
    default:
      return state;
  }
}

export const selectConflicts = (state) => findConflicts(state.timeline);
