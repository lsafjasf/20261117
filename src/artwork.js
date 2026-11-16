function archPath(cx, top, width, bottom) {
  const radius = width / 2;
  const left = cx - radius;
  const right = cx + radius;
  const shoulder = Math.min(bottom - 0.5, top + radius);
  return [
    `M ${round(left)} ${round(bottom)}`,
    `L ${round(left)} ${round(shoulder)}`,
    `A ${round(radius)} ${round(radius)} 0 0 1 ${round(right)} ${round(shoulder)}`,
    `L ${round(right)} ${round(bottom)}`,
    "Z",
  ].join(" ");
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function archPrimitives(box, theme) {
  const min = Math.min(box.w, box.h);
  const cx = box.x + box.w * 0.5;
  const bottom = box.y + box.h * 0.96;
  const outerWidth = box.w * 0.84;
  const innerWidth = box.w * 0.58;
  const outerTop = box.y + box.h * 0.29;
  const innerTop = box.y + box.h * 0.47;
  const moonRadius = min * 0.14;

  return [
    {
      type: "path",
      d: archPath(cx, outerTop, outerWidth, bottom),
      fill: theme.accent,
      fillOpacity: 0.12,
      stroke: theme.accent,
      strokeWidth: Math.max(0.8, min * 0.004),
      strokeOpacity: 0.7,
    },
    {
      type: "path",
      d: archPath(cx, innerTop, innerWidth, bottom),
      fill: theme.accent,
      fillOpacity: 0.2,
      stroke: "none",
    },
    {
      type: "circle",
      cx,
      cy: box.y + box.h * 0.26,
      r: moonRadius,
      fill: theme.accent,
      fillOpacity: 0.94,
    },
    {
      type: "ellipse",
      cx,
      cy: box.y + box.h * 0.26,
      rx: moonRadius * 1.65,
      ry: moonRadius * 0.62,
      rotate: -18,
      fill: "none",
      stroke: theme.ink,
      strokeWidth: Math.max(0.7, min * 0.003),
      strokeOpacity: 0.42,
    },
    {
      type: "line",
      x1: box.x + box.w * 0.26,
      y1: box.y + box.h * 0.94,
      x2: box.x + box.w * 0.74,
      y2: box.y + box.h * 0.94,
      stroke: theme.ink,
      strokeWidth: Math.max(0.7, min * 0.003),
      strokeOpacity: 0.5,
    },
  ];
}

function orbitPrimitives(box, theme) {
  const min = Math.min(box.w, box.h);
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  const stroke = Math.max(0.8, min * 0.0035);

  return [
    {
      type: "ellipse",
      cx,
      cy,
      rx: box.w * 0.47,
      ry: box.h * 0.19,
      rotate: -24,
      fill: "none",
      stroke: theme.ink,
      strokeWidth: stroke,
      strokeOpacity: 0.34,
    },
    {
      type: "ellipse",
      cx,
      cy,
      rx: box.w * 0.39,
      ry: box.h * 0.32,
      rotate: 34,
      fill: "none",
      stroke: theme.accent,
      strokeWidth: stroke,
      strokeOpacity: 0.72,
    },
    {
      type: "circle",
      cx,
      cy,
      r: min * 0.12,
      fill: theme.accent,
      fillOpacity: 0.92,
    },
    {
      type: "circle",
      cx: cx + box.w * 0.29,
      cy: cy - box.h * 0.14,
      r: min * 0.035,
      fill: theme.ink,
      fillOpacity: 0.84,
    },
    {
      type: "circle",
      cx: cx - box.w * 0.38,
      cy: cy + box.h * 0.2,
      r: min * 0.024,
      fill: theme.accent,
      fillOpacity: 0.82,
    },
  ];
}

function bloomPrimitives(box, theme) {
  const min = Math.min(box.w, box.h);
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  const petalLength = min * 0.31;
  const petalWidth = min * 0.14;

  const petals = Array.from({ length: 6 }, (_, index) => ({
    type: "ellipse",
    cx,
    cy,
    rx: petalWidth,
    ry: petalLength,
    rotate: index * 30,
    fill: theme.accent,
    fillOpacity: index % 2 === 0 ? 0.26 : 0.16,
    stroke: theme.accent,
    strokeWidth: Math.max(0.55, min * 0.0025),
    strokeOpacity: 0.58,
  }));

  return [
    ...petals,
    {
      type: "circle",
      cx,
      cy,
      r: min * 0.105,
      fill: theme.accent,
      fillOpacity: 0.95,
    },
    {
      type: "circle",
      cx,
      cy,
      r: min * 0.21,
      fill: "none",
      stroke: theme.ink,
      strokeWidth: Math.max(0.6, min * 0.0025),
      strokeOpacity: 0.3,
    },
  ];
}

export function getIllustrationPrimitives(layout, design) {
  const box = layout.illustration.box;
  if (!layout.illustration.visible || box.w <= 0 || box.h <= 0) return [];

  switch (layout.illustration.style) {
    case "orbit":
      return orbitPrimitives(box, design.theme);
    case "bloom":
      return bloomPrimitives(box, design.theme);
    case "arch":
      return archPrimitives(box, design.theme);
    default:
      return [];
  }
}
