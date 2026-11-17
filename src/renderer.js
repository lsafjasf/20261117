import { GAME_CONFIG, TARGETS, clamp, lerp } from "./game-engine.js";

const WIDTH = 960;
const HEIGHT = 620;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

function hash(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.time = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== WIDTH * ratio || this.canvas.height !== HEIGHT * ratio) {
      this.canvas.width = WIDTH * ratio;
      this.canvas.height = HEIGHT * ratio;
    }
    this.ratio = ratio;
  }

  draw(state, options = {}) {
    const ctx = this.ctx;
    const snapshot = options.snapshot;
    const camera = snapshot ? snapshot.camera : state.camera;
    const turbidity = snapshot ? snapshot.turbidity : state.turbidity;
    const lamp = snapshot ? snapshot.lamp : state.lamp;
    const targetIndex = snapshot ? snapshot.targetIndex : state.targetIndex;
    const fish = snapshot ? snapshot.fish : state.fish;
    const time = options.time ?? this.time;
    const phase = snapshot ? snapshot.phase : state.phase;

    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    this.drawWater(ctx, turbidity, time);
    this.drawRays(ctx, time, turbidity);
    this.drawParticles(ctx, camera, turbidity, time);
    this.drawSeabed(ctx, camera, time);
    this.drawTargets(ctx, camera, targetIndex, turbidity, time);
    this.drawFish(ctx, camera, fish, targetIndex, time);
    this.drawBeam(ctx, lamp, time);
    this.drawBubbles(ctx, camera, time);
    this.drawViewfinder(ctx, targetIndex, state);
    this.drawVignette(ctx, turbidity, phase);
    if (!snapshot && state.shotFlash > 0) this.drawShotFlash(ctx, state.shotFlash);
  }

  drawWater(ctx, turbidity, time) {
    const murk = clamp(turbidity / 100, 0, 1);
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, `rgb(${8 + murk * 18}, ${57 + murk * 9}, ${67 + murk * 5})`);
    gradient.addColorStop(0.45, `rgb(${7 + murk * 17}, ${37 + murk * 4}, ${49 + murk * 3})`);
    gradient.addColorStop(1, `rgb(${3 + murk * 13}, ${17 + murk * 4}, ${23 + murk * 2})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const glow = ctx.createRadialGradient(WIDTH * 0.48, -80, 20, WIDTH * 0.48, 20, 560);
    glow.addColorStop(0, `rgba(134, 255, 232, ${0.12 - murk * 0.05})`);
    glow.addColorStop(0.42, "rgba(49, 163, 170, 0.04)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    ctx.globalAlpha = 0.07 + Math.sin(time * 0.6) * 0.015;
    ctx.strokeStyle = "#8ef4e2";
    ctx.lineWidth = 1;
    for (let band = 0; band < 6; band += 1) {
      const y = 50 + band * 96 + Math.sin(time * 0.35 + band) * 13;
      ctx.beginPath();
      for (let x = -20; x <= WIDTH + 20; x += 24) {
        const wave = Math.sin(x * 0.018 + time * 0.7 + band) * 10;
        if (x === -20) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRays(ctx, time, turbidity) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const alpha = 0.06 * (1 - turbidity / 150);
    for (let index = 0; index < 4; index += 1) {
      const origin = 120 + index * 230 + Math.sin(time * 0.2 + index) * 24;
      const width = 120 + index * 24;
      const gradient = ctx.createLinearGradient(origin, 0, origin + 160, HEIGHT);
      gradient.addColorStop(0, `rgba(150, 255, 237, ${alpha + 0.025})`);
      gradient.addColorStop(1, "rgba(69, 186, 181, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(origin - 18, 0);
      ctx.lineTo(origin + 18, 0);
      ctx.lineTo(origin + width + 130, HEIGHT);
      ctx.lineTo(origin + width - 40, HEIGHT);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawParticles(ctx, camera, turbidity, time) {
    const density = 42 + Math.floor(turbidity * 1.7);
    ctx.save();
    for (let index = 0; index < density; index += 1) {
      const seedX = hash(index * 3.1) * (WIDTH + 120);
      const seedY = hash(index * 5.7) * (HEIGHT + 100);
      const drift = (time * (3 + hash(index) * 7) + camera.x * 0.16) % (WIDTH + 120);
      const y = (seedY - camera.y * 0.11 + Math.sin(time * 0.2 + index) * 15) % (HEIGHT + 100);
      const x = (seedX - drift + WIDTH + 120) % (WIDTH + 120);
      const size = 0.45 + hash(index * 9.3) * (1.7 + turbidity * 0.015);
      ctx.globalAlpha = 0.1 + hash(index * 11.2) * 0.35;
      ctx.fillStyle = index % 7 === 0 ? "#e0ce9f" : "#b5ede2";
      ctx.beginPath();
      ctx.arc(x, y < 0 ? y + HEIGHT : y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawSeabed(ctx, camera, time) {
    ctx.save();
    const parallaxX = -camera.x * 0.34;
    ctx.translate(parallaxX % 180, -camera.y * 0.1);
    const ridge = ctx.createLinearGradient(0, 460, 0, HEIGHT);
    ridge.addColorStop(0, "#0a3131");
    ridge.addColorStop(1, "#031718");
    ctx.fillStyle = ridge;
    ctx.beginPath();
    ctx.moveTo(-220, HEIGHT);
    ctx.lineTo(-220, 548);
    for (let x = -220; x < WIDTH + 360; x += 70) {
      ctx.lineTo(x, 548 + Math.sin(x * 0.012) * 24 + Math.sin(x * 0.03) * 8);
    }
    ctx.lineTo(WIDTH + 360, HEIGHT);
    ctx.closePath();
    ctx.fill();

    for (let index = 0; index < 13; index += 1) {
      const x = -100 + index * 105 + hash(index) * 40;
      const height = 48 + hash(index + 7) * 105;
      const sway = Math.sin(time * 0.55 + index) * 6;
      ctx.strokeStyle = `rgba(${20 + index * 2}, ${101 + index * 4}, ${91 + index * 3}, ${0.16 + hash(index) * 0.18})`;
      ctx.lineWidth = 2 + hash(index + 3) * 4;
      ctx.beginPath();
      ctx.moveTo(x, 570);
      ctx.bezierCurveTo(x - 20, 570 - height * 0.4, x + sway, 570 - height * 0.7, x + sway, 570 - height);
      ctx.stroke();
    }
    ctx.restore();
  }

  worldToScreen(camera, x, y) {
    return { x: CENTER_X + x - camera.x, y: CENTER_Y + y - camera.y };
  }

  drawTargets(ctx, camera, activeIndex, turbidity, time) {
    TARGETS.forEach((target, index) => {
      const point = this.worldToScreen(camera, target.x, target.y);
      const isActive = index === activeIndex;
      const isDone = index < activeIndex;
      if (point.x < -180 || point.x > WIDTH + 180 || point.y < -150 || point.y > HEIGHT + 150) {
        if (isActive) this.drawOffscreenGuide(ctx, point, target, time);
        return;
      }

      ctx.save();
      ctx.translate(point.x, point.y);
      if (isActive) {
        const pulse = 1 + Math.sin(time * 2.4) * 0.08;
        ctx.strokeStyle = `${target.accent}55`;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 9]);
        ctx.beginPath();
        ctx.arc(0, 0, 62 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = isDone ? 0.3 : 0.84;
      this.drawReef(ctx, target, index, time, isActive);
      ctx.globalAlpha = 1;

      if (isActive) {
        ctx.fillStyle = "rgba(2, 18, 22, 0.82)";
        roundRect(ctx, -64, 78, 128, 42, 7);
        ctx.fill();
        ctx.strokeStyle = `${target.accent}55`;
        ctx.stroke();
        ctx.fillStyle = target.accent;
        ctx.font = '600 8px "Noto Sans SC Local", "SFMono-Regular", monospace';
        ctx.textAlign = "center";
        ctx.fillText(`目标 ${index + 1} / ${target.short}`, 0, 94);
        ctx.fillStyle = "#8bb5b1";
        ctx.font = '500 7px "Noto Sans SC Local", "SFMono-Regular", monospace';
        ctx.fillText(
          `${target.minDistance}–${target.maxDistance} 距离 · ${target.fishRequired}+ 鱼`,
          0,
          108,
        );
      } else if (isDone) {
        ctx.fillStyle = "rgba(99, 228, 207, 0.8)";
        ctx.font = '700 9px "Noto Sans SC Local", "SFMono-Regular", monospace';
        ctx.textAlign = "center";
        ctx.fillText("✓ 已记录", 0, 80);
      }
      ctx.restore();
    });
  }

  drawOffscreenGuide(ctx, point, target, time) {
    const margin = 38;
    const angle = Math.atan2(point.y - CENTER_Y, point.x - CENTER_X);
    const radiusX = WIDTH / 2 - margin;
    const radiusY = HEIGHT / 2 - margin;
    const scale = Math.min(
      Math.abs(radiusX / Math.cos(angle)),
      Math.abs(radiusY / Math.sin(angle)),
    );
    const x = CENTER_X + Math.cos(angle) * scale;
    const y = CENTER_Y + Math.sin(angle) * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const pulse = 0.6 + Math.sin(time * 3) * 0.2;
    ctx.fillStyle = `rgba(99, 228, 207, ${pulse})`;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-angle);
    ctx.fillStyle = "rgba(2, 18, 22, 0.82)";
    roundRect(ctx, -47, 14, 94, 18, 5);
    ctx.fill();
    ctx.fillStyle = target.accent;
    ctx.font = '600 7px "Noto Sans SC Local", "SFMono-Regular", monospace';
    ctx.textAlign = "center";
    ctx.fillText(`${target.short} · 目标 ${TARGETS.indexOf(target) + 1}`, 0, 26);
    ctx.restore();
  }

  drawReef(ctx, target, index, time, active) {
    const accent = target.accent;
    ctx.strokeStyle = "rgba(4, 17, 20, 0.6)";
    ctx.lineWidth = 2;
    if (index === 1) {
      ctx.fillStyle = "#243d3b";
      ctx.beginPath();
      ctx.moveTo(-82, 66);
      ctx.lineTo(-50, 12);
      ctx.lineTo(-18, 28);
      ctx.lineTo(8, -16);
      ctx.lineTo(34, 24);
      ctx.lineTo(86, 66);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = active ? `${accent}66` : "rgba(100, 146, 139, 0.28)";
      ctx.strokeRect(-34, 20, 24, 25);
      ctx.beginPath();
      ctx.moveTo(-22, 20);
      ctx.lineTo(4, 36);
      ctx.lineTo(-22, 45);
      ctx.stroke();
    } else if (index === 2) {
      const halo = ctx.createRadialGradient(0, 0, 12, 0, 0, 88);
      halo.addColorStop(0, "rgba(0, 11, 16, 0.92)");
      halo.addColorStop(0.58, "rgba(12, 68, 77, 0.64)");
      halo.addColorStop(0.78, "rgba(64, 134, 147, 0.24)");
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(81, 168, 179, 0.22)";
      ctx.beginPath();
      ctx.arc(0, 0, 54 + Math.sin(time) * 3, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#183d3b";
      ctx.beginPath();
      ctx.moveTo(-88, 60);
      ctx.bezierCurveTo(-70, 20, -54, 34, -42, -4);
      ctx.bezierCurveTo(-24, 26, -8, 4, 8, 22);
      ctx.bezierCurveTo(30, 0, 42, 34, 72, 16);
      ctx.lineTo(88, 60);
      ctx.closePath();
      ctx.fill();
      for (let branch = 0; branch < 6; branch += 1) {
        const x = -64 + branch * 25;
        const height = 21 + hash(branch) * 28;
        ctx.strokeStyle = active ? `${accent}55` : "rgba(70, 145, 128, 0.24)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 32);
        ctx.lineTo(x + Math.sin(time + branch) * 5, 32 - height);
        ctx.stroke();
      }
    }
  }

  drawFish(ctx, camera, fish, activeIndex, time) {
    const colors = ["#58c8bb", "#8dc8bb", "#d5b56d"];
    fish.forEach((entry, index) => {
      const isSnapshot = Array.isArray(entry);
      const fishX = isSnapshot ? entry[0] : entry.x;
      const fishY = isSnapshot ? entry[1] : entry.y;
      const group = isSnapshot ? entry[2] : entry.group;
      const fear = isSnapshot ? entry[3] : entry.fear;
      const size = isSnapshot ? entry[4] : entry.size;
      const tint = isSnapshot ? entry[5] : entry.tint;
      const vx = isSnapshot ? Math.sin(time * 2 + index) : entry.vx;
      const vy = isSnapshot ? Math.cos(time * 2 + index) : entry.vy;
      const point = this.worldToScreen(camera, fishX, fishY);
      if (point.x < -35 || point.x > WIDTH + 35 || point.y < -30 || point.y > HEIGHT + 30) return;
      const dim = group === activeIndex ? 1 : 0.4;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(Math.atan2(vy, vx || 1));
      ctx.globalAlpha = (0.58 + (1 - fear) * 0.34) * dim;
      ctx.fillStyle = fear > 0.5 ? "#e6b96c" : colors[tint];
      ctx.beginPath();
      ctx.ellipse(0, 0, size, size * 0.43, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-size * 0.86, 0);
      ctx.lineTo(-size * 1.7, -size * 0.42);
      ctx.lineTo(-size * 1.55, size * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha *= 0.8;
      ctx.fillStyle = "#03171a";
      ctx.beginPath();
      ctx.arc(size * 0.5, -size * 0.08, Math.max(0.8, size * 0.09), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  drawBeam(ctx, lamp, time) {
    if (!lamp || lamp.intensity <= 0.015) return;
    const strength = clamp(lamp.intensity, 0, 1);
    const spread = lerp(0.14, 0.3, strength);
    const length = lerp(280, 520, strength);
    ctx.save();
    ctx.translate(CENTER_X, CENTER_Y);
    ctx.rotate(lamp.aim);
    ctx.globalCompositeOperation = "screen";
    const gradient = ctx.createLinearGradient(0, 0, length, 0);
    gradient.addColorStop(0, `rgba(255, 235, 178, ${0.22 * strength})`);
    gradient.addColorStop(0.42, `rgba(255, 218, 139, ${0.1 * strength})`);
    gradient.addColorStop(1, "rgba(255, 205, 120, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(length, Math.tan(spread) * length);
    ctx.lineTo(length, -Math.tan(spread) * length);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.35 + Math.sin(time * 8) * 0.025;
    ctx.strokeStyle = `rgba(255, 232, 177, ${0.3 * strength})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(length * 0.95, Math.tan(spread) * length * 0.95);
    ctx.moveTo(8, 0);
    ctx.lineTo(length * 0.95, -Math.tan(spread) * length * 0.95);
    ctx.stroke();
    ctx.restore();
  }

  drawBubbles(ctx, camera, time) {
    ctx.save();
    for (let index = 0; index < 9; index += 1) {
      const baseX = 80 + hash(index * 2.4) * 800;
      const x = baseX - camera.x * 0.07;
      const y = (HEIGHT - ((time * (18 + hash(index) * 16) + index * 65) % 680));
      const size = 1.2 + hash(index + 8) * 3.4;
      ctx.strokeStyle = "rgba(178, 246, 233, 0.22)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(x + Math.sin(time + index) * 4, y, size, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawViewfinder(ctx, activeIndex, state) {
    const target = TARGETS[activeIndex];
    if (!target) return;
    const camera = state.camera || { x: 0, y: 0 };
    const point = this.worldToScreen(camera, target.x, target.y);
    const frame = GAME_CONFIG.frame;
    const inside = point.x >= frame.left && point.x <= frame.right
      && point.y >= frame.top && point.y <= frame.bottom;
    if (inside) {
      ctx.save();
      ctx.strokeStyle = `${target.accent}55`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 41, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = target.accent;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const { left, top, right, bottom } = frame;
    ctx.save();
    ctx.strokeStyle = "rgba(166, 239, 227, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, CENTER_Y);
    ctx.lineTo(right, CENTER_Y);
    ctx.moveTo(CENTER_X, top);
    ctx.lineTo(CENTER_X, bottom);
    ctx.stroke();
    ctx.restore();
  }

  drawVignette(ctx, turbidity, phase) {
    const murk = clamp(turbidity / 100, 0, 1);
    const vignette = ctx.createRadialGradient(
      CENTER_X,
      CENTER_Y,
      150,
      CENTER_X,
      CENTER_Y,
      570,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.68, `rgba(0, 9, 12, ${0.15 + murk * 0.15})`);
    vignette.addColorStop(1, `rgba(0, 6, 9, ${0.55 + murk * 0.24})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (phase === "protected" || phase === "failed") {
      ctx.fillStyle = "rgba(49, 10, 7, 0.12)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  drawShotFlash(ctx, amount) {
    if (amount <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(255, 248, 218, ${amount * 0.22})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }
}
