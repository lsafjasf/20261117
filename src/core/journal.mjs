import { applyOp, createProject } from "./project.mjs";

// 操作日志：所有编辑先记日志再应用，失败也记录，用于失败回放与问题定位。
export class Journal {
  constructor() {
    this.entries = [];
  }

 record(operation, result) {
    this.entries.push({
      seq: this.entries.length,
      at: new Date().toISOString(),
      operation,
      ok: result.ok,
      error: result.ok ? null : result.error
    });
  }

  replay(operations = this.entries.map((e) => e.operation)) {
    let project = createProject();
    const trace = [];
    for (const operation of operations) {
      let result;
      try {
        result = applyOp(project, operation);
      } catch (error) {
        result = { ok: false, error: error.message, conflicts: [] };
      }
      trace.push({ operation, ...result });
      if (result.ok) project = result.project;
    }
    return { project, trace };
  }

  failed() {
    return this.entries.filter((e) => !e.ok);
  }

  toJSON() {
    return this.entries;
  }
}
