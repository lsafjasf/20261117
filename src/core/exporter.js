// 导出流水线：先阻止任何非法重叠，再逐帧合成并校验首尾非黑。
import { findConflicts } from "./timeline.js";
import { renderFrame, renderAudio, isBlack } from "./compositor.js";
import { encodePng } from "../encode/png.js";
import { encodeApng } from "../encode/apng.js";
import { encodeWav } from "../encode/wav.js";

export function assertExportable(timeline) {
  const conflicts = findConflicts(timeline);
  if (conflicts.length) {
    const error = new Error("存在非法重叠，导出已阻止");
    error.conflicts = conflicts;
    throw error;
  }
  return true;
}

export async function exportPng(timeline, sources, time, crop, size = { width: 96, height: 54 }) {
  assertExportable(timeline);
  const rgba = renderFrame(timeline, sources, Math.min(time, timeline.duration - 1e-6), crop, size.width, size.height);
  if (isBlack(rgba)) throw new Error("选帧为黑帧，拒绝导出");
  return encodePng(rgba, size.width, size.height);
}

export async function exportProgram(timeline, sources, { fps = 4, crop = "16:9", width = 96, height = 54, sampleRate = 8000 } = {}) {
  assertExportable(timeline);
  const frameMs = 1000 / fps;
  const frameCount = Math.max(1, Math.round(timeline.duration * fps));
  const frames = [];
  for (let i = 0; i < frameCount; i += 1) {
    // 取每个帧区间的中点，避免末端采样落到节目结束之后的无素材黑区。
    const time = Math.min(timeline.duration - 0.5 / fps, (i + 0.5) / fps);
    const rgba = renderFrame(timeline, sources, time, crop, width, height);
    if (i === 0 || i === frameCount - 1) {
      if (isBlack(rgba)) throw new Error(`第 ${i === 0 ? "首" : "尾"} 帧为黑帧，拒绝导出`);
    }
    frames.push({ rgba, width, height, delayMs: frameMs });
  }
  const apng = await encodeApng(frames, 0);
  const audio = renderAudio(timeline, sources, 0, timeline.duration, sampleRate);
  const wav = encodeWav(audio.samples, sampleRate);
  return {
    apng,
    wav,
    frameCount,
    fps,
    durationSeconds: frameCount / fps,
    audioDurationSeconds: audio.samples.length / sampleRate
  };
}

// 时长比较：用于验证裁切/转场后的节目时长差异。
export function compareDurations(a, b) {
  const delta = b.durationSeconds - a.durationSeconds;
  return {
    a: a.durationSeconds,
    b: b.durationSeconds,
    delta,
    verdict: delta > 0 ? "b 更长" : delta < 0 ? "b 更短" : "时长相同"
  };
}
