import { CONFIG } from "./sim.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function rgba(hex, alpha) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export class WetlandScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.lastDraw = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(320, rect.width);
    this.height = Math.max(380, rect.height);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  draw(sim, now) {
    const ctx = this.context;
    const w = this.width;
    const h = this.height;
    const levelY = this.levelY(sim.level);
    ctx.clearRect(0, 0, w, h);
    this.drawSky(ctx, w, h, sim, now);
    this.drawTerrain(ctx, w, h, levelY);
    this.drawUpstream(ctx, w, h, levelY, sim, now);
    this.drawDownstream(ctx, w, h, levelY, sim, now);
    this.drawRoad(ctx, w, h, sim);
    this.drawLodges(ctx, w, h, sim);
    this.drawBirds(ctx, w, h, sim, now);
    this.drawDam(ctx, w, h, levelY, sim);
    this.drawStakes(ctx, w, h, sim);
    this.drawLevelGuides(ctx, w, h, sim, levelY);
    this.drawRain(ctx, w, h, sim, now);
    this.drawFlow(ctx, w, h, sim, now);
    this.drawLabels(ctx, w, h, sim);
  }

  levelY(level) {
    const top = this.height * 0.28;
    const bottom = this.height * 0.69;
    return top + ((5.08 - level) / (5.08 - 3.82)) * (bottom - top);
  }

  drawSky(ctx, w, h, sim, now) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    const storm = sim.storm;
    sky.addColorStop(0, storm > 0.3 ? "#132b2d" : "#13342f");
    sky.addColorStop(0.45, storm > 0.3 ? "#173432" : "#1b4036");
    sky.addColorStop(1, "#0b211b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.7, h * 0.04, 0, w * 0.7, h * 0.04, w * 0.42);
    glow.addColorStop(0, "rgba(219, 221, 158, 0.12)");
    glow.addColorStop(1, "rgba(219, 221, 158, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h * 0.55);

    ctx.fillStyle = "rgba(17, 46, 37, 0.82)";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.27);
    ctx.lineTo(w * 0.1, h * 0.17);
    ctx.lineTo(w * 0.24, h * 0.25);
    ctx.lineTo(w * 0.38, h * 0.15);
    ctx.lineTo(w * 0.55, h * 0.24);
    ctx.lineTo(w * 0.7, h * 0.13);
    ctx.lineTo(w * 0.82, h * 0.25);
    ctx.lineTo(w, h * 0.16);
    ctx.lineTo(w, h * 0.45);
    ctx.lineTo(0, h * 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(24, 58, 45, 0.76)";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.36);
    ctx.quadraticCurveTo(w * 0.19, h * 0.2, w * 0.36, h * 0.37);
    ctx.quadraticCurveTo(w * 0.54, h * 0.19, w * 0.72, h * 0.36);
    ctx.quadraticCurveTo(w * 0.87, h * 0.24, w, h * 0.35);
    ctx.lineTo(w, h * 0.49);
    ctx.lineTo(0, h * 0.49);
    ctx.closePath();
    ctx.fill();

    const count = 22;
    for (let index = 0; index < count; index += 1) {
      const x = (index / count) * w + 17;
      const treeHeight = 10 + ((index * 17) % 24);
      const y = h * 0.31 - treeHeight;
      ctx.fillStyle = "rgba(9, 31, 24, 0.62)";
      ctx.beginPath();
      ctx.moveTo(x - 8, y + treeHeight);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 8, y + treeHeight);
      ctx.fill();
    }

    const haze = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.47);
    haze.addColorStop(0, "rgba(95, 132, 107, 0)");
    haze.addColorStop(0.8, "rgba(95, 132, 107, 0.09)");
    haze.addColorStop(1, "rgba(95, 132, 107, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.2, w, h * 0.3);
    this.drawClouds(ctx, w, h, sim, now);
  }

  drawClouds(ctx, w, h, sim, now) {
    const opacity = 0.05 + sim.storm * 0.2;
    ctx.fillStyle = `rgba(205, 221, 198, ${opacity})`;
    for (let index = 0; index < 4; index += 1) {
      const x = ((now * (5 + index * 2) + index * w * 0.27) % (w + 220)) - 90;
      const y = h * (0.07 + index * 0.032);
      const scale = 0.7 + index * 0.15 + sim.storm * 0.2;
      ctx.beginPath();
      ctx.ellipse(x, y, 58 * scale, 13 * scale, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 38 * scale, y - 6 * scale, 34 * scale, 12 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawTerrain(ctx, w, h, levelY) {
    const leftBank = ctx.createLinearGradient(0, h * 0.4, 0, h);
    leftBank.addColorStop(0, "#2e4730");
    leftBank.addColorStop(1, "#14281d");
    ctx.fillStyle = leftBank;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.37);
    ctx.quadraticCurveTo(w * 0.12, h * 0.34, w * 0.27, h * 0.43);
    ctx.quadraticCurveTo(w * 0.35, h * 0.48, w * 0.39, h * 0.58);
    ctx.lineTo(w * 0.39, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#263d2a";
    ctx.beginPath();
    ctx.moveTo(w, h * 0.31);
    ctx.quadraticCurveTo(w * 0.84, h * 0.34, w * 0.71, h * 0.42);
    ctx.quadraticCurveTo(w * 0.59, h * 0.47, w * 0.53, h * 0.58);
    ctx.lineTo(w * 0.48, h);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(80, 109, 66, 0.36)";
    for (let index = 0; index < 35; index += 1) {
      const x = (index * 47 + 13) % w;
      const y = h * 0.44 + ((index * 31) % Math.max(40, levelY - h * 0.44));
      if (y > levelY - 4) continue;
      ctx.fillRect(x, y, 2, 6 + (index % 4) * 2);
    }
  }

  waterGradient(ctx, w, h, levelY, sim, downstream = false) {
    const gradient = ctx.createLinearGradient(0, levelY, 0, h);
    const murk = Math.min(0.46, sim.turbidity / 90);
    gradient.addColorStop(0, downstream ? "#3c786c" : "#3f7f75");
    gradient.addColorStop(0.45, downstream ? "#2e6255" : "#2b625a");
    gradient.addColorStop(1, `rgba(${45 + murk * 40}, ${74 + murk * 22}, ${61 + murk * 4}, 0.94)`);
    return gradient;
  }

  drawUpstream(ctx, w, h, levelY, sim, now) {
    const damX = w * 0.405;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, levelY);
    ctx.quadraticCurveTo(w * 0.2, levelY - 3, damX, levelY + 2);
    ctx.lineTo(damX, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = this.waterGradient(ctx, w, h, levelY, sim);
    ctx.fillRect(0, levelY - 5, damX, h - levelY + 5);
    this.drawSurfaceWaves(ctx, 0, damX, levelY, now, sim, 0.7);
    ctx.restore();

    ctx.strokeStyle = "rgba(167, 203, 163, 0.65)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, levelY);
    ctx.quadraticCurveTo(w * 0.2, levelY - 3, damX, levelY + 2);
    ctx.stroke();

    this.drawReeds(ctx, w * 0.08, levelY + 9, 13, 1);
    this.drawReeds(ctx, w * 0.31, levelY + 12, 10, 0.8);
  }

  drawDownstream(ctx, w, h, levelY, sim, now) {
    const startX = w * 0.405;
    const downstreamY = levelY + 15;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startX, downstreamY);
    ctx.bezierCurveTo(w * 0.56, downstreamY - 2, w * 0.74, downstreamY + 8, w, downstreamY + 2);
    ctx.lineTo(w, h);
    ctx.lineTo(startX, h);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = this.waterGradient(ctx, w, h, downstreamY, sim, true);
    ctx.fillRect(startX, downstreamY - 6, w - startX, h - downstreamY + 6);
    this.drawSurfaceWaves(ctx, startX, w, downstreamY, now, sim, 0.5);
    ctx.restore();

    ctx.strokeStyle = "rgba(151, 204, 174, 0.48)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX, downstreamY);
    ctx.bezierCurveTo(w * 0.56, downstreamY - 2, w * 0.74, downstreamY + 8, w, downstreamY + 2);
    ctx.stroke();

    this.drawIslands(ctx, w, h, sim);
    this.drawReeds(ctx, w * 0.47, downstreamY + 16, 9, 0.7);
    this.drawReeds(ctx, w * 0.91, downstreamY + 20, 11, 0.7);
  }

  drawSurfaceWaves(ctx, startX, endX, y, now, sim, scale) {
    const flow = clamp(sim.inflow / 16, 0.18, 1.2);
    ctx.lineWidth = 0.8;
    for (let row = 0; row < 7; row += 1) {
      const rowY = y + 11 + row * 14 * scale + row * row * 1.1;
      ctx.strokeStyle = `rgba(183, 218, 188, ${0.04 + (7 - row) * 0.012})`;
      ctx.beginPath();
      for (let x = startX - 20; x <= endX + 20; x += 7) {
        const wave = Math.sin(x * 0.034 + now * (1.1 + flow * 1.4) + row * 0.8) * (1.2 + row * 0.18);
        const drift = ((now * flow * 14 + row * 19) % 23);
        if (x < startX + drift - 5) continue;
        const px = x;
        const py = rowY + wave;
        if (x === startX - 20) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  drawReeds(ctx, x, y, count, scale) {
    ctx.save();
    ctx.strokeStyle = "rgba(118, 137, 79, 0.7)";
    ctx.lineWidth = 1;
    for (let index = 0; index < count; index += 1) {
      const offsetX = x + (index - count / 2) * 3.3;
      const height = (8 + ((index * 7) % 16)) * scale;
      const lean = Math.sin(index * 1.7) * 3;
      ctx.beginPath();
      ctx.moveTo(offsetX, y + 3);
      ctx.quadraticCurveTo(offsetX + lean, y - height * 0.6, offsetX + lean * 1.4, y - height);
      ctx.stroke();
      if (index % 3 === 0) {
        ctx.fillStyle = "rgba(126, 112, 65, 0.76)";
        ctx.fillRect(offsetX + lean * 1.4 - 1, y - height, 2.3, 6 * scale);
      }
    }
    ctx.restore();
  }

  drawIslands(ctx, w, h, sim) {
    for (const target of sim.targets.birds) {
      const x = target.x * w;
      const y = this.levelY(target.threshold) + 10;
      ctx.fillStyle = "rgba(32, 54, 34, 0.95)";
      ctx.beginPath();
      ctx.ellipse(x, y + 11, 31, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(84, 111, 65, 0.62)";
      ctx.beginPath();
      ctx.ellipse(x - 4, y + 9, 21, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawRoad(ctx, w, h, sim) {
    const startX = w * 0.51;
    const roadY = this.levelY(CONFIG.roadLevel) + 7;
    const flooded = sim.roadClearance < 0;
    ctx.save();
    ctx.globalAlpha = flooded ? 0.56 : 1;
    ctx.fillStyle = "#394440";
    ctx.beginPath();
    ctx.moveTo(startX, roadY);
    ctx.lineTo(w, roadY - h * 0.055);
    ctx.lineTo(w, roadY - h * 0.012);
    ctx.lineTo(startX, roadY + h * 0.04);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(222, 222, 184, 0.44)";
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 9]);
    ctx.beginPath();
    ctx.moveTo(startX, roadY + h * 0.013);
    ctx.lineTo(w, roadY - h * 0.036);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(219, 197, 132, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, roadY + h * 0.043);
    ctx.lineTo(w, roadY - h * 0.01);
    ctx.stroke();

    ctx.fillStyle = "#b4a26b";
    for (let index = 0; index < 5; index += 1) {
      const x = w * (0.59 + index * 0.093);
      const y = roadY - ((x - startX) / (w - startX)) * h * 0.055;
      ctx.fillRect(x, y + 2, 2, 10);
      ctx.fillRect(x - 1, y, 4, 2);
    }

    if (flooded) {
      const water = ctx.createLinearGradient(0, roadY - 6, 0, roadY + 18);
      water.addColorStop(0, "rgba(68, 117, 105, 0.38)");
      water.addColorStop(1, "rgba(39, 80, 68, 0.58)");
      ctx.fillStyle = water;
      ctx.beginPath();
      ctx.moveTo(startX, roadY - 4);
      ctx.lineTo(w, roadY - h * 0.059);
      ctx.lineTo(w, roadY + h * 0.015);
      ctx.lineTo(startX, roadY + h * 0.065);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    if (sim.roadClearance < 0.1) {
      ctx.fillStyle = "rgba(22, 20, 13, 0.72)";
      ctx.fillRect(w * 0.64, roadY - 14, 48, 15);
      ctx.strokeStyle = "rgba(239, 181, 93, 0.72)";
      ctx.strokeRect(w * 0.64 + 0.5, roadY - 13.5, 47, 14);
      ctx.fillStyle = "#efb55d";
      ctx.font = '8px "Noto Sans SC", monospace';
      ctx.textAlign = "center";
      ctx.fillText(flooded ? "道路中断" : "道路预警", w * 0.64 + 24, roadY - 4);
    }
  }

  drawLodges(ctx, w, h, sim) {
    for (const lodge of sim.targets.lodges) {
      const x = lodge.x * w;
      const y = this.levelY(lodge.minLevel) + 18;
      const height = 26 + lodge.x * 40;
      ctx.fillStyle = "rgba(40, 35, 24, 0.9)";
      ctx.beginPath();
      ctx.moveTo(x - 30, y);
      ctx.quadraticCurveTo(x - 16, y - height, x, y - height - 5);
      ctx.quadraticCurveTo(x + 21, y - height + 7, x + 31, y);
      ctx.quadraticCurveTo(x, y + 11, x - 30, y);
      ctx.fill();
      ctx.strokeStyle = "rgba(150, 128, 79, 0.36)";
      ctx.lineWidth = 1;
      for (let index = 0; index < 5; index += 1) {
        ctx.beginPath();
        ctx.moveTo(x - 22 + index * 10, y - 2);
        ctx.lineTo(x - 8 + index * 4, y - height + 6 + (index % 2) * 5);
        ctx.stroke();
      }
      this.drawTargetBadge(ctx, x, y - height - 13, lodge);
    }
  }

  drawBirds(ctx, w, h, sim, now) {
    for (const [index, target] of sim.targets.birds.entries()) {
      const x = target.x * w;
      const baseY = this.levelY(target.threshold) + 5;
      const bob = Math.sin(now * 1.8 + index) * 1.2;
      ctx.strokeStyle = "rgba(57, 47, 30, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, baseY + 14);
      ctx.lineTo(x, baseY - 10);
      ctx.stroke();
      ctx.strokeStyle = "rgba(57, 47, 30, 0.75)";
      ctx.beginPath();
      ctx.moveTo(x - 7, baseY - 3);
      ctx.lineTo(x, baseY - 9);
      ctx.lineTo(x + 7, baseY - 3);
      ctx.stroke();
      ctx.fillStyle = target.alive ? "#725a35" : "#574a3a";
      ctx.beginPath();
      ctx.ellipse(x, baseY - 11 + bob, 10, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(34, 28, 18, 0.72)";
      ctx.beginPath();
      ctx.ellipse(x, baseY - 14 + bob, 6.5, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      this.drawTargetBadge(ctx, x, baseY - 28, target, `N${index + 1}`);

      if (!target.safe && target.alive) {
        ctx.strokeStyle = "rgba(224, 106, 88, 0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, baseY - 11, 16 + Math.sin(now * 4) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawTargetBadge(ctx, x, y, target, label = "") {
    const safe = target.alive && target.safe;
    const color = target.alive ? (safe ? "#cbdc71" : "#e06a58") : "#718f7e";
    ctx.fillStyle = "rgba(6, 21, 17, 0.84)";
    ctx.strokeStyle = rgba(color, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '7px "Noto Sans SC", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label || (safe ? "✓" : "!"), x, y + 0.5);
    ctx.textBaseline = "alphabetic";
  }

  drawDam(ctx, w, h, levelY, sim) {
    const damX = w * 0.405;
    const damTop = this.levelY(4.78);
    const damBottom = h * 0.82;
    const damWidth = Math.max(28, w * 0.046);

    ctx.fillStyle = "rgba(38, 33, 23, 0.94)";
    ctx.beginPath();
    ctx.moveTo(damX - damWidth * 0.6, damBottom);
    ctx.quadraticCurveTo(damX - damWidth * 0.75, damTop + 18, damX - damWidth * 0.3, damTop);
    ctx.lineTo(damX + damWidth * 0.42, damTop + 5);
    ctx.quadraticCurveTo(damX + damWidth * 0.76, damTop + 24, damX + damWidth * 0.55, damBottom);
    ctx.closePath();
    ctx.fill();

    const rows = 10;
    for (let row = 0; row < rows; row += 1) {
      const y = damTop + 8 + row * ((damBottom - damTop - 14) / rows);
      const inset = Math.sin(row * 0.9) * 5;
      ctx.strokeStyle = row % 2 ? "rgba(126, 103, 62, 0.55)" : "rgba(95, 78, 49, 0.62)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(damX - damWidth * 0.43 + inset, y);
      ctx.lineTo(damX + damWidth * 0.38 + inset * 0.2, y + 3);
      ctx.stroke();
      ctx.strokeStyle = "rgba(54, 44, 27, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(damX - damWidth * 0.42 + inset, y - 2);
      ctx.lineTo(damX + damWidth * 0.37 + inset * 0.2, y + 1);
      ctx.stroke();
    }

    const gateTop = damTop + 14;
    const gateBottom = damBottom - 14;
    const gateHeight = gateBottom - gateTop;
    const opening = sim.controls.spillway;
    const mouthHeight = 9 + opening * gateHeight * 0.54;
    const mouthX = damX + damWidth * 0.02;
    const mouthW = Math.max(11, damWidth * 0.34);
    const mouthY = gateBottom - mouthHeight;
    const water = ctx.createLinearGradient(0, mouthY, 0, gateBottom);
    water.addColorStop(0, "rgba(96, 173, 158, 0.72)");
    water.addColorStop(1, "rgba(44, 112, 100, 0.9)");
    ctx.fillStyle = water;
    ctx.fillRect(mouthX, mouthY, mouthW, mouthHeight);
    ctx.fillStyle = "rgba(13, 31, 25, 0.9)";
    ctx.fillRect(mouthX - 2, mouthY - 6, mouthW + 4, 6);

    const plateTravel = 30 * (1 - opening);
    ctx.fillStyle = "#7f9584";
    ctx.fillRect(mouthX + 1, mouthY - 30 + plateTravel, mouthW - 2, 28);
    ctx.fillStyle = "rgba(215, 226, 193, 0.16)";
    for (let index = 0; index < 4; index += 1) {
      ctx.fillRect(mouthX + 3, mouthY - 27 + plateTravel + index * 6, mouthW - 6, 1);
    }
    ctx.fillStyle = "#c8d472";
    ctx.fillRect(mouthX + mouthW + 3, mouthY - 4, 2, mouthHeight + 8);

    if (sim.beaver.activity > 0.08) {
      ctx.strokeStyle = `rgba(161, 116, 65, ${0.35 + sim.beaver.activity * 0.45})`;
      ctx.lineWidth = 2;
      for (let index = 0; index < 9; index += 1) {
        const x = damX - damWidth * 0.42 + index * 6 + Math.sin(index) * 4;
        const y = damTop + 22 + (index % 4) * 13;
        ctx.beginPath();
        ctx.moveTo(x, y + 12);
        ctx.lineTo(x + 8, y);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(215, 174, 97, 0.7)";
      ctx.font = '7px "Noto Sans SC", monospace';
      ctx.textAlign = "center";
      ctx.fillText("河狸修补中", damX, damTop - 8);
    }

    ctx.fillStyle = "rgba(8, 25, 20, 0.86)";
    ctx.fillRect(damX + damWidth + 5, gateTop + 5, 48, 22);
    ctx.fillStyle = "#a9c38f";
    ctx.font = '8px "Noto Sans SC", monospace';
    ctx.textAlign = "center";
    ctx.fillText(`闸 ${Math.round(opening * 100)}%`, damX + damWidth + 29, gateTop + 19);
  }

  drawStakes(ctx, w, h, sim) {
    const count = Math.round(4 + sim.controls.stakes * 11);
    const startX = w * 0.47;
    const y = this.levelY(4.07) + 54;
    for (let index = 0; index < count; index += 1) {
      const x = startX + index * 4.7;
      const height = 16 + ((index * 7) % 12);
      ctx.fillStyle = "rgba(100, 79, 48, 0.9)";
      ctx.fillRect(x, y - height, 2.2, height + 4);
      ctx.fillStyle = "rgba(202, 180, 123, 0.58)";
      ctx.fillRect(x, y - height, 2.2, 1.5);
    }
  }

  drawLevelGuides(ctx, w, h, sim, levelY) {
    const lines = [
      { level: CONFIG.roadLevel, color: "rgba(239, 181, 93, 0.28)", label: `道路 ${CONFIG.roadLevel}` },
      { level: CONFIG.criticalLevel, color: "rgba(224, 106, 88, 0.28)", label: "巢穴 4.43" },
      { level: CONFIG.warningLevel, color: "rgba(239, 181, 93, 0.18)", label: "注意 4.30" }
    ];
    ctx.save();
    ctx.font = '7px "Noto Sans SC", monospace';
    ctx.textAlign = "right";
    for (const line of lines) {
      const y = this.levelY(line.level);
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(w * 0.43, y);
      ctx.lineTo(w - 8, y);
      ctx.stroke();
      ctx.fillStyle = line.color;
      ctx.fillText(line.label, w - 11, y - 3);
    }
    ctx.setLineDash([]);

    const observedY = this.levelY(sim.observed.level);
    ctx.strokeStyle = "rgba(123, 201, 187, 0.68)";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(w * 0.43, observedY + 8);
    ctx.lineTo(w * 0.95, observedY + 8);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(203, 220, 113, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.43, levelY);
    ctx.lineTo(w * 0.95, levelY);
    ctx.stroke();
    ctx.restore();
  }

  drawRain(ctx, w, h, sim, now) {
    if (sim.storm < 0.04) return;
    const drops = Math.round(18 + sim.storm * 58);
    ctx.save();
    ctx.strokeStyle = `rgba(160, 195, 193, ${0.1 + sim.storm * 0.2})`;
    ctx.lineWidth = 0.8;
    for (let index = 0; index < drops; index += 1) {
      const x = ((index * 67 + now * 110 * (0.7 + sim.storm)) % (w + 40)) - 20;
      const baseY = ((index * 137 + now * 240) % (h * 0.74));
      const length = 6 + (index % 5) * 2;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x - 4, baseY + length);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFlow(ctx, w, h, sim, now) {
    const speed = clamp(sim.inflow / 11, 0.4, 1.8);
    ctx.save();
    ctx.strokeStyle = "rgba(194, 224, 200, 0.28)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 9; index += 1) {
      const phase = (now * speed * 24 + index * 70) % (w * 0.65);
      const x = w * 0.35 + phase;
      const y = h * 0.78 + Math.sin(index * 2.1) * 18;
      if (x > w - 20) continue;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 8, y - 2, x + 19, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLabels(ctx, w, h, sim) {
    ctx.save();
    ctx.font = '8px "Noto Sans SC", monospace';
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(219, 232, 207, 0.72)";
    ctx.fillText("上游水位", w * 0.055, this.levelY(sim.level) - 8);
    ctx.fillText("东岸巡护路", w * 0.71, this.levelY(CONFIG.roadLevel) - 9);
    ctx.fillStyle = "rgba(219, 232, 207, 0.5)";
    ctx.fillText("浅水湿地", w * 0.48, h * 0.83);
    ctx.fillText("人工溢流口", w * 0.408, h * 0.87);
    ctx.restore();
  }
}
