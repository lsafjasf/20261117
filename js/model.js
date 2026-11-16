/*
 * model.js — 纯数据模型与校验逻辑。
 * 不依赖 DOM，可同时被浏览器与 Node 测试引用。
 * 所有轨道（视频片段 / 字幕 / 音频事件）共用同一时间轴（秒）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CreditModel = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const EPS = 1e-6;

  function uid(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 9);
  }

  /** 默认工程：一段示例短片 + 滚动片尾 + 背景声事件 */
  function createDefaultProject() {
    return {
      version: 1,
      name: "示例短片《夜航》片尾",
      settings: {
        width: 960,
        height: 540,
        fps: 30,
        lineHeight: 44,        // 行距(px)
        scrollSpeed: 60,       // 滚动速度(px/s)
        bgFadeOut: 2.0,        // 结尾背景淡出时长(s)，0 表示不淡出
        loop: true,
        fontFamily: "sans-serif",
      },
      // 视频片段：start/duration 为时间线位置；inPoint/outPoint 为源素材入出点
      clips: [
        { id: "clip_a", name: "开场", start: 0, duration: 4, inPoint: 0, outPoint: 4, hue: 210 },
        { id: "clip_b", name: "主体", start: 4, duration: 6, inPoint: 0, outPoint: 6, hue: 160 },
        { id: "clip_c", name: "尾声", start: 10, duration: 4, inPoint: 0, outPoint: 4, hue: 280 },
      ],
      // 转场：位于 from 片段末尾，向 to 片段交叉淡化
      transitions: [
        { id: "tr_1", from: "clip_a", to: "clip_b", duration: 1.0, type: "crossfade" },
      ],
      // 片尾字幕行；pauses 为停留段：该行滚到停留线时暂停滚动 dwell 秒
      credits: {
        startTime: 14,          // 字幕开始滚动的时间线时刻
        dwellLineRatio: 0.5,    // 停留线位置（画面高度比例）
        lines: [
          "夜航", "NIGHT FERRY", "",
          "导演  林一舟", "摄影  陈 默", "录音  苏 晴", "",
          "主演", "周 野  饰  船长", "唐 果  饰  领航员", "",
          "鸣谢  海港城市影业", "© 2026 夜航剧组",
        ],
        pauses: [
          { lineIndex: 0, dwell: 1.5 },   // 片名停留
          { lineIndex: 12, dwell: 2.0 },  // 版权行停留
        ],
      },
      // 音频事件：与视频共用同一时间轴
      audioEvents: [
        { id: "au_1", type: "pad", start: 0, duration: 14, freq: 110, gain: 0.12 },
        { id: "au_2", type: "tone", start: 4, duration: 0.3, freq: 660, gain: 0.2 },
        { id: "au_3", type: "tone", start: 10, duration: 0.3, freq: 550, gain: 0.2 },
        { id: "au_4", type: "pad", start: 14, duration: 20, freq: 146.8, gain: 0.1 },
      ],
    };
  }

  /** 节目总时长 = max(片段末尾, 音频事件末尾, 字幕滚完时刻) */
  function programDuration(project) {
    let end = 0;
    for (const c of project.clips) end = Math.max(end, c.start + c.duration);
    for (const a of project.audioEvents) end = Math.max(end, a.start + a.duration);
    end = Math.max(end, creditsEndTime(project));
    return end;
  }

  /**
   * 字幕滚动几何（真实停留模型）。
   * 基础布局：第 i 行初始 y = height + i*lineHeight（从画面底部进入）。
   * 停留段：当指定行到达停留线（dwellLineRatio * height）时，
   * 全局滚动暂停 dwell 秒。暂停是“时间→滚动量”的分段线性映射，
   * 纯函数无状态，拖动播放头可任意定位。
   */
  function creditsLayout(project) {
    const s = project.settings;
    const lines = project.credits.lines;
    const dwellLine = s.height * (project.credits.dwellLineRatio ?? 0.5);
    const pauseMap = new Map((project.credits.pauses || []).map((p) => [p.lineIndex, p.dwell]));
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const baseY = s.height + i * s.lineHeight;
      rows.push({ index: i, text: lines[i], y: baseY, dwell: pauseMap.get(i) || 0 });
    }
    // 计算每个停留段的触发时刻（相对 startTime），按触发位置排序
    const pauses = rows
      .filter((r) => r.dwell > 0)
      .map((r) => ({ triggerScroll: r.y - dwellLine, dwell: r.dwell, lineIndex: r.index }))
      .sort((a, b) => a.triggerScroll - b.triggerScroll);
    let accumDwell = 0;
    for (const p of pauses) {
      p.triggerTime = (p.triggerScroll + accumDwell * s.scrollSpeed) / s.scrollSpeed;
      accumDwell += p.dwell;
    }
    const lastY = rows.length ? rows[rows.length - 1].y : s.height;
    const baseTravel = lastY + s.lineHeight; // 末行滚出画面顶部所需滚动量
    const totalDwell = accumDwell;
    return { rows, pauses, dwellLine, baseTravel, totalDwell, lineHeight: s.lineHeight };
  }

  /** 时间 → 有效滚动量：扣除停留段冻结的行程 */
  function effectiveScroll(layout, speed, elapsed) {
    let scroll = elapsed * speed;
    for (const p of layout.pauses) {
      if (elapsed >= p.triggerTime + p.dwell) scroll -= p.dwell * speed;
      else if (elapsed >= p.triggerTime) scroll -= (elapsed - p.triggerTime) * speed;
    }
    return Math.max(0, scroll);
  }

  /** 字幕完全滚出画面的时间线时刻 */
  function creditsEndTime(project) {
    const s = project.settings;
    const layout = creditsLayout(project);
    return project.credits.startTime + layout.baseTravel / s.scrollSpeed + layout.totalDwell;
  }

  /** 给定时间线时刻，返回每行字幕的屏幕 y 坐标（含停留效果，纯函数无状态） */
  function creditsPositionsAt(project, t) {
    const s = project.settings;
    const layout = creditsLayout(project);
    const elapsed = Math.max(0, t - project.credits.startTime);
    const scroll = effectiveScroll(layout, s.scrollSpeed, elapsed);
    return layout.rows.map((row) => ({
      index: row.index,
      text: row.text,
      screenY: row.y - scroll,
    }));
  }

  /** 指定时刻处于活动状态的视频片段（含转场混合信息） */
  function activeClipAt(project, t) {
    const sorted = [...project.clips].sort((a, b) => a.start - b.start);
    for (const c of sorted) {
      if (t >= c.start - EPS && t < c.start + c.duration - EPS) {
        const tr = project.transitions.find((x) => x.from === c.id);
        let blend = null;
        if (tr) {
          const trStart = c.start + c.duration - tr.duration;
          if (t >= trStart) {
            const next = sorted.find((x) => x.id === tr.to);
            if (next) blend = { next, progress: (t - trStart) / tr.duration };
          }
        }
        return { clip: c, blend };
      }
    }
    return null;
  }

  /* ---------------- 编辑操作（全部作用于同一时间轴） ---------------- */

  /** 移动片段；linked=true 时，落在该片段时间域内的音频事件同步平移 */
  function moveClip(project, clipId, newStart, linked) {
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip) throw new Error("clip not found: " + clipId);
    const oldStart = clip.start;
    const oldEnd = oldStart + clip.duration;
    const delta = newStart - oldStart;
    clip.start = newStart;
    if (linked) {
      for (const a of project.audioEvents) {
        if (a.start >= oldStart - EPS && a.start < oldEnd - EPS) a.start += delta;
      }
    }
    return project;
  }

  /** 在 t 处分割片段；源入出点同步切分。音频事件共用时间轴，无需改动即仍对齐 */
  function splitClip(project, clipId, t) {
    const idx = project.clips.findIndex((c) => c.id === clipId);
    if (idx < 0) throw new Error("clip not found: " + clipId);
    const clip = project.clips[idx];
    const offset = t - clip.start;
    if (offset <= EPS || offset >= clip.duration - EPS) {
      throw new Error("split point outside clip body");
    }
    const second = {
      id: uid("clip"),
      name: clip.name + "(2)",
      start: t,
      duration: clip.duration - offset,
      inPoint: clip.inPoint + offset,
      outPoint: clip.outPoint,
      hue: clip.hue,
    };
    clip.duration = offset;
    clip.outPoint = clip.inPoint + offset;
    project.clips.splice(idx + 1, 0, second);
    for (const tr of project.transitions) {
      if (tr.from === clipId) tr.from = second.id;
    }
    return { first: clip, second };
  }

  /** 裁切片段入点/出点（时间线长度同步变化） */
  function trimClip(project, clipId, newIn, newOut) {
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip) throw new Error("clip not found: " + clipId);
    if (newOut - newIn <= EPS) throw new Error("invalid trim range");
    clip.inPoint = newIn;
    clip.outPoint = newOut;
    clip.duration = newOut - newIn;
    return clip;
  }

  /** 在相邻两片段间添加交叉淡化转场 */
  function addTransition(project, fromId, toId, duration) {
    const from = project.clips.find((c) => c.id === fromId);
    const to = project.clips.find((c) => c.id === toId);
    if (!from || !to) throw new Error("transition endpoints missing");
    if (duration <= EPS) throw new Error("transition duration must be > 0");
    if (duration > from.duration + EPS) throw new Error("transition longer than source clip");
    project.transitions.push({ id: uid("tr"), from: fromId, to: toId, duration, type: "crossfade" });
    return project;
  }

  /* ---------------- 校验：任何非法都阻止导出 ---------------- */

  /**
   * 返回冲突列表，每项含 type/message/时间区间/相关片段 id，供 UI 高亮：
   *  - overlap:    片段时间重叠
   *  - transition: 转场越过片段边界
   *  - credits:    字幕停留段冲突
   */
  function validateProject(project) {
    const issues = [];
    const sorted = [...project.clips].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (a.start + a.duration > b.start + EPS) {
        issues.push({
          type: "overlap",
          message: `片段「${a.name}」与「${b.name}」重叠`,
          start: b.start,
          end: Math.min(a.start + a.duration, b.start + b.duration),
          ids: [a.id, b.id],
        });
      }
    }
    for (const tr of project.transitions) {
      const from = project.clips.find((c) => c.id === tr.from);
      if (from && tr.duration > from.duration + EPS) {
        issues.push({
          type: "transition",
          message: `转场时长超出片段「${from.name}」`,
          start: from.start,
          end: from.start + from.duration,
          ids: [from.id],
        });
      }
    }
    // 字幕校验：停留段指向不存在的行 / 行文本越界（超出画面宽度）
    const layout = creditsLayout(project);
    const lineCount = project.credits.lines.length;
    for (const p of project.credits.pauses || []) {
      if (p.lineIndex < 0 || p.lineIndex >= lineCount) {
        issues.push({
          type: "credits",
          message: `字幕停留段指向不存在的第 ${p.lineIndex + 1} 行`,
          start: project.credits.startTime,
          end: creditsEndTime(project),
          ids: [],
        });
      }
    }
    for (const row of layout.rows) {
      if (row.text && estimateTextWidth(row.text, row.index === 0) > project.settings.width - 40) {
        issues.push({
          type: "credits",
          message: `第 ${row.index + 1} 行字幕越界（超出画面宽度）`,
          start: project.credits.startTime,
          end: creditsEndTime(project),
          ids: [],
        });
      }
    }
    return issues;
  }

  /** 估算文本像素宽度：CJK 按全宽、ASCII 按 0.55 宽 */
  function estimateTextWidth(text, isTitle) {
    const fontSize = isTitle ? 40 : 26;
    let w = 0;
    for (const ch of text) {
      w += /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch) ? fontSize : fontSize * 0.55;
    }
    return w;
  }

  /** 字幕越界判定：行距/速度非正、行程非法或任一行超出画面宽度 */
  function creditsOverflow(project) {
    const s = project.settings;
    if (s.lineHeight <= 0 || s.scrollSpeed <= 0) return true;
    const layout = creditsLayout(project);
    if (!isFinite(layout.baseTravel) || layout.baseTravel <= 0) return true;
    return layout.rows.some(
      (r) => r.text && estimateTextWidth(r.text, r.index === 0) > s.width - 40
    );
  }

  return {
    EPS,
    uid,
    createDefaultProject,
    programDuration,
    creditsLayout,
    creditsEndTime,
    creditsPositionsAt,
    activeClipAt,
    moveClip,
    splitClip,
    trimClip,
    addTransition,
    validateProject,
    creditsOverflow,
    estimateTextWidth,
  };
});
