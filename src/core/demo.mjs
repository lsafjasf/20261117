import { createProject, applyOp } from "./project.mjs";
import { Journal } from "./journal.mjs";
import { BEAT_INTERVAL } from "./timebase.mjs";

// 12 秒节目：所有切点落在 0.5s 节拍网格上，转场仅允许在相邻片段内重叠。
export function buildDemoProject() {
  const journal = new Journal();
  let project = createProject();

  const edits = [
    { type: "addClip", cameraId: "camA", start: 0, duration: 4 },
    { type: "addClip", cameraId: "camB", start: 4, duration: 4, transition: "dissolve" },
    { type: "addClip", cameraId: "camA", start: 8, duration: 2, transition: "dip" },
    { type: "addClip", cameraId: "camC", start: 10, duration: 2 },
    {
      type: "addSubtitle",
      start: 0,
      end: 4,
      text: "全景：跟随节拍的开场段落"
    },
    {
      type: "addSubtitle",
      start: 4,
      end: 8,
      text: "中景：短叠化切到主机位"
    },
    {
      type: "addSubtitle",
      start: 8,
      end: 12,
      text: "特写收尾，切点与鼓点对齐"
    }
  ];

  for (const operation of edits) {
    const result = applyOp(project, operation);
    journal.record(operation, result);
    if (!result.ok) throw new Error(result.error);
    project = result.project;
  }

  // 节拍音频轨：每 0.5s 一个事件，切点处额外叠加 cue。
  for (let t = 0; t < 12; t += BEAT_INTERVAL) {
    const operation = {
      type: "addAudioClip",
      kind: "beat",
      start: t,
      duration: 0.12
    };
    const result = applyOp(project, operation);
    journal.record(operation, result);
    project = result.project;
  }

  return { project, journal };
}
