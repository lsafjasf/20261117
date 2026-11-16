import { renderFrame, frameLuma } from './chart-renderer.js';
import { renderOffline } from './audio-engine.js';
import { absoluteAudioEvents, validateProject } from './engine.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

// Frame-locked export: one canvas frame per requested frame time, paced by the
// offline-rendered audio clock so video and audio share one deterministic base.
export async function exportWebM(project, canvas, {
  failOnAttempt = 0,
  onProgress = () => {},
  signal,
} = {}) {
  const validation = validateProject(project);
  if (!validation.valid) {
    const error = new Error('export blocked: illegal timeline overlap');
    error.conflicts = validation.conflicts;
    throw error;
  }

  const fps = project.frameRate;
  const frameCount = Math.round(project.duration * fps);
  const events = absoluteAudioEvents(project);
  const audioBuffer = await renderOffline(events, project.duration);

  // Audio master clock for the whole export.
  const audioCtx = new AudioContext({ sampleRate: audioBuffer.sampleRate });
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);

  // Manual track: we own every frame request and can therefore guarantee an
  // exact frame count (captureStream(fps) is allowed to coalesce under load).
  const stream = canvas.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0];
  for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  const ctx = canvas.getContext('2d');
  const alignment = [];
  let firstLuma = 0;
  let lastLuma = 0;

  const drawAt = (frameIndex, recordAlignment = true) => {
    const time = frameIndex / fps;
    renderFrame(ctx, project, time, events, canvas.width, canvas.height);
    videoTrack.requestFrame();
    if (frameIndex === 0) firstLuma = frameLuma(canvas);
    if (frameIndex === frameCount - 1) lastLuma = frameLuma(canvas);
    if (recordAlignment) {
      const nearestBeat = events
        .filter((e) => Math.abs(e.time - time) <= 1 / fps)
        .map((e) => ({ time: e.time, clipId: e.clipId, kind: e.kind }));
      alignment.push({ frame: frameIndex, time: Number(time.toFixed(3)), beats: nearestBeat });
    }
  };

  recorder.start(250);
  await audioCtx.resume();
  source.start();
  const startWall = performance.now();
  const startAudio = audioCtx.currentTime;
  const framePeriodMs = 1000 / fps;

  let attemptFailure = failOnAttempt === 1;
  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (signal?.aborted) throw new Error('export aborted');
      if (attemptFailure) {
        attemptFailure = false;
        throw new Error('simulated export failure for replay verification');
      }
      // Fixed wall-clock slot: one frame every framePeriod, so a slow frame
      // delays the whole export instead of being dropped.
      const targetWall = startWall + frameIndex * framePeriodMs;
      let waited = 0;
      while (performance.now() < targetWall) {
        if (waited > 4000) throw new Error('export clock stalled');
        await sleep(2);
        waited += 2;
      }
      drawAt(frameIndex);
      onProgress((frameIndex + 1) / frameCount);
    }
    // The audio clock runs on the same program base; assert the two stayed
    // together while the wall-clock loop authored every frame.
    const audioElapsed = audioCtx.currentTime - startAudio;
    if (Math.abs(audioElapsed - project.duration) > 0.35) {
      throw new Error(`A/V drift during export: audio ${audioElapsed.toFixed(3)}s vs ${project.duration}s`);
    }
    // Hold the final frame for two periods so the encoder flushes it.
    await sleep(framePeriodMs * 2);
  } finally {
    try { source.stop(); } catch {}
    recorder.stop();
    await stopped;
    await audioCtx.close();
    stream.getTracks().forEach((track) => track.stop());
  }

  const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
  return {
    blob,
    mimeType,
    frameCount,
    framesRequested: frameCount,
    durationSec: (performance.now() - startWall) / 1000,
    alignment,
    luma: { first: firstLuma, last: lastLuma },
    audioEvents: events.map((e) => ({
      time: e.time, clipId: e.clipId, kind: e.kind,
    })),
    audioDurationSec: audioBuffer.duration,
  };
}

export { pickMimeType };
