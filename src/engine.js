// Pure timeline engine: no DOM / AudioContext dependencies so it runs in Node.

export const SCHEMA_VERSION = 1;

export function clipDuration(clip) {
  return clip.sourceIn === undefined ? clip.duration : clip.sourceOut - clip.sourceIn;
}

export function getTrack(project, trackName) {
  return project.tracks[trackName] || [];
}

export function sortedClips(clips) {
  return [...clips].sort((a, b) => a.start - b.start);
}

export function findClip(project, clipId, trackName) {
  const names = trackName ? [trackName] : Object.keys(project.tracks);
  for (const name of names) {
    const clip = getTrack(project, name).find((c) => c.id === clipId);
    if (clip) return { clip, trackName: name };
  }
  return null;
}

// Move a clip while keeping its trimmed length; snaps are handled by the caller.
export function moveClip(project, clipId, deltaOrStart, trackName) {
  const found = findClip(project, clipId, trackName);
  if (!found) throw new Error(`clip ${clipId} not found`);
  const next = structuredClone(project);
  const target = findClip(next, clipId, found.trackName).clip;
  target.start = typeof deltaOrStart === 'number'
    ? target.start + deltaOrStart
    : deltaOrStart;
  return next;
}

export function setTransitionDuration(project, clipId, duration, trackName) {
  const next = structuredClone(project);
  const found = findClip(next, clipId, trackName);
  if (!found) throw new Error(`clip ${clipId} not found`);
  found.clip.transition = {
    type: (found.clip.transition && found.clip.transition.type) || 'crossfade',
    duration: Math.max(0, Number(duration) || 0),
  };
  return next;
}

// Trim in/out points of a clip. start/end are in source seconds.
export function setTrim(project, clipId, start, end, trackName) {
  const found = findClip(project, clipId, trackName);
  if (!found) throw new Error(`clip ${clipId} not found`);
  const clip = found.clip;
  const lo = 0;
  const hi = clip.sourceDuration ?? clip.duration;
  const sourceIn = Math.min(Math.max(start, lo), Math.max(lo, hi - 0.05));
  const sourceOut = Math.max(Math.min(end, hi), sourceIn + 0.05);
  const next = structuredClone(project);
  const target = findClip(next, clipId, found.trackName).clip;
  target.sourceIn = sourceIn;
  target.sourceOut = sourceOut;
  return next;
}

// Split a clip at a program time; audio events are rebased to source time.
export function splitClip(project, clipId, atTime, trackName = 'video') {
  const found = findClip(project, clipId, trackName);
  if (!found) throw new Error(`clip ${clipId} not found`);
  const clip = found.clip;
  const offset = atTime - clip.start;
  if (offset <= 0 || offset >= clipDuration(clip)) {
    throw new Error('split point must be inside the clip');
  }
  const next = structuredClone(project);
  const track = next.tracks[trackName];
  const index = track.findIndex((c) => c.id === clipId);
  const first = track[index];

  const sourceIn = first.sourceIn ?? 0;
  const sourceOut = first.sourceOut ?? (first.sourceDuration ?? first.duration);
  const cutPoint = sourceIn + offset;

  const second = structuredClone(first);
  second.id = `${first.id}-split-${Date.now().toString(36)}`;
  second.start = first.start + offset;
  second.sourceIn = cutPoint;
  second.sourceOut = sourceOut;
  second.transition = { type: 'crossfade', duration: 0 };

  first.sourceIn = sourceIn;
  first.sourceOut = cutPoint;
  first.transition = { type: 'crossfade', duration: 0 };

  first.audioEvents = (first.audioEvents || [])
    .filter((e) => (e.time ?? 0) < cutPoint);
  second.audioEvents = (second.audioEvents || [])
    .filter((e) => (e.time ?? 0) >= cutPoint);

  track.splice(index + 1, 0, second);
  return { project: next, newClipId: second.id };
}

// Illegal overlap: overlap beyond the declared transition overlap of either side.
export function validateProject(project) {
  const conflicts = [];
  const warnings = [];
  for (const [trackName, clips] of Object.entries(project.tracks)) {
    const ordered = sortedClips(clips);
    for (let i = 0; i < ordered.length; i += 1) {
      const clip = ordered[i];
      const duration = clipDuration(clip);
      if (!(duration > 0)) {
        conflicts.push({
          track: trackName, clipId: clip.id, at: clip.start,
          reason: 'clip has zero or negative duration',
        });
      }
      if (clip.start < -1e-9 || clip.start + duration > project.duration + 1e-9) {
        conflicts.push({
          track: trackName, clipId: clip.id, at: clip.start,
          reason: `clip extends outside the ${project.duration}s program`,
        });
      }
      if (i === 0) continue;
      const prev = ordered[i - 1];
      const overlap = prev.start + clipDuration(prev) - clip.start;
      if (overlap > 1e-9) {
        const declared = clip.transition?.duration || 0;
        if (Math.abs(overlap - declared) > 1e-6 || declared <= 0) {
          conflicts.push({
            track: trackName,
            clipId: `${prev.id} <-> ${clip.id}`,
            at: clip.start,
            reason: `illegal overlap of ${overlap.toFixed(3)}s without matching transition`,
          });
        }
      }
    }
  }
  return {
    valid: conflicts.length === 0,
    conflicts,
    warnings,
  };
}

export function canExport(project) {
  const result = validateProject(project);
  return result.valid;
}

// Total program time covered by a trimmed/transited track.
export function trackDuration(clips) {
  const ordered = sortedClips(clips);
  if (ordered.length === 0) return 0;
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  // Start positions already encode every declared transition overlap.
  return last.start + clipDuration(last) - first.start;
}

export function serializeProject(project) {
  return JSON.stringify({ ...project, schemaVersion: SCHEMA_VERSION });
}

export function deserializeProject(text) {
  const data = typeof text === 'string' ? JSON.parse(text) : structuredClone(text);
  if (!data || typeof data !== 'object' || !data.tracks) {
    throw new Error('invalid project file: missing tracks');
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported project schema ${data.schemaVersion}`);
  }
  const result = validateProject(data);
  return { project: data, validation: result };
}

// Flatten every audio event to absolute program time for the shared clock.
export function absoluteAudioEvents(project) {
  const events = [];
  for (const [trackName, clips] of Object.entries(project.tracks)) {
    for (const clip of clips) {
      const sourceIn = clip.sourceIn ?? 0;
      for (const event of clip.audioEvents || []) {
        events.push({
          time: clip.start + (event.time - sourceIn),
          sourceTime: event.time,
          clipId: clip.id,
          track: trackName,
          kind: event.kind || 'beat',
          intensity: event.intensity ?? 1,
        });
      }
    }
  }
  return events.sort((a, b) => a.time - b.time);
}
