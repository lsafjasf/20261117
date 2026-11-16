import { FONT_EMBEDS } from "./constants.js";

const cache = new Map();

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

export async function loadFontEmbed(fontKey) {
  const config = FONT_EMBEDS[fontKey] ?? FONT_EMBEDS.serif;
  if (cache.has(config.file)) return cache.get(config.file);

  const promise = (async () => {
    const url = new URL(`../assets/fonts/${config.file}`, import.meta.url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`字体文件加载失败 (${response.status})。`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("字体文件为空。");
    return {
      family: config.family,
      dataUrl: await readAsDataUrl(blob),
      bytes: blob.size,
    };
  })();

  cache.set(config.file, promise);
  try {
    return await promise;
  } catch (error) {
    cache.delete(config.file);
    throw error;
  }
}
