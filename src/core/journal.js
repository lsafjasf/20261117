// 操作日志：记录每次变更（含失败），支持失败回放与重新载入后审计。
// 所有变更函数都通过 apply 调用，保证时间线、播放头与日志顺序一致。
export class ActionJournal {
  constructor() {
    this.entries = [];
  }

  apply(name, args, fn) {
    let result;
    let ok = true;
    let error = null;
    try {
      result = fn();
    } catch (e) {
      ok = false;
      error = e.message;
    }
    this.entries.push({
      seq: this.entries.length,
      name,
      args: JSON.parse(JSON.stringify(args ?? null)),
      ok,
      error,
      at: Date.now(),
    });
    if (!ok) throw new Error(error);
    return result;
  }

  get failures() {
    return this.entries.filter((e) => !e.ok);
  }

  // 在一个全新模型上重放全部成功操作，验证重新载入后结构可重建。
  replay(factory, handlers) {
    const model = factory();
    const reapplied = [];
    for (const entry of this.entries) {
      if (!entry.ok) continue;
      const handler = handlers[entry.name];
      if (!handler) continue;
      handler(model, entry.args);
      reapplied.push(entry.seq);
    }
    return { model, reapplied };
  }

  toJSON() { return { entries: this.entries }; }
  static fromJSON(data) {
    const j = new ActionJournal();
    j.entries = data.entries || [];
    return j;
  }
}
