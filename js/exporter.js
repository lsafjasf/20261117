/* 导出：WebVTT 走 vtt 模块；媒体走 canvas.captureStream + MediaStreamAudioDestinationNode。
   导出前必须通过模型校验，任何非法重叠都会阻止导出并回报冲突位置。 */
(function (root, factory) {
  var api = factory(
    (typeof module === "object" && module.exports) ? require("./util.js") : root.TC.util,
    (typeof module === "object" && module.exports) ? require("./model.js") : root.TC.model,
    (typeof module === "object" && module.exports) ? require("./renderer.js") : root.TC.renderer
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TC = root.TC || {};
  root.TC.exporter = api;
})(typeof self !== "undefined" ? self : this, function (util, model, renderer) {
  "use strict";

  function preExportCheck(project) {
    var gate = model.canExport(project);
    if (!gate.allowed) {
      return {
        allowed: false,
        reason: "存在非法重叠/越界，已阻止导出",
        conflicts: gate.report.conflictLocs,
        report: gate.report
      };
    }
    return { allowed: true, report: gate.report, conflicts: [] };
  }

  /* 首尾与均匀采样的黑帧守卫。 */
  function blackFrameGuard(project, stageRenderer) {
    var samples = [0, 0.05, project.duration * 0.25, project.duration * 0.5,
      project.duration * 0.75, project.duration - 0.05, project.duration - util.EPS];
    var findings = stageRenderer.sampleBlackFrames(project, samples);
    return {
      ok: findings.length === 0,
      samples: samples,
      findings: findings
    };
  }

  function pickMimeType() {
    if (typeof MediaRecorder === "undefined") return null;
    var candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return "";
  }

  /* 实时录制导出。deps: { canvas, transport, engine, stageRenderer, onProgress } */
  function recordWebM(project, deps) {
    var check = preExportCheck(project);
    if (!check.allowed) return Promise.reject(check);
    var guard = blackFrameGuard(project, deps.stageRenderer);
    if (!guard.ok) {
      return Promise.reject({ allowed: false, reason: "黑帧守卫未通过", guard: guard });
    }
    if (typeof deps.canvas.captureStream !== "function" ||
        typeof MediaRecorder === "undefined") {
      return Promise.reject({ allowed: false, reason: "当前浏览器不支持 captureStream/MediaRecorder" });
    }
    var stream = deps.canvas.captureStream(30);
    var audioDestination = deps.engine.ensureContext().createMediaStreamDestination();
    deps.engine.master.disconnect();
    deps.engine.master.connect(audioDestination);
    deps.engine.master.connect(deps.engine.ctx.destination);
    audioDestination.stream.getAudioTracks().forEach(function (track) {
      stream.addTrack(track);
    });

    var mimeType = pickMimeType();
    var recorder = new MediaRecorder(stream, mimeType ? { mimeType: mimeType } : undefined);
    var chunks = [];
    recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };

    return new Promise(function (resolve, reject) {
      recorder.onstop = function () {
        try {
          deps.engine.master.disconnect(audioDestination);
          stream.getTracks().forEach(function (track) { track.stop(); });
        } catch (cleanupErr) { /* 节点清理失败不影响产物 */ }
        var blob = new Blob(chunks, { type: mimeType || "video/webm" });
        resolve({
          blob: blob,
          mimeType: blob.type,
          size: blob.size,
          durationSec: project.duration,
          guard: guard
        });
      };
      recorder.onerror = function (err) { reject({ allowed: false, reason: "录制失败", detail: err }); };
      var startAt = Date.now();
      deps.transport.seek(0);
      deps.transport.play();
      recorder.start(200);
      var timer = setInterval(function () {
        var elapsed = (Date.now() - startAt) / 1000;
        if (deps.onProgress) deps.onProgress(Math.min(1, elapsed / project.duration));
        if (elapsed >= project.duration + 0.25) {
          clearInterval(timer);
          recorder.stop();
          deps.transport.stop();
        }
      }, 100);
    });
  }

  return {
    preExportCheck: preExportCheck,
    blackFrameGuard: blackFrameGuard,
    pickMimeType: pickMimeType,
    recordWebM: recordWebM
  };
});
