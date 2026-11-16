const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.waitForFunction(() => window.__mixer !== undefined);
  // 无头环境 downloadBlob 不点击，直接拿 blob 转 base64 落盘
  const b64 = await page.evaluate(async () => {
    const { blob } = await window.__mixer.exportWav();
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  });
  fs.writeFileSync('/tmp/export.wav', Buffer.from(b64, 'base64'));
  await browser.close();

  const b = fs.readFileSync('/tmp/export.wav');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riff = b.toString('ascii', 0, 4);
  const wave = b.toString('ascii', 8, 12);
  const fmt = b.toString('ascii', 12, 16);
  const audioFmt = dv.getUint16(20, true);
  const channels = dv.getUint16(22, true);
  const sr = dv.getUint32(24, true);
  const bits = dv.getUint16(34, true);
  const dataSize = dv.getUint32(40, true);
  const dataBytes = b.length - 44;
  const duration = dataSize / sr / channels / (bits / 8);
  // 采样峰值
  let pkL = 0, pkR = 0;
  for (let i = 0; i < dataBytes / 2; i += 2) {
    const off = 44 + i * 2;
    const L = Math.abs(dv.getInt16(off, true)) / 32768;
    const R = Math.abs(dv.getInt16(off + 2, true)) / 32768;
    if (L > pkL) pkL = L;
    if (R > pkR) pkR = R;
  }
  console.log(JSON.stringify({ riff, wave, fmt, audioFmt, channels, sampleRate: sr, bitsPerSample: bits,
    headerDataSize: dataSize, actualDataBytes: dataBytes, sizeMatch: dataSize === dataBytes,
    durationSec: +duration.toFixed(4), peakL: +pkL.toFixed(4), peakR: +pkR.toFixed(4), fileBytes: b.length }, null, 1));
  const ok = riff === 'RIFF' && wave === 'WAVE' && fmt === 'fmt ' && audioFmt === 1 &&
    channels === 2 && sr === 48000 && bits === 16 && dataSize === dataBytes &&
    Math.abs(duration - 2.25) < 0.002 && pkL > 0.1 && pkR > 0.01;
  console.log(ok ? 'WAV FILE VALID' : 'WAV FILE INVALID');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
