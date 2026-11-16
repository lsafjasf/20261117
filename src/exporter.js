// 批次结果与事件日志导出。仅在用户点击时生成下载，不做任何持久化。
import { snapshot } from './engine.js';

export function buildReport(sim) {
  const snap = snapshot(sim);
  const shutdownEvents = sim.events.filter((e) => e.type === 'SHUTDOWN');
  return {
    exportedAt: new Date().toISOString(),
    batch: snap.batchResult || {
      batchId: snap.batchId,
      status: snap.status,
      good: snap.good,
      scrap: snap.scrap,
      note: '批次尚未完成，导出当前进度',
    },
    yieldRate: snap.batchResult ? snap.batchResult.yieldRate
      : Number(((snap.good + snap.scrap) ? snap.good / (snap.good + snap.scrap) : 0).toFixed(4)),
    peakKw: snap.peakKw,
    energyKwh: snap.energyKwh,
    shutdownReasons: shutdownEvents.map((e) => ({
      clock: e.clock, reason: e.reason, message: e.message, glassId: e.glassId,
    })),
    anomalies: snap.glasses.flatMap((g) => g.defects.map((d) => ({
      glassId: g.id, type: d.type, clock: d.clock, position: d.position,
    }))),
    eventCount: sim.events.length,
    events: sim.events,
  };
}

function download(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportJson(sim) {
  const report = buildReport(sim);
  download(`batch-${report.batch.batchId}-report.json`, 'application/json',
    JSON.stringify(report, null, 2));
  return report;
}

export function exportCsv(sim) {
  const header = ['seq', 'batchId', 'clock', 'type', 'message', 'pressure', 'feed', 'coolant'];
  const rows = sim.events.map((e) => [
    e.seq, e.batchId, e.clock, e.type, e.message,
    e.params.pressure, e.params.feed, e.params.coolant,
  ].map(csvEscape).join(','));
  download(`batch-${sim.batchId}-events.csv`, 'text/csv', [header.join(','), ...rows].join('\n'));
}

// 显式保证重开不保留旧缓存：若环境中存在历史存储则清空，并拦截后续写入
export function disablePersistentStorage() {
  try {
    window.localStorage.clear();
    const proto = window.Storage.prototype;
    const blocked = () => { throw new Error('本应用禁用持久化存储，仿真状态只存在内存中'); };
    proto.setItem = blocked;
  } catch { /* 无 localStorage 环境（如 Node）忽略 */ }
}
