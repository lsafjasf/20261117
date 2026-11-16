import { createSyntheticSource } from "./synthetic.js";

let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

// 视频片段与对应音频事件共享 groupId，编辑时整组移动，保持唇形/节拍对齐。
function makeGroup(video, audio) {
  const groupId = nextId("grp");
  return [{ ...video, groupId }, { ...audio, groupId }];
}

export function buildSampleProject() {
  seq = 0;
  const sourceA = createSyntheticSource("src-a", { duration: 40, hue: 205, freq: 220 });
  const sourceB = createSyntheticSource("src-b", { duration: 40, hue: 330, freq: 330 });
  const sources = { [sourceA.id]: sourceA, [sourceB.id]: sourceB };

  const group1 = makeGroup(
    { id: nextId("v"), kind: "video", track: "v1", sourceId: sourceA.id, start: 0, srcIn: 2, duration: 8, crop: "16:9" },
    { id: nextId("a"), kind: "audio", track: "a1", sourceId: sourceA.id, start: 0, srcIn: 2, duration: 8 }
  );
  const group2 = makeGroup(
    { id: nextId("v"), kind: "video", track: "v1", sourceId: sourceB.id, start: 8, srcIn: 5, duration: 7, crop: "16:9" },
    { id: nextId("a"), kind: "audio", track: "a1", sourceId: sourceB.id, start: 8, srcIn: 5, duration: 7 }
  );
  const group3 = makeGroup(
    { id: nextId("v"), kind: "video", track: "v1", sourceId: sourceA.id, start: 15, srcIn: 12, duration: 9, crop: "4:3" },
    { id: nextId("a"), kind: "audio", track: "a1", sourceId: sourceA.id, start: 15, srcIn: 12, duration: 9 }
  );

  return {
    duration: 24,
    sources,
    videos: [group1[0], group2[0], group3[0]],
    audios: [group1[1], group2[1], group3[1]],
    subtitles: [
      { id: nextId("s"), kind: "subtitle", track: "s1", groupId: null, start: 1, duration: 5, text: "开场字幕" },
      { id: nextId("s"), kind: "subtitle", track: "s1", groupId: null, start: 10, duration: 6, text: "第二段说明" }
    ],
    animations: [
      { id: nextId("m"), kind: "animation", track: "m1", groupId: null, start: 2, duration: 18, effect: "moving-dot" }
    ],
    transitions: []
  };
}
