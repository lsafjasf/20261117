import { BATCH_TARGET_KG, PHASE_LABELS, RECIPES } from "./config.js";

const W = 1120;
const H = 620;
const FONT = '"Noto Sans SC Local", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const MONO = '"SFMono-Regular", Consolas, monospace';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function bevel(ctx, x, y, width, height, radius = 8) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = "rgba(19, 30, 40, 0.96)";
  ctx.fill();
  ctx.strokeStyle = "rgba(151, 179, 194, 0.26)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function label(ctx, text, x, y, options = {}) {
  ctx.save();
  ctx.font = `${options.weight || 500} ${options.size || 11}px ${options.mono ? MONO : FONT}`;
  ctx.fillStyle = options.color || "#8fa0af";
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function particlePoint(path, t) {
  const one = 1 - t;
  return {
    x: one * one * path.x0 + 2 * one * t * path.cx + t * t * path.x1,
    y: one * one * path.y0 + 2 * one * t * path.cy + t * t * path.y1
  };
}

function particle(ctx, path, t, color, radius = 2.2) {
  const point = particlePoint(path, clamp(t, 0, 1));
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

export class PlantRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.layout = {
      silos: [
        { x: 58, y: 63, w: 78, h: 144 },
        { x: 139, y: 48, w: 78, h: 159 },
        { x: 220, y: 63, w: 78, h: 144 }
      ],
      hopper: { x: 314, y: 247, w: 216, h: 123 },
      mixer: { x: 665, y: 292, w: 216, h: 150 },
      package: { x: 934, y: 234, w: 116, h: 213 },
      paths: [
        { x0: 97, y0: 207, cx: 107, cy: 280, x1: 351, y1: 249 },
        { x0: 178, y0: 207, cx: 188, cy: 290, x1: 407, y1: 249 },
        { x0: 259, y0: 207, cx: 269, cy: 280, x1: 465, y1: 249 }
      ]
    };
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(sim) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this._drawBackdrop(ctx, sim);
    this._drawHeader(ctx, sim);
    this._drawSilos(ctx, sim);
    this._drawTransferTubes(ctx, sim);
    this._drawHopper(ctx, sim);
    this._drawMixer(ctx, sim);
    this._drawPackageBin(ctx, sim);
    this._drawFlowStatus(ctx, sim);
    this._drawAlarm(ctx, sim);
  }

  _drawBackdrop(ctx, sim) {
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#111a23");
    gradient.addColorStop(0.62, "#0c131a");
    gradient.addColorStop(1, "#090e13");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = "rgba(124, 163, 177, 0.05)";
    ctx.lineWidth = 1;
    for (let x = 20; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 20; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();

    const floor = ctx.createLinearGradient(0, 497, 0, 590);
    floor.addColorStop(0, "rgba(15, 25, 33, 0.25)");
    floor.addColorStop(1, "rgba(4, 8, 12, 0.78)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, 487, W, 104);
    ctx.strokeStyle = "rgba(232, 187, 99, 0.18)";
    ctx.beginPath();
    ctx.moveTo(34, 489);
    ctx.lineTo(W - 34, 489);
    ctx.stroke();

    if (sim.phase === "stopped") {
      ctx.save();
      ctx.fillStyle = "rgba(240, 109, 109, 0.025)";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  _drawHeader(ctx, sim) {
    const recipe = RECIPES[sim.recipeId];
    label(ctx, "SHARED SIMULATION CLOCK", 34, 30, {
      size: 9,
      weight: 700,
      color: "#57d5d1"
    });
    label(ctx, sim.clock.toFixed(1).padStart(6, "0") + " s", 224, 30, {
      size: 12,
      weight: 700,
      color: "#e9f2f5",
      mono: true
    });
    label(ctx, `${recipe.name} · 目标 ${BATCH_TARGET_KG} kg`, 638, 30, {
      size: 10,
      weight: 600,
      color: "#b9c6cf"
    });
    label(ctx, PHASE_LABELS[sim.phase] || sim.phase, 1084, 30, {
      size: 10,
      weight: 700,
      color: sim.phase === "stopped" ? "#f06d6d" : "#57d5d1",
      align: "right"
    });
  }

  _drawSilos(ctx, sim) {
    const colors = ["#e8c879", "#d6a95f", "#bf8651"];
    const letters = ["A", "B", "C"];
    const names = ["高筋粉", "中筋粉", "低筋粉"];
    this.layout.silos.forEach((silo, index) => {
      const centerX = silo.x + silo.w / 2;
      const active = sim.screws[index].flowKgS > 0.001;
      ctx.save();
      ctx.shadowColor = active ? "rgba(232, 187, 99, 0.18)" : "transparent";
      ctx.shadowBlur = active ? 18 : 0;
      roundedRect(ctx, silo.x, silo.y, silo.w, silo.h, 10);
      const shell = ctx.createLinearGradient(silo.x, 0, silo.x + silo.w, 0);
      shell.addColorStop(0, "#17232d");
      shell.addColorStop(0.45, "#22323e");
      shell.addColorStop(1, "#121b23");
      ctx.fillStyle = shell;
      ctx.fill();
      ctx.strokeStyle = active ? "rgba(232, 187, 99, 0.6)" : "rgba(151, 179, 194, 0.24)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      const target = BATCH_TARGET_KG * RECIPES[sim.recipeId].ratios[index];
      const delivered = sim.screws[index].deliveredKg || 0;
      const fillRatio = sim.phase === "ready" && delivered === 0
        ? 0.68
        : clamp(delivered / Math.max(target, 0.001), 0.02, 0.78);
      const fillHeight = (silo.h - 35) * fillRatio;
      ctx.save();
      roundedRect(ctx, silo.x + 5, silo.y + 28 + (silo.h - 33 - fillHeight), silo.w - 10, fillHeight, 6);
      const powder = ctx.createLinearGradient(0, silo.y + silo.h - fillHeight, 0, silo.y + silo.h);
      powder.addColorStop(0, colors[index]);
      powder.addColorStop(1, index === 2 ? "#8f5a35" : "#a4773b");
      ctx.fillStyle = powder;
      ctx.globalAlpha = 0.78;
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "rgba(5, 9, 13, 0.88)";
      roundedRect(ctx, silo.x + 6, silo.y + 7, silo.w - 12, 20, 6);
      ctx.fill();
      label(ctx, `${letters[index]} · ${names[index]}`, centerX, silo.y + 17, {
        size: 9,
        weight: 700,
        color: colors[index],
        align: "center"
      });
      label(ctx, `${sim.screws[index].actual.toFixed(1)}%`, centerX, silo.y + silo.h - 13, {
        size: 11,
        weight: 700,
        color: "#f0e3c4",
        align: "center",
        mono: true
      });

      ctx.fillStyle = active ? colors[index] : "#46545e";
      ctx.beginPath();
      ctx.arc(centerX, silo.y + silo.h + 9, active ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (active) {
        ctx.strokeStyle = "rgba(232, 187, 99, 0.3)";
        ctx.beginPath();
        ctx.arc(centerX, silo.y + silo.h + 9, 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      label(ctx, `设定 ${sim.screws[index].setpoint.toFixed(0)}%`, centerX, silo.y - 10, {
        size: 8,
        color: "#748894",
        align: "center"
      });
    });
  }

  _drawTransferTubes(ctx, sim) {
    const colors = ["#e8c879", "#d6a95f", "#bf8651"];
    this.layout.paths.forEach((path, index) => {
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(77, 96, 108, 0.55)";
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.moveTo(path.x0, path.y0);
      ctx.quadraticCurveTo(path.cx, path.cy, path.x1, path.y1);
      ctx.stroke();
      ctx.strokeStyle = "rgba(7, 12, 17, 0.9)";
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = "rgba(151, 179, 194, 0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      const screw = sim.screws[index];
      if (screw.actual > 0.01) {
        const flowRatio = clamp(screw.flowKgS / 3.6, 0, 1);
        const count = Math.ceil(3 + flowRatio * 8);
        const travel = (sim.clock * (0.18 + flowRatio * 0.32)) % 1;
        for (let particleIndex = 0; particleIndex < count; particleIndex += 1) {
          const t = (travel + particleIndex / count) % 1;
          particle(ctx, path, t, colors[index], 1.6 + flowRatio * 1.4);
        }
        ctx.save();
        ctx.strokeStyle = colors[index];
        ctx.globalAlpha = 0.38 + flowRatio * 0.36;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 5]);
        ctx.lineDashOffset = -sim.clock * 12 * (0.5 + flowRatio);
        ctx.beginPath();
        ctx.moveTo(path.x0, path.y0);
        ctx.quadraticCurveTo(path.cx, path.cy, path.x1, path.y1);
        ctx.stroke();
        ctx.restore();
      }
      const mid = particlePoint(path, 0.58);
      label(ctx, `${screw.flowKgS.toFixed(2)} kg/s`, mid.x + 7, mid.y - 7, {
        size: 8,
        color: screw.flowKgS > 0 ? colors[index] : "#536570",
        mono: true
      });
    });
    label(ctx, "送料螺旋", 178, 232, {
      size: 9,
      weight: 600,
      color: "#738995",
      align: "center"
    });
  }

  _drawHopper(ctx, sim) {
    const box = this.layout.hopper;
    const wobble = Math.sin(sim.clock * 18) * Math.min(4.5, sim.weigh.oscillationKg);
    const x = box.x + wobble;
    const y = box.y;
    const width = box.w;
    const height = box.h;
    const mouth = 44;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width / 2 + mouth / 2, y + height - 14);
    ctx.lineTo(x + width / 2 - mouth / 2, y + height - 14);
    ctx.closePath();
    const shell = ctx.createLinearGradient(x, y, x + width, y);
    shell.addColorStop(0, "#1b2a35");
    shell.addColorStop(0.5, "#2b3e4a");
    shell.addColorStop(1, "#182630");
    ctx.fillStyle = shell;
    ctx.fill();
    ctx.strokeStyle = sim.weigh.stable ? "rgba(87, 213, 209, 0.36)" : "rgba(242, 155, 88, 0.68)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    const fillRatio = clamp(sim.weigh.trueKg / BATCH_TARGET_KG, 0, 1);
    if (fillRatio > 0.005) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width / 2 + mouth / 2, y + height - 14);
      ctx.lineTo(x + width / 2 - mouth / 2, y + height - 14);
      ctx.closePath();
      ctx.clip();
      const top = y + height - 10 - (height - 20) * fillRatio;
      const fill = ctx.createLinearGradient(0, top, 0, y + height);
      fill.addColorStop(0, "rgba(232, 200, 121, 0.92)");
      fill.addColorStop(1, "rgba(173, 113, 56, 0.92)");
      ctx.fillStyle = fill;
      ctx.fillRect(x + 2, top, width - 4, height);
      const line = Math.sin(sim.clock * 11) * sim.weigh.oscillationKg;
      ctx.fillStyle = "rgba(248, 227, 174, 0.52)";
      ctx.fillRect(x + 4, top + line, width - 8, 1.5);
      ctx.restore();
    }

    label(ctx, "WEIGH HOPPER", x + width / 2, y + 13, {
      size: 8,
      weight: 700,
      color: "#728793",
      align: "center"
    });
    label(ctx, `${sim.weigh.trueKg.toFixed(2)} kg`, x + width / 2, y + 92, {
      size: 25,
      weight: 700,
      color: "#f2ddb0",
      align: "center",
      mono: true
    });
    label(ctx, "真值", x + width / 2, y + 112, {
      size: 8,
      color: "#8a9aa4",
      align: "center"
    });

    const gateY = y + height - 11;
    const gateLeft = x + width / 2 - mouth / 2;
    const spread = sim.weigh.gateOpen ? 21 : 1;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = sim.weigh.gateOpen ? "#e8bb63" : "#8fa8b5";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(gateLeft, gateY);
    ctx.lineTo(gateLeft - spread, gateY + 17);
    ctx.moveTo(gateLeft + mouth, gateY);
    ctx.lineTo(gateLeft + mouth + spread, gateY + 17);
    ctx.stroke();
    ctx.restore();

    if (sim.weigh.gateOpen) {
      const path = {
        x0: x + width / 2,
        y0: gateY + 19,
        cx: x + width / 2 + 90,
        cy: gateY + 6,
        x1: this.layout.mixer.x + 56,
        y1: this.layout.mixer.y + 8
      };
      ctx.save();
      ctx.strokeStyle = "rgba(232, 187, 99, 0.35)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(path.x0, path.y0);
      ctx.quadraticCurveTo(path.cx, path.cy, path.x1, path.y1);
      ctx.stroke();
      ctx.restore();
      for (let index = 0; index < 12; index += 1) {
        const t = (sim.clock * 0.58 + index / 12) % 1;
        particle(ctx, path, t, index % 3 === 0 ? "#e8c879" : "#d6a95f", 2.1);
      }
    }

    const displayX = 365;
    const displayY = 398;
    roundedRect(ctx, displayX, displayY, 114, 42, 7);
    ctx.fillStyle = "#071214";
    ctx.fill();
    ctx.strokeStyle = sim.weigh.stable ? "rgba(87, 213, 209, 0.4)" : "rgba(242, 155, 88, 0.55)";
    ctx.stroke();
    label(ctx, `W ${sim.weigh.measuredKg.toFixed(2)}`, displayX + 57, displayY + 15, {
      size: 12,
      weight: 700,
      color: sim.weigh.stable ? "#7ee6da" : "#f4ad67",
      align: "center",
      mono: true
    });
    label(ctx, sim.weigh.stable ? "STABLE" : `OSC ±${sim.weigh.oscillationKg.toFixed(2)}`, displayX + 57, displayY + 30, {
      size: 7,
      weight: 700,
      color: sim.weigh.stable ? "#6f958f" : "#de8c53",
      align: "center",
      mono: true
    });
  }

  _drawMixer(ctx, sim) {
    const box = this.layout.mixer;
    const fillRatio = clamp(sim.mixer.totalKg / BATCH_TARGET_KG, 0, 0.92);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(box.x, box.y);
    ctx.lineTo(box.x + box.w, box.y);
    ctx.lineTo(box.x + box.w - 22, box.y + box.h - 24);
    ctx.quadraticCurveTo(box.x + box.w / 2, box.y + box.h + 14, box.x + 22, box.y + box.h - 24);
    ctx.closePath();
    const shell = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.h);
    shell.addColorStop(0, "#263844");
    shell.addColorStop(1, "#121d25");
    ctx.fillStyle = shell;
    ctx.fill();
    ctx.strokeStyle = sim.mixer.fault ? "rgba(240, 109, 109, 0.8)" : "rgba(151, 179, 194, 0.3)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    if (fillRatio > 0.003) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(box.x + 4, box.y + 6);
      ctx.lineTo(box.x + box.w - 4, box.y + 6);
      ctx.lineTo(box.x + box.w - 25, box.y + box.h - 24);
      ctx.quadraticCurveTo(box.x + box.w / 2, box.y + box.h + 8, box.x + 25, box.y + box.h - 24);
      ctx.closePath();
      ctx.clip();
      const top = box.y + box.h - 16 - (box.h - 18) * fillRatio;
      const blend = ctx.createLinearGradient(0, top, 0, box.y + box.h);
      blend.addColorStop(0, "rgba(220, 185, 108, 0.94)");
      blend.addColorStop(1, "rgba(143, 97, 55, 0.96)");
      ctx.fillStyle = blend;
      ctx.fillRect(box.x + 2, top, box.w - 4, box.h);
      if (sim.mixer.on) {
        ctx.strokeStyle = "rgba(255, 226, 166, 0.28)";
        ctx.lineWidth = 1;
        for (let index = 0; index < 4; index += 1) {
          const yy = top + ((sim.clock * 24 + index * 16) % Math.max(16, box.h - 18));
          ctx.beginPath();
          ctx.moveTo(box.x + 8, yy);
          ctx.lineTo(box.x + box.w - 8, yy);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    const centerX = box.x + box.w / 2;
    const centerY = box.y + 75;
    const angle = sim.mixer.on ? sim.clock * 2.7 : -0.55;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);
    ctx.strokeStyle = sim.mixer.fault ? "#f06d6d" : (sim.mixer.on ? "#e8bb63" : "#708690");
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-47, 0);
    ctx.lineTo(47, 0);
    ctx.moveTo(0, -27);
    ctx.lineTo(0, 27);
    ctx.stroke();
    ctx.fillStyle = sim.mixer.fault ? "rgba(240, 109, 109, 0.7)" : "rgba(232, 187, 99, 0.72)";
    [[-47, 0], [47, 0], [0, -27], [0, 27]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
    ctx.beginPath();
    ctx.arc(centerX, centerY, 17, 0, Math.PI * 2);
    ctx.fillStyle = "#17252e";
    ctx.fill();
    ctx.strokeStyle = sim.mixer.on ? "rgba(232, 187, 99, 0.7)" : "rgba(151, 179, 194, 0.25)";
    ctx.stroke();

    label(ctx, "MIXER", box.x + 12, box.y + 15, {
      size: 8,
      weight: 700,
      color: "#728793"
    });
    label(ctx, `${sim.mixer.totalKg.toFixed(1)} kg`, box.x + box.w - 12, box.y + 15, {
      size: 10,
      weight: 700,
      color: "#d4c39e",
      align: "right",
      mono: true
    });

    const timerWidth = box.w - 24;
    const ratio = clamp(sim.mixer.mixElapsed / Math.max(1, sim.settings.mixTime), 0, 1);
    ctx.fillStyle = "rgba(5, 9, 13, 0.72)";
    roundedRect(ctx, box.x + 12, box.y + box.h - 12, timerWidth, 7, 4);
    ctx.fill();
    ctx.fillStyle = sim.mixer.mixComplete ? "#7ddc9d" : "#57d5d1";
    roundedRect(ctx, box.x + 12, box.y + box.h - 12, timerWidth * ratio, 7, 4);
    ctx.fill();
    label(ctx, `${sim.mixer.mixElapsed.toFixed(1)} / ${sim.settings.mixTime} s`, centerX, box.y + box.h + 11, {
      size: 8,
      color: "#8497a2",
      align: "center",
      mono: true,
      baseline: "top"
    });
    label(ctx, sim.mixer.fault ? `FAULT · ${sim.mixer.fault}` : (sim.mixer.on ? "MIXING" : (sim.mixer.mixComplete ? "READY" : "IDLE")), centerX, box.y + 117, {
      size: 8,
      weight: 700,
      color: sim.mixer.fault ? "#f06d6d" : (sim.mixer.on ? "#e8bb63" : "#82939c"),
      align: "center"
    });

    if (sim.mixer.dischargeOpen) {
      const path = {
        x0: box.x + box.w - 2,
        y0: box.y + 82,
        cx: box.x + box.w + 34,
        cy: box.y + 62,
        x1: this.layout.package.x + 51,
        y1: this.layout.package.y + 8
      };
      ctx.save();
      ctx.strokeStyle = "rgba(232, 187, 99, 0.35)";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(path.x0, path.y0);
      ctx.quadraticCurveTo(path.cx, path.cy, path.x1, path.y1);
      ctx.stroke();
      ctx.restore();
      for (let index = 0; index < 10; index += 1) {
        const t = (sim.clock * 0.47 + index / 10) % 1;
        particle(ctx, path, t, "#e6c885", 2.2);
      }
    }
  }

  _drawPackageBin(ctx, sim) {
    const box = this.layout.package;
    const fillRatio = clamp(sim.cache.kg / 300, 0, 1);
    roundedRect(ctx, box.x, box.y + 30, box.w, box.h - 30, 12);
    const shell = ctx.createLinearGradient(box.x, 0, box.x + box.w, 0);
    shell.addColorStop(0, "#18252f");
    shell.addColorStop(0.5, "#273a46");
    shell.addColorStop(1, "#13202a");
    ctx.fillStyle = shell;
    ctx.fill();
    ctx.strokeStyle = sim.success ? "rgba(125, 220, 157, 0.7)" : "rgba(151, 179, 194, 0.27)";
    ctx.lineWidth = 1.3;
    ctx.stroke();

    if (fillRatio > 0.005) {
      const bottom = box.y + box.h - 5;
      const top = Math.min(bottom - 2, box.y + 30 + (box.h - 30) * (1 - fillRatio));
      const fill = ctx.createLinearGradient(0, top, 0, box.y + box.h);
      fill.addColorStop(0, "rgba(230, 200, 133, 0.86)");
      fill.addColorStop(1, "rgba(151, 103, 59, 0.9)");
      ctx.save();
      roundedRect(ctx, box.x + 5, top, box.w - 10, bottom - top, 8);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    }

    label(ctx, "包装仓缓存", box.x + box.w / 2, box.y + 13, {
      size: 9,
      weight: 650,
      color: "#96a9b4",
      align: "center"
    });
    label(ctx, `${sim.cache.kg.toFixed(1)} kg`, box.x + box.w / 2, box.y + box.h / 2, {
      size: 18,
      weight: 750,
      color: "#f0ddb0",
      align: "center",
      mono: true
    });
    label(ctx, `${sim.cache.batches} 批入库`, box.x + box.w / 2, box.y + box.h / 2 + 21, {
      size: 8,
      color: "#7e919c",
      align: "center"
    });
    if (sim.success) {
      roundedRect(ctx, box.x + 13, box.y + box.h - 32, box.w - 26, 19, 6);
      ctx.fillStyle = "rgba(125, 220, 157, 0.16)";
      ctx.fill();
      label(ctx, "3 BATCH PASS", box.x + box.w / 2, box.y + box.h - 22, {
        size: 7,
        weight: 700,
        color: "#9cebb5",
        align: "center"
      });
    }
  }

  _drawFlowStatus(ctx, sim) {
    const cards = [
      {
        title: "螺旋送料",
        value: `${sim.screws.reduce((sum, screw) => sum + screw.flowKgS, 0).toFixed(2)} kg/s`,
        sub: sim.screws.map((screw) => `${screw.actual.toFixed(0)}%`).join(" / "),
        color: "#e8bb63"
      },
      {
        title: "称重门",
        value: sim.weigh.gateOpen ? "OPEN" : (sim.weigh.stable ? "CLOSED" : "OSCILLATING"),
        sub: `${sim.weigh.measuredKg.toFixed(2)} kg`,
        color: sim.weigh.stable ? "#57d5d1" : "#f29b58"
      },
      {
        title: "混合机",
        value: sim.mixer.on ? "RUNNING" : (sim.mixer.mixComplete ? "COMPLETE" : "STANDBY"),
        sub: `${sim.mixer.mixElapsed.toFixed(1)} / ${sim.settings.mixTime} s`,
        color: sim.mixer.on ? "#7ddc9d" : "#6e8490"
      },
      {
        title: "总线功率",
        value: `${sim.power.currentKw.toFixed(2)} kW`,
        sub: `峰 ${sim.power.peakKw.toFixed(2)} · ${sim.power.energyKwh.toFixed(4)} kWh`,
        color: "#72a8ff"
      }
    ];
    const startX = 42;
    const cardWidth = 252;
    cards.forEach((card, index) => {
      const x = startX + index * (cardWidth + 11);
      roundedRect(ctx, x, 520, cardWidth, 53, 8);
      ctx.fillStyle = "rgba(8, 14, 19, 0.66)";
      ctx.fill();
      ctx.strokeStyle = "rgba(151, 179, 194, 0.11)";
      ctx.stroke();
      ctx.fillStyle = card.color;
      ctx.fillRect(x, 520, 3, 53);
      label(ctx, card.title, x + 13, 535, {
        size: 8,
        weight: 600,
        color: "#738894"
      });
      label(ctx, card.value, x + 13, 552, {
        size: 13,
        weight: 700,
        color: card.color,
        mono: true
      });
      label(ctx, card.sub, x + cardWidth - 11, 552, {
        size: 8,
        color: "#7d909b",
        align: "right",
        mono: true
      });
    });

    if (sim.purgeInProgress) {
      roundedRect(ctx, 44, 590, 176, 18, 5);
      ctx.fillStyle = "rgba(242, 155, 88, 0.1)";
      ctx.fill();
      label(ctx, "清空阀动作中 · 换料余料清除", 132, 599, {
        size: 8,
        color: "#f3b477",
        align: "center"
      });
    }
  }

  _drawAlarm(ctx, sim) {
    if (sim.phase === "stopped") {
      const text = `设备停机 · ${sim.currentReason || "等待检查"} · 批次 #${sim.batchNo} 已保留`;
      const width = 410;
      roundedRect(ctx, (W - width) / 2, 48, width, 29, 7);
      ctx.fillStyle = "rgba(107, 33, 37, 0.87)";
      ctx.fill();
      ctx.strokeStyle = "rgba(240, 109, 109, 0.6)";
      ctx.stroke();
      label(ctx, text, W / 2, 63, {
        size: 10,
        weight: 700,
        color: "#ffc3c3",
        align: "center"
      });
      ctx.beginPath();
      ctx.arc(326, 62.5, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#f06d6d";
      ctx.fill();
    } else if (sim.success) {
      const width = 360;
      roundedRect(ctx, (W - width) / 2, 48, width, 29, 7);
      ctx.fillStyle = "rgba(37, 92, 57, 0.8)";
      ctx.fill();
      ctx.strokeStyle = "rgba(125, 220, 157, 0.55)";
      ctx.stroke();
      label(ctx, `生产成功 · 三批良品 · 峰值 ${sim.power.peakKw.toFixed(2)} kW`, W / 2, 63, {
        size: 10,
        weight: 700,
        color: "#b9f3ca",
        align: "center"
      });
    } else if (sim.purgeRequired) {
      const width = 330;
      roundedRect(ctx, (W - width) / 2, 48, width, 27, 7);
      ctx.fillStyle = "rgba(107, 72, 26, 0.78)";
      ctx.fill();
      ctx.strokeStyle = "rgba(242, 155, 88, 0.5)";
      ctx.stroke();
      label(ctx, "换配料联锁：请先点击“清空余料”", W / 2, 62, {
        size: 9,
        weight: 650,
        color: "#ffd098",
        align: "center"
      });
    }
  }
}
