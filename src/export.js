// 导出：预校验（重叠 / 首尾黑帧）-> MediaRecorder 实时录制画布与鼓点。
// 录制循环与播放共用 model 的同一套时间映射，不另造时间基准。

import { validateProject, mappedAudioEvents } from './model.js';
import { renderFrame, averageLuminance, BLACK_LUMINANCE_THRESHOLD } from './renderer.js';

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export function preflightCheck(ctx, project, canvas, width, height) {
  const validation = validateProject(project);
  if (!validation.ok) {
    return { ok: false, stage: 'validate', validation };
  }
  const headEvents = mappedAudioEvents(project);
  renderFrame(ctx, project, project.inPoint, new Uint8Array(64), width, height);
  const headLuminance = averageLuminance(canvas);
  renderFrame(ctx, project, project.outPoint - 1 / project.fps, new Uint8Array(64), width, height);
  const tailLuminance = averageLuminance(canvas);
  const blackFrames = [];
  if (headLuminance < BLACK_LUMINANCE_THRESHOLD) {
    blackFrames.push({ position: 'head', luminance: headLuminance });
  }
  if (tailLuminance < BLACK_LUMINANCE_THRESHOLD) {
    blackFrames.push({ position: 'tail', luminance: tailLuminance });
  }
  if (blackFrames.length > 0) {
    return { ok: false, stage: 'black-frame', blackFrames, validation };
  }
  return {
    ok: true,
    validation,
    luminance: { head: headLuminance, tail: tailLuminance },
    eventCount: headEvents.length,
  };
}

export async function exportVideo({
  ctx,
  project,
  canvas,
  drum,
  width,
  height,
  onProgress,
}) {
  const preflight = preflightCheck(ctx, project, canvas, width, height);
  if (!preflight.ok) return preflight;

  await drum.ensureContext();
  const audioDestination = drum.createMediaStreamDestination();
  const videoStream = canvas.captureStream(project.fps);
  const combined = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const duration = project.outPoint - project.inPoint;
  const events = mappedAudioEvents(project).filter(
    (event) => event.audioTime >= project.inPoint && event.audioTime <= project.outPoint,
  );
  const startTime = performance.now();
  const audioStart = drum.ctx.currentTime + 0.15;
  for (const event of events) {
    const when = audioStart + (event.audioTime - project.inPoint);
    drum.playKickAt(when);
  }

  return new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      resolve({
        ok: true,
        blob,
        mimeType: blob.type,
        size: blob.size,
        duration,
        preflight,
      });
    };
    recorder.start(100);

    const drawLoop = (now) => {
      const elapsed = (now - startTime) / 1000;
      const programTime = Math.min(project.inPoint + elapsed, project.outPoint);
      renderFrame(ctx, project, programTime, drum.getWaveformSamples(), width, height);
      onProgress?.(Math.min(elapsed / duration, 1));
      if (elapsed >= duration) {
        recorder.stop();
        return;
      }
      requestAnimationFrame(drawLoop);
    };
    requestAnimationFrame(drawLoop);
  });
}
