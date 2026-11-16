// 纯几何计算：Canvas 渲染与 SVG 导出共用，保证同比例、同坐标
export const AXIS_W = 64;
export const COL_W = 132;
export const GAP_W = 150;
export const TOP_PAD = 34;
export const BOTTOM_PAD = 18;
export const ROW_H = 9;

export function computeGeometry(model, view) {
  const top = view?.depthTop ?? 0;
  const bottom = view?.depthBottom ?? (model.maxDepth || 10);
  const span = Math.max(1, bottom - top);
  const count = Math.max(1, model.columns.length);
  const width = AXIS_W + count * COL_W + (count - 1) * GAP_W + 24;
  const height = TOP_PAD + span * ROW_H + BOTTOM_PAD;
  const yOf = (depth) => TOP_PAD + (depth - top) * ROW_H;
  const colX = (i) => AXIS_W + i * (COL_W + GAP_W);
  return { top, bottom, span, width, height, yOf, colX,
    AXIS_W, COL_W, GAP_W, TOP_PAD, BOTTOM_PAD, ROW_H };
}
