/* icon-core.js — 纯逻辑层：数据模型、排版校验、SVG 序列化。
 * 浏览器（window.IconCore）与 Node（module.exports）共用，
 * 预览与导出都走同一套 svgForIcon，保证二者一致。 */
(function (root, factory) {
  const core = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.IconCore = core;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GRID = 48;            // 图标画布（网格单位）
  const SAFE_MARGIN = 4;      // 安全边距
  const MAX_TEXT_CHARS = 12;  // 文本最大字符数
  const MIN_EFFECTIVE_STROKE = 1; // 24px 下允许的最小等效线宽
  const EPS = 0.01;

  let uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return prefix + '-' + uidCounter;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultStyle() {
    return {
      strokeWidth: 3,
      cornerRadius: 6,
      colorPrimary: '#2563eb',
      colorAccent: '#f59e0b',
      background: '#ffffff'
    };
  }

  function resolveColor(token, style) {
    if (token === 'primary') return style.colorPrimary;
    if (token === 'accent') return style.colorAccent;
    if (token === 'none' || token == null) return 'none';
    return token;
  }

  function makeShape(type, at) {
    const x = at && typeof at.x === 'number' ? at.x : 24;
    const y = at && typeof at.y === 'number' ? at.y : 24;
    switch (type) {
      case 'rect':
        return { id: uid('rect'), type: 'rect', x: x - 7, y: y - 5, w: 14, h: 10, rx: null, fill: 'none', stroke: 'primary', strokeWidth: null };
      case 'circle':
        return { id: uid('circle'), type: 'circle', cx: x, cy: y, r: 6, fill: 'none', stroke: 'primary', strokeWidth: null };
      case 'line':
        return { id: uid('line'), type: 'line', x1: x - 6, y1: y, x2: x + 6, y2: y, stroke: 'primary', strokeWidth: null };
      case 'text':
        return { id: uid('text'), type: 'text', x: x, y: y, content: '文本', fontSize: 6, fill: 'primary' };
      default:
        throw new Error('未知图形类型: ' + type);
    }
  }

  function shapeLabel(shape) {
    switch (shape.type) {
      case 'rect': return '矩形';
      case 'circle': return '圆形';
      case 'line': return '线条';
      case 'text': return '文本“' + String(shape.content).slice(0, 8) + '”';
      default: return shape.type;
    }
  }

  /* 确定性文本测量：CJK 记 1em，其余记 0.6em。
   * 浏览器与 Node 结果一致，校验不依赖 canvas。 */
  function charUnits(ch) {
    const code = ch.codePointAt(0);
    return code > 0x2e7f ? 1 : 0.6;
  }

  function measureText(content, fontSize) {
    let units = 0;
    for (const ch of String(content)) units += charUnits(ch);
    return units * fontSize;
  }

  function bboxOf(shape, style) {
    const sw = shape.strokeWidth != null ? shape.strokeWidth : style.strokeWidth;
    const stroked = shape.stroke && shape.stroke !== 'none';
    const half = stroked ? sw / 2 : 0;
    switch (shape.type) {
      case 'rect':
        return { x: shape.x - half, y: shape.y - half, w: shape.w + 2 * half, h: shape.h + 2 * half };
      case 'circle':
        return { x: shape.cx - shape.r - half, y: shape.cy - shape.r - half, w: 2 * (shape.r + half), h: 2 * (shape.r + half) };
      case 'line': {
        const lx = Math.min(shape.x1, shape.x2) - half;
        const ly = Math.min(shape.y1, shape.y2) - half;
        return { x: lx, y: ly, w: Math.abs(shape.x2 - shape.x1) + 2 * half, h: Math.abs(shape.y2 - shape.y1) + 2 * half };
      }
      case 'text': {
        const w = measureText(shape.content, shape.fontSize);
        return { x: shape.x - w / 2, y: shape.y - 0.75 * shape.fontSize, w: w, h: shape.fontSize };
      }
      default:
        return { x: 0, y: 0, w: 0, h: 0 };
    }
  }

  function boxesOverlap(a, b) {
    const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return ow > EPS && oh > EPS;
  }

  function effectiveStrokeAt(style, size) {
    return style.strokeWidth * size / GRID;
  }

  /* ---------- 排版校验 ----------
   * 返回问题列表，每项含 rule/severity/message/fix，
   * UI 与测试共用同一套规则文案。 */
  function validateState(state) {
    const issues = [];
    const style = state.style;
    const safeMin = SAFE_MARGIN;
    const safeMax = GRID - SAFE_MARGIN;

    state.icons.forEach(function (icon, iconIndex) {
      const texts = [];
      const others = [];
      icon.shapes.forEach(function (shape) {
        const box = bboxOf(shape, style);
        const label = shapeLabel(shape);
        const outside = box.x < -EPS || box.y < -EPS ||
          box.x + box.w > GRID + EPS || box.y + box.h > GRID + EPS;
        if (outside) {
          issues.push({
            iconIndex: iconIndex, iconName: icon.name, shapeId: shape.id,
            rule: 'R1 裁切检查', severity: 'error',
            message: label + '超出 0–' + GRID + ' 画布边界，导出时会被裁掉',
            fix: '将元素移回画布范围内，或缩小其尺寸。'
          });
        } else if (box.x < safeMin - EPS || box.y < safeMin - EPS ||
          box.x + box.w > safeMax + EPS || box.y + box.h > safeMax + EPS) {
          issues.push({
            iconIndex: iconIndex, iconName: icon.name, shapeId: shape.id,
            rule: 'R2 安全边距', severity: 'warning',
            message: label + '进入边缘 ' + SAFE_MARGIN + 'px 安全边距区',
            fix: '让元素与画布边缘保持至少 ' + SAFE_MARGIN + 'px 距离。'
          });
        }
        if (shape.type === 'text') {
          const content = String(shape.content);
          const len = Array.from(content).length;
          if (content.trim() === '') {
            issues.push({
              iconIndex: iconIndex, iconName: icon.name, shapeId: shape.id,
              rule: 'R4 文本规则', severity: 'error',
              message: '文本不能为空',
              fix: '请输入至少 1 个字符。'
            });
          } else if (len > MAX_TEXT_CHARS) {
            issues.push({
              iconIndex: iconIndex, iconName: icon.name, shapeId: shape.id,
              rule: 'R4 文本规则', severity: 'error',
              message: '文本“' + content.slice(0, 10) + '…”共 ' + len + ' 字，超过 ' + MAX_TEXT_CHARS + ' 字上限',
              fix: '请缩短至 ' + MAX_TEXT_CHARS + ' 字以内，或改用更短的命名。'
            });
          }
          const w = measureText(content, shape.fontSize);
          if (w > safeMax - safeMin + EPS) {
            issues.push({
              iconIndex: iconIndex, iconName: icon.name, shapeId: shape.id,
              rule: 'R4 文本规则', severity: 'error',
              message: '文本宽度 ' + w.toFixed(1) + 'px 超出安全区宽度 ' + (safeMax - safeMin) + 'px',
              fix: '请缩短文本或减小字号。'
            });
          }
          texts.push({ shape: shape, box: box });
        } else {
          others.push({ shape: shape, box: box });
        }
      });
      texts.forEach(function (t) {
        others.forEach(function (o) {
          if (boxesOverlap(t.box, o.box)) {
            issues.push({
              iconIndex: iconIndex, iconName: icon.name, shapeId: t.shape.id,
              rule: 'R3 重叠检查', severity: 'error',
              message: shapeLabel(t.shape) + '与' + shapeLabel(o.shape) + '重叠',
              fix: '移动文本或图形，使二者边界框不再相交。'
            });
          }
        });
      });
    });

    const eff = effectiveStrokeAt(style, 24);
    if (eff < MIN_EFFECTIVE_STROKE) {
      issues.push({
        iconIndex: -1, iconName: '全部图标', shapeId: null,
        rule: 'R5 小尺寸辨识', severity: 'warning',
        message: '统一线宽 ' + style.strokeWidth + 'px 在 24px 下等效 ' + eff.toFixed(2) + 'px（小于 1px），缩小后可能无法辨识',
        fix: '将统一线宽提高到 2px 以上。'
      });
    }
    return issues;
  }

  /* ---------- 输入提交（非法输入保留原值并说明违反的规则） ---------- */
  function findShape(state, iconIndex, shapeId) {
    const icon = state.icons[iconIndex];
    if (!icon) return null;
    return icon.shapes.find(function (s) { return s.id === shapeId; }) || null;
  }

  function commitText(state, iconIndex, shapeId, content) {
    const shape = findShape(state, iconIndex, shapeId);
    if (!shape || shape.type !== 'text') {
      return { ok: false, errors: ['目标不是文本元素'], state: state };
    }
    const errors = [];
    const text = String(content);
    const len = Array.from(text).length;
    if (text.trim() === '') {
      errors.push('R4 文本规则：文本不能为空。修复：请输入至少 1 个字符。');
    } else if (len > MAX_TEXT_CHARS) {
      errors.push('R4 文本规则：共 ' + len + ' 字，超过 ' + MAX_TEXT_CHARS + ' 字上限。修复：请缩短至 ' + MAX_TEXT_CHARS + ' 字以内。');
    }
    const w = measureText(text, shape.fontSize);
    if (w > GRID - 2 * SAFE_MARGIN + EPS) {
      errors.push('R4 文本规则：文本宽度 ' + w.toFixed(1) + 'px 超出安全区 ' + (GRID - 2 * SAFE_MARGIN) + 'px。修复：请缩短文本或减小字号。');
    }
    if (errors.length) return { ok: false, errors: errors, state: state };
    const next = clone(state);
    findShape(next, iconIndex, shapeId).content = text;
    return { ok: true, errors: [], state: next };
  }

  function commitNumber(raw, opts) {
    const label = opts.label || '数值';
    const value = typeof raw === 'number' ? raw : parseFloat(String(raw).trim());
    if (!isFinite(value)) {
      return { ok: false, error: label + '必须是数字，已保留原值。' };
    }
    if (opts.min != null && value < opts.min) {
      return { ok: false, error: label + '不能小于 ' + opts.min + '，已保留原值。' };
    }
    if (opts.max != null && value > opts.max) {
      return { ok: false, error: label + '不能大于 ' + opts.max + '，已保留原值。' };
    }
    return { ok: true, value: value };
  }

  /* ---------- SVG 序列化（预览与导出共用，保证一致） ---------- */
  function escapeXml(text) {
    return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(value) {
    return Math.round(value * 100) / 100;
  }

  function shapeToSvg(shape, style) {
    const sw = shape.strokeWidth != null ? shape.strokeWidth : style.strokeWidth;
    switch (shape.type) {
      case 'rect': {
        const rx = shape.rx != null ? shape.rx : style.cornerRadius;
        return '<rect x="' + num(shape.x) + '" y="' + num(shape.y) + '" width="' + num(shape.w) +
          '" height="' + num(shape.h) + '" rx="' + num(rx) + '" fill="' + resolveColor(shape.fill, style) +
          '" stroke="' + resolveColor(shape.stroke, style) + '" stroke-width="' + num(sw) +
          '" stroke-linejoin="round"/>';
      }
      case 'circle':
        return '<circle cx="' + num(shape.cx) + '" cy="' + num(shape.cy) + '" r="' + num(shape.r) +
          '" fill="' + resolveColor(shape.fill, style) + '" stroke="' + resolveColor(shape.stroke, style) +
          '" stroke-width="' + num(sw) + '"/>';
      case 'line':
        return '<line x1="' + num(shape.x1) + '" y1="' + num(shape.y1) + '" x2="' + num(shape.x2) +
          '" y2="' + num(shape.y2) + '" stroke="' + resolveColor(shape.stroke, style) +
          '" stroke-width="' + num(sw) + '" stroke-linecap="round"/>';
      case 'text':
        return '<text x="' + num(shape.x) + '" y="' + num(shape.y) + '" font-size="' + num(shape.fontSize) +
          '" font-family="system-ui, sans-serif" text-anchor="middle" fill="' +
          resolveColor(shape.fill, style) + '">' + escapeXml(shape.content) + '</text>';
      default:
        return '';
    }
  }

  function svgForIcon(state, iconIndex, opts) {
    const size = opts && opts.size ? opts.size : GRID;
    const icon = state.icons[iconIndex];
    const style = state.style;
    const parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + GRID + ' ' + GRID +
        '" width="' + size + '" height="' + size + '">',
      '<rect width="' + GRID + '" height="' + GRID + '" fill="' + style.background + '"/>'
    ];
    icon.shapes.forEach(function (shape) {
      parts.push(shapeToSvg(shape, style));
    });
    parts.push('</svg>');
    return parts.join('\n');
  }

  function indexJson(state, now) {
    return {
      version: 1,
      generatedAt: now || new Date().toISOString(),
      grid: GRID,
      safeMargin: SAFE_MARGIN,
      style: clone(state.style),
      icons: state.icons.map(function (icon) {
        return {
          id: icon.id,
          name: icon.name,
          svg: icon.id + '.svg',
          png: icon.id + '.png',
          width: GRID,
          height: GRID,
          shapeCount: icon.shapes.length
        };
      })
    };
  }

  /* ---------- 内置案例 ---------- */
  function baseState() {
    return { version: 1, style: defaultStyle(), activeIcon: 0, icons: [] };
  }

  function downloadIcon(name, up) {
    const shapes = [
      { id: uid('rect'), type: 'rect', x: 12, y: 28, w: 24, h: 6, rx: null, fill: 'none', stroke: 'primary', strokeWidth: null },
      up
        ? { id: uid('line'), type: 'line', x1: 24, y1: 22, x2: 24, y2: 10, stroke: 'primary', strokeWidth: null }
        : { id: uid('line'), type: 'line', x1: 24, y1: 10, x2: 24, y2: 22, stroke: 'primary', strokeWidth: null },
      up
        ? { id: uid('line'), type: 'line', x1: 18, y1: 14, x2: 24, y2: 8, stroke: 'primary', strokeWidth: null }
        : { id: uid('line'), type: 'line', x1: 18, y1: 16, x2: 24, y2: 22, stroke: 'primary', strokeWidth: null },
      up
        ? { id: uid('line'), type: 'line', x1: 30, y1: 14, x2: 24, y2: 8, stroke: 'primary', strokeWidth: null }
        : { id: uid('line'), type: 'line', x1: 30, y1: 16, x2: 24, y2: 22, stroke: 'primary', strokeWidth: null },
      { id: uid('text'), type: 'text', x: 24, y: 42.5, content: name, fontSize: 6, fill: 'primary' }
    ];
    return shapes;
  }

  function createStandardState() {
    const state = baseState();
    state.icons = [
      { id: 'download', name: '下载', shapes: downloadIcon('下载', false) },
      { id: 'upload', name: '上传', shapes: downloadIcon('上传', true) },
      {
        id: 'settings', name: '设置', shapes: [
          { id: uid('circle'), type: 'circle', cx: 24, cy: 17, r: 7, fill: 'none', stroke: 'primary', strokeWidth: null },
          { id: uid('circle'), type: 'circle', cx: 24, cy: 17, r: 2, fill: 'accent', stroke: 'none', strokeWidth: null },
          { id: uid('line'), type: 'line', x1: 24, y1: 6, x2: 24, y2: 10, stroke: 'primary', strokeWidth: null },
          { id: uid('line'), type: 'line', x1: 24, y1: 24, x2: 24, y2: 28, stroke: 'primary', strokeWidth: null },
          { id: uid('line'), type: 'line', x1: 13, y1: 17, x2: 17, y2: 17, stroke: 'primary', strokeWidth: null },
          { id: uid('line'), type: 'line', x1: 31, y1: 17, x2: 35, y2: 17, stroke: 'primary', strokeWidth: null },
          { id: uid('text'), type: 'text', x: 24, y: 42.5, content: '设置', fontSize: 6, fill: 'primary' }
        ]
      }
    ];
    return state;
  }

  /* 极端案例：超长文本、越界裁切、侵入安全边距、文本重叠、过细线宽。 */
  function createExtremeState() {
    const state = createStandardState();
    state.style.strokeWidth = 1;
    state.icons[0].shapes.forEach(function (s) {
      if (s.type === 'text') s.content = '超级长的功能名称文本示例ABC';
    });
    state.icons[1].shapes[0].x = -6;
    state.icons[1].shapes.forEach(function (s) {
      if (s.type === 'text') s.y = 46.5;
    });
    state.icons[2].shapes.forEach(function (s) {
      if (s.type === 'text') s.y = 20;
    });
    return state;
  }

  function createEmptyState() {
    const state = baseState();
    ['icon-a', 'icon-b', 'icon-c'].forEach(function (id, i) {
      state.icons.push({ id: id, name: '图标 ' + (i + 1), shapes: [] });
    });
    return state;
  }

  return {
    GRID: GRID, SAFE_MARGIN: SAFE_MARGIN, MAX_TEXT_CHARS: MAX_TEXT_CHARS,
    MIN_EFFECTIVE_STROKE: MIN_EFFECTIVE_STROKE,
    clone: clone, defaultStyle: defaultStyle, resolveColor: resolveColor,
    makeShape: makeShape, shapeLabel: shapeLabel, measureText: measureText,
    bboxOf: bboxOf, boxesOverlap: boxesOverlap, effectiveStrokeAt: effectiveStrokeAt,
    validateState: validateState, findShape: findShape,
    commitText: commitText, commitNumber: commitNumber,
    escapeXml: escapeXml, svgForIcon: svgForIcon, indexJson: indexJson,
    createStandardState: createStandardState, createExtremeState: createExtremeState,
    createEmptyState: createEmptyState
  };
}));
