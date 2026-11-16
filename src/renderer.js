import { QUALITY_LIMITS, currentBatch } from "./simulation.js";

const TAU = Math.PI * 2;

function hash(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class WashRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(1120 * this.dpr);
    this.canvas.height = Math.round(660 * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(sim) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, 1120, 660);
    const time = sim.clock;
    const batch = currentBatch(sim);
    const running = sim.status === "running";
    const powered = running || sim.status === "paused";
    this.drawBackdrop(ctx, time, sim);
    this.drawPipework(ctx, sim);
    this.drawTank(ctx, sim, time, powered);
    this.drawBasket(ctx, sim, time, batch, powered);
    this.drawParts(ctx, sim, time, batch);
    this.drawFluid(ctx, sim, time, powered);
    this.drawProcessEffects(ctx, sim, time, powered);
    this.drawGaugePanel(ctx, sim, time);
    if (sim.status === "fault") this.drawFault(ctx, sim);
  }

  drawBackdrop(ctx, time, sim) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 660);
    gradient.addColorStop(0, "#0b2426");
    gradient.addColorStop(0.62, "#08191b");
    gradient.addColorStop(1, "#040e0f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1120, 660);

    const glow = ctx.createRadialGradient(510, 80, 10, 510, 80, 540);
    glow.addColorStop(0, "rgba(112, 213, 195, 0.14)");
    glow.addColorStop(1, "rgba(112, 213, 195, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1120, 540);

    ctx.strokeStyle = "rgba(117, 185, 178, 0.055)";
    ctx.lineWidth = 1;
    for (let x = 25; x < 1120; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 570);
      ctx.stroke();
    }
    for (let y = 30; y < 570; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1120, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(2, 8, 9, 0.58)";
    ctx.fillRect(0, 520, 1120, 140);
    ctx.strokeStyle = "rgba(126, 227, 202, 0.12)";
    ctx.beginPath();
    ctx.moveTo(0, 520);
    ctx.lineTo(1120, 520);
    ctx.stroke();

    ctx.fillStyle = "rgba(171, 216, 208, 0.35)";
    ctx.font = "10px monospace";
    ctx.fillText("ULTRASONIC CELL / A-03", 34, 545);
    ctx.fillText(`T+${time.toFixed(1)}s`, 34, 562);
    ctx.fillStyle = "rgba(126, 227, 202, 0.2)";
    ctx.fillText("DRAIN ─────  PROCESS WATER LOOP ─────  FILTER", 760, 548);
  }

  drawPipework(ctx, sim) {
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(80, 123, 119, 0.28)";
    ctx.beginPath();
    ctx.moveTo(92, 212);
    ctx.lineTo(128, 212);
    ctx.lineTo(128, 465);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(930, 436);
    ctx.lineTo(1000, 436);
    ctx.lineTo(1000, 510);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = sim.activeEquipment.includes("pump")
      ? "rgba(126, 227, 202, 0.55)"
      : "rgba(92, 130, 126, 0.22)";
    ctx.beginPath();
    ctx.moveTo(100, 212);
    ctx.lineTo(128, 212);
    ctx.lineTo(128, 455);
    ctx.stroke();
    this.drawPump(ctx, 100, 468, sim.activeEquipment.includes("pump"), sim.clock);
  }

  drawPump(ctx, x, y, active, time) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#122b2c";
    ctx.strokeStyle = active ? "#68c9b8" : "#2d4a48";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (active) {
      ctx.rotate(time * 3.4);
      ctx.strokeStyle = "rgba(126, 227, 202, 0.72)";
      for (let i = 0; i < 3; i += 1) {
        ctx.rotate(TAU / 3);
        ctx.beginPath();
        ctx.moveTo(4, -2);
        ctx.lineTo(18, -2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawTank(ctx, sim, time, powered) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = "#102427";
    ctx.beginPath();
    ctx.roundRect(145, 148, 742, 386, 30);
    ctx.fill();
    ctx.restore();

    const steel = ctx.createLinearGradient(145, 0, 887, 0);
    steel.addColorStop(0, "#264345");
    steel.addColorStop(0.12, "#5c7775");
    steel.addColorStop(0.5, "#2b4b4c");
    steel.addColorStop(0.9, "#566d6b");
    steel.addColorStop(1, "#1e3537");
    ctx.strokeStyle = steel;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.roundRect(145, 148, 742, 386, 30);
    ctx.stroke();

    ctx.strokeStyle = "rgba(190, 230, 220, 0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(157, 160, 718, 352, 22);
    ctx.stroke();

    ctx.fillStyle = "#061315";
    ctx.beginPath();
    ctx.roundRect(175, 186, 682, 310, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(126, 227, 202, 0.09)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(7, 24, 25, 0.8)";
    ctx.fillRect(178, 183, 676, 18);
    ctx.fillStyle = "rgba(202, 232, 224, 0.62)";
    ctx.font = "600 10px monospace";
    ctx.fillText("SEALED WASH CHAMBER", 198, 196);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(176, 201, 680, 292, 10);
    ctx.clip();
    const liquid = ctx.createLinearGradient(0, 306, 0, 500);
    liquid.addColorStop(0, "rgba(74, 184, 175, 0.23)");
    liquid.addColorStop(1, "rgba(15, 91, 90, 0.48)");
    ctx.fillStyle = liquid;
    ctx.fillRect(176, 306, 680, 220);
    ctx.restore();

    this.drawTransducers(ctx, sim, time, powered);
    this.drawValve(ctx, 838, 330, sim.activeEquipment.includes("heater"), time);
  }

  drawTransducers(ctx, sim, time, powered) {
    const active = sim.activeEquipment.includes("ultrasonic");
    for (let i = 0; i < 9; i += 1) {
      const x = 226 + i * 70;
      ctx.fillStyle = active ? "#5bc9b7" : "#273f3f";
      ctx.shadowColor = active ? "rgba(91, 201, 183, 0.55)" : "transparent";
      ctx.shadowBlur = active ? 11 : 0;
      ctx.beginPath();
      ctx.roundRect(x, 492, 34, 8, 3);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (active && powered) {
      ctx.strokeStyle = "rgba(103, 224, 204, 0.18)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 18; i += 1) {
        const x = 205 + hash(i) * 620;
        const phase = (time * 75 + i * 37) % 210;
        ctx.beginPath();
        ctx.arc(x, 498, 12 + phase * 0.16, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }
  }

  drawValve(ctx, x, y, active, time) {
    ctx.fillStyle = "#1b3233";
    ctx.strokeStyle = active ? "rgba(244, 184, 96, 0.55)" : "rgba(117, 158, 153, 0.24)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 15, y - 38, 30, 76, 6);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = active ? "#d39a55" : "#4a6562";
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x, y - 18);
    ctx.stroke();
    if (active) {
      ctx.fillStyle = "rgba(244, 184, 96, 0.84)";
      ctx.font = "8px monospace";
      ctx.fillText("HEAT", x - 12, y + 52);
    }
  }

  drawBasket(ctx, sim, time, batch, powered) {
    const basketActive = sim.activeEquipment.includes("basket");
    const left = 220;
    const right = 812;
    const top = 248;
    const bottom = 478;
    const phase = basketActive && powered ? (time * sim.parameters.rpm * 0.004) % 46 : 0;

    ctx.strokeStyle = basketActive
      ? "rgba(147, 211, 200, 0.42)"
      : "rgba(115, 147, 143, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, bottom - top, 16);
    ctx.stroke();
    ctx.strokeStyle = "rgba(126, 227, 202, 0.11)";
    ctx.lineWidth = 1;
    for (let x = left + 15; x < right; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, top + 5);
      ctx.lineTo(x, bottom - 5);
      ctx.stroke();
    }
    for (let y = top + 20; y < bottom; y += 24) {
      ctx.beginPath();
      ctx.moveTo(left + 5, y);
      ctx.lineTo(right - 5, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(185, 225, 216, 0.48)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(left + 6, top);
    ctx.lineTo(left + 6, bottom);
    ctx.moveTo(right - 6, top);
    ctx.lineTo(right - 6, bottom);
    ctx.stroke();

    ctx.strokeStyle = "rgba(165, 209, 200, 0.31)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i += 1) {
      const x = left + 48 + i * 250 + phase;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(170, 211, 203, 0.36)";
    ctx.font = "9px monospace";
    ctx.fillText(`BASKET ${sim.parameters.rpm} RPM`, left + 8, top - 9);
    ctx.fillText(batch.id, right - 39, top - 9);
  }

  drawParts(ctx, sim, time, batch) {
    const positions = [348, 506, 664];
    positions.forEach((x, index) => {
      const bounce = sim.activeEquipment.includes("basket")
        ? Math.sin(time * 2.2 + index * 1.7) * 2.5
        : 0;
      this.drawPart(
        ctx,
        x,
        367 + bounce,
        0.82,
        sim.batchIndex,
        sim,
        index
      );
    });
  }

  drawPart(ctx, x, y, scale, batchIndex, sim, seed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    const steel = ctx.createLinearGradient(-45, -45, 45, 45);
    steel.addColorStop(0, "#a8bbb5");
    steel.addColorStop(0.32, "#607b78");
    steel.addColorStop(0.55, "#c2d0ca");
    steel.addColorStop(1, "#455b59");
    ctx.fillStyle = steel;
    ctx.strokeStyle = "rgba(224, 241, 235, 0.45)";
    ctx.lineWidth = 1.4;

    if (batchIndex === 0) {
      ctx.beginPath();
      for (let i = 0; i < 24; i += 1) {
        const angle = (i / 24) * TAU;
        const radius = i % 2 ? 44 : 52;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#263b3b";
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#8ea6a0";
      ctx.stroke();
    } else if (batchIndex === 1) {
      ctx.beginPath();
      ctx.roundRect(-58, -23, 116, 46, 18);
      ctx.fill();
      ctx.stroke();
      for (const ringX of [-40, -18, 18, 40]) {
        ctx.strokeStyle = "rgba(41, 62, 60, 0.75)";
        ctx.beginPath();
        ctx.ellipse(ringX, 0, 5, 22, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = "#233837";
      ctx.beginPath();
      ctx.ellipse(-58, 0, 7, 15, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(-44, -37, 88, 74, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#2b4342";
      ctx.fillRect(-63, -10, 20, 20);
      ctx.fillRect(43, -10, 20, 20);
      ctx.strokeStyle = "rgba(208, 231, 224, 0.55)";
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "#819994";
      for (const [bx, by] of [[-31, -24], [31, -24], [-31, 24], [31, 24]]) {
        ctx.beginPath();
        ctx.arc(bx, by, 3.2, 0, TAU);
        ctx.fill();
      }
    }

    this.drawPartContamination(ctx, sim, seed);
    ctx.restore();
  }

  drawPartContamination(ctx, sim, seed) {
    const batch = currentBatch(sim);
    const residueRatio = clamp(sim.quality.residue / batch.oilLoad, 0, 1);
    if (residueRatio > 0.015) {
      for (let i = 0; i < 15; i += 1) {
        const n = seed * 31 + i;
        const x = (hash(n) - 0.5) * 84;
        const y = (hash(n + 91) - 0.5) * 64;
        const radius = 4 + hash(n + 17) * 12;
        ctx.fillStyle = `rgba(48, 31, 15, ${0.18 + residueRatio * 0.55})`;
        ctx.beginPath();
        ctx.ellipse(x, y, radius, radius * (0.35 + hash(n + 5) * 0.55), hash(n) * TAU, 0, TAU);
        ctx.fill();
      }
    }

    const corrosion = clamp(sim.quality.corrosion / QUALITY_LIMITS.corrosion, 0, 1.3);
    if (corrosion > 0.06) {
      for (let i = 0; i < 16; i += 1) {
        const n = seed * 23 + i * 7;
        const x = (hash(n) - 0.5) * 76;
        const y = (hash(n + 43) - 0.5) * 58;
        ctx.fillStyle = `rgba(211, 121, 58, ${0.18 + corrosion * 0.6})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + hash(n + 3) * 3.4, 0, TAU);
        ctx.fill();
      }
    }

    const rust = clamp(sim.quality.rust / QUALITY_LIMITS.rust, 0, 1.3);
    if (rust > 0.06) {
      for (let i = 0; i < 12; i += 1) {
        const n = seed * 41 + i * 13;
        const x = (hash(n) - 0.5) * 70;
        const y = (hash(n + 67) - 0.5) * 54;
        ctx.fillStyle = `rgba(157, 62, 37, ${0.22 + rust * 0.55})`;
        ctx.fillRect(x, y, 2 + hash(n + 2) * 6, 1.5 + hash(n + 4) * 3);
      }
    }
  }

  drawFluid(ctx, sim, time, powered) {
    if (sim.stage === "idle") return;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(176, 201, 680, 292, 10);
    ctx.clip();

    const waveY = 307;
    const wave = ctx.createLinearGradient(0, waveY, 0, 500);
    wave.addColorStop(0, "rgba(84, 195, 183, 0.11)");
    wave.addColorStop(1, "rgba(20, 99, 95, 0.22)");
    ctx.fillStyle = wave;
    ctx.beginPath();
    ctx.moveTo(176, waveY);
    for (let x = 176; x <= 856; x += 8) {
      const y = waveY + Math.sin(x * 0.025 + time * 1.6) * 3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(856, 500);
    ctx.lineTo(176, 500);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(153, 237, 220, 0.33)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = 176; x <= 856; x += 6) {
      const y = waveY + Math.sin(x * 0.025 + time * 1.6) * 3;
      if (x === 176) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (sim.stage === "ultrasonic" && sim.status !== "fault") {
      for (let i = 0; i < 54; i += 1) {
        const speed = 14 + hash(i + 2) * 32;
        const range = 165;
        const y = 480 - ((time * speed + hash(i + 11) * range) % range);
        const x = 195 + hash(i) * 650 + Math.sin(time * 2 + i) * 3;
        const radius = 1 + hash(i + 5) * 3.4;
        ctx.strokeStyle = `rgba(171, 244, 228, ${0.12 + hash(i + 8) * 0.36})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TAU);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(126, 227, 202, 0.17)";
      for (let i = 0; i < 8; i += 1) {
        const x = 235 + i * 81;
        const h = 38 + Math.sin(time * 5 + i) * 18;
        ctx.beginPath();
        ctx.moveTo(x, 490);
        ctx.quadraticCurveTo(x + Math.sin(time + i) * 9, 490 - h * 0.6, x, 490 - h);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawProcessEffects(ctx, sim, time, powered) {
    if (!powered) return;
    if (sim.stage === "rinse") {
      ctx.save();
      ctx.strokeStyle = "rgba(112, 218, 234, 0.52)";
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 8]);
      ctx.lineDashOffset = -time * 42;
      for (let i = 0; i < 7; i += 1) {
        const x = 265 + i * 86;
        ctx.beginPath();
        ctx.moveTo(x, 216);
        ctx.bezierCurveTo(x + 8, 248, x - 8, 276, x + 2, 318);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(137, 226, 237, 0.18)";
      for (let i = 0; i < 22; i += 1) {
        const x = 240 + hash(i) * 600;
        const y = 220 + ((time * 110 + hash(i + 5) * 220) % 240);
        ctx.beginPath();
        ctx.arc(x, y, 1 + hash(i + 3) * 2, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    if (sim.stage === "drying") {
      ctx.save();
      ctx.strokeStyle = "rgba(244, 184, 96, 0.28)";
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 14; i += 1) {
        const x = 250 + hash(i) * 570;
        const y = 222 + ((time * 26 + hash(i + 9) * 160) % 160);
        ctx.beginPath();
        ctx.arc(x, y, 11 + hash(i + 12) * 17, -0.4, 1.9);
        ctx.stroke();
      }
      const heat = ctx.createRadialGradient(500, 490, 10, 500, 490, 260);
      heat.addColorStop(0, "rgba(244, 171, 83, 0.14)");
      heat.addColorStop(1, "rgba(244, 171, 83, 0)");
      ctx.fillStyle = heat;
      ctx.fillRect(200, 300, 600, 220);
      ctx.fillStyle = "rgba(244, 200, 132, 0.75)";
      ctx.font = "9px monospace";
      ctx.fillText(`HOT AIR / WET ${sim.quality.wetness.toFixed(1)}%`, 630, 238);
      ctx.restore();
    }
  }

  drawGaugePanel(ctx, sim, time) {
    const x = 908;
    const y = 172;
    const w = 172;
    const h = 338;
    ctx.save();
    ctx.fillStyle = "rgba(4, 16, 17, 0.77)";
    ctx.strokeStyle = "rgba(126, 227, 202, 0.17)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 13);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(126, 227, 202, 0.56)";
    ctx.font = "700 9px monospace";
    ctx.fillText("PROCESS METER", x + 14, y + 23);
    ctx.fillStyle = "rgba(161, 202, 194, 0.31)";
    ctx.fillRect(x + 14, y + 32, w - 28, 1);

    this.drawLinearGauge(
      ctx,
      x + 14,
      y + 50,
      w - 28,
      "TEMP",
      `${sim.parameters.temp.toFixed(0)}°C`,
      (sim.parameters.temp - 20) / 60,
      "#f4b860"
    );
    this.drawLinearGauge(
      ctx,
      x + 14,
      y + 105,
      w - 28,
      "RPM",
      `${sim.parameters.rpm}`,
      sim.parameters.rpm / 1700,
      "#7ee3ca"
    );
    this.drawLinearGauge(
      ctx,
      x + 14,
      y + 160,
      w - 28,
      "POWER",
      `${sim.energy.currentKw.toFixed(2)}kW`,
      sim.energy.currentKw / 4,
      "#76a9ff"
    );

    ctx.fillStyle = "rgba(161, 202, 194, 0.31)";
    ctx.fillRect(x + 14, y + 219, w - 28, 1);
    ctx.fillStyle = "rgba(126, 227, 202, 0.46)";
    ctx.font = "700 8px monospace";
    ctx.fillText("STAGE BUS", x + 14, y + 238);
    const stages = [
      ["超声", "ultrasonic"],
      ["漂洗", "rinse"],
      ["烘干", "drying"],
      ["检查", "inspection"]
    ];
    stages.forEach(([label, stage], index) => {
      const active = sim.stage === stage;
      const dotY = y + 258 + index * 18;
      ctx.fillStyle = active
        ? sim.status === "fault" ? "#f06b62" : "#7ee3ca"
        : "rgba(105, 141, 137, 0.22)";
      ctx.beginPath();
      ctx.arc(x + 17, dotY - 3, 2.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = active ? "rgba(226, 243, 238, 0.85)" : "rgba(122, 158, 153, 0.4)";
      ctx.font = "9px sans-serif";
      ctx.fillText(label, x + 27, dotY);
    });

    const pulse = 0.62 + Math.sin(time * 3.2) * 0.22;
    ctx.fillStyle = sim.status === "fault"
      ? `rgba(240, 107, 98, ${pulse})`
      : sim.status === "running"
        ? `rgba(126, 227, 202, ${pulse})`
        : "rgba(116, 153, 148, 0.28)";
    ctx.beginPath();
    ctx.arc(x + w - 18, y + 18, 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawLinearGauge(ctx, x, y, width, label, value, ratio, color) {
    ctx.fillStyle = "rgba(126, 227, 202, 0.38)";
    ctx.font = "8px monospace";
    ctx.fillText(label, x, y);
    ctx.fillStyle = "rgba(229, 243, 238, 0.86)";
    ctx.font = "600 15px monospace";
    ctx.fillText(value, x, y + 20);
    ctx.fillStyle = "rgba(100, 136, 132, 0.16)";
    ctx.fillRect(x, y + 28, width, 3);
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 28, width * clamp(ratio, 0, 1), 3);
  }

  drawFault(ctx, sim) {
    ctx.save();
    const flash = 0.08 + (Math.sin(sim.clock * 7) + 1) * 0.025;
    ctx.fillStyle = `rgba(207, 48, 40, ${flash})`;
    ctx.fillRect(0, 0, 1120, 660);
    ctx.strokeStyle = "rgba(240, 107, 98, 0.55)";
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 1104, 644);
    const scanY = (sim.clock * 42) % 660;
    const scan = ctx.createLinearGradient(0, scanY - 30, 0, scanY + 30);
    scan.addColorStop(0, "rgba(240, 107, 98, 0)");
    scan.addColorStop(0.5, "rgba(240, 107, 98, 0.12)");
    scan.addColorStop(1, "rgba(240, 107, 98, 0)");
    ctx.fillStyle = scan;
    ctx.fillRect(0, scanY - 30, 1120, 60);

    ctx.fillStyle = "rgba(34, 8, 7, 0.93)";
    ctx.strokeStyle = "rgba(240, 107, 98, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(353, 270, 414, 120, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffb1aa";
    ctx.font = "700 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SAFETY INTERLOCK", 560, 301);
    ctx.fillStyle = "#fff0ed";
    ctx.font = "600 16px sans-serif";
    ctx.fillText(sim.fault?.message ?? "设备联锁停机", 560, 332);
    ctx.fillStyle = "rgba(255, 189, 182, 0.76)";
    ctx.font = "10px monospace";
    ctx.fillText(`${sim.fault?.code ?? "FAULT"} · ${sim.fault?.clock ?? "0.00s"}`, 560, 357);
    ctx.fillText(`${sim.fault?.location ?? ""}`, 560, 375);
    ctx.textAlign = "start";
    ctx.restore();
  }
}
