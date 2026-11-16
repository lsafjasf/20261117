// 缩略图异步调度。每次可见窗口/缩放/裁切变化都开启新一代请求（generation），
// 旧代次完成的结果在 reducer 处被直接丢弃，保证异步结果不会覆盖新请求。

export function thumbKey(entry) {
  return `${entry.clipId}@${entry.srcTime.toFixed(3)}|${entry.width}x${entry.height}|${entry.crop}`;
}

export class ThumbnailScheduler {
  constructor(store, frameProvider) {
    this.store = store;
    this.frameProvider = frameProvider;
    this.generation = 0;
    this.inflight = new Set();
    this.failed = [];
  }

  requestVisible(entries) {
    this.generation += 1;
    const generation = this.generation;
    // 新一代请求开始：旧代次在途任务即使返回，也会被 reducer 按代次丢弃。
    this.inflight.clear();
    this.store.dispatch({ type: "THUMB_GEN_START", generation });
    const { results } = this.store.getState().thumbnails;
    for (const entry of entries) {
      const key = thumbKey(entry);
      if (this.inflight.has(key) || results[key]) continue;
      this.inflight.add(key);
      this.store.dispatch({ type: "THUMB_JOB", key, status: "pending", generation });
      this._run(key, entry, generation);
    }
  }

  async _run(key, entry, generation) {
    try {
      const bitmap = await this.frameProvider(entry);
      this.store.dispatch({
        type: "THUMB_RESULT",
        key,
        generation,
        bitmap,
        time: entry.srcTime,
        crop: entry.crop
      });
    } catch (error) {
      this.store.dispatch({
        type: "THUMB_JOB",
        key,
        status: "failed",
        generation,
        error: String(error && error.message ? error.message : error)
      });
      this.failed.push({ key, entry, generation });
    } finally {
      this.inflight.delete(key);
    }
  }

  // 失败回放：只重试最近一代中仍被需要的失败任务。
  retryFailed(entries = []) {
    const wanted = new Set(entries.map(thumbKey));
    const pending = [];
    const retried = [];
    for (const item of this.failed) {
      if (wanted.size && !wanted.has(item.key)) { pending.push(item); continue; }
      retried.push(item.key);
      this.inflight.add(item.key);
      this.store.dispatch({ type: "THUMB_JOB", key: item.key, status: "pending", generation: this.generation });
      this._run(item.key, item.entry, this.generation);
    }
    this.failed = pending;
    return retried;
  }
}

// 根据滚动窗口和缩放比例，为每个视频片段生成等间隔缩略图请求。
export function buildVisibleThumbEntries(timeline, view, widthForSecond, marginSeconds = 1) {
  const { pxPerSecond, scrollLeft, cropAspect } = view;
  const viewportStart = Math.max(0, scrollLeft / pxPerSecond - marginSeconds);
  const viewportEnd = (scrollLeft + widthForSecond) / pxPerSecond + marginSeconds;
  const entries = [];
  const spacing = Math.max(0.5, 48 / pxPerSecond);
  for (const clip of timeline.videos) {
    const clipEnd = clip.start + clip.duration;
    if (clipEnd <= viewportStart || clip.start >= viewportEnd) continue;
    const first = Math.max(clip.start, viewportStart);
    const last = Math.min(clipEnd, viewportEnd);
    for (let time = first; time <= last + 1e-6; time += spacing) {
      const srcTime = clip.srcIn + (time - clip.start);
      entries.push({
        clipId: clip.id,
        sourceId: clip.sourceId,
        srcTime,
        width: Math.max(32, Math.round(spacing * pxPerSecond)),
        height: 40,
        crop: cropAspect
      });
    }
  }
  return entries;
}
