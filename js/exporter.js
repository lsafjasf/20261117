/*
 * exporter.js — 导出为 WebM 视频。
 * 防黑帧策略：
 *  - 录制开始前先把第 0 帧画上画布，再 start()；
 *  - 用 captureStream(fps) 连续抓帧，停止前把最后一帧重画一次；
 *  - 录制区间严格为 [0, programDuration]，播放头走实时时钟。
 * 导出前强制校验：任何冲突或字幕越界都会拒绝导出。
 */
(function (root) {
  "use strict";

  /**
   * @returns {Promise<{blob, expectedDur, actualDur, clipDurations}>}
   */
  async function exportVideo(project, transport, canvas, audioEngine, onProgress) {
    const M = root.CreditModel;
    const issues = M.validateProject(project);
    if (issues.length) {
      throw new Error("存在冲突，已阻止导出：" + issues.map((i) => i.message).join("；"));
    }
    if (M.creditsOverflow(project)) {
      throw new Error("字幕越界（行距/滚动速度非法），已阻止导出");
    }

    const s = project.settings;
    const duration = M.programDuration(project);
    // 至少比较两段片段在裁切/转场后的时间线时长与源区间长度
    const clipDurations = project.clips.map((c) => ({
      id: c.id,
      name: c.name,
      timeline: c.duration,
      source: c.outPoint - c.inPoint,
      match: Math.abs(c.duration - (c.outPoint - c.inPoint)) < 1e-6,
    }));

    // 画面流 + 音频流合并
    const stream = canvas.captureStream(s.fps);
    const audioStream = audioEngine.attachRecordingTap();
    for (const track of audioStream.getAudioTracks()) stream.addTrack(track);

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    // 关键：start 之前先画第 0 帧，避免开头黑帧
    transport.pause();
    transport.setLoop(false);
    transport.seek(0);
    root.Renderer.renderFrame(canvas, project, 0);
    audioEngine.scheduleFrom(project.audioEvents, 0);
    transport.play();

    await new Promise((resolve, reject) => {
      rec.onerror = () => reject(rec.error || new Error("recorder error"));
      rec.start(250);
      const tick = () => {
        const t = transport.now();
        root.Renderer.renderFrame(canvas, project, Math.min(t, duration));
        if (onProgress) onProgress(t / duration);
        if (t >= duration - 1e-3) {
          // 停止前重画最后一帧内容帧，保证尾部不是黑帧
          root.Renderer.renderFrame(canvas, project, duration - 1 / s.fps);
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });

    const blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      rec.stop();
    });
    audioEngine.stopAll();
    audioEngine.detachRecordingTap();
    transport.pause();

    // 实测导出时长，与预期对比
    const actualDur = await probeDuration(blob);
    return { blob, expectedDur: duration, actualDur, clipDurations };
  }

  function probeDuration(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        // 部分浏览器 WebM 时长为 Infinity，需 seek 触发计算
        if (v.duration === Infinity) {
          v.currentTime = 1e7;
          v.ontimeupdate = () => {
            URL.revokeObjectURL(url);
            resolve(v.currentTime);
          };
        } else {
          URL.revokeObjectURL(url);
          resolve(v.duration);
        }
      };
      v.onerror = () => resolve(NaN);
      v.src = url;
    });
  }

  root.Exporter = { exportVideo };
})(typeof self !== "undefined" ? self : this);
