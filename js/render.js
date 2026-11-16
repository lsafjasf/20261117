import { RECIPES } from "./engine.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const TAU = Math.PI * 2;

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function phaseLocal(machine) {
  const ratio = machine.cycleProgress;
  const windows = machine.phaseWindows();
  const starts = {
    feed: 0,
    glue: windows.feed,
    press: windows.feed + windows.glue,
    eject: windows.feed + windows.glue + windows.press
  };
  const start = starts[machine.phase] ?? 0;
  const end = machine.phase === "feed"
    ? windows.feed
    : machine.phase === "glue"
      ? starts.glue + windows.glue
      : machine.phase === "press"
        ? starts.press + windows.press
        : 1;
  return clamp((ratio - start) / Math.max(end - start, 0.001), 0, 1);
}

export class MachineRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(machine, timestamp = performance.now()) {
    if (!this.width) this.resize();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    this.drawBackground(ctx, w, h, machine, timestamp);
    this.drawMachineFrame(ctx, w, h, machine);
    const geometry = this.drawBlank(ctx, w, h, machine);
    this.drawGlue(ctx, geometry, machine);
    this.drawRollers(ctx, geometry, machine, timestamp);
    this.drawConveyor(ctx, w, h, machine);
    this.drawBuffer(ctx, w, h, machine);
    this.drawAnnotation(ctx, w, h, geometry, machine);
    this.drawOverlay(ctx, w, h, machine);
  }

  drawBackground(ctx, w, h, machine, timestamp) {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, "#0b1215");
    gradient.addColorStop(0.56, "#0e171b");
    gradient.addColorStop(1, "#091014");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.51, h * 0.48, 10, w * 0.51, h * 0.48, w * 0.38);
    glow.addColorStop(0, "rgba(242,184,75,0.075)");
    glow.addColorStop(0.45, "rgba(98,217,194,0.025)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(126,151,158,0.055)";
    ctx.lineWidth = 1;
    const gap = 30;
    const drift = (machine.simTime * 3) % gap;
    for (let x = -gap + drift; x < w + gap; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += gap) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(6,10,12,0.48)";
    ctx.fillRect(0, 0, w, 31);
    ctx.fillStyle = "rgba(92,110,117,0.58)";
    ctx.font = "9px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText("CELL 04 / FORMING BAY", 16, 20);
    ctx.textAlign = "right";
    ctx.fillText(`HYD ${(86 + machine.params.press * 4).toFixed(1)} bar`, w - 16, 20);

    const lowGlow = ctx.createLinearGradient(0, h - 90, 0, h);
    lowGlow.addColorStop(0, "rgba(0,0,0,0)");
    lowGlow.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = lowGlow;
    ctx.fillRect(0, h - 90, w, 90);
  }

  drawMachineFrame(ctx, w, h, machine) {
    const left = w * 0.15;
    const right = w * 0.85;
    const top = h * 0.12;
    const belt = h * 0.705;
    ctx.strokeStyle = "#27343a";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(left, belt);
    ctx.lineTo(left, top + 9);
    ctx.quadraticCurveTo(left, top, left + 9, top);
    ctx.lineTo(right - 9, top);
    ctx.quadraticCurveTo(right, top, right, top + 9);
    ctx.lineTo(right, belt);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left - 3, belt);
    ctx.lineTo(left - 3, top + 12);
    ctx.lineTo(right - 12, top + 4);
    ctx.stroke();

    ctx.fillStyle = "#1a2429";
    roundRect(ctx, left - 14, top - 6, 20, 34, 3);
    ctx.fill();
    roundRect(ctx, right - 6, top - 6, 20, 34, 3);
    ctx.fill();

    ctx.strokeStyle = "rgba(242,184,75,0.16)";
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 8]);
    ctx.strokeRect(left + 26, top + 25, right - left - 52, belt - top - 37);
    ctx.setLineDash([]);

    ctx.save();
    ctx.translate(left - 8, top + 64);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "rgba(112,133,140,0.38)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("FORMING CELL · 04", 0, 0);
    ctx.restore();

    ctx.fillStyle = "#0e1518";
    roundRect(ctx, w * 0.645, top + 9, 108, 23, 3);
    ctx.fill();
    ctx.strokeStyle = "#2f3c42";
    ctx.stroke();
    ctx.fillStyle = machine.mode === "running" ? "#62d9c2" : machine.mode === "stopped" ? "#ff655d" : "#829098";
    ctx.beginPath();
    ctx.arc(w * 0.657, top + 20.5, 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#819097";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`SERVO ${machine.mode === "running" ? "SYNC" : "HOLD"}`, w * 0.667, top + 23);
  }

  drawConveyor(ctx, w, h, machine) {
    const beltY = h * 0.705;
    const left = w * 0.055;
    const right = w * 0.945;
    const beltH = 36;
    const speed = machine.params.speed;
    const offset = (machine.simTime * speed * 0.5) % 24;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#111a1e";
    roundRect(ctx, left, beltY + 8, right - left, beltH + 12, 7);
    ctx.fill();
    ctx.restore();

    const beltGradient = ctx.createLinearGradient(0, beltY, 0, beltY + beltH);
    beltGradient.addColorStop(0, "#2a353a");
    beltGradient.addColorStop(0.12, "#1a2428");
    beltGradient.addColorStop(0.9, "#121a1e");
    beltGradient.addColorStop(1, "#253035");
    ctx.fillStyle = beltGradient;
    roundRect(ctx, left + 7, beltY + 8, right - left - 14, beltH, 5);
    ctx.fill();

    ctx.save();
    roundRect(ctx, left + 7, beltY + 8, right - left - 14, beltH, 5);
    ctx.clip();
    ctx.strokeStyle = "rgba(132,159,166,0.18)";
    ctx.lineWidth = 1.5;
    for (let x = left - 30 + offset; x < right; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, beltY + 9);
      ctx.lineTo(x - 7, beltY + beltH + 6);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    ctx.beginPath();
    ctx.moveTo(left, beltY + 16);
    ctx.lineTo(right, beltY + 16);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#080d0f";
    roundRect(ctx, left + 24, beltY + 22, right - left - 48, 11, 5);
    ctx.fill();
    for (let x = left + 42; x < right - 30; x += 50) {
      ctx.fillStyle = "#222d32";
      ctx.beginPath();
      ctx.arc(x, beltY + 28, 7, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#354248";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, beltY + 28, 4, machine.simTime * speed * 0.05, machine.simTime * speed * 0.05 + Math.PI * 1.5);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(116,136,142,0.34)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`CONVEYOR ${Math.round(speed)} m/min`, left + 11, beltY + 64);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(242,184,75,0.52)";
    ctx.fillText("FLOW →", right - 12, beltY + 64);
  }

  drawBlank(ctx, w, h, machine) {
    const recipe = RECIPES[machine.currentSize];
    const beltY = h * 0.705;
    const local = phaseLocal(machine);
    let shift = 0;
    if (machine.phase === "feed") shift = -(1 - local) * w * 0.13;
    if (machine.phase === "eject") shift = local * w * 0.16;
    const speedDelta = (machine.params.speed - recipe.speed.ideal) / Math.max(recipe.speed.ideal, 1);
    const angle = clamp(speedDelta * 0.09, -0.085, 0.085);
    const bw = clamp(98 + recipe.width * 0.62, 162, 266);
    const bh = bw * 0.48;
    const cx = w * 0.505 + shift;
    const cy = beltY - bh * 0.36;
    const halfW = bw * 0.33;
    const halfH = bh * 0.25;
    const sideW = bw * 0.17;
    const flapH = bh * 0.25;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(0,0,0,0.56)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 7;
    const paper = ctx.createLinearGradient(-bw / 2, -bh / 2, bw / 2, bh / 2);
    paper.addColorStop(0, "#dcca9f");
    paper.addColorStop(0.42, "#c9b485");
    paper.addColorStop(1, "#a78d61");
    ctx.fillStyle = paper;
    ctx.strokeStyle = "rgba(79,62,35,0.58)";
    ctx.lineWidth = 1;

    const flap = (points, tint) => {
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = tint;
      ctx.fill();
      ctx.stroke();
    };

    flap([[-halfW, -halfH], [halfW, -halfH], [halfW, -halfH - flapH], [-halfW, -halfH - flapH]], "#c8b486");
    flap([[-halfW, halfH], [halfW, halfH], [halfW, halfH + flapH], [-halfW, halfH + flapH]], "#bda678");
    flap([[-halfW, -halfH], [-halfW, halfH], [-halfW - sideW, halfH], [-halfW - sideW, -halfH]], "#d5c195");
    flap([[halfW, -halfH], [halfW, halfH], [halfW + sideW, halfH], [halfW + sideW, -halfH]], "#af9669");

    const centerGradient = ctx.createLinearGradient(-halfW, -halfH, halfW, halfH);
    centerGradient.addColorStop(0, "#e4d3aa");
    centerGradient.addColorStop(0.55, "#d6c295");
    centerGradient.addColorStop(1, "#bda474");
    ctx.fillStyle = centerGradient;
    ctx.fillRect(-halfW, -halfH, halfW * 2, halfH * 2);
    ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);

    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(92,72,42,0.34)";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 0.8;
    for (const y of [-halfH, halfH]) {
      ctx.beginPath();
      ctx.moveTo(-halfW - sideW, y);
      ctx.lineTo(halfW + sideW, y);
      ctx.stroke();
    }
    for (const x of [-halfW, halfW]) {
      ctx.beginPath();
      ctx.moveTo(x, -halfH - flapH);
      ctx.lineTo(x, halfH + flapH);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    for (let y = -halfH + 5; y < halfH; y += 7) {
      ctx.beginPath();
      ctx.moveTo(-halfW + 4, y);
      ctx.lineTo(halfW - 4, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(72,57,34,0.64)";
    ctx.textAlign = "center";
    ctx.font = "700 9px ui-monospace, monospace";
    ctx.fillText(`BLANK ${recipe.id}`, 0, -2);
    ctx.font = "7px ui-monospace, monospace";
    ctx.fillStyle = "rgba(72,57,34,0.45)";
    ctx.fillText(recipe.dims, 0, 10);

    ctx.fillStyle = "rgba(72,57,34,0.38)";
    ctx.font = "6px ui-monospace, monospace";
    ctx.fillText("A", 0, -halfH - flapH + 8);
    ctx.fillText("B", 0, halfH + flapH - 5);
    ctx.restore();

    return { cx, cy, bw, bh, halfW, halfH, sideW, flapH, angle };
  }

  drawGlue(ctx, geometry, machine) {
    const { cx, cy, halfW, halfH, sideW, angle } = geometry;
    const recipe = RECIPES[machine.currentSize];
    const glueDelta = machine.params.glue - recipe.glue.ideal;
    const low = machine.params.glue < recipe.glue.min;
    const high = machine.params.glue > recipe.glue.max;
    const reveal = machine.phase === "glue" ? phaseLocal(machine) : machine.phase === "feed" ? 0 : 1;
    if (reveal <= 0) return;
    const radius = clamp(1.15 + machine.params.glue * 0.48, 1.25, 2.8);
    const gapSpan = low ? 0.26 + Math.min(0.2, Math.abs(glueDelta) * 0.25) : 0.03;
    const total = reveal * 1.02;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.shadowColor = high ? "rgba(242,184,75,0.6)" : "rgba(242,184,75,0.25)";
    ctx.shadowBlur = high ? 8 : 3;
    ctx.fillStyle = high ? "#f7c85a" : "#d9a63a";

    const line = (x1, y1, x2, y2) => {
      const length = Math.hypot(x2 - x1, y2 - y1);
      const count = Math.max(3, Math.floor(length / 5));
      for (let index = 0; index <= count * total; index += 1) {
        const p = index / count;
        if (low && p > 0.33 && p < 0.33 + gapSpan) continue;
        if (low && p > 0.7 && p < 0.7 + gapSpan * 0.7) continue;
        const x = x1 + (x2 - x1) * p;
        const y = y1 + (y2 - y1) * p;
        ctx.beginPath();
        ctx.arc(x, y, radius * (0.85 + Math.sin(index * 2.7) * 0.14), 0, TAU);
        ctx.fill();
      }
    };

    line(-halfW + 2, -halfH, halfW - 2, -halfH);
    line(-halfW + 2, halfH, halfW - 2, halfH);
    line(-halfW, -halfH + 3, -halfW, halfH - 3);
    line(halfW, -halfH + 3, halfW, halfH - 3);

    if (high) {
      const strands = 4 + Math.round(Math.min(4, Math.abs(glueDelta) * 5));
      ctx.strokeStyle = "rgba(246,192,70,0.78)";
      ctx.lineWidth = 1;
      for (let index = 0; index < strands; index += 1) {
        const x = -halfW + (index / Math.max(strands - 1, 1)) * halfW * 2;
        const sway = Math.sin(machine.simTime * 3 + index) * 5;
        ctx.beginPath();
        ctx.moveTo(x, halfH);
        ctx.bezierCurveTo(x + sway, halfH + 7, x - sway * 0.6, halfH + 18, x + sway, halfH + 24 + (index % 2) * 5);
        ctx.stroke();
      }
    }
    ctx.restore();

    if (machine.phase === "glue") {
      ctx.save();
      ctx.fillStyle = "rgba(242,184,75,0.58)";
      ctx.font = "7px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`GLUE ${machine.params.glue.toFixed(2)} g`, geometry.cx + geometry.bw * 0.45, geometry.cy - geometry.bh * 0.42);
      ctx.restore();
    }
  }

  drawRollers(ctx, geometry, machine, timestamp) {
    const { cx, cy, bw, bh } = geometry;
    const local = phaseLocal(machine);
    const pressing = machine.phase === "press";
    const pressDrop = pressing ? Math.sin(local * Math.PI) * bh * 0.2 + bh * 0.05 : 0;
    const baseY = cy - bh * 0.73 + pressDrop;
    const rollerW = bw * 0.27;
    const rollerH = 22;
    const offset = (timestamp * 0.00035 + machine.simTime * machine.params.speed * 0.12) % 9;

    ctx.strokeStyle = "#35434a";
    ctx.lineWidth = 5;
    for (const sign of [-1, 1]) {
      const x = cx + sign * bw * 0.15;
      ctx.beginPath();
      ctx.moveTo(x, baseY - 47);
      ctx.lineTo(x, baseY + 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 2, baseY - 46);
      ctx.lineTo(x - 2, baseY);
      ctx.stroke();
      ctx.strokeStyle = "#35434a";
      ctx.lineWidth = 5;
    }

    for (const sign of [-1, 1]) {
      const x = cx + sign * bw * 0.15;
      const gradient = ctx.createLinearGradient(0, baseY, 0, baseY + rollerH);
      gradient.addColorStop(0, "#9babb0");
      gradient.addColorStop(0.18, "#e3eceb");
      gradient.addColorStop(0.48, "#65767c");
      gradient.addColorStop(0.78, "#202c31");
      gradient.addColorStop(1, "#10181b");
      ctx.fillStyle = gradient;
      roundRect(ctx, x - rollerW / 2, baseY, rollerW, rollerH, 9);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      roundRect(ctx, x - rollerW / 2 + 2, baseY + 2, rollerW - 4, rollerH - 4, 7);
      ctx.clip();
      ctx.strokeStyle = "rgba(13,20,23,0.34)";
      for (let stripe = -rollerW; stripe < rollerW; stripe += 9) {
        const stripeX = x - rollerW / 2 + stripe + offset;
        ctx.beginPath();
        ctx.moveTo(stripeX, baseY);
        ctx.lineTo(stripeX + 5, baseY + rollerH);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = "#182226";
      ctx.beginPath();
      ctx.arc(x, baseY + rollerH / 2, 3.2, 0, TAU);
      ctx.fill();
    }

    if (pressing) {
      ctx.strokeStyle = `rgba(242,184,75,${0.25 + Math.sin(local * Math.PI) * 0.3})`;
      ctx.lineWidth = 1;
      for (const sign of [-1, 1]) {
        const x = cx + sign * bw * 0.15;
        ctx.beginPath();
        ctx.moveTo(x - 7, baseY + rollerH + 5);
        ctx.lineTo(x, baseY + rollerH + 11);
        ctx.lineTo(x + 7, baseY + rollerH + 5);
        ctx.stroke();
      }
    }

    this.drawGlueHead(ctx, cx, cy, bw, bh, machine, local);
  }

  drawGlueHead(ctx, cx, cy, bw, bh, machine, local) {
    const headX = cx - bw * 0.39;
    const beamY = 61;
    const nozzleY = cy - bh * 0.62;
    ctx.strokeStyle = "#2a373d";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(headX, beamY);
    ctx.lineTo(headX, nozzleY - 28);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(headX - 2, beamY);
    ctx.lineTo(headX - 2, nozzleY - 28);
    ctx.stroke();

    ctx.fillStyle = "#26343a";
    roundRect(ctx, headX - 16, beamY - 10, 32, 22, 4);
    ctx.fill();
    ctx.fillStyle = "#141d21";
    roundRect(ctx, headX - 9, nozzleY - 31, 18, 29, 3);
    ctx.fill();
    ctx.fillStyle = "#d2a946";
    ctx.beginPath();
    ctx.moveTo(headX - 3, nozzleY - 4);
    ctx.lineTo(headX + 3, nozzleY - 4);
    ctx.lineTo(headX + 1.2, nozzleY + 9);
    ctx.lineTo(headX - 1.2, nozzleY + 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#8e9ba0";
    ctx.font = "6px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("GLUE", headX, beamY - 14);

    if (machine.phase === "glue") {
      const dropY = nozzleY + 9 + local * 32;
      ctx.fillStyle = "rgba(242,184,75,0.75)";
      ctx.beginPath();
      ctx.ellipse(headX, dropY, 1.7, 3.6, 0, 0, TAU);
      ctx.fill();
      if (local > 0.4) {
        ctx.beginPath();
        ctx.ellipse(headX, dropY + 13, 1.4, 3, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  drawBuffer(ctx, w, h, machine) {
    const x = w * 0.875;
    const baseY = h * 0.605;
    ctx.save();
    ctx.fillStyle = "rgba(8,13,15,0.6)";
    roundRect(ctx, x - 48, baseY - 80, 96, 98, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(130,144,152,0.12)";
    ctx.stroke();
    ctx.fillStyle = "rgba(112,128,135,0.48)";
    ctx.font = "7px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("STACK / BUFFER", x, baseY - 68);

    const items = machine.buffer.slice(-6);
    items.forEach((item, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const bx = x - 31 + column * 22;
      const by = baseY - 51 - row * 14;
      ctx.fillStyle = item.ok ? "#bca475" : "#d58a72";
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + 16, by - 3);
      ctx.lineTo(bx + 18, by + 7);
      ctx.lineTo(bx + 2, by + 10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(40,30,16,0.45)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    });
    if (!items.length) {
      ctx.strokeStyle = "rgba(130,144,152,0.16)";
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x - 28, baseY - 52, 56, 28);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(112,128,135,0.38)";
      ctx.fillText("EMPTY", x, baseY - 35);
    }
    ctx.fillStyle = "rgba(112,128,135,0.42)";
    ctx.fillText(`${machine.bufferCount} / ${machine.bufferCapacity}`, x, baseY + 11);
    ctx.restore();
  }

  drawAnnotation(ctx, w, h, geometry, machine) {
    const defect = machine.lastDefect;
    if (!defect || machine.simTime - defect.time > 5.2) return;
    const age = machine.simTime - defect.time;
    const pulse = 0.65 + Math.sin(age * 8) * 0.25;
    let anchorX = geometry.cx + geometry.bw * 0.33;
    let anchorY = geometry.cy;
    if (defect.code === "GLUE_HIGH") anchorX = geometry.cx - geometry.bw * 0.18;
    if (defect.code === "GLUE_HIGH") anchorY = geometry.cy - geometry.bh * 0.28;
    if (defect.code?.startsWith("PRESS")) {
      anchorX = geometry.cx;
      anchorY = geometry.cy + geometry.bh * 0.2;
    }
    if (defect.code?.startsWith("SPEED")) {
      anchorX = geometry.cx + geometry.bw * 0.42;
      anchorY = geometry.cy - geometry.bh * 0.31;
    }
    const calloutW = 158;
    const calloutH = 48;
    const calloutX = Math.min(w - calloutW - 18, geometry.cx + geometry.bw * 0.55);
    const calloutY = 47;

    ctx.save();
    ctx.strokeStyle = `rgba(255,101,93,${pulse})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(anchorX + 7, anchorY - 5);
    ctx.lineTo(calloutX + 11, calloutY + calloutH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(anchorX, anchorY, 10 + Math.sin(age * 7) * 2, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(anchorX - 5, anchorY);
    ctx.lineTo(anchorX + 5, anchorY);
    ctx.moveTo(anchorX, anchorY - 5);
    ctx.lineTo(anchorX, anchorY + 5);
    ctx.stroke();

    ctx.fillStyle = "rgba(31,17,18,0.9)";
    roundRect(ctx, calloutX, calloutY, calloutW, calloutH, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,101,93,0.48)";
    ctx.stroke();
    ctx.fillStyle = "#ff7770";
    ctx.font = "7px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("ANOMALY / REJECT", calloutX + 9, calloutY + 13);
    ctx.fillStyle = "#f0c1be";
    ctx.font = '8px "Noto Sans SC Local", "Noto Sans SC", sans-serif';
    ctx.fillText(defect.label, calloutX + 9, calloutY + 26);
    ctx.fillStyle = "rgba(255,190,186,0.66)";
    ctx.font = '7px "Noto Sans SC Local", "Noto Sans SC", sans-serif';
    ctx.fillText(`${defect.effect} · ${defect.location}`, calloutX + 9, calloutY + 39);
    ctx.restore();
  }

  drawOverlay(ctx, w, h, machine) {
    const cx = w / 2;
    let label = "";
    let color = "#62d9c2";
    if (machine.mode === "paused") {
      label = machine.changeoverPending ? "换型暂停 · 校准参数后继续" : "PAUSED · 检查模式";
      color = "#f2b84b";
    } else if (machine.mode === "stopped") {
      label = `E-STOP · ${machine.stopReason || "设备停机"}`;
      color = "#ff655d";
    } else if (machine.mode === "complete") {
      label = "批次通过 · 12 / 12";
      color = "#62d9c2";
    } else if (machine.mode === "failed") {
      label = "批次未通过 · 查看异常位置";
      color = "#ff655d";
    }

    if (label) {
      ctx.save();
      ctx.font = '600 10px "Noto Sans SC Local", "Noto Sans SC", sans-serif';
      const width = ctx.measureText(label).width + 30;
      ctx.fillStyle = "rgba(9,14,16,0.78)";
      roundRect(ctx, cx - width / 2, h - 52, width, 26, 13);
      ctx.fill();
      ctx.strokeStyle = `${color}66`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx - width / 2 + 12, h - 39, 3, 0, TAU);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillText(label, cx + 5, h - 35.5);
      ctx.restore();
    }

    const steps = ["feed", "glue", "press", "eject"];
    const labels = ["FEED", "GLUE", "PRESS", "EJECT"];
    const startX = 20;
    const y = h - 20;
    steps.forEach((phase, index) => {
      const active = machine.phase === phase && machine.mode === "running";
      const completed = steps.indexOf(machine.phase) > index && machine.mode === "running";
      ctx.fillStyle = active ? "#f2b84b" : completed ? "#62d9c2" : "rgba(88,104,111,0.28)";
      ctx.fillRect(startX + index * 46, y, active ? 31 : 24, 2);
      ctx.fillStyle = active ? "#d7bd82" : "rgba(100,116,123,0.42)";
      ctx.font = "6px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(labels[index], startX + index * 46, y - 5);
    });

    if (machine.lastQuality && machine.mode !== "idle") {
      ctx.textAlign = "right";
      ctx.font = "7px ui-monospace, monospace";
      ctx.fillStyle = machine.lastQuality.ok ? "rgba(98,217,194,0.6)" : "rgba(255,101,93,0.72)";
      ctx.fillText(`QUALITY ${machine.lastQuality.score.toFixed(0)}`, w - 16, h - 16);
    }
  }
}

export class TelemetryRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(machine) {
    if (!this.width) this.resize();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(8,13,15,0.2)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(112,132,139,0.1)";
    ctx.lineWidth = 1;
    for (let row = 1; row < 4; row += 1) {
      const y = 10 + ((h - 25) / 3) * row;
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(w - 8, y);
      ctx.stroke();
    }
    for (let col = 1; col < 6; col += 1) {
      const x = 8 + ((w - 16) / 6) * col;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, h - 15);
      ctx.stroke();
    }

    const data = machine.samples.slice(-60);
    if (data.length < 2) {
      ctx.fillStyle = "rgba(111,128,135,0.35)";
      ctx.font = "8px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("等待同步采样…", w / 2, h / 2);
      return;
    }
    const left = 10;
    const right = w - 10;
    const top = 8;
    const bottom = h - 20;
    const firstT = data[0].t;
    const lastT = Math.max(data[data.length - 1].t, firstT + 1);
    const maxEnergy = Math.max(0.01, ...data.map((item) => item.energy));
    const points = {
      production: [],
      energy: [],
      buffer: []
    };
    data.forEach((item) => {
      const x = left + ((item.t - firstT) / (lastT - firstT)) * (right - left);
      points.production.push([x, bottom - (item.produced / 12) * (bottom - top)]);
      points.energy.push([x, bottom - (item.energy / maxEnergy) * (bottom - top) * 0.92]);
      points.buffer.push([x, bottom - (item.buffer / 6) * (bottom - top) * 0.92]);
    });

    this.line(ctx, points.production, "#62d9c2", 1.4, true);
    this.line(ctx, points.energy, "#f2b84b", 1.1, false);
    this.line(ctx, points.buffer, "#6aa9dd", 1, false);

    const latest = data[data.length - 1];
    ctx.fillStyle = "rgba(111,128,135,0.5)";
    ctx.font = "7px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${firstT.toFixed(0)}s`, left, h - 5);
    ctx.textAlign = "right";
    ctx.fillText(`T+${latest.t.toFixed(1)}s`, right, h - 5);
  }

  line(ctx, points, color, width, fill) {
    if (!points.length) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (fill) {
      const gradient = ctx.createLinearGradient(0, 8, 0, this.height - 20);
      gradient.addColorStop(0, "rgba(98,217,194,0.13)");
      gradient.addColorStop(1, "rgba(98,217,194,0)");
      ctx.lineTo(points[points.length - 1][0], this.height - 20);
      ctx.lineTo(points[0][0], this.height - 20);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    const last = points[points.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(last[0], last[1], 2.1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
