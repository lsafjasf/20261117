/* 主应用：UI 接线、拖拽编辑、动作日志、失败回放、保存/载入/导出。 */
(function () {
  "use strict";
  var TC = window.TC;
  var util = TC.util, model = TC.model, vtt = TC.vtt, storage = TC.storage;
  var audioApi = TC.audio, transportApi = TC.transport, rendererApi = TC.renderer, exporter = TC.exporter;

  var state = {
    project: model.createDefaultProject(),
    transport: null,
    engine: null,
    timelineRenderer: null,
    stageRenderer: null,
    drag: null
  };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    ["btn-play", "btn-pause", "btn-stop", "btn-loop", "btn-seek-zero", "btn-split",
      "btn-transition", "btn-verify", "btn-save", "btn-reload", "btn-export-vtt",
      "btn-import-vtt", "file-import", "btn-export-media", "btn-replay-fail",
      "btn-clear-log", "btn-selftest", "timeline-canvas", "stage-canvas",
      "validation-view", "log-view", "ro-time", "ro-duration", "ro-state",
      "ro-state-dot", "ro-bpm", "stage-guard", "duration-table", "download-anchor"
    ].forEach(function (id) { el[id] = $(id); });

    state.engine = new audioApi.BeatEngine();
    state.transport = new transportApi.Transport(state.project, state.engine);
    state.timelineRenderer = new rendererApi.TimelineRenderer(el["timeline-canvas"]);
    state.stageRenderer = new rendererApi.StageRenderer(el["stage-canvas"]);

    state.transport.onTick(onTick);
    state.transport.onLoop(function (s, e2) {
      log("info", "循环回到 " + s.toFixed(2) + "s（区间结束 " + e2.toFixed(2) + "s）");
    });

    bindButtons();
    bindEditButtons();
    bindExportAndLogButtons();
    bindCanvasDrag();
    el["ro-duration"].textContent = state.project.duration.toFixed(3);
    el["ro-bpm"].textContent = state.project.bpm;
    renderAll();
    refreshValidation(model.validateProject(state.project));
    refreshDurationTable();
    log("info", "工程就绪：" + state.project.beats.length + " 个节拍事件，" +
      state.project.subtitles.length + " 条字幕");
  }

  function renderAll() {
    state.timelineRenderer.render(state.project, state.transport.time);
    state.stageRenderer.render(state.project, state.transport.time);
  }

  function onTick(snap) {
    el["ro-time"].textContent = snap.time.toFixed(3);
    el["ro-state"].textContent = snap.state;
    el["ro-state-dot"].className = "dot " + snap.state;
    renderAll();
  }

  function log(kind, message) {
    var li = document.createElement("li");
    li.className = kind === "ok" ? "ok-entry" : kind === "fail" ? "fail-entry" : "info-entry";
    li.textContent = "[" + new Date().toLocaleTimeString() + "] " + message;
    el["log-view"].appendChild(li);
    el["log-view"].scrollTop = el["log-view"].scrollHeight;
  }

  window.TC_APP = {
    state: state,
    log: log,
    refreshValidation: refreshValidation,
    refreshDurationTable: refreshDurationTable
  };

  document.addEventListener("DOMContentLoaded", init);

  function applyAction(action, payload) {
    var result = model.dispatch(state.project, action, payload);
    if (result.ok) {
      state.project = result.project;
      state.transport.updateProject(state.project);
      state.timelineRenderer.invalidatePeaks();
      log("ok", action + " 已接受 " + JSON.stringify(payload));
      renderAll();
      refreshValidation(model.validateProject(state.project));
      refreshDurationTable();
      return true;
    }
    state.project = result.project;
    log("fail", action + " 被阻止：" + result.reason + " " + JSON.stringify(payload));
    var report = model.validateProject(state.project);
    refreshValidation(report);
    state.timelineRenderer.setConflicts(report.conflictLocs);
    renderAll();
    return false;
  }

  function refreshValidation(report) {
    state.timelineRenderer.setConflicts(report.conflictLocs);
    var view = el["validation-view"];
    if (report.ok) {
      view.innerHTML = '<span class="ok">✓ 校验通过：无重叠、无越界，允许导出。</span>';
      el["stage-guard"].textContent = "黑帧守卫：待导出校验";
      return;
    }
    var html = '<span class="bad">✗ ' + report.errors.length + ' 个错误（已在时间线红色 X 标出）</span><ul>';
    report.errors.forEach(function (err) {
      var pos = err.loc ? " @ " + err.loc.time.toFixed(2) + "s" : "";
      html += "<li>" + err.message + pos + "</li>";
    });
    html += "</ul>";
    view.innerHTML = html;
  }

  function refreshDurationTable() {
    var tbody = el["duration-table"].querySelector("tbody");
    tbody.innerHTML = "";
    state.project.clips.forEach(function (clip) {
      var current = clip.end - clip.start;
      var original = clip.sourceDuration;
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + clip.name + "</td><td>" + original.toFixed(3) +
        "</td><td>" + current.toFixed(3) + "</td>" +
        '<td class="delta">' + (current - original).toFixed(3) + "</td>" +
        "<td>" + (clip.transitionIn + clip.transitionOut).toFixed(2) + "s</td>";
      tbody.appendChild(tr);
    });
  }

  function selectedClip() {
    return state.project.clips[0] || null;
  }

  function bindButtons() {
    el["btn-play"].addEventListener("click", function () {
      state.engine.ensureContext();
      state.transport.play();
      log("info", "播放 t=" + state.transport.time.toFixed(3));
    });
    el["btn-pause"].addEventListener("click", function () {
      state.transport.pause();
      log("info", "暂停 t=" + state.transport.time.toFixed(3));
    });
    el["btn-stop"].addEventListener("click", function () {
      state.transport.stop();
    });
    el["btn-seek-zero"].addEventListener("click", function () {
      state.transport.seek(0);
    });
    el["btn-loop"].addEventListener("click", function () {
      var enabled = !state.project.loop.enabled;
      var loop = enabled
        ? { enabled: true, start: 1.0, end: 5.0 }
        : { enabled: false, start: 0, end: state.project.duration };
      applyAction("set-loop", loop);
      el["btn-loop"].setAttribute("aria-pressed", String(enabled));
      el["btn-loop"].textContent = enabled ? "🔁 循环:开 1–5s" : "🔁 循环:关";
    });
  }

  function canvasPoint(evt) {
    var rect = el["timeline-canvas"].getBoundingClientRect();
    var scaleX = el["timeline-canvas"].width / rect.width;
    var scaleY = el["timeline-canvas"].height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY
    };
  }

  function bindCanvasDrag() {
    var canvas = el["timeline-canvas"];
    canvas.addEventListener("pointerdown", function (evt) {
      var point = canvasPoint(evt);
      var hit = state.timelineRenderer.hitTest(state.project, point.x, point.y);
      if (hit.type === "ruler" || hit.type === "empty") {
        state.transport.seek(hit.time);
        return;
      }
      state.drag = { hit: hit, moved: false };
      canvas.setPointerCapture(evt.pointerId);
    });

    canvas.addEventListener("pointermove", function (evt) {
      if (!state.drag) return;
      var point = canvasPoint(evt);
      var m = state.timelineRenderer.metrics(state.project);
      var time = m.timeOf(point.x);
      var hit = state.drag.hit;
      state.drag.moved = true;
      if (hit.type === "clip-edge") {
        applyAction("trim-clip", { id: hit.id, edge: hit.edge, value: time });
      } else if (hit.type === "clip-body") {
        applyAction("move-clip", { id: hit.id, start: time - hit.grabOffset });
      } else if (hit.type === "cue-edge") {
        applyAction("trim-cue", { id: hit.id, edge: hit.edge, value: time });
      } else if (hit.type === "cue-body") {
        applyAction("move-cue", { id: hit.id, start: time - hit.grabOffset });
      } else if (hit.type === "char") {
        applyAction("nudge-char", { id: hit.id, index: hit.index, time: time });
      }
    });

    canvas.addEventListener("pointerup", function (evt) {
      if (state.drag) {
        canvas.releasePointerCapture(evt.pointerId);
        state.drag = null;
      }
    });
  }

  function bindEditButtons() {
    el["btn-split"].addEventListener("click", function () {
      var clip = selectedClip();
      var at = state.transport.time;
      applyAction("split-clip", { id: clip.id, at: at });
    });

    el["btn-transition"].addEventListener("click", function () {
      var clip = selectedClip();
      applyAction("set-transition", { id: clip.id, edge: "out", duration: 0.4 });
    });

    el["btn-verify"].addEventListener("click", function () {
      runFullVerification();
    });

    el["btn-save"].addEventListener("click", function () {
      var saveGate = exporter.preExportCheck(state.project);
      if (!saveGate.allowed) {
        refreshValidation(saveGate.report);
        log("fail", "保存被阻止：" + saveGate.reason);
        return;
      }
      storage.saveLocal(state.project);
      downloadText("project.tc.json", storage.serialize(state.project), "application/json");
      log("ok", "工程已保存（localStorage + 下载文件）");
    });

    el["btn-reload"].addEventListener("click", function () {
      var loaded = storage.loadLocal();
      if (!loaded) {
        log("fail", "没有可载入的本地工程");
        return;
      }
      replaceProject(loaded, "本地工程已重新载入");
    });

    el["btn-export-vtt"].addEventListener("click", function () {
      var gate = exporter.preExportCheck(state.project);
      if (!gate.allowed) {
        log("fail", "VTT 导出被阻止：" + gate.reason);
        refreshValidation(gate.report);
        return;
      }
      downloadText("subtitles.vtt", vtt.exportVTT(state.project.subtitles), "text/vtt");
      log("ok", "WebVTT 已导出（含逐字时间戳）");
    });

    el["btn-import-vtt"].addEventListener("click", function () {
      el["file-import"].click();
    });

    el["file-import"].addEventListener("change", function (evt) {
      var file = evt.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var cues = vtt.importVTT(String(reader.result));
          var next = util.deepClone(state.project);
          next.subtitles = cues;
          var report = model.validateProject(next);
          if (!report.ok) {
            log("fail", "导入字幕校验失败：" + report.errors[0].message);
            refreshValidation(report);
            return;
          }
          replaceProject(next, "WebVTT 导入完成：恢复 " + cues.length + " 条字幕与逐字时间");
        } catch (err) {
          log("fail", "VTT 解析失败：" + err.message);
        }
      };
      reader.readAsText(file);
      evt.target.value = "";
    });
  }

  function replaceProject(project, message) {
    state.project = project;
    state.transport.updateProject(project);
    state.timelineRenderer.invalidatePeaks();
    renderAll();
    refreshValidation(model.validateProject(project));
    refreshDurationTable();
    log("ok", message);
  }

  function downloadText(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var anchor = el["download-anchor"];
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function runFullVerification() {
    var report = model.validateProject(state.project);
    refreshValidation(report);
    if (!report.ok) {
      log("fail", "校验未通过，导出已阻止，冲突位置已用红 X 标出");
      return report;
    }
    var guard = exporter.blackFrameGuard(state.project, state.stageRenderer);
    el["stage-guard"].textContent = guard.ok
      ? "黑帧守卫：通过（" + guard.samples.length + " 个采样点均非黑帧）"
      : "黑帧守卫：发现 " + guard.findings.length + " 个黑帧";
    log(guard.ok ? "ok" : "fail", "黑帧守卫 " + (guard.ok ? "通过" : "失败"));
    log("ok", "时长对比：" + state.project.clips.map(function (c) {
      return c.name + " " + (c.end - c.start).toFixed(3) + "s/源 " + c.sourceDuration.toFixed(3) + "s";
    }).join("；"));
    return report;
  }

  function bindExportAndLogButtons() {
    el["btn-export-media"].addEventListener("click", function () {
      var check = exporter.preExportCheck(state.project);
      if (!check.allowed) {
        refreshValidation(check.report);
        log("fail", "媒体导出被阻止：" + check.reason);
        return;
      }
      log("info", "开始实时录制 WebM（约 " + state.project.duration + " 秒）…");
      exporter.recordWebM(state.project, {
        canvas: el["stage-canvas"],
        transport: state.transport,
        engine: state.engine,
        stageRenderer: state.stageRenderer,
        onProgress: function () {}
      }).then(function (result) {
        var url = URL.createObjectURL(result.blob);
        var anchor = el["download-anchor"];
        anchor.href = url;
        anchor.download = "program.webm";
        anchor.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 6000);
        log("ok", "WebM 导出完成 " + (result.size / 1024).toFixed(1) +
          " KB，黑帧守卫 " + (result.guard.ok ? "通过" : "失败"));
      }).catch(function (err) {
        log("fail", "媒体导出失败：" + (err.reason || JSON.stringify(err)));
      });
    });

    el["btn-replay-fail"].addEventListener("click", function () {
      var failedActions = state.project.log.filter(function (entry) { return !entry.ok; })
        .map(function (entry) {
          return { action: entry.action, payload: entry.detail || {} };
        });
      if (failedActions.length === 0) {
        log("info", "没有失败操作可回放");
        return;
      }
      var baseline = model.createDefaultProject();
      var result = model.replay(baseline, failedActions);
      var failedAgain = result.steps.filter(function (s) { return !s.ok; }).length;
      log("fail", "失败回放：重放 " + result.steps.length + " 个被拒动作，" +
        failedAgain + " 个仍被阻止（行为可复现）");
    });

    el["btn-clear-log"].addEventListener("click", function () {
      el["log-view"].innerHTML = "";
      state.project.log = [];
      log("info", "日志已清空");
    });

    el["btn-selftest"].addEventListener("click", function () {
      if (window.TC_SELFTEST) {
        var outcome = window.TC_SELFTEST.run();
        log(outcome.ok ? "ok" : "fail", "浏览器自测：" + outcome.passed + "/" +
          outcome.total + " 通过" + (outcome.ok ? "" : "；" + outcome.failures.join(" | ")));
      }
    });
  }
})();
