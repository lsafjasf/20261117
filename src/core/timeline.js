// Multi-track program timeline. A clip may not overlap another clip on the
// same track unless a transition object covers that exact overlap, which lets
// the renderer crossfade instead of treating it as a conflict.

function nextId(prefix, counter) {
  counter.value += 1;
  return `${prefix}_${counter.value}`;
}

export class Timeline {
  constructor() {
    this._idCounter = { value: 0 };
    this.tracks = [{ id: nextId('track', this._idCounter), clips: [] }];
    this.transitions = [];
  }

  seedIdCounter(value) {
    this._idCounter.value = value;
  }

  mintClipId() {
    return nextId('clip', this._idCounter);
  }

  mintTransitionId() {
    return nextId('trans', this._idCounter);
  }

  addClip({ trackId = this.tracks[0].id, start, end,
    sourceStart = 0, sourceDuration = end - start, color, label = '', id = null }) {
    if (end <= start) throw new Error('Clip end must be greater than start');
    const track = this._track(trackId);
    const clip = {
      id: id || nextId('clip', this._idCounter), trackId, start, end,
      sourceStart, sourceDuration, color, label
    };
    if (this._hasIllegalOverlap(track, clip)) {
      throw new Error(`Illegal overlap adding clip at ${start}-${end}`);
    }
    track.clips.push(clip);
    track.clips.sort((a, b) => a.start - b.start);
    return clip;
  }

  findClip(clipId) {
    for (const track of this.tracks) {
      const clip = track.clips.find((item) => item.id === clipId);
      if (clip) return clip;
    }
    return null;
  }

  // Move keeps duration and source mapping constant. Overlap (outside an
  // existing transition) blocks the operation and reports the conflict.
  moveClip(clipId, newStart, newTrackId) {
    const clip = this.findClip(clipId);
    if (!clip) throw new Error(`Unknown clip ${clipId}`);
    if (newStart < 0) throw new Error('Clip cannot start before zero');
    const targetTrack = this._track(newTrackId || clip.trackId);
    const duration = clip.end - clip.start;
    const candidate = { ...clip, start: newStart, end: newStart + duration,
      trackId: targetTrack.id };
    if (this._hasIllegalOverlap(targetTrack, candidate, clipId)) {
      const conflict = this._conflictAt(targetTrack, candidate, clipId);
      const error = new Error('Move blocked: illegal overlap');
      error.code = 'OVERLAP_BLOCKED';
      error.conflict = conflict;
      throw error;
    }
    clip.start = candidate.start;
    clip.end = candidate.end;
    if (newTrackId && newTrackId !== clip.trackId) {
      this._track(clip.trackId).clips = this._track(clip.trackId).clips
        .filter((item) => item.id !== clipId);
      clip.trackId = newTrackId;
      targetTrack.clips.push(clip);
    }
    targetTrack.clips.sort((a, b) => a.start - b.start);
    return clip;
  }

  splitClip(clipId, atMs, newId = null) {
    const clip = this.findClip(clipId);
    if (!clip) throw new Error(`Unknown clip ${clipId}`);
    if (atMs <= clip.start || atMs >= clip.end) {
      throw new Error('Split point must be inside the clip');
    }
    const offset = atMs - clip.start;
    const right = {
      id: newId || nextId('clip', this._idCounter), trackId: clip.trackId,
      start: atMs, end: clip.end,
      sourceStart: clip.sourceStart + offset,
      sourceDuration: clip.sourceDuration - offset,
      color: clip.color, label: clip.label
    };
    clip.end = atMs;
    clip.sourceDuration = offset;
    this._track(clip.trackId).clips.push(right);
    this._track(clip.trackId).clips.sort((a, b) => a.start - b.start);
    return { left: clip, right };
  }

  trimClip(clipId, { start, end }) {
    const clip = this.findClip(clipId);
    if (!clip) throw new Error(`Unknown clip ${clipId}`);
    const nextStart = start ?? clip.start;
    const nextEnd = end ?? clip.end;
    if (nextEnd <= nextStart) throw new Error('Trim produced an empty clip');
    if (nextStart < clip.sourceStart ||
      nextEnd - clip.start > clip.sourceDuration + (clip.start - clip.sourceStart)) {
      throw new Error('Trim exceeds available source media');
    }
    const candidate = { ...clip, start: nextStart, end: nextEnd };
    if (this._hasIllegalOverlap(this._track(clip.trackId), candidate, clipId)) {
      const error = new Error('Trim blocked: illegal overlap');
      error.code = 'OVERLAP_BLOCKED';
      error.conflict = this._conflictAt(this._track(clip.trackId), candidate, clipId);
      throw error;
    }
    if (start !== undefined) {
      clip.sourceStart += start - clip.start;
    }
    clip.start = nextStart;
    clip.end = nextEnd;
    return clip;
  }

  // Crossfade: pull the later clip back so the pair overlaps for exactly
  // durationMs, then register a transition covering that overlap.
  addTransition(clipAId, clipBId, durationMs, transitionId = null) {
    const a = this.findClip(clipAId);
    const b = this.findClip(clipBId);
    if (!a || !b) throw new Error('Transition needs two existing clips');
    if (a.trackId !== b.trackId) throw new Error('Transitions require one track');
    if (durationMs <= 0) throw new Error('Transition duration must be positive');
    if (a.end > b.start) throw new Error('First clip must end before the second');
    const newStart = b.start - durationMs;
    const candidate = { ...b, start: newStart, end: b.end };
    const blockedByThird = this._track(b.trackId).clips.some((clip) => {
      if (clip.id === b.id || clip.id === a.id) return false;
      return newStart < clip.end && b.end > clip.start;
    });
    if (blockedByThird) {
      throw new Error('Transition blocked by a third clip');
    }
    b.start = newStart;
    b.sourceStart -= durationMs;
    b.sourceDuration += durationMs;
    const transition = {
      id: transitionId || nextId('trans', this._idCounter),
      fromClipId: a.id, toClipId: b.id,
      start: newStart, end: a.end, durationMs
    };
    this.transitions.push(transition);
    this._track(b.trackId).clips.sort((x, y) => x.start - y.start);
    return transition;
  }

  activeClipsAt(timeMs) {
    const visible = [];
    for (const track of this.tracks) {
      for (const clip of track.clips) {
        if (timeMs >= clip.start && timeMs < clip.end) {
          visible.push({ clip, alpha: 1 });
        }
      }
    }
    for (const transition of this.transitions) {
      if (timeMs >= transition.start && timeMs < transition.end) {
        const progress = (timeMs - transition.start) / transition.durationMs;
        for (const entry of visible) {
          if (entry.clip.id === transition.fromClipId) entry.alpha = 1 - progress;
          if (entry.clip.id === transition.toClipId) entry.alpha = progress;
        }
      }
    }
    return visible;
  }

  // Returns every overlap with the clips and time range involved. A covered
  // transition overlap is legal and excluded from the conflict list.
  validate() {
    const conflicts = [];
    for (const track of this.tracks) {
      const clips = [...track.clips].sort((a, b) => a.start - b.start);
      for (let i = 0; i < clips.length; i += 1) {
        for (let j = i + 1; j < clips.length; j += 1) {
          const a = clips[i];
          const b = clips[j];
          if (b.start >= a.end) break;
          const overlapStart = Math.max(a.start, b.start);
          const overlapEnd = Math.min(a.end, b.end);
          if (!this._transitionCovers(a, b, overlapStart, overlapEnd)) {
            conflicts.push({
              trackId: track.id,
              clipIds: [a.id, b.id],
              start: overlapStart, end: overlapEnd,
              message: `Illegal overlap ${a.id} / ${b.id} at ${overapLabel(overlapStart, overlapEnd)}`
            });
          }
        }
      }
    }
    return conflicts;
  }

  get durationMs() {
    return this.tracks.reduce((max, track) =>
      Math.max(max, ...track.clips.map((clip) => clip.end)), 0);
  }

  _transitionCovers(a, b, start, end) {
    return this.transitions.some((transition) => {
      const pair = [transition.fromClipId, transition.toClipId].sort().join();
      const clips = [a.id, b.id].sort().join();
      return pair === clips && transition.start === start && transition.end === end;
    });
  }

  _hasIllegalOverlap(track, candidate, ignoreId = null) {
    return track.clips.some((clip) => {
      if (clip.id === candidate.id || clip.id === ignoreId) return false;
      return candidate.start < clip.end && candidate.end > clip.start &&
        !this._transitionCovers(
          { id: candidate.id }, clip,
          Math.max(candidate.start, clip.start),
          Math.min(candidate.end, clip.end));
    });
  }

  _conflictAt(track, candidate, ignoreId) {
    const other = track.clips.find((clip) => {
      if (clip.id === candidate.id || clip.id === ignoreId) return false;
      return candidate.start < clip.end && candidate.end > clip.start;
    });
    if (!other) return null;
    return {
      trackId: track.id,
      clipIds: [candidate.id, other.id],
      start: Math.max(candidate.start, other.start),
      end: Math.min(candidate.end, other.end)
    };
  }

  _track(trackId) {
    const track = this.tracks.find((item) => item.id === trackId);
    if (!track) throw new Error(`Unknown track ${trackId}`);
    return track;
  }
}

function overapLabel(start, end) {
  return `${start}-${end}ms`;
}
