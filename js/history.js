/* 撤销/重做：以文档快照(JSON)为单位的命令栈。 */
(function (global) {
  'use strict';

  function History(limit) {
    this.limit = limit || 100;
    this.undoStack = [];
    this.redoStack = [];
  }

  History.prototype.snapshot = function (doc) {
    return JSON.stringify({ canvas: doc.canvas, blocks: doc.blocks });
  };

  /* 在每次“提交型”修改前调用，记录当前状态 */
  History.prototype.push = function (doc) {
    this.undoStack.push(this.snapshot(doc));
    if (this.undoStack.length > this.limit) { this.undoStack.shift(); }
    this.redoStack.length = 0;
  };

  History.prototype.canUndo = function () { return this.undoStack.length > 0; };
  History.prototype.canRedo = function () { return this.redoStack.length > 0; };

  History.prototype.undo = function (doc) {
    if (!this.canUndo()) { return null; }
    this.redoStack.push(this.snapshot(doc));
    return this.undoStack.pop();
  };

  History.prototype.redo = function (doc) {
    if (!this.canRedo()) { return null; }
    this.undoStack.push(this.snapshot(doc));
    return this.redoStack.pop();
  };

  global.PosterHistory = { History: History };
})(window);
