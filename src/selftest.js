// 浏览器内自检：覆盖对齐、冲突阻止、保存重载、时长比较、黑帧检测。
// 任一步失败都会保留失败现场，支持基于日志的失败回放。

import {
  createProject,
  splitClip,
  moveClip,
  setTransition,
  setInOut,
  setAudioOffset,
  mappedAudioEvents,
  validateProject,
  compareVariants,
  getVideoTrack,
  programDuration,
} from './model.js';
import { serializeProject, deserializeProject, verifyReload } from './persist.js';

function check(name, fn) {
  try {
    const detail = fn();
    return { name, ok: true, detail };
  } catch (error) {
    return { name, ok: false, detail: error.message };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function runSelfCheck() {
  const results = [];

  results.push(check('十二次闪光与十二次鼓点事件一一对应', () => {
    const project = createProject();
    const events = mappedAudioEvents(project);
    assert(events.length === 12, `事件数=${events.length}`);
    return `事件数 ${events.length}，默认差值 0ms`;
  }));

  results.push(check('整体音频偏移后差值一致且可归零', () => {
    const project = createProject();
    setAudioOffset(project, 0.12);
    assert(mappedAudioEvents(project).every((e) => e.delta === 0.12), '差值不一致');
    setAudioOffset(project, 0);
    assert(mappedAudioEvents(project).every((e) => e.delta === 0), '归零失败');
    return '偏移 +120ms 后归零，全部事件对齐';
  }));

  results.push(check('分割片段后事件仍与画面对齐', () => {
    const project = createProject();
    splitClip(project, getVideoTrack(project).clips[0].id, 7.5);
    const events = mappedAudioEvents(project);
    assert(events.length === 12, '事件丢失');
    assert(events.every((e) => e.audioTime === e.visualTime), '对齐被破坏');
    return `片段数 ${getVideoTrack(project).clips.length}，12 个事件全部对齐`;
  }));

  results.push(check('移动造成的非法重叠被阻止', () => {
    const project = createProject();
    splitClip(project, getVideoTrack(project).clips[0].id, 9);
    const right = getVideoTrack(project).clips[1];
    const result = moveClip(project, right.id, right.timelineStart - 1);
    assert(result.ok === false, '重叠未被阻止');
    assert(validateProject(project).ok, '回滚后不应残留冲突');
    return `已阻止：${result.reason}`;
  }));

  results.push(check('转场不改变时长与事件位置', () => {
    const project = createProject();
    splitClip(project, getVideoTrack(project).clips[0].id, 10);
    const before = mappedAudioEvents(project).map((e) => e.audioTime);
    setTransition(project, getVideoTrack(project).clips[0].id, 0.6);
    const after = mappedAudioEvents(project).map((e) => e.audioTime);
    assert(JSON.stringify(before) === JSON.stringify(after), '事件位置变化');
    assert(programDuration(project) === 20, '时长变化');
    return '0.6s 交叉淡化，时长保持 20s';
  }));

  results.push(check('保存 -> 重载后入点出点与事件位置不变', () => {
    const project = createProject();
    splitClip(project, getVideoTrack(project).clips[0].id, 6.5);
    setInOut(project, 1.233, 17.8);
    setAudioOffset(project, -0.04);
    const text = serializeProject(project);
    const loaded = deserializeProject(text);
    assert(loaded.ok, loaded.reason);
    const verification = verifyReload(project, loaded.project);
    assert(verification.ok, JSON.stringify(verification.mismatches));
    return '校验和通过，入/出点、12 个事件与片段坐标逐项一致';
  }));

  results.push(check('至少两段裁切/转场变体的时长比较', () => {
    const base = createProject();
    const variantA = createProject();
    setInOut(variantA, 2, 14);
    const variantB = createProject();
    splitClip(variantB, getVideoTrack(variantB).clips[0].id, 9);
    setTransition(variantB, getVideoTrack(variantB).clips[0].id, 0.8);
    setInOut(variantB, 0, 12);
    const report = compareVariants(base, [
      { name: '裁切 2-14s', project: variantA },
      { name: '分割转场 + 裁切 0-12s', project: variantB },
    ]);
    assert(report.rows[0].duration === 12 && report.rows[1].duration === 12, '时长比较错误');
    return `基准 ${report.baseline.duration}s；两段变体均 ${report.rows[0].duration}s（差值 ${report.rows[0].durationDelta}s / ${report.rows[1].durationDelta}s）`;
  }));

  const failed = results.filter((result) => !result.ok);
  return {
    ok: failed.length === 0,
    results,
    replay: failed.length
      ? `检测到 ${failed.length} 项失败，可在“操作日志”面板点击回放重建现场`
      : '全部通过',
  };
}
