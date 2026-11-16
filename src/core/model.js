import { clamp } from './time.js';

let uid = 1;
export const nextId = (prefix = 'id') => `${prefix}_${uid++}_${Math.random().toString(36).slice(2, 7)}`;

export const TRANSITIONS = ['push', 'dissolve', 'mask'];

// 片段：timeline 上 [inPoint, outPoint] 区间播放源 [srcIn, srcOut] 的内容。
export function createClip({ id, kind, source, inPoint, outPoint, srcIn = 0, srcOut, color }) {
  if (outPoint <= inPoint) throw new Error('片段时长必须为正');
  if (srcOut == null) srcOut = srcIn + (outPoint - inPoint);
  if (srcOut <= srcIn) throw new Error('源入点必须早于源出点');
  return {
    id: id ?? nextId('clip'),
    kind, source,
    inPoint, outPoint, srcIn, srcOut,
    color: color ?? null,
  };
}

// 节目时间 t -> 该片段自身（源）时间。不继承旧时间：始终由映射推导。
export function localTime(clip, t) {
  const duration = clip.outPoint - clip.inPoint;
  const ratio = clamp((t - clip.inPoint) / duration, 0, 1);
  return clip.srcIn + ratio * (clip.srcOut - clip.srcIn);
}

export class TimelineModel {
  constructor() {
    this.clips = [];        // 视频/动画场景片段
    this.audioEvents = [];  // { id, atMs, durationMs, gain, freq }
    this.subtitles = [];    // { id, startMs, endMs, text }
    this.transitions = [];  // { id, type, fromClip, toClip, startMs, durationMs }
    this.durationMs = 0;
  }

  addClip(clip) {
    this.clips.push(clip);
    this._sortAndRecalc();
    return clip;
  }

  _sortAndRecalc() {
    this.clips.sort((a, b) => a.inPoint - b.inPoint);
    this.durationMs = this.clips.reduce((m, c) => Math.max(m, c.outPoint), 0);
  }

  // 非法重叠：同轨两个片段在时间线上重叠（允许相切）。返回冲突列表。
  findOverlaps() {
    const conflicts = [];
    const sorted = [...this.clips].sort((a, b) => a.inPoint - b.inPoint);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.inPoint < prev.outPoint) {
        conflicts.push({
          type: 'overlap',
          clipIds: [prev.id, cur.id],
          startMs: cur.inPoint,
          endMs: Math.min(prev.outPoint, cur.outPoint),
          message: `片段 ${prev.id} 与 ${cur.id} 在 ${cur.inPoint}ms 处非法重叠`,
        });
      }
    }
    return conflicts;
  }

  // 移动片段：保持自身时长与源映射不变，仅平移时间线位置；不允许越界到负时间。
  moveClip(clipId, newInPoint) {
    const clip = this._must(clipId);
    const dur = clip.outPoint - clip.inPoint;
    clip.inPoint = Math.max(0, newInPoint);
    clip.outPoint = clip.inPoint + dur;
    this._sortAndRecalc();
    return clip;
  }

  // 分割：在节目时间 t 处把片段切成两段，源时间按同一比例切开，两段相切不重叠。
  splitClip(clipId, atMs) {
    const clip = this._must(clipId);
    if (atMs <= clip.inPoint || atMs >= clip.outPoint) {
      throw new Error('分割点必须位于片段内部');
    }
    const splitLocal = localTime(clip, atMs);
    const right = createClip({
      kind: clip.kind, source: clip.source, color: clip.color,
      inPoint: atMs, outPoint: clip.outPoint,
      srcIn: splitLocal, srcOut: clip.srcOut,
    });
    clip.outPoint = atMs;
    clip.srcOut = splitLocal;
    this.clips.push(right);
    this._sortAndRecalc();
    return [clip, right];
  }

  // 转场：把相邻的两个片段在时间线上重叠 durationMs，重叠区间内做转场。
  // 第二场景在重叠区内从自身源起点开始（srcIn），不继承第一场景的旧时间。
  addTransition(fromId, toId, type, durationMs) {
    if (!TRANSITIONS.includes(type)) throw new Error(`未知转场类型 ${type}`);
    const from = this._must(fromId);
    const to = this._must(toId);
    if (durationMs <= 0) throw new Error('转场时长必须为正');
    if (to.inPoint !== from.outPoint) {
      throw new Error('只能在相邻（相切）片段之间添加转场');
    }
    const maxDur = Math.min(from.outPoint - from.inPoint, to.outPoint - to.inPoint);
    if (durationMs >= maxDur) throw new Error('转场时长不能覆盖整段片段');
    const ownDuration = to.outPoint - to.inPoint;
    to.inPoint = from.outPoint - durationMs;
    to.outPoint = to.inPoint + ownDuration;
    this._sortAndRecalc();
    const tr = {
      id: nextId('tr'), type, fromClip: fromId, toClip: toId,
      startMs: to.inPoint, durationMs,
    };
    this.transitions = this.transitions.filter(
      (x) => !(x.fromClip === fromId && x.toClip === toId));
    this.transitions.push(tr);
    return tr;
  }

  removeTransition(id) {
    const tr = this.transitions.find((x) => x.id === id);
    if (!tr) return;
    const to = this.clips.find((c) => c.id === tr.toClip);
    const from = this.clips.find((c) => c.id === tr.fromClip);
    if (to && from) {
      const ownDuration = to.outPoint - to.inPoint;
      to.inPoint = from.outPoint;
      to.outPoint = to.inPoint + ownDuration;
    }
    this.transitions = this.transitions.filter((x) => x.id !== id);
    this._sortAndRecalc();
  }

  addAudioEvent(ev) {
    const item = { id: ev.id ?? nextId('aud'), ...ev };
    this.audioEvents.push(item);
    this.audioEvents.sort((a, b) => a.atMs - b.atMs);
    return item;
  }

  addSubtitle(sub) {
    const item = { id: sub.id ?? nextId('sub'), ...sub };
    this.subtitles.push(item);
    this.subtitles.sort((a, b) => a.startMs - b.startMs);
    return item;
  }

  activeAt(t) {
    const visible = this.clips.filter((c) => t >= c.inPoint && t < c.outPoint);
    const transition = this.transitions.find(
      (tr) => t >= tr.startMs && t < tr.startMs + tr.durationMs) || null;
    const subs = this.subtitles.filter((s) => t >= s.startMs && t < s.endMs);
    return { clips: visible, transition, subtitles: subs };
  }

  // 导出前完整校验：任何冲突都会阻止导出并给出位置。
  validate() {
    const errors = [];
    // 转场导致的重叠是合法的，其余重叠非法并阻止导出。
    errors.push(...this.findOverlaps().filter((c) => !this._overlapAllowedByTransition(c)));
    for (const c of this.clips) {
      if (c.outPoint - c.inPoint <= 0) {
        errors.push({ type: 'zero-length', clipIds: [c.id], message: `片段 ${c.id} 时长为零` });
      }
    }
    for (const tr of this.transitions) {
      const a = this.clips.find((c) => c.id === tr.fromClip);
      const b = this.clips.find((c) => c.id === tr.toClip);
      if (!a || !b) { errors.push({ type: 'dangling-transition', message: `转场 ${tr.id} 引用了缺失片段` }); continue; }
      if (!(b.inPoint < a.outPoint && tr.startMs === b.inPoint)) {
        errors.push({ type: 'bad-transition', message: `转场 ${tr.id} 与片段位置不一致` });
      }
    }
    return { ok: errors.length === 0, errors };
  }

  _overlapAllowedByTransition(conflict) {
    return this.transitions.some((tr) =>
      tr.fromClip === conflict.clipIds[0] && tr.toClip === conflict.clipIds[1] &&
      conflict.startMs === tr.startMs);
  }

  _must(id) {
    const clip = this.clips.find((c) => c.id === id);
    if (!clip) throw new Error(`片段不存在: ${id}`);
    return clip;
  }

  toJSON() {
    return {
      version: 1, timebase: 'ms',
      clips: this.clips, audioEvents: this.audioEvents,
      subtitles: this.subtitles, transitions: this.transitions,
      durationMs: this.durationMs,
    };
  }

  static fromJSON(data) {
    const m = new TimelineModel();
    m.clips = data.clips.map((c) => ({ ...c }));
    m.audioEvents = (data.audioEvents || []).map((e) => ({ ...e }));
    m.subtitles = (data.subtitles || []).map((s) => ({ ...s }));
    m.transitions = (data.transitions || []).map((t) => ({ ...t }));
    m._sortAndRecalc();
    return m;
  }
}
