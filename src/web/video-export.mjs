import { verifyExport, toCSV } from "../core/exporter.mjs";
import { composeFrame } from "../core/composer.mjs";
import { FPS } from "../core/timebase.mjs";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text, filename, mime = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

// 先跑与 Node 测试相同的确定性校验，再实际录制 WebM。
export async function exportVideo(project, {
  width = 640,
  height = 360,
  fps = FPS,
  onProgress = () => {}
} = {}) {
  const report = verifyExport(project, { width, height, fps });
  if (!report.exportable) {
    return { ok: false, report };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(fps);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start();

  const frameMs = 1000 / fps;
  for (let frame = 0; frame < report.frameCount; frame += 1) {
    composeFrame(ctx, project, frame / fps, { width, height });
    onProgress((frame + 1) / report.frameCount);
    // 让出事件循环，保证 MediaRecorder 实际采集到每一帧。
    await new Promise((r) => setTimeout(r, frameMs));
  }
  recorder.stop();
  await done;

  const blob = new Blob(chunks, { type: "video/webm" });
  downloadBlob(blob, "program-export.webm");
  downloadText(toCSV(report.shots), "shot-list.csv", "text/csv;charset=utf-8");
  return { ok: true, report, blob, bytes: blob.size };
}
