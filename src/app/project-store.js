// 工程持久化：完整保存模型与操作日志，载入后入点/出点/事件位置保持不变。
import { TimelineModel } from '../core/model.js';
import { ActionJournal } from '../core/journal.js';

const STORAGE_KEY = 'dual-scene-project-v1';

export function serializeProject(model, journal) {
  return JSON.stringify({
    format: 'dual-scene-project',
    savedAt: new Date().toISOString(),
    timeline: model.toJSON(),
    journal: journal.toJSON(),
  }, null, 2);
}

export function deserializeProject(text) {
  const data = JSON.parse(text);
  if (data.format !== 'dual-scene-project') throw new Error('不是有效的工程文件');
  const model = TimelineModel.fromJSON(data.timeline);
  const journal = ActionJournal.fromJSON(data.journal || { entries: [] });
  return { model, journal };
}

export const ProjectStore = {
  saveLocal(model, journal) {
    localStorage.setItem(STORAGE_KEY, serializeProject(model, journal));
  },
  loadLocal() {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? deserializeProject(text) : null;
  },
  clearLocal() {
    localStorage.removeItem(STORAGE_KEY);
  },
  download(model, journal) {
    const blob = new Blob([serializeProject(model, journal)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
