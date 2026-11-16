import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class JsonlLogger {
  constructor(filePath, runId) {
    this.filePath = filePath;
    this.runId = runId;
    this.entries = [];
    mkdirSync(dirname(filePath), { recursive: true });
  }

  log(level, event, payload = {}) {
    const entry = {
      ts: new Date().toISOString(),
      runId: this.runId,
      level,
      event,
      ...payload
    };
    this.entries.push(entry);
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
  }

  info(event, payload) { this.log('info', event, payload); }
  warn(event, payload) { this.log('warn', event, payload); }
  error(event, payload) { this.log('error', event, payload); }

  count(level) {
    return this.entries.filter((entry) => entry.level === level).length;
  }
}

export function formatValidationErrors(errors) {
  return errors.map((item) =>
    `  - node=${item.nodeId} field=${item.field} reason=${item.reason}`
  ).join('\n');
}
