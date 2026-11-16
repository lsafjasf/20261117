import { LITHOLOGY, DEPTH_TICK_M } from './constants.js';
import { fmtNum, hashVersion } from './util.js';
import { STAT_BASIS, basisValue } from './stats.js';
import { svgPatternDefs } from '../ui/texture.js';

// 由当前视图模型生成独立 SVG。所有文字/数值均取自 model，不引用屏幕像素、不写死预设。
export function buildSvg(model, state, geometry) {
  const g = geometry;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${g.width + 360}" height="${Math.max(g.height, 420)}" viewBox="0 0 ${g.width + 360} ${Math.max(g.height, 420)}" font-family="sans-serif">`);
  parts.push(svgPatternDefs());
  parts.push('<rect width="100%" height="100%" fill="#ffffff"/>');
  parts.push(headerText(model, state, g));
  parts.push(depthAxis(g));
  model.columns.forEach((col, i) => parts.push(columnSvg(col, i, g, model)));
  if (model.columns.length === 2) parts.push(correlationSvg(model, g));
  parts.push(statsBlock(model, state, g));
  parts.push(footerText(model, g));
  parts.push('</svg>');
  return parts.join('\n');
}

function headerText(model, state, g) {
  const win = model.filtered.window;
  const basis = STAT_BASIS.find((b) => b.id === state.statsBasis);
  return `<text x="12" y="20" font-size="15" font-weight="bold">钻孔地层柱对比（${model.clean.label}）</text>
  <text x="12" y="38" font-size="11" fill="#555">版本 ${model.version} ｜ 时间窗口：${win.label} ｜ 统计口径：${basis.label} ｜ 钻孔：${state.boreholeIds.join(', ')} ｜ 岩性：${state.lithoIds.join(', ')}</text>`;
}

function depthAxis(g) {
  const ticks = [];
  const first = Math.ceil(g.top / DEPTH_TICK_M) * DEPTH_TICK_M;
  for (let d = first; d <= g.bottom + 0.001; d += DEPTH_TICK_M) {
    const y = g.yOf(d);
    ticks.push(`<line x1="${g.AXIS_W - 10}" y1="${y}" x2="${g.AXIS_W - 2}" y2="${y}" stroke="#555"/>
    <text x="${g.AXIS_W - 13}" y="${y + 4}" font-size="10" text-anchor="end" fill="#333">${d}</text>`);
  }
  return ticks.join('');
}

function columnSvg(col, i, g, model) {
  const x = g.colX(i);
  const meta = model.filtered.boreholes.find((b) => b.id === col.boreholeId);
  const rects = col.units.filter((u) => u.bottom > g.top && u.top < g.bottom).map((u) => {
    const y0 = g.yOf(Math.max(u.top, g.top));
    const y1 = g.yOf(Math.min(u.bottom, g.bottom));
    const fill = u.kind === 'gap' ? 'url(#gapPattern)' : `url(#pat-${u.lithoId})`;
    const label = u.kind === 'gap' ? '缺失段' : u.lithoName;
    const textY = y1 - y0 > 16 ? (y0 + y1) / 2 + 3 : y0 - 2;
    return `<rect x="${x}" y="${y0}" width="${g.COL_W}" height="${Math.max(1, y1 - y0)}" fill="${fill}" stroke="#444" stroke-width="0.8"/>
    <text x="${x + g.COL_W / 2}" y="${textY}" font-size="10" text-anchor="middle" fill="#222">${label}</text>`;
  });
  return `<text x="${x + g.COL_W / 2}" y="18" font-size="12" font-weight="bold" text-anchor="middle">${meta ? meta.name : col.boreholeId}</text>
  <rect x="${x}" y="${g.TOP_PAD}" width="${g.COL_W}" height="${(g.bottom - g.top) * g.ROW_H}" fill="none" stroke="#222" stroke-width="1.2"/>
  ${rects.join('')}`;
}

function correlationSvg(model, g) {
  const xA = g.colX(0) + g.COL_W;
  const xB = g.colX(1);
  return model.correlation.lines.map((line) => {
    const yA = g.yOf(line.a.depth);
    const yB = g.yOf(line.b.depth);
    return `<line x1="${xA}" y1="${yA}" x2="${xB}" y2="${yB}" stroke="${LITHOLOGY[line.lithoId].color}" stroke-width="1.6"/>`;
  }).join('');
}

function statsBlock(model, state, g) {
  const x = g.width + 18;
  const basis = state.statsBasis;
  const rows = model.stats.perBorehole.map((r) => {
    const val = basisValue(r, basis);
    return [r.name, fmtNum(val), String(r.sampleCount), fmtNum(r.thickness)];
  });
  const t = model.stats.total;
  rows.push(['总体', fmtNum(basisValue(t, basis)), String(t.sampleCount), fmtNum(t.thickness)]);
  let y = 64;
  const out = [
    `<text x="${x}" y="${y}" font-size="12" font-weight="bold">统计（${STAT_BASIS.find((b) => b.id === basis).label}）</text>`
  ];
  y += 18;
  for (const row of rows) {
    out.push(`<text x="${x}" y="${y}" font-size="11">${row[0]}：${row[1]} ｜ 采样 ${row[2]} ｜ 累计厚 ${row[3]} m</text>`);
    y += 17;
  }
  if (model.filtered.empty) {
    out.push(`<text x="${x}" y="${y + 8}" font-size="11" fill="#b00020">空结果：无数值图元导出</text>`);
  }
  return out.join('');
}

function footerText(model, g) {
  const y = Math.max(g.height, 420) - 10;
  return `<text x="12" y="${y}" font-size="10" fill="#777">生成于 ${model.generatedAt} ｜ 数值指纹 ${exportFingerprint(model)} ｜ 图表/地图/统计/导出共用同一数据版本</text>`;
}

// 数值指纹：对筛选后的关键聚合结果做哈希，屏幕与 SVG 各自计算一次应完全相同
export function exportFingerprint(model) {
  const payload = {
    version: model.version,
    total: model.stats.total,
    perBorehole: model.stats.perBorehole.map((r) => [r.boreholeId, r.grMean, r.grMax, r.grMin, r.sampleCount, r.thickness]),
    resampled: Object.fromEntries(Object.entries(model.resampled)
      .map(([id, g2]) => [id, g2.grid.map((cell) => cell.gr)]))
  };
  return hashVersion(payload);
}

export function countSvgElements(svgText) {
  return (svgText.match(/<(rect|line|circle|text|path)\b/g) || []).length;
}

export function downloadSvg(svgText, filename) {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
