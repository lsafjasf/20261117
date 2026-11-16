// 文档模型：世界坐标使用 mm，原点在展开图左上角。折叠方向仅是视图属性。
const Model = (() => {
  const PAGE = { w: 297, h: 210, panels: 3, margin: 5 };
  const panelW = () => PAGE.w / PAGE.panels;

  let nextId = 1;
  const uid = () => 'el' + (nextId++);

  function createDoc() {
    return { page: { ...PAGE }, foldDirection: 'in', elements: [] };
  }

  function makeText(x, y, w, text, opts = {}) {
    return { id: uid(), type: 'text', x, y, w, text,
      fontSize: opts.fontSize ?? 12, color: opts.color ?? '#1a1a1a',
      align: opts.align ?? 'left', bold: opts.bold ?? false };
  }
  function makeRect(x, y, w, h, opts = {}) {
    return { id: uid(), type: 'rect', x, y, w, h,
      fill: opts.fill ?? '#7ec8ff', stroke: opts.stroke ?? '', lineWidth: opts.lineWidth ?? 0 };
  }
  function makeEllipse(x, y, w, h, opts = {}) {
    return { id: uid(), type: 'ellipse', x, y, w, h,
      fill: opts.fill ?? '#ffd27a', stroke: opts.stroke ?? '', lineWidth: opts.lineWidth ?? 0 };
  }

  // ---- 校验：返回 [{level:'error'|'warn', elId, rule, message, fix}] ----
  function elBBox(el) {
    if (el.type === 'text') {
      const lay = TextLayout.layout(el, 4); // 4px/mm 足够精确
      return { x: el.x, y: el.y, w: lay.widthMm, h: lay.heightMm, layout: lay };
    }
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  }

  function validate(doc) {
    const out = [];
    const P = doc.page, pw = P.w / P.panels, m = P.margin;
    const boxes = [];
    for (const el of doc.elements) {
      const b = elBBox(el);
      boxes.push({ el, b });
      // 裁切：元素超出页面
      if (b.x < 0 || b.y < 0 || b.x + b.w > P.w || b.y + b.h > P.h) {
        out.push({ level: 'error', elId: el.id, rule: '裁切',
          message: `「${label(el)}」超出页面范围（页面 ${P.w}×${P.h}mm）。`,
          fix: '将元素移回页面内，或缩小尺寸/字号。' });
        continue;
      }
      // 安全区：文字必须完整落在某一个分页的安全区内
      if (el.type === 'text') {
        const lay = b.layout;
        if (lay.unbreakable) {
          out.push({ level: 'error', elId: el.id, rule: '文字超宽',
            message: `「${label(el)}」中存在比文本框还宽且无法断行的内容。`,
            fix: '加宽文本框、减小字号，或在长词中插入空格/换行。' });
        }
        const i0 = Math.floor(b.x / pw), i1 = Math.floor((b.x + b.w - 1e-9) / pw);
        if (i0 !== i1) {
          out.push({ level: 'error', elId: el.id, rule: '跨折线',
            message: `「${label(el)}」横跨第 ${i0 + 1}/${i1 + 1} 折页的分页折线。`,
            fix: '把文字完整移动到某一折页内，或拆成两个文本框。' });
        } else {
          const sx = i0 * pw + m, ex = (i0 + 1) * pw - m;
          if (b.x < sx || b.x + b.w > ex || b.y < m || b.y + b.h > P.h - m) {
            out.push({ level: 'error', elId: el.id, rule: '安全边距',
              message: `「${label(el)}」越过第 ${i0 + 1} 折页的 ${m}mm 安全边距。`,
              fix: `将文字限制在 x∈[${sx.toFixed(0)}, ${ex.toFixed(0)}]、y∈[${m}, ${P.h - m}]mm 内，或减小字号/缩短内容。` });
          }
        }
      }
    }
    // 重叠：任意两元素包围盒相交（警告，不阻止导出）
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        if (a.b.x < c.b.x + c.b.w && c.b.x < a.b.x + a.b.w &&
            a.b.y < c.b.y + c.b.h && c.b.y < a.b.y + a.b.h) {
          out.push({ level: 'warn', elId: a.el.id, rule: '重叠',
            message: `「${label(a.el)}」与「${label(c.el)}」的占位区域重叠。`,
            fix: '如非刻意叠加，请错开位置；刻意叠加可忽略此警告。' });
        }
      }
    }
    return out;
  }

  function label(el) {
    if (el.type === 'text') {
      const t = String(el.text).replace(/\s+/g, ' ').trim();
      return t.length > 10 ? t.slice(0, 10) + '…' : (t || '空文字');
    }
    return el.type === 'rect' ? '矩形' : '椭圆';
  }

  // ---- 历史：快照式撤销/重做 ----
  function createHistory(doc) {
    let stack = [JSON.stringify(doc)];
    let idx = 0;
    return {
      commit(d) { stack = stack.slice(0, idx + 1); stack.push(JSON.stringify(d)); idx++; },
      undo() { if (idx > 0) { idx--; return JSON.parse(stack[idx]); } return null; },
      redo() { if (idx < stack.length - 1) { idx++; return JSON.parse(stack[idx]); } return null; },
      canUndo: () => idx > 0,
      canRedo: () => idx < stack.length - 1,
      reset(d) { stack = [JSON.stringify(d)]; idx = 0; },
    };
  }

  return { PAGE, panelW, createDoc, makeText, makeRect, makeEllipse,
           validate, elBBox, label, createHistory };
})();
