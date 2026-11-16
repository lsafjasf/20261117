// Records the shared clock by driving a canvas stream through MediaRecorder.
// The same render plan used for preview is painted on every frame while the
// transport plays, so the exported video matches the offline APNG exactly.

export class CanvasRecorder {
  constructor(canvas, fps = 30) {
    this.canvas = canvas;
    this.fps = fps;
    this.recorder = null;
    this.chunks = [];
  }

  get mimeType() {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  start() {
    this.chunks = [];
    const stream = this.canvas.captureStream(this.fps);
    this.recorder = new MediaRecorder(stream,
      this.mimeType ? { mimeType: this.mimeType } : undefined);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recorder) {
        resolve(null);
        return;
      }
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks,
          { type: this.recorder.mimeType || 'video/webm' });
        this.recorder = null;
        resolve(blob);
      };
      this.recorder.stop();
    });
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadText(text, filename, type = 'application/json') {
  downloadBlob(new Blob([text], { type }), filename);
}
