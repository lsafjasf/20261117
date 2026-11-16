// 程序化媒体源：无需外部视频文件即可在 Node 与浏览器中产生确定的帧与采样。
// 像素由源时间驱动，因此同一 srcTime 永远得到同一帧，便于断言“缩略图对应正确帧”。

export const CROP_RATIOS = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "9:16": 9 / 16
};

export function createSyntheticSource(id, { width = 96, height = 54, duration = 60, hue = 200, freq = 220 } = {}) {
  return { id, kind: "synthetic", width, height, duration, hue, freq };
}

function hslToRgb(hue, saturation, lightness) {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hp = (hue % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0; let g = 0; let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lightness - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// 返回 RGBA 字节数组；带随时间移动的条纹与时间戳色带，保证首尾帧非黑。
export function renderSourceFrame(source, srcTime, crop = "16:9") {
  const { width, height } = source;
  const ratio = CROP_RATIOS[crop] ?? CROP_RATIOS["16:9"];
  const cropWidth = Math.max(8, Math.min(width, Math.round(height * ratio)));
  const cropX = Math.round((width - cropWidth) / 2);
  const phase = Math.floor(srcTime * 4) % width;
  const band = Math.floor((srcTime % 4) * (height / 4));
  const rgba = new Uint8Array(cropWidth * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const stripe = (x + cropX + phase) % 12 < 6;
      const hue = (source.hue + (stripe ? 40 : 0) + band * 6) % 360;
      const [r, g, b] = hslToRgb(hue, 0.75, stripe ? 0.55 : 0.35);
      const offset = (y * cropWidth + x) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, width: cropWidth, height };
}

// 确定性正弦音频，采样值由绝对源时间决定，移动片段后仍与画面对齐。
export function renderSourceSamples(source, srcStart, srcEnd, sampleRate = 8000) {
  const count = Math.max(1, Math.round((srcEnd - srcStart) * sampleRate));
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = srcStart + i / sampleRate;
    samples[i] = Math.sin(2 * Math.PI * source.freq * t) * 0.6;
  }
  return { samples, sampleRate };
}
