import { CARGO } from "./core.js";

const W = 1600;
const H = 900;
const CX = 790;
const CY = 472;
const RADIUS = 250;
const FENCE_RADIUS = 319;
const DEG = Math.PI / 180;

const C = {
  asphalt: "#111a1c",
  asphaltDark: "#0a1113",
  line: "rgba(185, 207, 201, 0.13)",
  text: "#dbe5e1",
  muted: "#899b97",
  amber: "#f4b94f",
  amberDim: "rgba(244, 185, 79, 0.3)",
  cyan: "#61d6d0",
  cyanDim: "rgba(97, 214, 208, 0.28)",
  green: "#82cf89",
  red: "#ff6b5f",
};

const radialPoint = (angle, radius = RADIUS) => ({
  x: CX + Math.cos(angle * DEG) * radius,
  y: CY + Math.sin(angle * DEG) * radius,
});

const normalizeDeg = (angle) => ((angle % 360) + 360) % 360;

function shortAngleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function roundRect(ctx, x, y, width, height, radius = 4) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function text(ctx, value, x, y, size = 14, color = C.text, options = {}) {
  ctx.save();
  ctx.font = `${options.weight || 500} ${size}px ${
    options.mono
      ? '"Cascadia Mono", "Twin Sans SC", Consolas, monospace'
      : '"Bahnschrift", "Twin Sans SC", "Arial Narrow", sans-serif'
  }`;
  ctx.fillStyle = color;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "middle";
  if (options.letterSpacing) {
    ctx.letterSpacing = `${options.letterSpacing}px`;
  }
  ctx.fillText(value, x, y);
  ctx.restore();
}

function line(ctx, x1, y1, x2, y2, color, width = 1, dash = null) {
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawBackground(ctx, time) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#0a1113");
  sky.addColorStop(0.48, "#111b1d");
  sky.addColorStop(1, "#080e10");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(CX, CY);
  const glow = ctx.createRadialGradient(0, -40, 30, 0, 0, 620);
  glow.addColorStop(0, "rgba(91, 135, 126, 0.14)");
  glow.addColorStop(0.55, "rgba(60, 91, 84, 0.045)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-W / 2, -H / 2, W, H);
  ctx.restore();

  ctx.strokeStyle = "rgba(168, 193, 186, 0.055)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -200; x < W + 200; x += 58) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let y = 0; y < H; y += 58) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 0.3;
  const edge = ctx.createLinearGradient(0, 0, 0, 140);
  edge.addColorStop(0, "rgba(0,0,0,0.65)");
  edge.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, 140);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(244, 185, 79, 0.12)";
  ctx.lineWidth = 8;
  ctx.setLineDash([28, 18]);
  ctx.strokeRect(42, 42, W - 84, H - 84);
  ctx.restore();

  drawWarehouse(ctx);
  drawYardMarkings(ctx, time);
}

function drawWarehouse(ctx) {
  ctx.save();
  ctx.fillStyle = "rgba(6, 11, 13, 0.78)";
  ctx.fillRect(72, 72, 268, 144);
  ctx.strokeStyle = "rgba(180, 202, 195, 0.12)";
  ctx.strokeRect(72, 72, 268, 144);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let x = 82; x < 330; x += 38) {
    ctx.fillRect(x, 82, 24, 124);
  }
  ctx.fillStyle = "rgba(244, 185, 79, 0.11)";
  ctx.fillRect(72, 72, 6, 144);
  text(ctx, "STORAGE / 07", 90, 94, 13, "rgba(203, 219, 214, 0.44)", {
    mono: true,
    letterSpacing: 2,
  });
  text(ctx, "KEEP CLEAR", 90, 116, 10, "rgba(244, 185, 79, 0.45)", {
    mono: true,
    letterSpacing: 1,
  });
  ctx.strokeStyle = "rgba(244, 185, 79, 0.13)";
  ctx.beginPath();
  for (let x = 90; x < 330; x += 9) {
    ctx.moveTo(x, 188);
    ctx.lineTo(x + 8, 196);
  }
  ctx.stroke();
  ctx.restore();
}

function drawYardMarkings(ctx, time) {
  ctx.save();
  ctx.translate(CX, CY);

  ctx.strokeStyle = "rgba(171, 195, 188, 0.1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 380, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(171, 195, 188, 0.055)";
  ctx.beginPath();
  ctx.arc(0, 0, 416, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([5, 14]);
  ctx.strokeStyle = "rgba(196, 214, 208, 0.12)";
  for (let angle = 0; angle < 360; angle += 30) {
    const inner = radialPoint(angle, 336);
    const outer = radialPoint(angle, 365);
    ctx.beginPath();
    ctx.moveTo(inner.x - CX, inner.y - CY);
    ctx.lineTo(outer.x - CX, outer.y - CY);
    ctx.stroke();
  }
  ctx.restore();

  const pulse = 0.45 + Math.sin(time * 2.1) * 0.1;
  ctx.save();
  ctx.strokeStyle = `rgba(244, 185, 79, ${pulse * 0.24})`;
  ctx.lineWidth = 1;
  ctx.setLineDash([16, 13]);
  ctx.beginPath();
  ctx.arc(CX, CY, 335, -0.36, 0.72);
  ctx.stroke();
  ctx.restore();
}

function drawGuardrail(ctx, state, time) {
  const danger = state.sway > 44 ? 1 : 0;
  const collisionFlash =
    state.impactFlash > 0 ? Math.sin(time * 42) * 0.34 + 0.34 : 0;

  ctx.save();
  ctx.translate(CX, CY);
  ctx.lineCap = "butt";
  for (let angle = 0; angle < 360; angle += 12) {
    const start = angle * DEG;
    const end = (angle + 9.2) * DEG;
    ctx.beginPath();
    ctx.arc(0, 0, FENCE_RADIUS, start, end);
    ctx.strokeStyle =
      danger || collisionFlash
        ? `rgba(255, 107, 95, ${0.34 + collisionFlash})`
        : "rgba(210, 222, 217, 0.23)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, FENCE_RADIUS - 5, start, end);
    ctx.strokeStyle =
      danger || collisionFlash
        ? `rgba(255, 107, 95, ${0.16 + collisionFlash * 0.5})`
        : "rgba(244, 185, 79, 0.12)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (let angle = 0; angle < 360; angle += 18) {
    const point = radialPoint(angle, FENCE_RADIUS);
    ctx.fillStyle = danger ? C.red : "rgba(224, 233, 230, 0.46)";
    ctx.fillRect(point.x - CX - 2, point.y - CY - 7, 4, 14);
  }

  ctx.setLineDash([3, 11]);
  ctx.strokeStyle = danger
    ? "rgba(255, 107, 95, 0.32)"
    : "rgba(244, 185, 79, 0.13)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, FENCE_RADIUS + 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (danger) {
    const point = radialPoint(state.slewAngle, FENCE_RADIUS);
    ctx.save();
    ctx.fillStyle = `rgba(255, 107, 95, ${0.07 + Math.sin(time * 6) * 0.025})`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawDropBay(ctx, state, time) {
  const activeIndex = state.cargoIndex || 0;
  const placed = state.placed || 0;
  ctx.save();

  const bayPoint = radialPoint(11, 333);
  ctx.translate(bayPoint.x, bayPoint.y);
  ctx.rotate(11 * DEG + Math.PI / 2);
  ctx.fillStyle = "rgba(8, 16, 17, 0.58)";
  roundRect(ctx, -100, -78, 200, 156, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(130, 207, 137, 0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, -100, -78, 200, 156, 7);
  ctx.stroke();
  ctx.restore();

  text(ctx, "DROP BAY / 泊位", 1126, 783, 13, "rgba(198, 216, 210, 0.44)", {
    mono: true,
    letterSpacing: 1.6,
  });
  text(ctx, "RAIL CLEARANCE 0.8M", 1126, 801, 9, "rgba(130, 207, 137, 0.38)", {
    mono: true,
  });

  CARGO.forEach((cargo, index) => {
    const done = index < placed;
    const active = index === activeIndex && !done;
    const point = radialPoint(cargo.targetAngle, RADIUS);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(cargo.targetAngle * DEG + Math.PI / 2);
    const glow = active ? 0.15 + Math.sin(time * 3.3) * 0.04 : 0;

    ctx.fillStyle = done
      ? "rgba(130, 207, 137, 0.16)"
      : active
        ? `rgba(244, 185, 79, ${0.1 + glow})`
        : "rgba(8, 16, 17, 0.66)";
    roundRect(ctx, -42, -31, 84, 62, 4);
    ctx.fill();
    ctx.strokeStyle = done
      ? "rgba(130, 207, 137, 0.72)"
      : active
        ? "rgba(244, 185, 79, 0.68)"
        : "rgba(205, 220, 214, 0.15)";
    ctx.lineWidth = active ? 2 : 1;
    ctx.stroke();

    ctx.strokeStyle = done
      ? "rgba(130, 207, 137, 0.46)"
      : active
        ? "rgba(244, 185, 79, 0.42)"
        : "rgba(205, 220, 214, 0.15)";
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(-34, -23);
    ctx.lineTo(34, -23);
    ctx.moveTo(-34, 23);
    ctx.lineTo(34, 23);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.rotate(-(cargo.targetAngle * DEG + Math.PI / 2));
    text(
      ctx,
      done ? "✓" : `0${index + 1}`,
      0,
      1,
      done ? 25 : 19,
      done ? C.green : active ? C.amber : "rgba(208, 221, 216, 0.3)",
      { align: "center", weight: 700, mono: true },
    );
    ctx.restore();

    if (active) {
      ctx.save();
      ctx.strokeStyle = `rgba(244, 185, 79, ${0.28 + Math.sin(time * 4) * 0.08})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 55 + Math.sin(time * 2.5) * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  });
}

function drawPickupBay(ctx, state, time) {
  text(ctx, "STAGING / 待吊区", 405, 695, 13, "rgba(198, 216, 210, 0.4)", {
    mono: true,
    letterSpacing: 1.6,
  });

  CARGO.forEach((cargo, index) => {
    if (index === 0) return;
    const taken = index < state.cargoIndex || state.placed > index;
    const next = index === state.cargoIndex;
    if (taken) return;
    const point = radialPoint(cargo.pickupAngle, RADIUS);
    drawGroundCrate(ctx, point.x, point.y, cargo, next, time);
  });
}

function drawGroundCrate(ctx, x, y, cargo, active, time) {
  ctx.save();
  ctx.translate(x, y);
  if (active) {
    const glow = 0.11 + Math.sin(time * 3) * 0.025;
    ctx.fillStyle = `rgba(97, 214, 208, ${glow})`;
    ctx.beginPath();
    ctx.arc(0, 0, 48 + Math.sin(time * 2) * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(97, 214, 208, 0.42)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawCrateBody(ctx, cargo, 42, 32, active ? C.cyan : "rgba(202, 215, 210, 0.55)");
  ctx.restore();

  text(ctx, cargo.id, x, y + 31, 8, active ? C.cyan : "rgba(205, 219, 214, 0.4)", {
    mono: true,
    align: "center",
    letterSpacing: 1,
  });
}

function drawCrateBody(ctx, cargo, width, height, accent) {
  const grad = ctx.createLinearGradient(-width / 2, -height / 2, width / 2, height / 2);
  grad.addColorStop(0, cargo.color || "#c69145");
  grad.addColorStop(1, "#73502d");
  ctx.fillStyle = grad;
  roundRect(ctx, -width / 2, -height / 2, width, height, 3);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.strokeStyle = "rgba(30, 22, 13, 0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-width / 2 + 5, -height / 2 + 4);
  ctx.lineTo(width / 2 - 5, height / 2 - 4);
  ctx.moveTo(width / 2 - 5, -height / 2 + 4);
  ctx.lineTo(-width / 2 + 5, height / 2 - 4);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 240, 208, 0.26)";
  ctx.fillRect(-width / 2 + 5, -height / 2 + 5, 9, 3);
}

function drawCrane(ctx, state, time) {
  const angle = normalizeDeg(state.slewAngle || 0);
  const tip = radialPoint(angle, RADIUS);
  const back = radialPoint(angle + 180, 132);
  const target = CARGO[Math.min(state.cargoIndex || 0, CARGO.length - 1)];
  const targetAngle = state.phase === "pickup" ? target.pickupAngle : target.targetAngle;

  if (targetAngle != null) {
    ctx.save();
    ctx.translate(CX, CY);
    ctx.strokeStyle = "rgba(244, 185, 79, 0.24)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 9]);
    ctx.beginPath();
    const start = Math.min(angle, normalizeDeg(targetAngle)) * DEG;
    const end = Math.max(angle, normalizeDeg(targetAngle)) * DEG;
    ctx.arc(0, 0, 128, start, end);
    ctx.stroke();
    ctx.restore();

    const diff = shortAngleDelta(angle, targetAngle);
    if (Math.abs(diff) > 4) {
      const mid = normalizeDeg(angle + diff / 2);
      const labelPoint = radialPoint(mid, 128);
      ctx.save();
      ctx.translate(labelPoint.x, labelPoint.y);
      ctx.rotate(mid * DEG + (diff > 0 ? Math.PI / 2 : -Math.PI / 2));
      ctx.fillStyle = "rgba(6, 12, 14, 0.82)";
      roundRect(ctx, -26, -11, 52, 22, 3);
      ctx.fill();
      ctx.rotate(-(mid * DEG + (diff > 0 ? Math.PI / 2 : -Math.PI / 2)));
      text(ctx, `${Math.abs(diff).toFixed(0)}°`, 0, 1, 11, C.amber, {
        mono: true,
        align: "center",
      });
      ctx.restore();
    }
  }

  line(ctx, CX, CY, back.x, back.y, "rgba(180, 202, 195, 0.52)", 5);
  line(ctx, CX, CY, back.x, back.y, "rgba(7, 12, 14, 0.72)", 2);
  ctx.save();
  ctx.translate(back.x, back.y);
  ctx.rotate(angle * DEG);
  ctx.fillStyle = "#242c2c";
  ctx.fillRect(-23, -22, 46, 44);
  ctx.strokeStyle = "rgba(244, 185, 79, 0.36)";
  ctx.strokeRect(-23, -22, 46, 44);
  ctx.fillStyle = "rgba(244, 185, 79, 0.14)";
  ctx.fillRect(-16, -14, 32, 8);
  ctx.restore();

  line(ctx, CX, CY, tip.x, tip.y, "rgba(202, 218, 212, 0.66)", 7);
  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(angle * DEG);
  ctx.strokeStyle = "rgba(7, 12, 14, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < RADIUS; x += 18) {
    ctx.moveTo(x, -3);
    ctx.lineTo(x + 13, 3);
    ctx.moveTo(x + 13, 3);
    ctx.lineTo(x + 18, -3);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(244, 185, 79, 0.14)";
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(RADIUS, -4);
  ctx.moveTo(0, 4);
  ctx.lineTo(RADIUS, 4);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.fillStyle = "#182426";
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.amber;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  drawTowerBase(ctx, state, time);
  drawHoistGauge(ctx, state);
}

function drawTowerBase(ctx, state, time) {
  ctx.save();
  ctx.translate(CX, CY);

  ctx.fillStyle = "rgba(0, 0, 0, 0.26)";
  ctx.beginPath();
  ctx.arc(10, 13, 78, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(177, 198, 192, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 83, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(244, 185, 79, 0.35)";
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.arc(0, 0, 72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#1a2425";
  ctx.beginPath();
  ctx.arc(0, 0, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(211, 225, 220, 0.27)";
  ctx.lineWidth = 2;
  ctx.stroke();

  for (let i = 0; i < 8; i += 1) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 4);
    ctx.fillStyle = i % 2 ? "rgba(244, 185, 79, 0.19)" : "rgba(0, 0, 0, 0.22)";
    ctx.fillRect(-3, -52, 6, 16);
    ctx.restore();
  }

  const cabin = ctx.createLinearGradient(-28, -20, 28, 24);
  cabin.addColorStop(0, "#3a4948");
  cabin.addColorStop(1, "#11191a");
  ctx.fillStyle = cabin;
  roundRect(ctx, -26, -17, 52, 34, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(244, 185, 79, 0.42)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "rgba(97, 214, 208, 0.2)";
  ctx.fillRect(-19, -10, 38, 10);
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.fillRect(-19, -10, 18, 10);
  text(ctx, "TL-07", 0, 8, 9, "rgba(232, 240, 237, 0.7)", {
    mono: true,
    align: "center",
    letterSpacing: 1,
  });

  const pulse = state.status === "playing" ? 0.7 + Math.sin(time * 4) * 0.2 : 0.35;
  ctx.fillStyle = state.protection ? C.red : C.green;
  ctx.globalAlpha = pulse;
  ctx.beginPath();
  ctx.arc(34, -22, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHoistGauge(ctx, state) {
  const x = 125;
  const top = 262;
  const height = 310;
  const value = Math.max(0, Math.min(100, state.hoistHeight || 0));
  ctx.save();
  ctx.fillStyle = "rgba(5, 12, 14, 0.6)";
  roundRect(ctx, 82, 224, 86, 376, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(97, 214, 208, 0.2)";
  ctx.stroke();
  text(ctx, "P2", 90, 241, 9, C.cyan, { mono: true, letterSpacing: 1 });
  text(ctx, "HOIST", 90, 255, 7, "rgba(133, 154, 149, 0.65)", {
    mono: true,
    letterSpacing: 1,
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
  ctx.fillRect(x, top, 11, height);
  const fillHeight = (height * value) / 100;
  const grad = ctx.createLinearGradient(0, top + height, 0, top);
  grad.addColorStop(0, "rgba(97, 214, 208, 0.2)");
  grad.addColorStop(1, "rgba(97, 214, 208, 0.78)");
  ctx.fillStyle = grad;
  ctx.fillRect(x, top + height - fillHeight, 11, fillHeight);

  ctx.strokeStyle = "rgba(130, 207, 137, 0.3)";
  ctx.setLineDash([3, 4]);
  const safeLine = top + height * 0.78;
  ctx.beginPath();
  ctx.moveTo(x - 5, safeLine);
  ctx.lineTo(x + 16, safeLine);
  ctx.stroke();
  ctx.setLineDash([]);

  const markerY = top + height - fillHeight;
  ctx.fillStyle = C.cyan;
  ctx.fillRect(x - 5, markerY - 1, 23, 2);
  ctx.beginPath();
  ctx.moveTo(32 + x, markerY);
  ctx.lineTo(25 + x, markerY - 5);
  ctx.lineTo(25 + x, markerY + 5);
  ctx.closePath();
  ctx.fill();
  text(ctx, `${Math.round(value)}%`, 145, 241, 15, C.cyan, {
    mono: true,
    align: "center",
  });
  ctx.restore();
}

function drawLoad(ctx, state, time, options) {
  const angle = normalizeDeg(state.slewAngle || 0);
  const tip = radialPoint(angle, RADIUS);
  const loadX = tip.x + (state.swayX || 0);
  const loadY = tip.y + (state.swayY || 0);
  const attached = state.cargoAttached !== false;
  const cargo = CARGO[Math.min(state.cargoIndex || 0, CARGO.length - 1)];
  const sway = Math.hypot(state.swayX || 0, state.swayY || 0);
  const warning = sway > 30;
  const danger = sway > 52;

  ctx.save();
  ctx.globalAlpha = 0.17;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(loadX + 10, loadY + 17, 34, 14, angle * DEG, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = danger
    ? "rgba(255, 107, 95, 0.75)"
    : warning
      ? "rgba(244, 185, 79, 0.72)"
      : "rgba(211, 223, 218, 0.44)";
  ctx.lineWidth = danger ? 2 : 1.2;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(loadX, loadY);
  ctx.stroke();

  const dx = loadX - tip.x;
  const dy = loadY - tip.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / length;
  const ny = dx / length;
  ctx.strokeStyle = danger ? "rgba(255, 107, 95, 0.5)" : "rgba(211, 223, 218, 0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(loadX - nx * 21, loadY - ny * 21);
  ctx.lineTo(loadX - nx * 16, loadY - ny * 16 - 6);
  ctx.lineTo(loadX + nx * 16, loadY + ny * 16 - 6);
  ctx.lineTo(loadX + nx * 21, loadY + ny * 21);
  ctx.stroke();
  ctx.restore();

  if (!attached) {
    ctx.save();
    ctx.translate(loadX, loadY);
    ctx.fillStyle = "#1d292a";
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(97, 214, 208, 0.5)";
    ctx.beginPath();
    ctx.moveTo(-4, 4);
    ctx.lineTo(0, 9);
    ctx.lineTo(4, 4);
    ctx.stroke();
    ctx.restore();
    text(ctx, "EMPTY HOOK", loadX, loadY + 21, 7, "rgba(97, 214, 208, 0.55)", {
      mono: true,
      align: "center",
      letterSpacing: 1,
    });
    return;
  }

  ctx.save();
  ctx.translate(loadX, loadY);
  ctx.rotate(angle * DEG);
  if (danger) {
    ctx.strokeStyle = `rgba(255, 107, 95, ${0.4 + Math.sin(time * 9) * 0.15})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 37, 0, Math.PI * 2);
    ctx.stroke();
  } else if (warning) {
    ctx.strokeStyle = "rgba(244, 185, 79, 0.38)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, 33, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawCrateBody(ctx, cargo, 40, 30, danger ? C.red : warning ? C.amber : C.cyan);
  ctx.fillStyle = "rgba(6, 13, 14, 0.83)";
  roundRect(ctx, -15, -8, 30, 16, 2);
  ctx.fill();
  text(ctx, cargo.id, 0, 0, 7, "rgba(242, 246, 243, 0.8)", {
    mono: true,
    align: "center",
    letterSpacing: 0.5,
  });
  ctx.restore();

  const statusY = loadY - 30;
  ctx.save();
  ctx.fillStyle = "rgba(5, 12, 14, 0.78)";
  roundRect(ctx, loadX - 30, statusY - 8, 60, 16, 2);
  ctx.fill();
  text(ctx, `${cargo.weight.toFixed(1)} t`, loadX, statusY, 7, danger ? C.red : C.amber, {
    mono: true,
    align: "center",
  });
  ctx.restore();

  if (sway > 30) {
    const segments = Math.min(7, Math.floor(sway / 9));
    for (let i = 0; i < segments; i += 1) {
      const progress = i / 9;
      const x = tip.x + (loadX - tip.x) * progress;
      const y = tip.y + (loadY - tip.y) * progress;
      ctx.fillStyle = danger ? "rgba(255, 107, 95, 0.45)" : "rgba(244, 185, 79, 0.38)";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }

  if (options.impactFlash > 0) {
    ctx.save();
    ctx.translate(loadX, loadY);
    ctx.strokeStyle = `rgba(255, 107, 95, ${options.impactFlash})`;
    ctx.lineWidth = 3;
    for (let i = 0; i < 9; i += 1) {
      const ray = (i / 9) * Math.PI * 2 + time;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ray) * 25, Math.sin(ray) * 25);
      ctx.lineTo(Math.cos(ray) * (48 + (i % 2) * 12), Math.sin(ray) * (48 + (i % 2) * 12));
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawTargetCue(ctx, state, time) {
  const cargo = CARGO[Math.min(state.cargoIndex || 0, CARGO.length - 1)];
  if (state.phase === "settle" || state.status === "success") return;

  const targetAngle = state.phase === "pickup" ? cargo.pickupAngle : cargo.targetAngle;
  if (targetAngle == null) return;
  const point = radialPoint(targetAngle, RADIUS);
  const active = state.status === "playing";
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.strokeStyle =
    state.phase === "pickup"
      ? `rgba(97, 214, 208, ${active ? 0.34 + Math.sin(time * 4) * 0.08 : 0.2})`
      : `rgba(244, 185, 79, ${active ? 0.34 + Math.sin(time * 4) * 0.08 : 0.2})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 7]);
  ctx.beginPath();
  ctx.arc(0, 0, 55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.rotate(targetAngle * DEG + Math.PI / 2);
  ctx.fillStyle = state.phase === "pickup" ? C.cyan : C.amber;
  ctx.beginPath();
  ctx.moveTo(0, -71);
  ctx.lineTo(-5, -61);
  ctx.lineTo(5, -61);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHudLines(ctx, state, time) {
  const angle = normalizeDeg(state.slewAngle || 0);
  const loadPoint = radialPoint(angle, RADIUS);

  ctx.save();
  ctx.setLineDash([3, 7]);
  ctx.strokeStyle = "rgba(244, 185, 79, 0.17)";
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.lineTo(loadPoint.x, loadPoint.y);
  ctx.stroke();
  ctx.restore();

  text(ctx, "SLEW R 250", 924, 177, 9, "rgba(244, 185, 79, 0.44)", {
    mono: true,
    letterSpacing: 1.4,
  });
  text(ctx, "GUARDRAIL / ±0.8M", 925, 193, 8, "rgba(182, 202, 196, 0.3)", {
    mono: true,
    letterSpacing: 0.8,
  });

  const placed = state.placed || 0;
  text(ctx, `${placed} / 3`, 1422, 176, 22, placed >= 3 ? C.green : C.amber, {
    mono: true,
    align: "right",
    letterSpacing: 1,
  });
  text(ctx, "CARGO SEATED", 1422, 195, 8, "rgba(182, 202, 196, 0.34)", {
    mono: true,
    align: "right",
    letterSpacing: 1.4,
  });

  const phaseMap = {
    carry: "CARRY / 转运",
    pickup: "PICKUP / 挂载",
    settle: "SEAT / 入位确认",
    ready: "STANDBY / 待命",
  };
  text(ctx, phaseMap[state.phase] || "CARRY / 转运", 1244, 806, 10, "rgba(210, 223, 218, 0.5)", {
    mono: true,
    letterSpacing: 1.4,
  });

  if (state.status === "playing" || state.status === "paused") {
    const pulse = 0.35 + Math.sin(time * 3) * 0.2;
    ctx.fillStyle = `rgba(244, 185, 79, ${pulse})`;
    ctx.beginPath();
    ctx.arc(1238, 806, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function renderScene(ctx, canvas, state = {}, options = {}) {
  const now = options.time ?? performance.now() / 1000;
  const sx = canvas.width / W;
  const sy = canvas.height / H;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(sx, sy);
  if (options.shake > 0) {
    ctx.translate(
      Math.sin(now * 64) * options.shake * 10,
      Math.cos(now * 51) * options.shake * 7,
    );
  }

  drawBackground(ctx, now);
  drawGuardrail(
    ctx,
    {
      ...state,
      impactFlash:
        (state.impactFlash || options.impactFlash || 0) > 0 ? options.impactFlash || 0.5 : 0,
    },
    now,
  );
  drawDropBay(ctx, state, now);
  drawPickupBay(ctx, state, now);
  drawTargetCue(ctx, state, now);
  drawCrane(ctx, state, now);
  drawLoad(ctx, state, now, options);
  drawHudLines(ctx, state, now);

  if (options.replay) {
    ctx.save();
    ctx.fillStyle = "rgba(5, 12, 14, 0.72)";
    roundRect(ctx, 1240, 54, 300, 36, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(97, 214, 208, 0.28)";
    ctx.stroke();
    text(ctx, "REPLAY / 回放审计", 1390, 72, 11, C.cyan, {
      mono: true,
      align: "center",
      letterSpacing: 1.5,
    });
    ctx.restore();
  }

  ctx.restore();
}

export const rendererConstants = { W, H, CX, CY, RADIUS, FENCE_RADIUS };
