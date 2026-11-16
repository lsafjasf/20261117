import { createProject, validateProject } from "./project.mjs";
import { Journal } from "./journal.mjs";

export const STORAGE_KEY = "multicam-timeline-save-v1";

export function serializeSave(project, journal) {
  return JSON.stringify({
    kind: "multicam-timeline-save",
    savedAt: new Date().toISOString(),
    project,
    journal: journal.toJSON()
  }, null, 2);
}

export function parseSave(text) {
  const payload = typeof text === "string" ? JSON.parse(text) : text;
  if (payload?.kind !== "multicam-timeline-save") {
    throw new Error("不是本程序生成的工程文件");
  }
  if (!payload.project || !Array.isArray(payload.project.clips)) {
    throw new Error("工程文件缺少片段数据");
  }
  const project = { ...createProject(), ...payload.project };
  const journal = new Journal();
  journal.entries = Array.isArray(payload.journal) ? payload.journal : [];
  return { project, journal, savedAt: payload.savedAt ?? null };
}

// storage 需提供 getItem/setItem（浏览器 localStorage 或测试内存实现均可）。
export function saveProject(storage, project, journal, key = STORAGE_KEY) {
  const text = serializeSave(project, journal);
  storage.setItem(key, text);
  return { key, bytes: text.length, savedAt: new Date().toISOString() };
}

export function loadProject(storage, key = STORAGE_KEY) {
  const text = storage.getItem(key);
  if (!text) return null;
  const loaded = parseSave(text);
  return { ...loaded, validation: validateProject(loaded.project) };
}

// 保存→重载后的点位一致性比对（入点/出点/事件位置）。
export function diffPositions(before, after) {
  const map = (project) => ({
    clips: project.clips
      .map((c) => ({ id: c.id, start: c.start, end: c.start + c.duration, sourceIn: c.sourceIn }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    subtitles: project.subtitles
      .map((s) => ({ id: s.id, start: s.start, end: s.end }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    audio: project.audioClips
      .map((a) => ({ id: a.id, start: a.start, duration: a.duration }))
      .sort((a, b) => a.id.localeCompare(b.id))
  });
  const a = map(before);
  const b = map(after);
  return {
    identical: JSON.stringify(a) === JSON.stringify(b),
    before: a,
    after: b
  };
}
