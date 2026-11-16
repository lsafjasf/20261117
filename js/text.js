// 共享文字排版：Canvas 预览与 SVG 导出使用同一套换行/测量逻辑，保证一致。
// 模型单位为 mm，字号为 pt。1pt = 25.4/72 mm。
const PT_TO_MM = 25.4 / 72;
const LINE_HEIGHT = 1.3;

const TextLayout = (() => {
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');

  function fontCss(el, pxPerMm) {
    const px = el.fontSize * PT_TO_MM * pxPerMm;
    return `${el.bold ? 'bold ' : ''}${px}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  }

  // 将文本切成可换行单元：拉丁按词，CJK 按字，保留显式换行。
  function tokenize(text) {
    const tokens = [];
    for (const rawLine of String(text).split('\n')) {
      let buf = '';
      for (const ch of rawLine) {
        if (/[一-鿿　-〿＀-￯]/.test(ch)) {
          if (buf) { tokens.push(buf); buf = ''; }
          tokens.push(ch);
        } else if (/\s/.test(ch)) {
          if (buf) { tokens.push(buf); buf = ''; }
          tokens.push(' ');
        } else {
          buf += ch;
        }
      }
      if (buf) tokens.push(buf);
      tokens.push('\n');
    }
    if (tokens.length && tokens[tokens.length - 1] === '\n') tokens.pop();
    return tokens;
  }

  // 返回 { lines:[str], lineHeightMm, widthMm, heightMm, unbreakable:bool }
  function layout(el, pxPerMm) {
    mctx.font = fontCss(el, pxPerMm);
    const maxW = el.w * pxPerMm;
    const lines = [];
    let cur = '';
    let unbreakable = false;
    const push = () => { lines.push(cur); cur = ''; };
    for (const tok of tokenize(el.text)) {
      if (tok === '\n') { push(); continue; }
      const trial = cur + tok;
      const w = mctx.measureText(trial).width;
      if (w <= maxW || cur === '') {
        if (cur === '' && w > maxW) unbreakable = true; // 单个词/字超宽
        cur = trial;
      } else {
        push();
        if (mctx.measureText(tok).width > maxW) unbreakable = true;
        cur = tok === ' ' ? '' : tok;
      }
    }
    push();
    const lineHeightMm = el.fontSize * PT_TO_MM * LINE_HEIGHT;
    let widthMm = 0;
    for (const ln of lines) {
      widthMm = Math.max(widthMm, mctx.measureText(ln).width / pxPerMm);
    }
    return {
      lines,
      lineHeightMm,
      widthMm,
      heightMm: lines.length * lineHeightMm,
      unbreakable,
    };
  }

  return { layout, fontCss };
})();
