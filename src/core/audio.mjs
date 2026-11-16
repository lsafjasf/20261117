import { sortedClips } from "./project.mjs";
import { BEAT_INTERVAL, beatEvents, nearestBeat, isOnBeat } from "./timebase.mjs";

// 音频事件与切点共享同一时间基准：节拍表来自 timebase，切点来自镜头表。
export function buildAudioEvents(duration, cutTimes = [], beatInterval = BEAT_INTERVAL) {
  const events = [];
  for (const beat of beatEvents(duration, beatInterval)) {
    if (beat > duration + 1e-9) break;
    events.push({ time: beat, kind: "kick", note: "beat" });
    const offBeat = beat + beatInterval / 2;
    if (offBeat < duration - 1e-9) {
      events.push({ time: offBeat, kind: "hat", note: "offbeat" });
    }
  }
  for (const cut of cutTimes) {
    events.push({ time: cut, kind: "cue", note: "camera-cut" });
  }
  return events.sort((a, b) => a.time - b.time || a.kind.localeCompare(b.kind));
}

export function cutTimes(project) {
  return sortedClips(project).slice(1).map((c) => c.start);
}

// 音画同步校验：每个切点必须落在节拍上，且与音频 cue 事件时间完全一致。
export function checkCutBeatSync(project) {
  const cuts = cutTimes(project);
  const events = buildAudioEvents(
    Math.max(...project.clips.map((c) => c.start + c.duration), 0),
    cuts,
    project.beatInterval
  );
  const cueTimes = new Set(events.filter((e) => e.kind === "cue").map((e) => e.time));
  const rows = cuts.map((cut) => {
    const drift = cut - nearestBeat(cut, project.beatInterval);
    return {
      cut,
      nearestBeat: nearestBeat(cut, project.beatInterval),
      drift,
      onBeat: isOnBeat(cut, project.beatInterval),
      hasAudioCue: cueTimes.has(cut)
    };
  });
  return {
    rows,
    maxDrift: rows.reduce((max, r) => Math.max(max, Math.abs(r.drift)), 0),
    synced: rows.every((r) => r.onBeat && r.hasAudioCue)
  };
}
