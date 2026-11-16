import { clipEnd, sortedClips } from "./project.mjs";
import { drawFrame } from "./scene.mjs";

const EPS = 1e-6;

// 返回在节目时间 t 上参与合成的片段。叠化区间内同时返回 outgoing/incoming。
export function resolveClipsAt(project, time) {
  const ordered = sortedClips(project);
  let active = null;
  for (const clip of ordered) {
    if (time + EPS >= clip.start && time < clipEnd(clip) - EPS) {
      active = clip;
      break;
    }
  }
  if (!active) return { covered: false, layers: [] };

  const index = ordered.findIndex((c) => c.id === active.id);
  const incoming = index > 0 ? ordered[index] : null;
  const outgoing = index > 0 ? ordered[index - 1] : null;
  const transition = incoming?.transition;

  if (
    incoming &&
    outgoing &&
    transition &&
    transition.type !== "cut" &&
    time < incoming.start + transition.duration - EPS
  ) {
    const progress = (time - incoming.start) / transition.duration;
    if (transition.type === "dissolve") {
      return {
        covered: true,
        layers: [
          { clip: outgoing, alpha: 1 - progress },
          { clip: incoming, alpha: progress }
        ]
      };
    }
    if (transition.type === "dip") {
      // 先压黑再提亮，全程仍由不透明画面覆盖，不会留下真正的黑帧空洞。
      // 上限 0.9：保留底层画面痕迹，避免产生真正意义上的全黑帧。
      const blackAlpha = (progress < 0.5 ? progress * 2 : (1 - progress) * 2) * 0.9;
      return {
        covered: true,
        layers: [
          { clip: outgoing, alpha: 1 },
          { clip: incoming, alpha: 1, dipBlack: blackAlpha }
        ]
      };
    }
  }
  return { covered: true, layers: [{ clip: active, alpha: 1 }] };
}

export function subtitleAt(project, time) {
  const entry = project.subtitles.find((s) => time + EPS >= s.start && time < s.end - EPS);
  return entry?.text ?? "";
}

// 单帧合成入口：浏览器 Canvas 与 Node 测试桩共用。
export function composeFrame(ctx, project, time, options = {}) {
  const { width = 640, height = 360 } = options;
  const resolution = resolveClipsAt(project, time);
  if (!resolution.covered) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    return { covered: false, layers: [] };
  }
  for (const layer of resolution.layers) {
    drawFrame(ctx, {
      time, // 关键：传入节目时间而非片段内时间，场景动画连续不重置
      cameraId: layer.clip.cameraId,
      width,
      height,
      alpha: layer.alpha,
      subtitle: layer === resolution.layers[resolution.layers.length - 1]
        ? subtitleAt(project, time)
        : ""
    });
    if (layer.dipBlack) {
      const previousAlpha = ctx.globalAlpha;
      ctx.globalAlpha = layer.dipBlack;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = previousAlpha;
    }
  }
  return resolution;
}
