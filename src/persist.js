// 工程保存 / 重载：JSON + FNV-1a 校验和，保证入点、出点、事件位置可验证。

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalPayload(project) {
  return JSON.stringify({
    version: project.version,
    sourceDuration: project.sourceDuration,
    fps: project.fps,
    audioOffset: project.audioOffset,
    inPoint: project.inPoint,
    outPoint: project.outPoint,
    videoTracks: project.videoTracks,
    audioTracks: project.audioTracks,
  });
}

export function serializeProject(project) {
  const payload = canonicalPayload(project);
  return JSON.stringify(
    {
      format: 'av-timeline-sync-demo',
      checksum: fnv1a(payload),
      savedAt: new Date().toISOString(),
      data: JSON.parse(payload),
      log: project.log,
    },
    null,
    2,
  );
}

export function deserializeProject(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    return { ok: false, reason: '工程文件不是合法 JSON' };
  }
  if (envelope.format !== 'av-timeline-sync-demo') {
    return { ok: false, reason: '工程格式标识不匹配' };
  }
  const payload = canonicalPayload(envelope.data);
  if (fnv1a(payload) !== envelope.checksum) {
    return { ok: false, reason: '校验和失败：工程内容已被改动或损坏' };
  }
  const project = envelope.data;
  project.log = Array.isArray(envelope.log) ? envelope.log : [];
  return { ok: true, project };
}

// 基于操作日志的失败回放：在新工程上重放全部编辑，逐步返回结果。
export async function replayLog(actions, factory) {
  const project = factory();
  const trace = [];
  for (const entry of actions) {
    const result = entry.action(project, entry.payload);
    trace.push({ action: entry.action.name, ok: result.ok, result });
    if (!result.ok) break;
  }
  return { project, trace };
}

// 保存后自检：关键坐标逐项比对，返回不一致清单。
export function verifyReload(before, after) {
  const mismatches = [];
  const keys = ['inPoint', 'outPoint', 'audioOffset', 'sourceDuration', 'fps'];
  for (const key of keys) {
    if (before[key] !== after[key]) {
      mismatches.push({ field: key, before: before[key], after: after[key] });
    }
  }
  const beforeEvents = before.audioTracks[0].events;
  const afterEvents = after.audioTracks[0].events;
  if (beforeEvents.length !== afterEvents.length) {
    mismatches.push({ field: 'events.length', before: beforeEvents.length, after: afterEvents.length });
  }
  beforeEvents.forEach((event, index) => {
    if (!afterEvents[index] || event.sourceTime !== afterEvents[index].sourceTime) {
      mismatches.push({
        field: `events[${index}].sourceTime`,
        before: event.sourceTime,
        after: afterEvents[index]?.sourceTime,
      });
    }
  });
  const beforeClips = before.videoTracks[0].clips;
  const afterClips = after.videoTracks[0].clips;
  if (beforeClips.length !== afterClips.length) {
    mismatches.push({ field: 'clips.length', before: beforeClips.length, after: afterClips.length });
  }
  beforeClips.forEach((clip, index) => {
    const other = afterClips[index];
    ['sourceStart', 'sourceEnd', 'timelineStart', 'timelineEnd'].forEach((field) => {
      if (other && clip[field] !== other[field]) {
        mismatches.push({ field: `clips[${index}].${field}`, before: clip[field], after: other[field] });
      }
    });
  });
  return { ok: mismatches.length === 0, mismatches };
}
