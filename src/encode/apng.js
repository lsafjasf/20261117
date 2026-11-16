// APNG 动画导出：现代浏览器（Chrome/Firefox/Safari）与 ffmpeg 均可直接播放。
import { deflate } from "./deflate.js";
import { chunk, concat, u32, u16, ihdr, rawWithFilter } from "./png.js";

function fcTL({ sequence, width, height, delayNumerator, delayDenominator = 1000 }) {
  return concat([
    u32(sequence),
    u32(width),
    u32(height),
    u32(0),
    u32(0),
    u16(delayNumerator),
    u16(delayDenominator),
    new Uint8Array([0, 0])
  ]);
}

// frames: [{ rgba, width, height, delayMs }]，全部帧尺寸需一致。
export async function encodeApng(frames, loopCount = 0) {
  const { width, height } = frames[0];
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk("IHDR", ihdr(width, height))];
  parts.push(chunk("acTL", concat([u32(frames.length), u32(loopCount)])));
  let sequence = 1;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    parts.push(chunk("fcTL", fcTL({
      sequence: sequence++, width, height, delayNumerator: Math.max(1, Math.round(frame.delayMs))
    })));
    const compressed = await deflate(rawWithFilter(frame.rgba, width, height));
    if (index === 0) {
      parts.push(chunk("IDAT", compressed));
    } else {
      parts.push(chunk("fdAT", concat([u32(sequence++), compressed])));
    }
  }
  parts.push(chunk("IEND", new Uint8Array(0)));
  return concat(parts);
}
