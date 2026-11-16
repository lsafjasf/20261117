(function (global) {
  "use strict";

  const Canyon = global.Canyon;
  const S = Canyon.seed;
  const SAFE_DOCK_SPEED = 0.065;
  const STATION_RADIUS = 0.017;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.lastFrame = 0;
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (width === this.width && height === this.height && dpr === this.dpr) {
        return;
      }
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    cablePoint(position) {
      const t = S.clamp((position - 0.04) / 0.88, 0, 1);
      const sag = 4 * t * (1 - t);
      return {
        x: this.width * (0.04 + t * 0.88),
        y: this.height * (0.34 + sag * 0.205),
        t
      };
    }

    draw(game, timestamp) {
      this.resize();
      const ctx = this.ctx;
      const state = game.state;
      const level = game.level;
      const time = timestamp / 1000;
      this.lastFrame = time;
      ctx.clearRect(0, 0, this.width, this.height);
      this.drawSky(level, time);
      this.drawMoon(level, time);
      this.drawStars(level, time);
      this.drawFarCanyon(level);
      this.drawMist(level, time);
      this.drawCableStructures(level, state);
      this.drawWindStreams(state, time);
      this.drawStations(level, state, time);
      this.drawBasket(level, state, time);
      this.drawSceneHud(level, state);
      this.drawVignette();
    }

    drawSky(level, time) {
      const ctx = this.ctx;
      const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
      gradient.addColorStop(0, "#071c25");
      gradient.addColorStop(0.42, "#0b2328");
      gradient.addColorStop(0.72, "#0b2527");
      gradient.addColorStop(1, "#050f12");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);

      const haze = ctx.createRadialGradient(
        this.width * level.canyon.moonX,
        this.height * level.canyon.moonY,
        0,
        this.width * level.canyon.moonX,
        this.height * level.canyon.moonY,
        this.width * 0.48
      );
      haze.addColorStop(0, "rgba(194, 166, 96, 0.14)");
      haze.addColorStop(0.4, "rgba(80, 110, 98, 0.06)");
      haze.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, this.width, this.height * 0.8);

      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = "#9ab8ae";
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i += 1) {
        const y = this.height * (0.1 + i * 0.052);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.width, y + Math.sin(i) * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    drawStars(level, time) {
      const ctx = this.ctx;
      for (const star of level.canyon.stars) {
        const flicker = 0.7 + Math.sin(time * 0.7 + star.x * 40) * 0.3;
        ctx.globalAlpha = star.alpha * flicker;
        ctx.fillStyle = "#d9e8df";
        ctx.fillRect(
          star.x * this.width,
          star.y * this.height * 0.84,
          star.size,
          star.size
        );
      }
      ctx.globalAlpha = 1;
    }

    drawMoon(level, time) {
      const ctx = this.ctx;
      const x = level.canyon.moonX * this.width;
      const y = level.canyon.moonY * this.height;
      const radius = Math.max(45, Math.min(this.width, this.height) * 0.075);
      const glow = ctx.createRadialGradient(x, y, radius * 0.15, x, y, radius * 2.5);
      glow.addColorStop(0, "rgba(235, 205, 137, 0.32)");
      glow.addColorStop(0.38, "rgba(205, 172, 99, 0.1)");
      glow.addColorStop(1, "rgba(201, 166, 88, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2);
      ctx.fill();

      const body = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.25, 0, x, y, radius);
      body.addColorStop(0, "#e5d3a3");
      body.addColorStop(0.72, "#d6c28f");
      body.addColorStop(1, "#b7a574");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.13;
      ctx.fillStyle = "#756a4d";
      for (let i = 0; i < 5; i += 1) {
        const angle = i * 1.7;
        ctx.beginPath();
        ctx.arc(
          x + Math.cos(angle) * radius * 0.42,
          y + Math.sin(angle) * radius * 0.34,
          radius * (0.08 + (i % 3) * 0.035),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ridgePath(points, width, yBase, heightScale) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(0, this.height);
      for (const point of points) {
        ctx.lineTo(point.x * width, yBase * this.height + point.y * heightScale * this.height);
      }
      ctx.lineTo(width, this.height);
      ctx.closePath();
    }

    drawFarCanyon(level) {
      const ctx = this.ctx;
      const canyon = level.canyon;

      this.ridgePath(canyon.farRidge, this.width, 0.23, 0.55);
      ctx.fillStyle = "#102d32";
      ctx.fill();

      this.ridgePath(canyon.midRidge, this.width, 0.38, 0.48);
      const mid = ctx.createLinearGradient(0, this.height * 0.42, 0, this.height);
      mid.addColorStop(0, "#133237");
      mid.addColorStop(1, "#091b1f");
      ctx.fillStyle = mid;
      ctx.fill();

      const floor = ctx.createLinearGradient(0, this.height * 0.72, 0, this.height);
      floor.addColorStop(0, "rgba(39, 80, 76, 0.32)");
      floor.addColorStop(0.6, "rgba(8, 25, 27, 0.88)");
      floor.addColorStop(1, "#050f12");
      ctx.fillStyle = floor;
      ctx.fillRect(0, this.height * 0.65, this.width, this.height * 0.35);

      this.drawCliff(canyon.leftCliff, "left", "#08181c", "#0d2529");
      this.drawCliff(canyon.rightCliff, "right", "#071619", "#0c2226");
    }

    drawCliff(points, side, colorDark, colorLight) {
      const ctx = this.ctx;
      ctx.beginPath();
      if (side === "left") {
        ctx.moveTo(0, 0);
        ctx.lineTo(0, this.height);
        for (let i = points.length - 1; i >= 0; i -= 1) {
          const point = points[i];
          ctx.lineTo(
            (0.04 + point.x * 0.24) * this.width,
            (0.43 + point.y * 0.52) * this.height
          );
        }
      } else {
        ctx.moveTo(this.width, 0);
        ctx.lineTo(this.width, this.height);
        for (let i = points.length - 1; i >= 0; i -= 1) {
          const point = points[i];
          ctx.lineTo(
            (0.96 - point.x * 0.24) * this.width,
            (0.43 + point.y * 0.52) * this.height
          );
        }
      }
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, this.height * 0.3, 0, this.height);
      gradient.addColorStop(0, colorLight);
      gradient.addColorStop(1, colorDark);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = "rgba(115, 157, 149, 0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    drawMist(level, time) {
      const ctx = this.ctx;
      const base = this.height * level.canyon.haze;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 4; i += 1) {
        const drift = Math.sin(time * 0.08 + i * 1.8) * this.width * 0.08;
        const gradient = ctx.createLinearGradient(0, base + i * 26, this.width, base + i * 20);
        gradient.addColorStop(0, "rgba(75, 126, 116, 0)");
        gradient.addColorStop(0.45, `rgba(75, 126, 116, ${0.026 - i * 0.004})`);
        gradient.addColorStop(1, "rgba(75, 126, 116, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(drift - this.width * 0.15, base + i * 27, this.width * 1.3, 18);
      }
      ctx.restore();
    }

    drawCableStructures(level, state) {
      const ctx = this.ctx;
      const cableA = this.cablePoint(0.045);
      const cableB = this.cablePoint(0.915);
      const towerPositions = [0.18, 0.69];

      for (const position of towerPositions) {
        const top = this.cablePoint(position);
        const baseY = this.height * 0.83;
        const halfWidth = Math.max(22, this.width * 0.032);
        ctx.strokeStyle = "rgba(102, 144, 137, 0.42)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(top.x - 6, top.y);
        ctx.lineTo(top.x - halfWidth, baseY);
        ctx.moveTo(top.x + 6, top.y);
        ctx.lineTo(top.x + halfWidth, baseY);
        ctx.stroke();
        ctx.strokeStyle = "rgba(91, 130, 124, 0.22)";
        ctx.lineWidth = 0.7;
        for (let i = 1; i < 8; i += 1) {
          const fraction = i / 8;
          const y = S.lerp(top.y, baseY, fraction);
          const half = S.lerp(6, halfWidth, fraction);
          ctx.beginPath();
          ctx.moveTo(top.x - half, y);
          ctx.lineTo(top.x + half, y);
          if (i < 7) {
            const nextY = S.lerp(top.y, baseY, (i + 1) / 8);
            const nextHalf = S.lerp(6, halfWidth, (i + 1) / 8);
            ctx.moveTo(top.x - half, y);
            ctx.lineTo(top.x + nextHalf, nextY);
            ctx.moveTo(top.x + half, y);
            ctx.lineTo(top.x - nextHalf, nextY);
          }
          ctx.stroke();
        }
        ctx.fillStyle = "#0a1b1e";
        ctx.fillRect(top.x - 12, top.y - 5, 24, 10);
        ctx.strokeStyle = "#6f918b";
        ctx.strokeRect(top.x - 12, top.y - 5, 24, 10);
      }

      const drawCable = (offsetY, width, color) => {
        ctx.beginPath();
        for (let i = 0; i <= 100; i += 1) {
          const point = this.cablePoint(0.045 + (0.87 * i) / 100);
          if (i === 0) {
            ctx.moveTo(point.x, point.y + offsetY);
          } else {
            ctx.lineTo(point.x, point.y + offsetY);
          }
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      };
      drawCable(2.5, 3.2, "rgba(1, 8, 9, 0.78)");
      drawCable(0, 1.35, "rgba(178, 203, 193, 0.88)");
      drawCable(-2.1, 0.7, "rgba(90, 124, 118, 0.5)");

      ctx.strokeStyle = "rgba(205, 171, 90, 0.44)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cableA.x, cableA.y);
      ctx.lineTo(cableA.x - 26, cableA.y + 25);
      ctx.moveTo(cableB.x, cableB.y);
      ctx.lineTo(cableB.x + 26, cableB.y + 25);
      ctx.stroke();
    }

    drawWindStreams(state, time) {
      const ctx = this.ctx;
      const strength = Math.min(1.5, Math.abs(state.wind));
      if (strength < 0.08) {
        return;
      }
      const direction = state.wind >= 0 ? 1 : -1;
      ctx.save();
      ctx.strokeStyle = state.wind >= 0 ? "rgba(222, 177, 84, 0.2)" : "rgba(105, 180, 165, 0.18)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i += 1) {
        const seed = i * 1.73;
        const y = this.height * (0.16 + ((i * 0.077 + Math.sin(seed) * 0.04) % 0.58));
        const travel = S.mod(time * (18 + strength * 18) * direction + i * 67, this.width + 210) - 105;
        const length = 24 + strength * 36 + (i % 3) * 8;
        ctx.globalAlpha = 0.25 + strength * 0.16;
        ctx.beginPath();
        ctx.moveTo(travel, y);
        ctx.quadraticCurveTo(travel + direction * length * 0.6, y - 3, travel + direction * length, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawStations(level, state, time) {
      const ctx = this.ctx;
      const stations = level.stations;
      for (let index = 0; index < stations.length; index += 1) {
        const station = stations[index];
        const point = this.cablePoint(station.x);
        const isHome = index === 0;
        const completed = index > 0 && state.completed[index - 1];
        const current = !isHome && state.targetIndex === index - 1;
        const failed = state.failure && state.failure.targetId === station.id;
        const color = failed
          ? "#e46d5b"
          : completed
            ? "#61b9a8"
            : current
              ? "#e2ac4b"
              : "#6d8581";

        if (isHome) {
          ctx.fillStyle = "#0a191b";
          ctx.strokeStyle = "#5f7d78";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
          ctx.strokeStyle = state.targetIndex >= 3 ? "#61b9a8" : "#b99a5d";
          ctx.stroke();
          this.drawStationLabel(station, point, "归站", color, current, false);
          continue;
        }

        if (current) {
          const pulse = 17 + Math.sin(time * 3.2) * 3.5;
          ctx.strokeStyle = "rgba(226, 172, 75, 0.24)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(point.x, point.y, pulse + 10, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(3, 12, 13, 0.9)";
        ctx.strokeStyle = color;
        ctx.lineWidth = current || failed ? 1.8 : 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.stroke();
        for (let spoke = 0; spoke < 3; spoke += 1) {
          const angle = time * 0.25 + state.tick * 0.001 + (spoke * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.moveTo(point.x + Math.cos(angle) * 2, point.y + Math.sin(angle) * 2);
          ctx.lineTo(point.x + Math.cos(angle) * 6.5, point.y + Math.sin(angle) * 6.5);
          ctx.stroke();
        }
        const obstacle = level.obstacleOrder[index - 1];
        this.drawStationLabel(
          station,
          point,
          `${station.task} · ${obstacle.code}`,
          color,
          current,
          completed
        );

        ctx.fillStyle = "rgba(5, 17, 18, 0.78)";
        ctx.fillRect(point.x - 7, point.y + 18, 14, 30);
        ctx.strokeStyle = "rgba(112, 144, 137, 0.25)";
        ctx.strokeRect(point.x - 7, point.y + 18, 14, 30);
      }
    }

    drawStationLabel(station, point, detail, color, current, completed) {
      const ctx = this.ctx;
      const width = current ? 128 : 110;
      const height = 43;
      const x = S.clamp(point.x - width / 2, 8, this.width - width - 8);
      const y = Math.max(66, point.y - 86);
      ctx.fillStyle = current ? "rgba(12, 28, 28, 0.94)" : "rgba(5, 16, 18, 0.86)";
      ctx.strokeStyle = current ? color : "rgba(71, 102, 98, 0.58)";
      ctx.lineWidth = current ? 1.5 : 0.8;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = color;
      ctx.font = "600 9px 'Canyon Sans SC', 'DejaVu Sans Mono', sans-serif";
      ctx.fillText(`${station.id} · ${completed ? "DONE" : current ? "TARGET" : "STANDBY"}`, x + 10, y + 14);
      ctx.fillStyle = current ? "#f1d08c" : "#b9c7c2";
      ctx.font = "500 10px 'Canyon Sans SC', sans-serif";
      ctx.fillText(detail, x + 10, y + 30);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(point.x, y + height);
      ctx.lineTo(point.x, point.y - 15);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawBasket(level, state, time) {
      const ctx = this.ctx;
      const point = this.cablePoint(state.position);
      const ropeLength = Math.max(104, Math.min(150, this.height * 0.17));
      const angle = (state.angle * Math.PI) / 180;
      const failure = state.failure;
      const recovering = state.mode === "recovering";

      ctx.fillStyle = "#061416";
      ctx.strokeStyle = "#98aaa4";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(point.x - 24, point.y - 8, 48, 16, 3);
      ctx.fill();
      ctx.stroke();
      for (let wheel = -1; wheel <= 1; wheel += 2) {
        ctx.beginPath();
        ctx.arc(point.x + wheel * 14, point.y - 1, 6.2, 0, Math.PI * 2);
        ctx.strokeStyle = "#9ba9a4";
        ctx.stroke();
        ctx.fillStyle = "#152f31";
        ctx.fill();
      }

      ctx.save();
      ctx.translate(point.x, point.y + 5);
      ctx.rotate(angle);

      if (failure && failure.code === "overspeed") {
        const spark = 0.5 + Math.sin(time * 17) * 0.5;
        ctx.save();
        ctx.globalAlpha = 0.35 + spark * 0.4;
        ctx.strokeStyle = "#ff8f63";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i += 1) {
          const ray = (i / 8) * Math.PI * 2 + time * 0.5;
          const inner = 28 + spark * 5;
          const outer = 45 + spark * 10;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ray) * inner, ropeLength + Math.sin(ray) * inner);
          ctx.lineTo(Math.cos(ray) * outer, ropeLength + Math.sin(ray) * outer);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (recovering) {
        ctx.strokeStyle = "rgba(97, 185, 168, 0.55)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.quadraticCurveTo(18, ropeLength * 0.55, 0, ropeLength - 34);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = "rgba(195, 209, 201, 0.82)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-18, 2);
      ctx.lineTo(-35, ropeLength - 27);
      ctx.moveTo(18, 2);
      ctx.lineTo(35, ropeLength - 27);
      ctx.stroke();

      const bodyY = ropeLength - 24;
      ctx.fillStyle = "#121d1c";
      ctx.fillRect(-29, bodyY - 46, 58, 46);
      ctx.strokeStyle = "#887036";
      ctx.lineWidth = 1;
      ctx.strokeRect(-29, bodyY - 46, 58, 46);

      const cage = ctx.createLinearGradient(-29, 0, 29, 0);
      cage.addColorStop(0, "#141f1d");
      cage.addColorStop(0.5, "#26332e");
      cage.addColorStop(1, "#121d1c");
      ctx.fillStyle = cage;
      ctx.fillRect(-24, bodyY - 39, 48, 24);
      ctx.strokeStyle = "rgba(139, 171, 160, 0.38)";
      ctx.strokeRect(-24, bodyY - 39, 48, 24);
      for (let bar = -16; bar <= 16; bar += 8) {
        ctx.beginPath();
        ctx.moveTo(bar, bodyY - 39);
        ctx.lineTo(bar, bodyY - 15);
        ctx.stroke();
      }

      ctx.fillStyle = "#cf9d3d";
      ctx.fillRect(-31, bodyY - 9, 62, 7);
      ctx.fillStyle = "#0b1110";
      for (let stripe = -30; stripe < 30; stripe += 12) {
        ctx.beginPath();
        ctx.moveTo(stripe, bodyY - 9);
        ctx.lineTo(stripe + 6, bodyY - 9);
        ctx.lineTo(stripe + 9, bodyY - 2);
        ctx.lineTo(stripe + 3, bodyY - 2);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = "#c99b44";
      ctx.fillRect(-33, bodyY + 4, 14, 10);
      ctx.fillRect(19, bodyY + 4, 14, 10);
      ctx.strokeStyle = "#5a4b28";
      ctx.strokeRect(-33, bodyY + 4, 14, 10);
      ctx.strokeRect(19, bodyY + 4, 14, 10);

      ctx.fillStyle = "#d6a949";
      ctx.fillRect(-10, bodyY + 3, 20, 8);
      ctx.fillStyle = "#17160f";
      ctx.font = "500 5px 'DejaVu Sans Mono', monospace";
      ctx.fillText(`${state.load.toFixed(0)} kg`, -8, bodyY + 9);

      const lightBlink = Math.sin(time * 2.6) > 0.25;
      ctx.fillStyle = lightBlink ? "#f1c366" : "#473b1f";
      ctx.beginPath();
      ctx.arc(24, bodyY - 42, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "rgba(4, 14, 15, 0.78)";
      ctx.fillRect(point.x + 43, point.y + ropeLength * 0.55, 104, 31);
      ctx.strokeStyle = "rgba(92, 125, 119, 0.4)";
      ctx.strokeRect(point.x + 43, point.y + ropeLength * 0.55, 104, 31);
      ctx.fillStyle = state.failure ? "#dc7a69" : "#c7d4cf";
      ctx.font = "500 8px 'Canyon Sans SC', 'DejaVu Sans Mono', sans-serif";
      ctx.fillText(failure ? "INCIDENT · HOLD" : "WORK BASKET · 07", point.x + 52, point.y + ropeLength * 0.55 + 12);
      ctx.fillStyle = "#809590";
      ctx.fillText(`${state.load.toFixed(1)} kg / ${Math.abs(state.speed * 10).toFixed(2)} m/s`, point.x + 52, point.y + ropeLength * 0.55 + 23);
    }

    drawSceneHud(level, state) {
      const ctx = this.ctx;
      const target = state.targetIndex < 3 ? level.stations[state.targetIndex + 1] : level.stations[0];
      const targetPoint = this.cablePoint(target.x);
      const distance = Math.abs(target.x - state.position);
      const nearDock = distance < STATION_RADIUS + 0.035;

      if (state.targetIndex < 3 || state.completed.every(Boolean)) {
        const size = Math.max(29, Math.min(42, this.width * 0.042));
        const angularError = Math.abs(state.angle);
        const safe = Math.abs(state.speed) <= SAFE_DOCK_SPEED && angularError <= target.tolerance;
        ctx.save();
        ctx.translate(targetPoint.x, targetPoint.y);
        ctx.strokeStyle = nearDock
          ? safe
            ? "rgba(97, 185, 168, 0.72)"
            : "rgba(220, 165, 65, 0.72)"
          : "rgba(176, 187, 180, 0.18)";
        ctx.lineWidth = nearDock ? 1.5 : 0.8;
        ctx.setLineDash(nearDock ? [4, 4] : [2, 7]);
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (nearDock) {
          ctx.fillStyle = "rgba(4, 14, 15, 0.82)";
          ctx.fillRect(-62, -size - 26, 124, 20);
          ctx.fillStyle = safe ? "#8cd5c7" : "#e2b15a";
          ctx.font = "500 8px 'Canyon Sans SC', 'DejaVu Sans Mono', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            `进站 ${(Math.abs(state.speed) * 10).toFixed(2)} / 摆角 ${Math.abs(state.angle).toFixed(1)}°`,
            0,
            -size - 13
          );
          ctx.textAlign = "left";
        }
        ctx.restore();
      }

      if (state.windInfo && state.windInfo.activeSource) {
        const label = {
          GUST: "阵风窗 · 横风突增",
          VIBE: "抖索段 · 吊篮摆动",
          FOG: "雾带 · 能见度下降"
        }[state.windInfo.activeSource] || "障碍区";
        const pulse = 0.55 + Math.sin(performance.now() / 240) * 0.2;
        ctx.fillStyle = `rgba(105, 44, 33, ${0.28 + pulse * 0.16})`;
        ctx.fillRect(this.width * 0.5 - 88, 18, 176, 23);
        ctx.strokeStyle = "rgba(222, 118, 92, 0.55)";
        ctx.strokeRect(this.width * 0.5 - 88, 18, 176, 23);
        ctx.fillStyle = "#e8b0a3";
        ctx.textAlign = "center";
        ctx.font = "500 8px 'Canyon Sans SC', 'DejaVu Sans Mono', sans-serif";
        ctx.fillText(`WARNING · ${label}`, this.width * 0.5, 33);
        ctx.textAlign = "left";
      }
    }

    drawVignette() {
      const ctx = this.ctx;
      const gradient = ctx.createRadialGradient(
        this.width * 0.5,
        this.height * 0.48,
        Math.min(this.width, this.height) * 0.18,
        this.width * 0.5,
        this.height * 0.48,
        Math.max(this.width, this.height) * 0.72
      );
      gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      gradient.addColorStop(0.67, "rgba(0, 5, 6, 0.12)");
      gradient.addColorStop(1, "rgba(0, 4, 5, 0.7)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.globalAlpha = 0.035;
      ctx.fillStyle = "#b9d9cd";
      for (let y = 0; y < this.height; y += 4) {
        ctx.fillRect(0, y, this.width, 0.5);
      }
      ctx.globalAlpha = 1;
    }
  }

  Canyon.Renderer = Renderer;
})(window);
