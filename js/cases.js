// 内置案例：一组标准案例 + 一组极端案例（超长文本 + 极小尺寸元素）。
const Cases = (() => {
  function standard() {
    const doc = Model.createDoc();
    doc.elements.push(
      // 第 3 折（封面，x∈[198,297]，安全区 [203,292]）
      Model.makeText(203, 60, 89, '产品手册 2026', { fontSize: 22, bold: true, align: 'center', color: '#12365c' }),
      Model.makeText(203, 78, 89, 'TRI-FOLD BROCHURE', { fontSize: 9, align: 'center', color: '#557' }),
      Model.makeRect(203, 95, 89, 2, { fill: '#12365c' }),
      // 第 1 折（封底）
      Model.makeText(5, 180, 89, '联系我们\ncontact@example.com\n+86 010-0000-0000', { fontSize: 9, align: 'center', color: '#444' }),
      // 第 2 折（正文）
      Model.makeText(104, 20, 89, '核心特性', { fontSize: 14, bold: true }),
      Model.makeText(104, 34, 89, '· 模块化设计，按需组合\n· 全流程可视化追踪\n· 支持私有化部署\n· 7×24 小时技术支持', { fontSize: 10 }),
      Model.makeEllipse(120, 120, 50, 30, { fill: '#dff1ff', stroke: '#7ec8ff', lineWidth: 0.5 }),
      Model.makeText(104, 160, 89, '“部署周期从两周缩短到两天。” —— 某制造业客户', { fontSize: 9, color: '#666' }),
    );
    return doc;
  }

  function extreme() {
    const doc = Model.createDoc();
    // 超长文本：6pt 小字，约 600 字，必须正好排在安全区 [5,205]mm 内
    const longText = ('极端长文本压力测试。本段用于验证编辑器在极小字号与超长内容下的换行、'
      + '安全边距与裁切检查是否可靠。').repeat(12)
      + 'The quick brown fox jumps over the lazy dog. '.repeat(6).trim();
    doc.elements.push(
      Model.makeText(104, 5, 89, longText, { fontSize: 6 }),
      // 极小尺寸元素：3×2mm 矩形与 2mm 圆点，贴近安全区边缘
      Model.makeRect(203, 5, 3, 2, { fill: '#e74c3c' }),
      Model.makeEllipse(289, 202, 2, 2, { fill: '#2ecc71' }),
      Model.makeText(203, 12, 89, '极小元素旁注', { fontSize: 7 }),
      // 第 1 折：长英文单词 + 混排，验证断词逻辑
      Model.makeText(5, 5, 89, 'Supercalifragilistic expialidocious 混排中英文自动换行测试，'
        + '确认长单词不会被静默截断，而是给出明确错误提示。', { fontSize: 8 }),
    );
    return doc;
  }

  return { standard, extreme };
})();
