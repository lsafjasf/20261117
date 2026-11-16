import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  PLOTS,
  PLOT_RECTS,
  seedHash,
  mulberry32,
} from "./sim.js";

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

function drawDashedCircle(ctx, x, y, radius, dash = [3, 5]) {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function seededDots(seed, count, bounds) {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    x: bounds.x + random() * bounds.w,
    y: bounds.y + random() * bounds.h,
    size: 0.5 + random() * 1.4,
    alpha: 0.12 + random() * 0.45,
  }));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawMicrobe(ctx, x, y, size, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.28;
  ctx.beginPath();
  ctx.arc(x, y, size * 2.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export class CanvasRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.ctx = canvas.getContext("2d");
    this.view = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
    this.hover = null;
    this.pointer = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setEngine(engine) {
    this.engine = engine;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, rect.width);
    const height = Math.max(360, rect.height);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const scale = Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT);
    this.view = {
      width,
      height,
      scale,
      dpr,
      offsetX: (width - CANVAS_WIDTH * scale) / 2,
      offsetY: (height - CANVAS_HEIGHT * scale) / 2,
    };
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.view.offsetX) / this.view.scale,
      y: (clientY - rect.top - this.view.offsetY) / this.view.scale,
    };
  }

  setPointer(point) {
    this.pointer = point;
    const plot = point ? this.engine.plotAt(point.x, point.y) : null;
    const nearest = plot ? this.engine.nearestTarget(plot, point.x, point.y) : null;
    this.hover = nearest
      ? { ...nearest, plot, inRange: nearest.distance <= nearest.target.radius }
      : null;
    return this.hover;
  }

  render(visualTime = performance.now()) {
    const { ctx, view } = this;
    const state = this.engine.stateSummary();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(
      view.dpr * view.scale,
      0,
      0,
      view.dpr * view.scale,
      view.dpr * view.offsetX,
      view.dpr * view.offsetY,
    );
    this.drawBackdrop(state, visualTime);
    this.drawField(state, visualTime);
    this.drawSamples(state, visualTime);
    this.drawDishes(state, visualTime);
    this.drawHover(state);
  }

  drawBackdrop(state, time) {
    const { ctx } = this;
    const gradient = ctx.createRadialGradient(500, 120, 20, 500, 300, 720);
    gradient.addColorStop(0, "rgba(95, 135, 93, 0.035)");
    gradient.addColorStop(1, "rgba(4, 10, 8, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.strokeStyle = "rgba(205, 228, 212, 0.045)";
    ctx.lineWidth = 0.6;
    for (let x = 0; x < CANVAS_WIDTH; x += 25) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, 425);
      ctx.stroke();
    }
    for (let y = 0; y < 425; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(CANVAS_WIDTH, y + 0.5);
      ctx.stroke();
    }

    ctx.fillStyle = "#94a99c";
    ctx.font = "11px 'DM Mono', monospace";
    ctx.letterSpacing = "1.5px";
    ctx.fillText("OPEN FIELD / 120 SEC OBSERVATION", 29, 30);
    ctx.textAlign = "right";
    const phaseNames = {
      stable: "STABLE BASELINE",
      heat: "HEAT STRESS",
      humid: "HUMIDITY ALERT",
      recovery: "ENV RECOVERY",
      closing: "OBSERVATION CLOSING",
    };
    ctx.fillStyle = state.phase.id === "stable" ? "#b9f391" : "#f2ca7e";
    ctx.fillText(phaseNames[state.phase.id], 971, 30);
    ctx.textAlign = "left";

    ctx.strokeStyle = "rgba(205, 228, 212, 0.08)";
    ctx.beginPath();
    ctx.moveTo(29, 41.5);
    ctx.lineTo(971, 41.5);
    ctx.stroke();

    const pulse = (Math.sin(time * 0.0014) + 1) / 2;
    ctx.fillStyle = `rgba(157, 220, 121, ${0.18 + pulse * 0.22})`;
    ctx.beginPath();
    ctx.arc(963, 25, 2.2, 0, TAU);
    ctx.fill();
  }

  drawField(state, time) {
    const { ctx } = this;
    for (const plot of PLOTS) {
      const rect = PLOT_RECTS[plot.id];
      const group = state.groups.find((item) => item.id === plot.id);
      const hasCritical = state.criticalWarnings.length > 0;
      const glow = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      glow.addColorStop(0, "#253f30");
      glow.addColorStop(0.38, "#1e3527");
      glow.addColorStop(1, "#12251b");

      ctx.save();
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 13);
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.strokeStyle = hasCritical
        ? "rgba(239, 126, 110, 0.22)"
        : group.complete
          ? "rgba(157, 220, 121, 0.28)"
          : "rgba(205, 228, 212, 0.12)";
      ctx.stroke();

      ctx.fillStyle = plot.color;
      ctx.font = "600 15px 'Noto Sans SC', sans-serif";
      ctx.fillText(plot.name, rect.x + 16, rect.y + 25);
      ctx.fillStyle = "#9eb2a5";
      ctx.font = "10px 'Noto Sans SC', sans-serif";
      ctx.fillText(plot.fertilizer, rect.x + 16, rect.y + 42);

      ctx.textAlign = "right";
      ctx.fillStyle = group.complete ? "#b9f391" : "#94a99c";
      ctx.font = "10px 'DM Mono', monospace";
      ctx.fillText(`SAMPLE ${group.count}/3`, rect.x + rect.w - 14, rect.y + 24);
      ctx.fillStyle = "#7f9588";
      ctx.fillText(`SOIL ${state.actual.water.toFixed(0)}%`, rect.x + rect.w - 14, rect.y + 40);
      ctx.textAlign = "left";

      const bed = {
        x: rect.x + 10,
        y: rect.y + 54,
        w: rect.w - 20,
        h: rect.h - 67,
      };
      this.drawSoilBed(plot, bed, state, time);
      this.drawPlotInterventions(plot, bed, state, time);
      this.drawTargets(plot, state, time);

      ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
      roundRect(ctx, rect.x + 14, rect.y + rect.h - 18, 58, 10, 3);
      ctx.fill();
      ctx.fillStyle = group.comparable ? "#b9f391" : "#8da194";
      ctx.font = "8px 'DM Mono', monospace";
      ctx.fillText(group.comparable ? "COMPARABLE" : "COLLECTING", rect.x + 20, rect.y + rect.h - 10);
      ctx.restore();
    }
  }

  drawSoilBed(plot, bed, state, time) {
    const { ctx } = this;
    ctx.save();
    roundRect(ctx, bed.x, bed.y, bed.w, bed.h, 9);
    ctx.clip();
    const soil = ctx.createLinearGradient(0, bed.y, 0, bed.y + bed.h);
    soil.addColorStop(0, "#38573e");
    soil.addColorStop(0.55, "#2b4835");
    soil.addColorStop(1, "#1e3628");
    ctx.fillStyle = soil;
    ctx.fillRect(bed.x, bed.y, bed.w, bed.h);

    if (state.actual.water > 70) {
      const waterAlpha = clamp((state.actual.water - 65) / 50, 0, 0.22);
      ctx.fillStyle = `rgba(73, 126, 151, ${waterAlpha})`;
      ctx.fillRect(bed.x, bed.y, bed.w, bed.h);
    }

    const randomSeed = (seedHash(this.engine.seed) ^ (plot.id.charCodeAt(0) * 97)) >>> 0;
    const specks = seededDots(randomSeed, 45, bed);
    for (const speck of specks) {
      ctx.fillStyle = `rgba(${145 + speck.alpha * 45}, ${174 + speck.alpha * 30}, 130, ${speck.alpha})`;
      ctx.beginPath();
      ctx.arc(speck.x, speck.y, speck.size, 0, TAU);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(174, 203, 148, 0.16)";
    ctx.lineWidth = 1;
    for (let row = 1; row < 5; row += 1) {
      const y = bed.y + (bed.h / 5) * row;
      ctx.beginPath();
      ctx.moveTo(bed.x + 6, y);
      ctx.bezierCurveTo(
        bed.x + bed.w * 0.3,
        y - 4,
        bed.x + bed.w * 0.7,
        y + 4,
        bed.x + bed.w - 6,
        y,
      );
      ctx.stroke();
    }

    const microbes = seededDots(randomSeed + 91, 20, {
      x: bed.x + 8,
      y: bed.y + 9,
      w: bed.w - 16,
      h: bed.h - 18,
    });
    const species = this.engine.speciesAt(plot.id);
    microbes.forEach((microbe, index) => {
      if (index % 3 === 0) {
        const twinkle = 0.45 + Math.sin(time * 0.0012 + index * 2.3) * 0.25;
        drawMicrobe(ctx, microbe.x, microbe.y, 1.1, plot.color, twinkle * clamp(species / 7, 0.3, 1));
      }
    });

    const edgeShade = ctx.createLinearGradient(bed.x, 0, bed.x + bed.w, 0);
    edgeShade.addColorStop(0, "rgba(0,0,0,0.25)");
    edgeShade.addColorStop(0.1, "rgba(0,0,0,0)");
    edgeShade.addColorStop(0.9, "rgba(0,0,0,0)");
    edgeShade.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = edgeShade;
    ctx.fillRect(bed.x, bed.y, bed.w, bed.h);
    ctx.restore();
  }

  drawPlotInterventions(plot, bed, state, time) {
    const { ctx } = this;
    const types = new Set(state.active.map((item) => item.type));
    ctx.save();
    roundRect(ctx, bed.x, bed.y, bed.w, bed.h, 9);
    ctx.clip();

    if (types.has("shade")) {
      ctx.fillStyle = "rgba(6, 13, 11, 0.28)";
      ctx.fillRect(bed.x, bed.y, bed.w, bed.h);
      ctx.strokeStyle = "rgba(232, 187, 104, 0.14)";
      ctx.lineWidth = 2;
      for (let x = bed.x - bed.h; x < bed.x + bed.w + bed.h; x += 23) {
        ctx.beginPath();
        ctx.moveTo(x, bed.y);
        ctx.lineTo(x + bed.h, bed.y + bed.h);
        ctx.stroke();
      }
    }

    if (types.has("ventilation")) {
      const offset = (time * 0.025) % 54;
      ctx.strokeStyle = "rgba(123, 187, 212, 0.22)";
      ctx.lineWidth = 1.2;
      for (let y = bed.y + 12; y < bed.y + bed.h; y += 30) {
        for (let x = bed.x - 40 + offset; x < bed.x + bed.w; x += 54) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.bezierCurveTo(x + 9, y - 4, x + 19, y + 4, x + 30, y);
          ctx.stroke();
        }
      }
    }

    if (types.has("irrigation")) {
      ctx.strokeStyle = "rgba(123, 187, 212, 0.7)";
      ctx.lineWidth = 1.2;
      for (let index = 0; index < 17; index += 1) {
        const x = bed.x + ((index * 47 + 13) % (bed.w - 24)) + 12;
        const y = bed.y + ((time * 0.16 + index * 29) % (bed.h - 20)) + 4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 1, y + 6, x - 1.5, y + 11);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawTargets(plot, state, time) {
    const { ctx } = this;
    const targets = state.targets.filter((target) => target.plot === plot.id);
    const pulse = (Math.sin(time * 0.004) + 1) / 2;
    for (const target of targets) {
      const hovered = this.hover?.target?.id === target.id;
      ctx.save();
      if (target.sampled) {
        ctx.fillStyle = "rgba(157, 220, 121, 0.16)";
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.radius, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "rgba(157, 220, 121, 0.7)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = "#b9f391";
        ctx.beginPath();
        ctx.arc(target.x, target.y, 4, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#102015";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(target.x - 1.8, target.y);
        ctx.lineTo(target.x - 0.2, target.y + 1.5);
        ctx.lineTo(target.x + 2.1, target.y - 1.8);
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(157, 220, 121, ${0.11 + pulse * 0.07})`;
        ctx.beginPath();
        ctx.arc(target.x, target.y, 9 + pulse * 4, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = hovered ? "rgba(185, 243, 145, 0.95)" : "rgba(157, 220, 121, 0.72)";
        ctx.lineWidth = hovered ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.radius, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = "rgba(157, 220, 121, 0.24)";
        ctx.lineWidth = 0.7;
        drawDashedCircle(ctx, target.x, target.y, target.radius + 8, [2, 4]);
        ctx.fillStyle = "#cbe8b8";
        ctx.beginPath();
        ctx.arc(target.x, target.y, 2.4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(9, 19, 14, 0.92)";
        roundRect(ctx, target.x - 12, target.y + target.radius + 3, 24, 13, 3);
        ctx.fill();
        ctx.fillStyle = "rgba(185, 243, 145, 0.94)";
        ctx.font = "8.5px 'DM Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(target.id, target.x, target.y + target.radius + 12.5);
        ctx.textAlign = "left";
      }
      ctx.restore();
    }
  }

  drawSamples(state, time) {
    const { ctx } = this;
    for (const dish of state.dishes) {
      ctx.save();
      if (dish.bias) {
        ctx.strokeStyle = "rgba(239, 126, 110, 0.55)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(dish.x, dish.y);
        ctx.lineTo(dish.targetX, dish.targetY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "#ef7e6e";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(dish.x - 4, dish.y - 4);
        ctx.lineTo(dish.x + 4, dish.y + 4);
        ctx.moveTo(dish.x + 4, dish.y - 4);
        ctx.lineTo(dish.x - 4, dish.y + 4);
        ctx.stroke();
        ctx.fillStyle = "rgba(239, 126, 110, 0.8)";
        ctx.font = "6px 'DM Mono', monospace";
        ctx.fillText(`${dish.distance}u`, dish.x + 7, dish.y - 6);
      } else {
        const pulse = 1 + Math.sin(time * 0.004 + dish.time) * 0.1;
        ctx.fillStyle = "rgba(185, 243, 145, 0.13)";
        ctx.beginPath();
        ctx.arc(dish.x, dish.y, 7 * pulse, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#b9f391";
        ctx.beginPath();
        ctx.arc(dish.x, dish.y, 2.7, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawDishes(state, time) {
    const { ctx } = this;
    ctx.strokeStyle = "rgba(205, 228, 212, 0.1)";
    ctx.beginPath();
    ctx.moveTo(29, 427.5);
    ctx.lineTo(971, 427.5);
    ctx.stroke();

    ctx.fillStyle = "#9bb0a3";
    ctx.font = "10px 'DM Mono', monospace";
    ctx.fillText("INCUBATION / CULTURE PLATES", 29, 455);
    ctx.fillStyle = "#778c7f";
    ctx.fillText("37°C · 48H EQUIV.", 29, 470);

    ctx.textAlign = "right";
    ctx.fillStyle = state.biasCount ? "#ff9a8c" : "#7f9488";
    ctx.fillText(`${state.biasCount} BIAS`, 971, 455);
    ctx.textAlign = "left";

    PLOTS.forEach((plot, index) => {
      const centerX = 185 + index * 315;
      const centerY = 610;
      const radius = 102;
      const group = state.groups.find((item) => item.id === plot.id);
      const dishes = state.dishes.filter((dish) => dish.plot === plot.id && !dish.bias);
      const bias = state.dishes.filter((dish) => dish.plot === plot.id && dish.bias);

      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 7;
      ctx.fillStyle = "rgba(25, 45, 35, 0.98)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + 5, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "rgba(205, 228, 212, 0.24)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + 5, 0, TAU);
      ctx.stroke();

      const agar = ctx.createRadialGradient(
        centerX - 20,
        centerY - 25,
        8,
        centerX,
        centerY,
        radius,
      );
      const contaminationMix = clamp(state.actual.contamination / 90, 0, 0.5);
      agar.addColorStop(0, `rgba(151, 178, 111, ${0.38 + contaminationMix * 0.25})`);
      agar.addColorStop(0.7, `rgba(103, 132, 80, ${0.3 + contaminationMix * 0.22})`);
      agar.addColorStop(1, "rgba(54, 80, 57, 0.65)");
      ctx.fillStyle = agar;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, TAU);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, TAU);
      ctx.clip();
      const gridAlpha = 0.035;
      ctx.strokeStyle = `rgba(220, 237, 211, ${gridAlpha})`;
      for (let x = centerX - radius; x < centerX + radius; x += 13) {
        ctx.beginPath();
        ctx.moveTo(x, centerY - radius);
        ctx.lineTo(x, centerY + radius);
        ctx.stroke();
      }
      for (let y = centerY - radius; y < centerY + radius; y += 13) {
        ctx.beginPath();
        ctx.moveTo(centerX - radius, y);
        ctx.lineTo(centerX + radius, y);
        ctx.stroke();
      }

      dishes.forEach((dish, dishIndex) => {
        const angle = -Math.PI / 2 + dishIndex * (TAU / 3) + 0.2;
        const clusterDistance = 48;
        const colonyX = centerX + Math.cos(angle) * clusterDistance;
        const colonyY = centerY + Math.sin(angle) * clusterDistance;
        const random = mulberry32(seedHash(`${this.engine.seed}-${dish.id}`));
        const colonyCount = 8 + Math.round(clamp(dish.species, 2, 8) * 2);
        for (let colony = 0; colony < colonyCount; colony += 1) {
          const spread = 17 * Math.sqrt(random());
          const direction = random() * TAU;
          const size = 0.8 + random() * 1.6;
          const contaminated = random() < clamp(state.actual.contamination / 130, 0.05, 0.55);
          drawMicrobe(
            ctx,
            colonyX + Math.cos(direction) * spread,
            colonyY + Math.sin(direction) * spread,
            size,
            contaminated ? "#d38b62" : plot.color,
            0.5 + random() * 0.35,
          );
        }
        ctx.fillStyle = "rgba(230, 243, 224, 0.66)";
        ctx.font = "8px 'DM Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(dish.targetId, colonyX, colonyY + 35);
        ctx.textAlign = "left";
      });

      if (!dishes.length) {
        ctx.strokeStyle = "rgba(205, 228, 212, 0.12)";
        drawDashedCircle(ctx, centerX, centerY, 46, [3, 5]);
        ctx.strokeStyle = "rgba(205, 228, 212, 0.18)";
        ctx.beginPath();
        ctx.moveTo(centerX - 5, centerY);
        ctx.lineTo(centerX + 5, centerY);
        ctx.moveTo(centerX, centerY - 5);
        ctx.lineTo(centerX, centerY + 5);
        ctx.stroke();
        ctx.fillStyle = "rgba(205, 228, 212, 0.48)";
        ctx.font = "9px 'Noto Sans SC', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("等待目标样本", centerX, centerY + 64);
        ctx.textAlign = "left";
      }
      ctx.restore();

      const lightSweep = centerX - 50 + Math.sin(time * 0.0005 + index) * 20;
      const shine = ctx.createLinearGradient(lightSweep, centerY - 60, lightSweep + 20, centerY);
      shine.addColorStop(0, "rgba(255, 255, 255, 0)");
      shine.addColorStop(0.5, "rgba(231, 247, 226, 0.055)");
      shine.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, TAU);
      ctx.clip();
      ctx.fillStyle = shine;
      ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
      ctx.restore();

      ctx.strokeStyle = "rgba(220, 238, 224, 0.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(205, 228, 212, 0.08)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius - 5, 0, TAU);
      ctx.stroke();

      bias.forEach((dish, biasIndex) => {
        const angle = time * 0.0002 + biasIndex * 2.1;
        const x = centerX + Math.cos(angle) * (radius - 10);
        const y = centerY + Math.sin(angle) * (radius - 10);
        ctx.strokeStyle = "rgba(239, 126, 110, 0.8)";
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 3);
        ctx.lineTo(x + 3, y + 3);
        ctx.moveTo(x + 3, y - 3);
        ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
      });

      ctx.fillStyle = group.comparable ? plot.color : "#d5e1d8";
      ctx.font = "600 13px 'Noto Sans SC', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${plot.name} · ${plot.short}`, centerX, 747);
      ctx.fillStyle = "#8da194";
      ctx.font = "9px 'DM Mono', monospace";
      ctx.fillText(
        `${group.count}/3 REPLICATES · ${group.span.toFixed(1)}s SPAN`,
        centerX,
        763,
      );
      ctx.textAlign = "left";
    });

    const progress = clamp(state.elapsed / 120, 0, 1);
    ctx.strokeStyle = "rgba(205, 228, 212, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(29, 831.5);
    ctx.lineTo(971, 831.5);
    ctx.stroke();
    ctx.strokeStyle = state.success ? "#9ddc79" : "rgba(157, 220, 121, 0.4)";
    ctx.beginPath();
    ctx.moveTo(29, 831.5);
    ctx.lineTo(29 + 942 * progress, 831.5);
    ctx.stroke();
    ctx.fillStyle = "#7e9387";
    ctx.font = "8px 'DM Mono', monospace";
    ctx.fillText("T+00:00", 29, 848);
    ctx.textAlign = "right";
    ctx.fillText("T+02:00", 971, 848);
    ctx.textAlign = "left";
  }

  drawHover(state) {
    if (!this.hover || this.hover.target.sampled) return;
    const { ctx } = this;
    const { target, distance, inRange } = this.hover;
    ctx.save();
    ctx.strokeStyle = inRange ? "rgba(185, 243, 145, 0.8)" : "rgba(239, 126, 110, 0.7)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(this.pointer.x, this.pointer.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(8, 17, 12, 0.9)";
    roundRect(ctx, this.pointer.x + 10, this.pointer.y - 23, 63, 16, 4);
    ctx.fill();
    ctx.fillStyle = inRange ? "#9ddc79" : "#ef7e6e";
    ctx.font = "7px 'DM Mono', monospace";
    ctx.fillText(`${distance.toFixed(1)}u / ${inRange ? "IN" : "OUT"}`, this.pointer.x + 16, this.pointer.y - 13);
    ctx.restore();
  }
}
