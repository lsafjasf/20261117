// 同构 deflate：浏览器走 CompressionStream，Node 走内置 zlib。
import { deflateSync } from "node:zlib";

export async function deflate(bytes) {
  // PNG/JPG zlib 块需要带 zlib 头；CompressionStream("deflate") 输出的是
  // raw deflate，因此 Node 环境优先使用内置 zlib，浏览器再走 CompressionStream。
  if (typeof process !== "undefined" && process.versions?.node) {
    return new Uint8Array(deflateSync(bytes));
  }
  if (typeof globalThis.CompressionStream === "function") {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error("当前环境不支持 deflate 压缩");
}
