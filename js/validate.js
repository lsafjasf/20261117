/* 排版规则校验：安全边距、重叠、裁切、越界。
 * 每条问题都附带可执行的修复建议，绝不静默丢弃内容。 */
(function (global) {
  'use strict';

  var EPS = 0.5;

  function validate(doc) {
    var issues = [];
    var c = doc.canvas;
    var m = c.margin;

    function blockName(b) { return '「' + (b.title || b.id) + '」'; }

    doc.blocks.forEach(function (b) {
      // 1) 安全边距
      if (b.x < m - EPS || b.y < m - EPS ||
          b.x + b.w > c.width - m + EPS || b.y + b.h > c.height - m + EPS) {
        issues.push({
          type: 'margin',
          blockId: b.id,
          message: '区块 ' + blockName(b) + ' 超出安全边距（边距 ' + m + 'px）。',
          fixes: [
            {
              label: '自动吸附回网格',
              apply: function (d) {
                var t = find(d, b.id);
                if (t) { t.pinned = false; }
              }
            },
            {
              label: '扩大画布高度以容纳',
              apply: function (d) {
                var need = b.y + b.h + m;
                if (need > d.canvas.height) { d.canvas.height = Math.ceil(need); }
              }
            }
          ]
        });
      }

      // 2) 文字裁切（固定行高时内容放不下）
      if (!b.autoHeight && b._contentHeight > b.h + EPS) {
        var overflow = Math.ceil(b._contentHeight - b.h);
        issues.push({
          type: 'clip',
          blockId: b.id,
          message: '区块 ' + blockName(b) + ' 文字被裁切约 ' + overflow + 'px。',
          fixes: [
            {
              label: '开启自动高度',
              apply: function (d) {
                var t = find(d, b.id);
                if (t) { t.autoHeight = true; }
              }
            },
            {
              label: '增加行高至容纳内容',
              apply: function (d) {
                var t = find(d, b.id);
                if (!t) { return; }
                var M = global.PosterModel;
                var need = Math.ceil((b._contentHeight + d.canvas.gap) /
                  (M.ROW_HEIGHT + d.canvas.gap));
                t.rowSpan = Math.max(t.rowSpan, need);
              }
            },
            {
              label: '缩小正文字号',
              apply: function (d) {
                var t = find(d, b.id);
                if (t && t.fontSize > 8) { t.fontSize = Math.max(8, t.fontSize - 2); }
              }
            }
          ]
        });
      }
    });

    // 3) 区块重叠（通常来自两个都被固定的区块）
    for (var i = 0; i < doc.blocks.length; i++) {
      for (var j = i + 1; j < doc.blocks.length; j++) {
        var a = doc.blocks[i], b2 = doc.blocks[j];
        if (a.x < b2.x + b2.w - EPS && b2.x < a.x + a.w - EPS &&
            a.y < b2.y + b2.h - EPS && b2.y < a.y + a.h - EPS) {
          issues.push(makeOverlapIssue(a, b2, blockName));
        }
      }
    }

    return issues;
  }

  /* 独立函数避免闭包捕获循环变量导致修复作用到错误区块 */
  function makeOverlapIssue(a, b2, blockName) {
    var aId = a.id, b2Id = b2.id;
    return {
      type: 'overlap',
      blockId: aId,
      message: '区块 ' + blockName(a) + ' 与 ' + blockName(b2) + ' 重叠。',
      fixes: [
        {
          label: '取消后者固定并重排',
          apply: function (d) {
            var t = find(d, b2Id);
            if (t) { t.pinned = false; }
          }
        },
        {
          label: '两者都取消固定',
          apply: function (d) {
            [aId, b2Id].forEach(function (id) {
              var t = find(d, id);
              if (t) { t.pinned = false; }
            });
          }
        }
      ]
    };
  }

  function find(doc, id) {
    for (var i = 0; i < doc.blocks.length; i++) {
      if (doc.blocks[i].id === id) { return doc.blocks[i]; }
    }
    return null;
  }

  global.PosterValidate = { validate: validate, findBlock: find };
})(window);
