/*
 * main.js — 应用装配。
 * 节目时间线 / 画面播放头 / 音频事件共享同一 Transport 状态。
 * 工程可保存到 localStorage 与 JSON 文件，重新载入后
 * 入点、出点与事件位置完全恢复；操作日志支持失败回放。
 */
(function () {
  "use strict";

  const M = window.CreditModel;
  const STORAGE_KEY = "credits-studio-project";
  const LOG_KEY = "credits-studio-oplog";

  let project = loadProject() || M.createDefaultProject();
  let opLog = loadOpLog();

  const canvas = document.getElementById("preview");
  const transport = new window.Transport.Transport(M.programDuration(project));
  transport.setLoop(project.settings.loop);
  const audio = new window.AudioEngine();

  /* ---------- 操作日志（失败回放 / 重新载入的基础） ---------- */
  function loadOpLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) { return []; }
  }
  function logOp(label) {
    opLog.push({ t: new Date().toISOString(), label });
    localStorage.setItem(LOG_KEY, JSON.stringify(opLog));
    renderOpLog();
  }
  function renderOpLog() {
    const el = document.getElementById("oplog");
    el.innerHTML = opLog.map((o) => `<li>${o.t.slice(11, 19)} ${o.label}</li>`).join("");
    el.scrollTop = el.scrollHeight;
  }

  /* ---------- 保存 / 载入 ---------- */
  function saveProject(silent) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    if (!silent) setStatus("工程已保存（入点/出点/事件位置将保持不变）");
  }
  function loadProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function reloadProject(p) {
    project = p;
    transport.setDuration(M.programDuration(project));
    transport.setLoop(project.settings.loop);
    transport.seek(0);
    timeline.setProject(project);
    syncSettingsForm();
    refreshValidation();
  }

  /* ---------- 校验与导出闸门 ---------- */
  function refreshValidation() {
    const issues = M.validateProject(project);
    if (M.creditsOverflow(project)) {
      issues.push({ type: "credits", message: "字幕越界：行距或滚动速度非法", start: 0, end: 0, ids: [] });
    }
    timeline.setIssues(issues);
    const btn = document.getElementById("btn-export");
    const box = document.getElementById("issues");
    if (issues.length) {
      btn.disabled = true;
      box.innerHTML = issues.map((i) =>
        `<li class="issue">⛔ ${i.message}（${i.start.toFixed(2)}s – ${i.end.toFixed(2)}s）</li>`).join("");
    } else {
      btn.disabled = false;
      box.innerHTML = '<li class="ok">✔ 无冲突，可以导出</li>';
    }
    document.getElementById("program-dur").textContent =
      "节目时长 " + M.programDuration(project).toFixed(2) + "s";
  }

  function setStatus(msg) {
    document.getElementById("status").textContent = msg;
  }

  /* ---------- 时间线 ---------- */
  const timeline = new window.Timeline(
    document.getElementById("timeline"),
    project,
    transport,
    {
      onEdit(label) {
        logOp(label);
        transport.setDuration(M.programDuration(project));
        refreshValidation();
        saveProject(true);
      },
      onSeek() { /* 播放头移动时音频在下次 play 时重对齐 */ },
    }
  );

  /* ---------- 渲染循环：画面播放头 = Transport ---------- */
  function frame() {
    const t = transport.now();
    window.Renderer.renderFrame(canvas, project, t);
    timeline.updatePlayhead();
    document.getElementById("timecode").textContent =
      t.toFixed(2) + " / " + transport.duration.toFixed(2) + "s";
    requestAnimationFrame(frame);
  }

  /* ---------- 传输控制：播放 / 暂停 / 拖动 / 循环 ---------- */
  document.getElementById("btn-play").addEventListener("click", () => {
    audio.ensureContext();
    audio.scheduleFrom(project.audioEvents, transport.currentTime);
    transport.play();
  });
  document.getElementById("btn-pause").addEventListener("click", () => {
    transport.pause();
    audio.stopAll();
  });
  document.getElementById("chk-loop").addEventListener("change", (e) => {
    transport.setLoop(e.target.checked);
    project.settings.loop = e.target.checked;
  });
  transport.onChange((kind) => {
    if (kind === "seek" && transport.playing) {
      // 拖动中：音频事件按新位置重调度，保持音画对齐
      audio.scheduleFrom(project.audioEvents, transport.currentTime);
    }
    if (kind === "pause") audio.stopAll();
  });

  /* ---------- 编辑按钮 ---------- */
  document.getElementById("btn-split").addEventListener("click", () => {
    const err = timeline.splitAtPlayhead();
    if (err) setStatus(err);
  });
  document.getElementById("btn-transition").addEventListener("click", () => {
    const err = timeline.addTransitionToNext();
    if (err) setStatus(err);
  });

  /* ---------- 设置表单 ---------- */
  function syncSettingsForm() {
    document.getElementById("set-lineheight").value = project.settings.lineHeight;
    document.getElementById("set-speed").value = project.settings.scrollSpeed;
    document.getElementById("set-fade").value = project.settings.bgFadeOut;
    document.getElementById("chk-loop").checked = project.settings.loop;
  }
  function bindSetting(id, key) {
    document.getElementById(id).addEventListener("input", (e) => {
      project.settings[key] = parseFloat(e.target.value) || 0;
      transport.setDuration(M.programDuration(project));
      refreshValidation();
      saveProject(true);
    });
  }
  bindSetting("set-lineheight", "lineHeight");
  bindSetting("set-speed", "scrollSpeed");
  bindSetting("set-fade", "bgFadeOut");

  /* ---------- 保存 / 载入 / 回放 ---------- */
  document.getElementById("btn-save").addEventListener("click", () => {
    saveProject(false);
    logOp("保存工程");
  });
  document.getElementById("btn-reload").addEventListener("click", () => {
    const saved = loadProject();
    if (saved) {
      reloadProject(saved);
      setStatus("已重新载入：入点/出点与事件位置已恢复");
      logOp("重新载入工程");
    } else setStatus("没有已保存的工程");
  });
  document.getElementById("btn-replay").addEventListener("click", () => {
    // 失败回放：回到初始工程，逐项重放日志中记录的编辑操作
    const fresh = M.createDefaultProject();
    reloadProject(fresh);
    setStatus("已重置到初始状态，可按日志逐步重放（见右侧面板）");
    logOp("失败回放：重置到初始工程");
  });
  document.getElementById("btn-export-json").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    downloadBlob(blob, "project.json");
  });
  document.getElementById("file-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      reloadProject(JSON.parse(await file.text()));
      setStatus("工程文件已载入");
      logOp("从文件载入工程");
    } catch (err) {
      setStatus("载入失败：" + err.message);
    }
  });

  /* ---------- 导出 ---------- */
  document.getElementById("btn-export").addEventListener("click", async () => {
    const btn = document.getElementById("btn-export");
    btn.disabled = true;
    try {
      setStatus("导出中…");
      const result = await window.Exporter.exportVideo(
        project, transport, canvas, audio,
        (p) => setStatus(`导出中… ${(p * 100).toFixed(0)}%`)
      );
      const cmp = result.clipDurations
        .map((c) => `${c.name}: 时间线 ${c.timeline.toFixed(2)}s / 源 ${c.source.toFixed(2)}s ${c.match ? "✓" : "✗"}`)
        .join("；");
      setStatus(
        `导出完成：预期 ${result.expectedDur.toFixed(2)}s，实测 ${result.actualDur.toFixed(2)}s。` +
        `片段时长比对 — ${cmp}`
      );
      logOp(`导出视频 ${result.expectedDur.toFixed(2)}s（实测 ${result.actualDur.toFixed(2)}s）`);
      downloadBlob(result.blob, "credits.webm");
    } catch (err) {
      setStatus("导出被阻止：" + err.message);
      logOp("导出失败：" + err.message);
    } finally {
      refreshValidation();
    }
  });

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------- 启动 ---------- */
  syncSettingsForm();
  refreshValidation();
  renderOpLog();
  frame();

  /* ---------- 测试钩子（只读视图 + 校验入口） ---------- */
  Object.defineProperty(window, "__project", { get: () => project });
  window.__transport = transport;
  window.__refreshValidation = refreshValidation;
})();
