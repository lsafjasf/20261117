// 浏览器端帧提供者：复用核心合成器的 RGBA 缓冲，绘制到离屏 Canvas。
import { renderSourceFrame } from "../src/core/synthetic.js";

export function createCanvasFrameProvider(sources, { failPattern = null } = {}) {
  return async function provide(entry) {
    if (failPattern && failPattern(entry)) {
      throw new Error(`模拟解码失败: ${entry.clipId}@${entry.srcTime.toFixed(2)}`);
    }
    const source = sources[entry.sourceId];
    const frame = renderSourceFrame(source, entry.srcTime, entry.crop);
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(frame.width, frame.height);
    image.data.set(frame.rgba);
    ctx.putImageData(image, 0, 0);
    return canvas;
  };
}
