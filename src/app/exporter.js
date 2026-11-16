// 导出：Canvas -> MediaStream -> MediaRecorder（视频），
// 离线渲染的 WAV -> 音频元素 -> 同一 MediaStream，保证音视频共用时间基准。
import { clamp } from '../core/time.js';

function isBlackFrame(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 12 && data[i + 1] < 12 && data[i + 2] < 12) dark++;
  }
  return dark / (data.length / 4) > 0.995;
}

export class Exporter {
  constructor(model, engine, audioEngine) {
    this.model = model;
    this.engine = engine;
    this.audioEngine = audioEngine;
  }

  _getAudioElement(url) {
    if (!this._audio) this._audio = new Audio();
    this._audio.src = url;
    this._audio.loop = false;
    return this._audio;
  }

  // onProgress(0..1)；realTime=false 时用 rAF 快速步进但仍逐帧渲染。
  async exportVideo({ realTime = true, onProgress = () => {} } = {}) {
    const check = this.model.validate();
    if (!check.ok) {
      const err = new Error('存在非法重叠，已阻止导出');
      err.conflicts = check.errors;
      throw err;
    }

    const canvas = this.engine.canvas;
    const durationMs = this.model.durationMs;
    const savedHead = this.engine.playheadMs;
    const wasPlaying = this.engine.state.playing;
    this.engine.pause();

    // 首末帧黑帧检测（在录制前渲染到目标位置）。
    this.engine.seek(20);
    const firstBlack = isBlackFrame(this.engine.ctx, canvas.width, canvas.height);
    this.engine.seek(durationMs - 40);
    const lastBlack = isBlackFrame(this.engine.ctx, canvas.width, canvas.height);

    const wavBlob = await this.audioEngine.renderOffline(durationMs, this.model.audioEvents);
    if (this._audioUrl) URL.revokeObjectURL(this._audioUrl);
    this._audioUrl = URL.createObjectURL(wavBlob);
    const audio = this._getAudioElement(this._audioUrl);
    await audio.play().then(() => audio.pause()).catch(() => {});

    const videoStream = canvas.captureStream(30);
    const audioCtx = this.audioEngine.ensureContext();
    if (!this._audioRig) {
      const mediaEl = audioCtx.createMediaElementSource(audio);
      const dest = audioCtx.createMediaStreamDestination();
      mediaEl.connect(dest);
      mediaEl.connect(audioCtx.destination);
      this._audioRig = { mediaEl, dest };
    }
    this._audioRig.dest.stream.getAudioTracks().forEach((tr) => videoStream.addTrack(tr));

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus' : 'video/webm';
    const recorder = new MediaRecorder(videoStream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { recorder.onstop = res; });

    this.engine.seek(0);
    recorder.start(100);
    audio.currentTime = 0;
    await audio.play();

    await new Promise((resolve) => {
      const frameMs = 1000 / 30;
      let head = 0;
      const step = (wall) => {
        if (realTime) {
          head = audio.currentTime * 1000;
          this.engine.seek(head);
          onProgress(clamp(head / durationMs, 0, 1));
          if (head >= durationMs - frameMs) return resolve();
          requestAnimationFrame(step);
        } else {
          head += frameMs;
          this.engine.seek(head);
          onProgress(clamp(head / durationMs, 0, 1));
          if (head >= durationMs) return resolve();
          setTimeout(step, 0);
        }
      };
      requestAnimationFrame(step);
    });

    audio.pause();
    recorder.stop();
    await done;
    this.engine.seek(savedHead);
    if (wasPlaying) this.engine.play();

    const blob = new Blob(chunks, { type: 'video/webm' });
    return {
      blob,
      url: URL.createObjectURL(blob),
      bytes: blob.size,
      durationMs,
      blackFrames: { first: firstBlack, last: lastBlack },
    };
  }
}
