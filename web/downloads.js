import { exportPng, exportProgram } from "../src/core/exporter.js";

export function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.getElementById("download");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadSelectedFrame(store) {
  const state = store.getState();
  const bytes = exportPng(state.timeline, state.sources, state.clock.time, state.view.crop);
  downloadBytes(await bytes, `frame-${state.clock.time.toFixed(2)}s.png`, "image/png");
}

export async function downloadProgram(store) {
  const state = store.getState();
  const result = await exportProgram(state.timeline, state.sources, {
    fps: 4,
    crop: state.view.crop,
    width: 192,
    height: 108
  });
  downloadBytes(result.apng, "program.apng", "image/apng");
  setTimeout(() => downloadBytes(result.wav, "program.wav", "audio/wav"), 300);
  return result;
}
