/* 工程数据模型、校验器与纯函数 reducer。
   不依赖 DOM，可在 Node 中直接 require 做无头测试。 */
(function (root, factory) {
  var api = factory(
    (typeof module === "object" && module.exports) ? require("./util.js") : root.TC.util
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TC = root.TC || {};
  root.TC.model = api;
})(typeof self !== "undefined" ? self : this, function (util) {
  "use strict";

  var EPS = util.EPS;
  var MIN_CLIP = 0.1;
  var MIN_CUE = 0.2;
  var PROJECT_VERSION = 1;

  /* ---------- 节拍网格 ---------- */

  function beatInterval(bpm) {
    return 60 / bpm;
  }

  function generateBeats(bpm, duration) {
    var step = beatInterval(bpm);
    var beats = [];
    var index = 0;
    for (var t = 0; t <= duration + EPS; t += step) {
      var time = Math.min(duration, Number(t.toFixed(6)));
      var kind = index % 4 === 0 ? "kick" : (index % 4 === 2 ? "snare" : "hat");
      beats.push({ id: "beat_" + index, time: time, kind: kind, velocity: kind === "hat" ? 0.6 : 0.9 });
      index += 1;
      if (time >= duration - EPS) break;
    }
    return beats;
  }

  /* ---------- 默认字幕（5 条，逐字时间） ---------- */

  function makeCue(id, start, end, text) {
    var chars = [];
    var span = end - start;
    for (var i = 0; i < text.length; i++) {
      chars.push({ ch: text[i], t: Number((start + span * (i / text.length)).toFixed(6)) });
    }
    return { id: id, start: start, end: end, text: text, chars: chars };
  }

  function defaultCues() {
    var raw = [
      [0.4, 2.2, "节拍第一句"],
      [2.6, 4.4, "字幕逐字对齐"],
      [4.8, 6.6, "拖动手排时间"],
      [7.0, 8.8, "重叠越界拦截"],
      [9.2, 11.4, "导出再导入一致"]
    ];
    return raw.map(function (r, i) { return makeCue("cue_" + (i + 1), r[0], r[1], r[2]); });
  }

  /* ---------- 默认视频片段 ---------- */

  function makeClip(id, name, start, end, sourceDuration, color) {
    return {
      id: id,
      name: name,
      track: 0,
      start: start,
      end: end,
      sourceIn: 0,
      sourceOut: end - start,
      sourceDuration: sourceDuration,
      color: color,
      transitionIn: 0,
      transitionOut: 0
    };
  }

  function defaultClips() {
    return [
      makeClip("clip_a", "片段 A · 青", 0, 5.8, 7.0, "#5e81ac"),
      makeClip("clip_b", "片段 B · 绿", 5.8, 12, 8.0, "#a3be8c")
    ];
  }

  function createDefaultProject() {
    var duration = 12;
    var project = {
      version: PROJECT_VERSION,
      bpm: 120,
      duration: duration,
      beats: generateBeats(120, duration),
      subtitles: defaultCues(),
      clips: defaultClips(),
      loop: { enabled: false, start: 0, end: duration },
      log: []
    };
    return project;
  }

  /* ---------- 校验 ---------- */

  function issue(level, code, message, loc) {
    return { level: level, code: code, message: message, loc: loc || null };
  }

  /* 仅当两段重叠区域恰好等于双方声明的转场时长时，视为合法交叉淡化。 */
  function crossfadeAllowed(a, b) {
    if (a.track !== b.track) return false;
    var ovStart = Math.max(a.start, b.start);
    var ovEnd = Math.min(a.end, b.end);
    var overlap = ovEnd - ovStart;
    if (overlap <= EPS) return false;
    var left = a.start <= b.start ? a : b;
    var right = left === a ? b : a;
    return util.nearlyEqual(left.transitionOut, overlap, 1e-4) &&
           util.nearlyEqual(right.transitionIn, overlap, 1e-4);
  }

  function validateClips(project) {
    var out = [];
    project.clips.forEach(function (clip) {
      if (clip.end - clip.start < MIN_CLIP - EPS) {
        out.push(issue("error", "clip-too-short", clip.id + " 时长小于 " + MIN_CLIP + "s",
          { track: clip.track, time: clip.start }));
      }
      if (clip.start < -EPS || clip.end > project.duration + EPS) {
        out.push(issue("error", "clip-out-of-bounds", clip.id + " 越出工程边界",
          { track: clip.track, time: util.clamp(clip.start, 0, project.duration) }));
      }
      var sourceLen = clip.sourceOut - clip.sourceIn;
      if (!util.nearlyEqual(sourceLen, clip.end - clip.start, 1e-4)) {
        out.push(issue("error", "clip-source-mismatch", clip.id + " 源时长与时间线时长不一致",
          { track: clip.track, time: clip.start }));
      }
      if (clip.transitionIn + clip.transitionOut > clip.end - clip.start + EPS) {
        out.push(issue("error", "transition-too-long", clip.id + " 转场总时长超过片段",
          { track: clip.track, time: clip.start }));
      }
    });

    for (var i = 0; i < project.clips.length; i++) {
      for (var j = i + 1; j < project.clips.length; j++) {
        var a = project.clips[i], b = project.clips[j];
        if (a.track !== b.track || !util.overlaps(a.start, a.end, b.start, b.end)) continue;
        if (crossfadeAllowed(a, b)) continue;
        out.push(issue("error", "clip-overlap",
          a.id + " 与 " + b.id + " 非法重叠",
          { track: a.track, time: Math.max(a.start, b.start) }));
      }
    }
    return out;
  }

  function validateSubtitles(project) {
    var out = [];
    project.subtitles.forEach(function (cue) {
      if (cue.end - cue.start < MIN_CUE - EPS) {
        out.push(issue("error", "cue-too-short", cue.id + " 短于 " + MIN_CUE + "s",
          { lane: "subtitles", time: cue.start }));
      }
      if (cue.start < -EPS || cue.end > project.duration + EPS) {
        out.push(issue("error", "cue-out-of-bounds", cue.id + " 越出工程边界",
          { lane: "subtitles", time: util.clamp(cue.start, 0, project.duration) }));
      }
      if (cue.end <= cue.start + EPS) {
        out.push(issue("error", "cue-inverted", cue.id + " 入点晚于出点",
          { lane: "subtitles", time: cue.start }));
      }
      if (cue.text.length !== cue.chars.length) {
        out.push(issue("error", "cue-char-mismatch", cue.id + " 逐字数量与文本不符",
          { lane: "subtitles", time: cue.start }));
      }
      for (var k = 0; k < cue.chars.length; k++) {
        var t = cue.chars[k].t;
        if (t < cue.start - EPS || t > cue.end + EPS) {
          out.push(issue("error", "char-out-of-cue",
            cue.id + " 第 " + (k + 1) + " 字越出字幕区间",
            { lane: "subtitles", time: util.clamp(t, cue.start, cue.end) }));
        }
        if (k > 0 && t < cue.chars[k - 1].t - EPS) {
          out.push(issue("error", "char-order", cue.id + " 逐字时间必须单调递增",
            { lane: "subtitles", time: t }));
        }
      }
    });

    for (var i = 0; i < project.subtitles.length; i++) {
      for (var j = i + 1; j < project.subtitles.length; j++) {
        var a = project.subtitles[i], b = project.subtitles[j];
        if (util.overlaps(a.start, a.end, b.start, b.end)) {
          out.push(issue("error", "cue-overlap",
            a.id + " 与 " + b.id + " 字幕重叠",
            { lane: "subtitles", time: Math.max(a.start, b.start) }));
        }
      }
    }
    return out;
  }

  function validateBeats(project) {
    var out = [];
    var step = beatInterval(project.bpm);
    project.beats.forEach(function (beat, i) {
      if (beat.time < -EPS || beat.time > project.duration + EPS) {
        out.push(issue("error", "beat-out-of-bounds", beat.id + " 越界",
          { lane: "audio", time: util.clamp(beat.time, 0, project.duration) }));
      }
      if (i > 0 && beat.time < project.beats[i - 1].time - EPS) {
        out.push(issue("error", "beat-order", "节拍时间必须单调递增",
          { lane: "audio", time: beat.time }));
      }
      var expected = i * step;
      if (i < project.beats.length - 1 &&
          !util.nearlyEqual(beat.time, expected, 1e-4) &&
          !(i === project.beats.length - 1 && beat.time >= project.duration - EPS)) {
        out.push(issue("warning", "beat-grid", beat.id + " 偏离 BPM 网格",
          { lane: "audio", time: beat.time }));
      }
    });
    return out;
  }

  function validateProject(project) {
    var issues = []
      .concat(validateClips(project))
      .concat(validateSubtitles(project))
      .concat(validateBeats(project));
    var errors = issues.filter(function (x) { return x.level === "error"; });
    return {
      ok: errors.length === 0,
      issues: issues,
      errors: errors,
      conflictLocs: errors.map(function (x) { return x.loc; }).filter(Boolean)
    };
  }

  function canExport(project) {
    var report = validateProject(project);
    return { allowed: report.ok, report: report };
  }

  /* ---------- 纯函数 reducer ---------- */

  function cloneProject(project) {
    return util.deepClone(project);
  }

  function findClip(project, id) {
    return project.clips.find(function (c) { return c.id === id; });
  }

  function findCue(project, id) {
    return project.subtitles.find(function (c) { return c.id === id; });
  }

  function appendLog(project, entry) {
    project.log.push({
      seq: project.log.length + 1,
      at: Date.now ? Date.now() : 0,
      action: entry.action,
      ok: entry.ok,
      reason: entry.reason || null,
      detail: entry.detail || null
    });
  }

  function reject(project, action, reason, detail) {
    var copy = cloneProject(project);
    appendLog(copy, { action: action, ok: false, reason: reason, detail: detail || null });
    return { ok: false, project: copy, reason: reason };
  }

  function accept(next, action, detail) {
    appendLog(next, { action: action, ok: true, detail: detail || null });
    return { ok: true, project: next };
  }

  function trimClip(project, payload) {
    var next = cloneProject(project);
    var clip = findClip(next, payload.id);
    if (!clip) return reject(project, "trim-clip", "片段不存在", payload);
    var newStart = payload.edge === "in" ? Number(payload.value.toFixed(6)) : clip.start;
    var newEnd = payload.edge === "out" ? Number(payload.value.toFixed(6)) : clip.end;
    if (newEnd - newStart < MIN_CLIP - EPS) {
      return reject(project, "trim-clip", "片段短于 " + MIN_CLIP + "s", payload);
    }
    if (newStart < -EPS || newEnd > project.duration + EPS) {
      return reject(project, "trim-clip", "入点/出点越出工程边界", payload);
    }
    var length = newEnd - newStart;
    if (payload.edge === "in") {
      var deltaIn = newStart - clip.start;
      clip.sourceIn = util.clamp(clip.sourceIn + deltaIn, 0, clip.sourceDuration - MIN_CLIP);
      clip.sourceOut = clip.sourceIn + length;
      clip.start = newStart;
      clip.end = newEnd;
    } else {
      clip.sourceOut = util.clamp(clip.sourceIn + length, clip.sourceIn + MIN_CLIP, clip.sourceDuration);
      clip.start = newStart;
      clip.end = clip.start + (clip.sourceOut - clip.sourceIn);
    }
    clip.transitionIn = Math.min(clip.transitionIn, (clip.end - clip.start) / 2);
    clip.transitionOut = Math.min(clip.transitionOut, (clip.end - clip.start) / 2);
    var report = validateProject(next);
    if (!report.ok) {
      return reject(project, "trim-clip", report.errors[0].message, report.conflictLocs[0]);
    }
    return accept(next, "trim-clip", payload);
  }

  function moveClip(project, payload) {
    var next = cloneProject(project);
    var clip = findClip(next, payload.id);
    if (!clip) return reject(project, "move-clip", "片段不存在", payload);
    var length = clip.end - clip.start;
    var targetStart = Number(util.clamp(payload.start, 0, project.duration - length).toFixed(6));
    clip.start = targetStart;
    clip.end = Number((targetStart + length).toFixed(6));
    clip.transitionIn = Math.min(clip.transitionIn, length / 2);
    clip.transitionOut = Math.min(clip.transitionOut, length / 2);
    var report = validateProject(next);
    if (!report.ok) {
      return reject(project, "move-clip", report.errors[0].message, report.conflictLocs[0]);
    }
    return accept(next, "move-clip", { id: payload.id, start: targetStart });
  }

  function splitClip(project, payload) {
    var next = cloneProject(project);
    var clip = findClip(next, payload.id);
    if (!clip) return reject(project, "split-clip", "片段不存在", payload);
    var at = payload.at;
    if (at <= clip.start + MIN_CLIP || at >= clip.end - MIN_CLIP) {
      return reject(project, "split-clip", "分割点距边缘过近", payload);
    }
    var sourceAt = clip.sourceIn + (at - clip.start);
    var rightPart = util.deepClone(clip);
    clip.end = Number(at.toFixed(6));
    clip.sourceOut = Number(sourceAt.toFixed(6));
    clip.transitionOut = 0;
    rightPart.id = clip.id + "_split";
    rightPart.start = Number(at.toFixed(6));
    rightPart.sourceIn = Number(sourceAt.toFixed(6));
    rightPart.transitionIn = 0;
    next.clips.push(rightPart);
    var report = validateProject(next);
    if (!report.ok) {
      return reject(project, "split-clip", report.errors[0].message, report.conflictLocs[0]);
    }
    return accept(next, "split-clip", payload);
  }

  function setTransition(project, payload) {
    var next = cloneProject(project);
    var clip = findClip(next, payload.id);
    if (!clip) return reject(project, "set-transition", "片段不存在", payload);
    var length = clip.end - clip.start;
    var value = Math.max(0, Number(payload.duration.toFixed(6)));
    if (value * 2 > length + EPS) {
      return reject(project, "set-transition", "转场过长，超出片段时长一半", payload);
    }
    clip[payload.edge === "in" ? "transitionIn" : "transitionOut"] = value;
    var report = validateProject(next);
    if (!report.ok) {
      return reject(project, "set-transition", report.errors[0].message, report.conflictLocs[0]);
    }
    return accept(next, "set-transition", payload);
  }

  function trimCue(project, payload) {
    var next = cloneProject(project);
    var cue = findCue(next, payload.id);
    if (!cue) return reject(project, "trim-cue", "字幕不存在", payload);
    if (payload.edge === "in") cue.start = Number(payload.value.toFixed(6));
    else cue.end = Number(payload.value.toFixed(6));
    if (cue.end <= cue.start + EPS || cue.end - cue.start < MIN_CUE - EPS) {
      return reject(project, "trim-cue", "字幕区间非法", payload);
    }
    var span = cue.end - cue.start;
    cue.chars = cue.text.split("").map(function (ch, i) {
      return { ch: ch, t: Number((cue.start + span * (i / cue.text.length)).toFixed(6)) };
    });
    var report = validateProject(next);
    if (!report.ok) {
      return reject(project, "trim-cue", report.errors[0].message, report.conflictLocs[0]);
    }
    return accept(next, "trim-cue", payload);
  }

  function moveCue(project, payload) {
    var next = cloneProject(project);
    var cue = findCue(next, payload.id);
    if (!cue) return reject(project, "move-cue", "字幕不存在", payload);
    var length = cue.end - cue.start;
    var targetStart = Number(util.clamp(payload.start, 0, project.duration - length).toFixed(6));
    var delta = targetStart - cue.start;
    cue.start = targetStart;
    cue.end = Number((targetStart + length).toFixed(6));
    cue.chars.forEach(function (c) { c.t = Number((c.t + delta).toFixed(6)); });
    var report = validateProject(next);
    if (!report.ok) {
      return reject(project, "move-cue", report.errors[0].message, report.conflictLocs[0]);
    }
    return accept(next, "move-cue", { id: payload.id, start: targetStart });
  }

  function nudgeChar(project, payload) {
    var next = cloneProject(project);
    var cue = findCue(next, payload.id);
    if (!cue) return reject(project, "nudge-char", "字幕不存在", payload);
    var charItem = cue.chars[payload.index];
    if (!charItem) return reject(project, "nudge-char", "逐字索引不存在", payload);
    var lower = payload.index === 0 ? cue.start : cue.chars[payload.index - 1].t;
    var upper = payload.index === cue.chars.length - 1 ? cue.end : cue.chars[payload.index + 1].t;
    var target = Number(util.clamp(payload.time, lower, upper).toFixed(6));
    charItem.t = target;
    var report = validateProject(next);
    if (!report.ok) {
      return reject(project, "nudge-char", report.errors[0].message, report.conflictLocs[0]);
    }
    return accept(next, "nudge-char", { id: payload.id, index: payload.index, time: target });
  }

  function setLoop(project, payload) {
    var next = cloneProject(project);
    next.loop = {
      enabled: !!payload.enabled,
      start: Number(util.clamp(payload.start, 0, project.duration).toFixed(6)),
      end: Number(util.clamp(payload.end, 0, project.duration).toFixed(6))
    };
    if (next.loop.end <= next.loop.start + EPS) {
      return reject(project, "set-loop", "循环区间非法", payload);
    }
    return accept(next, "set-loop", next.loop);
  }

  var HANDLERS = {
    "trim-clip": trimClip,
    "move-clip": moveClip,
    "split-clip": splitClip,
    "set-transition": setTransition,
    "trim-cue": trimCue,
    "move-cue": moveCue,
    "nudge-char": nudgeChar,
    "set-loop": setLoop
  };

  function dispatch(project, action, payload) {
    var handler = HANDLERS[action];
    if (!handler) return reject(project, action, "未知动作", payload);
    return handler(project, payload || {});
  }

  /* 重放动作日志（用于失败回放）：逐动作派发，返回每步结果。 */
  function replay(project, actions) {
    var current = cloneProject(project);
    current.log = [];
    var steps = [];
    actions.forEach(function (item) {
      var result = dispatch(current, item.action, item.payload);
      steps.push({ action: item.action, ok: result.ok, reason: result.reason || null });
      current = result.project;
    });
    return { project: current, steps: steps };
  }

  return {
    PROJECT_VERSION: PROJECT_VERSION,
    MIN_CLIP: MIN_CLIP,
    MIN_CUE: MIN_CUE,
    beatInterval: beatInterval,
    generateBeats: generateBeats,
    makeCue: makeCue,
    makeClip: makeClip,
    createDefaultProject: createDefaultProject,
    crossfadeAllowed: crossfadeAllowed,
    validateClips: validateClips,
    validateSubtitles: validateSubtitles,
    validateBeats: validateBeats,
    validateProject: validateProject,
    canExport: canExport,
    dispatch: dispatch,
    replay: replay
  };
});
