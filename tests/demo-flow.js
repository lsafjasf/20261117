"use strict";

/* 端到端场景：模拟用户在 UI 上的完整操作序列，落盘示例产物。 */
const fs = require("fs");
const path = require("path");
const { FakeCanvas } = require("./fake-canvas.js");

const util = require("../js/util.js");
const model = require("../js/model.js");
const vtt = require("../js/vtt.js");
const storage = require("../js/storage.js");
const transportApi = require("../js/transport.js");
const renderer = require("../js/renderer.js");
const exporter = require("../js/exporter.js");

let project = model.createDefaultProject();
const trace = [];
function act(action, payload) {
  const r = model.dispatch(project, action, payload);
  trace.push({ action, payload, ok: r.ok, reason: r.reason || null });
  project = r.project;
  return r;
}

/* 1. 合法移动 + 非法移动（应被阻止） */
act("move-clip", { id: "clip_b", start: 6.3 });
act("move-clip", { id: "clip_b", start: 3.0 });

/* 2. 转场：给相邻片段加等量交叉淡化并重叠 0.4s */
act("set-transition", { id: "clip_a", edge: "out", duration: 0.4 });
act("set-transition", { id: "clip_b", edge: "in", duration: 0.4 });
act("move-clip", { id: "clip_b", start: 5.4 });

/* 3. 裁切 A 的右半段，再分割（验证分割后音画仍对齐） */
act("trim-clip", { id: "clip_a", edge: "out", value: 5.2 });
act("split-clip", { id: "clip_a", at: 2.4 });

/* 4. 字幕逐字微调 + 一次非法重叠 */
act("nudge-char", { id: "cue_2", index: 0, time: 2.7 });
act("move-cue", { id: "cue_3", start: 3.5 });

/* 5. 循环区间与播放头推进，验证统一时钟 */
act("set-loop", { enabled: true, start: 1, end: 4 });
const transport = new transportApi.Transport(project, null);
transport.play();
transport.seek(3.9);
transport.advanceForTest(0.3);
const loopCount = transport.loopCount;
transport.dispose();

/* 6. 校验 + 黑帧守卫 */
const report = model.validateProject(project);
const stage = new renderer.StageRenderer(new FakeCanvas(960, 270));
const guard = exporter.blackFrameGuard(project, stage);

/* 7. 保存 / 重载 / VTT 往返 */
const reloaded = storage.parseProject(storage.serialize(project));
const cues = vtt.importVTT(vtt.exportVTT(project.subtitles));

/* 8. 失败回放 */
const failedActions = project.log.filter(e => !e.ok)
  .map(e => ({ action: e.action, payload: e.detail }));
const replay = model.replay(model.createDefaultProject(), failedActions);

/* 9. 导出闸门：人为制造冲突确认被阻止 */
const broken = util.deepClone(project);
broken.clips[0].end += 2;
broken.clips[0].sourceOut = broken.clips[0].sourceIn +
  (broken.clips[0].end - broken.clips[0].start);
const gate = exporter.preExportCheck(broken);

const artifactsDir = path.join(__dirname, "..", "artifacts");
fs.writeFileSync(path.join(artifactsDir, "demo-project.tc.json"), storage.serialize(project), "utf8");
fs.writeFileSync(path.join(artifactsDir, "demo-subtitles.vtt"), vtt.exportVTT(project.subtitles), "utf8");

const summary = {
  actions: trace,
  validationOk: report.ok,
  errors: report.errors.map(e => ({ code: e.code, message: e.message, loc: e.loc })),
  blackFrameGuard: guard,
  reloadDeepEqual: JSON.stringify(reloaded) === JSON.stringify(project),
  vttCueCount: cues.length,
  replaySteps: replay.steps,
  exportBlocked: !gate.allowed,
  exportConflicts: gate.conflicts,
  loopCountAfterWrap: loopCount,
  durationCompare: project.clips.map(c => ({
    id: c.id,
    current: Number((c.end - c.start).toFixed(3)),
    source: c.sourceDuration,
    transitionIn: c.transitionIn,
    transitionOut: c.transitionOut
  }))
};
fs.writeFileSync(path.join(artifactsDir, "demo-summary.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));
