import { getSheetLayout } from "./geometry.js";
import { drawEditor, preloadProjectImages } from "./render.js";

export const EXPORT_DPI = 300;
export const PX_PER_MM = EXPORT_DPI / 25.4;

function safeFilename(name) {
  const cleaned = String(name || "postcard")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return cleaned || "postcard";
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("浏览器无法生成 PNG 数据，请降低画布尺寸后重试。"));
    }, "image/png");
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportProjectPng(project) {
  if (document.fonts?.ready) await document.fonts.ready;
  const failedImages = await preloadProjectImages(project);
  if (failedImages.length) {
    throw new Error(
      `有 ${failedImages.length} 张照片无法读取。项目和文字均未改动，请重新选择照片或清除损坏的照片后再导出。`,
    );
  }
  const sheet = getSheetLayout(project.width, project.height);
  const width = Math.round(sheet.width * PX_PER_MM);
  const height = Math.round(sheet.height * PX_PER_MM);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  drawEditor(ctx, project, width, height, 1, {
    activeSide: null,
    selected: null,
    guides: false,
    errorKeys: new Set(),
  });
  const blob = await canvasToBlob(canvas);
  const filename = `${safeFilename(project.name)}-双面-300dpi.png`;
  downloadBlob(blob, filename);
  return { blob, filename, width, height };
}

export function downloadProjectFile(project, serialize) {
  const blob = new Blob([serialize(project)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `${safeFilename(project.name)}.postcard.json`);
}
