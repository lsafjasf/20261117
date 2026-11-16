// 在真实浏览器中验证导出的 WebM：可加载、可播放、含视频轨道且时长正确。
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => { throw error; });
await page.goto(process.env.DEMO_URL || 'http://localhost:38511/index.html');
await page.waitForFunction(() => window.__demo !== undefined);

await page.evaluate(() => window.__demo.setInOut(0, 2));
await page.click('#export-btn');
await page.waitForFunction(() =>
  document.querySelector('#export-progress').textContent.includes('导出完成'), { timeout: 30000 });

const playback = await page.evaluate(async () => {
  const href = document.querySelector('#export-download').href;
  const response = await fetch(href);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('视频元数据加载失败'));
  });
  await video.play();
  await new Promise((resolve) => {
    video.ontimeupdate = () => {
      if (video.currentTime > 0.5) resolve();
    };
  });
  video.pause();
  return {
    type: blob.type,
    size: blob.size,
    duration: video.duration,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    reachedTime: video.currentTime,
  };
});

assert.ok(playback.type.startsWith('video/webm'), `类型异常 ${playback.type}`);
assert.ok(playback.duration >= 1.9 && playback.duration <= 2.2, `时长异常 ${playback.duration}`);
assert.equal(playback.videoWidth, 720);
assert.equal(playback.videoHeight, 405);
assert.ok(playback.reachedTime > 0.5, '播放头没有推进');
console.log('导出文件可播放验证通过：', playback);
await browser.close();
