/* 浏览器内自测：与 Node 套件共享核心场景，使用 DOM 版 Canvas 做真实光栅化。 */
(function () {
  "use strict";
  var TC = window.TC;
  var util = TC.util, model = TC.model, vtt = TC.vtt, storage = TC.storage;
  var audio = TC.audio, transportApi = TC.transport, renderer = TC.renderer, exporter = TC.exporter;

  function assert(cond, message) {
    if (!cond) throw new Error(message || "断言失败");
  }

  function run() {
    var passed = 0, total = 0, failures = [];
    function it(name, fn) {
      total += 1;
      try { fn(); passed += 1; }
      catch (err) { failures.push(name + ": " + err.message); }
    }

    it("默认工程合法", function () {
      assert(model.validateProject(model.createDefaultProject()).ok);
    });

    it("重叠移动被阻止且状态回滚", function () {
      var p = model.createDefaultProject();
      var r = model.dispatch(p, "move-clip", { id: "clip_b", start: 4 });
      assert(!r.ok && r.project.clips[1].start === 5.8);
    });

    it("分割时长守恒", function () {
      var p = model.createDefaultProject();
      var originalLen = p.clips[0].end - p.clips[0].start;
      var r = model.dispatch(p, "split-clip", { id: "clip_a", at: 3 });
      assert(r.ok);
      var parts = r.project.clips.filter(function (c) { return c.id.indexOf("clip_a") === 0; });
      var sum = parts.reduce(function (s, c) { return s + (c.end - c.start); }, 0);
      assert(Math.abs(sum - originalLen) < 1e-4);
    });

    it("交叉淡化合法/普通重叠非法", function () {
      var p = model.createDefaultProject();
      var a = model.dispatch(p, "set-transition", { id: "clip_a", edge: "out", duration: 0.4 });
      var b = model.dispatch(a.project, "set-transition", { id: "clip_b", edge: "in", duration: 0.4 });
      var moved = model.dispatch(b.project, "move-clip", { id: "clip_b", start: 5.4 });
      assert(moved.ok);
      var noFade = model.dispatch(moved.project, "set-transition", { id: "clip_b", edge: "in", duration: 0 });
      assert(!noFade.ok);
    });

    it("VTT 往返保持文本与逐字时间", function () {
      var p = model.createDefaultProject();
      var cues = vtt.importVTT(vtt.exportVTT(p.subtitles));
      assert(cues.length === 5 && cues[0].text === p.subtitles[0].text);
      assert(Math.abs(cues[0].chars[1].t - p.subtitles[0].chars[1].t) < 0.0011);
    });

    it("工程序列化往返深度一致", function () {
      var p = model.createDefaultProject();
      var loaded = storage.parseProject(storage.serialize(p));
      assert(JSON.stringify(loaded) === JSON.stringify(p));
    });

    it("统一时钟播放/暂停/跳转/循环", function () {
      var p = model.dispatch(model.createDefaultProject(), "set-loop",
        { enabled: true, start: 1, end: 3 }).project;
      var t = new transportApi.Transport(p, null);
      t.play();
      t.advanceForTest(0.3);
      assert(t.state === "playing" && t.time > 0);
      t.pause();
      var frozen = t.time;
      t.advanceForTest(1);
      assert(t.time === frozen);
      t.seek(2.95);
      t.play();
      t.advanceForTest(0.2);
      assert(t.loopCount === 1);
      t.dispose();
    });

    it("波形峰值覆盖所有节拍", function () {
      var p = model.createDefaultProject();
      var peaks = audio.buildBeatPeaks(p.beats, p.duration, 0.02);
      assert(p.beats.every(function (b) {
        return peaks[Math.min(peaks.length - 1, Math.floor(b.time / 0.02))] > 0;
      }));
    });

    it("真实 Canvas 黑帧守卫通过（含首末帧）", function () {
      var p = model.createDefaultProject();
      var canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 270;
      var stage = new renderer.StageRenderer(canvas);
      var guard = exporter.blackFrameGuard(p, stage);
      assert(guard.ok, JSON.stringify(guard.findings));
    });

    it("导出闸门拦截冲突并给出位置", function () {
      var p = model.createDefaultProject();
      var bad = util.deepClone(p);
      bad.clips[0].end = 7;
      bad.clips[0].sourceOut = bad.clips[0].sourceIn + (bad.clips[0].end - bad.clips[0].start);
      var gate = exporter.preExportCheck(bad);
      assert(!gate.allowed && gate.conflicts.length > 0);
    });

    return { ok: failures.length === 0, passed: passed, total: total, failures: failures };
  }

  window.TC_SELFTEST = { run: run };
})();
