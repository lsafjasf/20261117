(function () {
  "use strict";

  const GROUP_PALETTES = [
    ["#d4775b", "#bd5b43", "#e08c6d", "#c46148"],
    ["#d0a653", "#b98b3d", "#dfbd70", "#c69a49"],
    ["#628c80", "#466f64", "#7ba196", "#547c70"],
    ["#657b94", "#50647b", "#7c91a9", "#596e84"]
  ];
  const GROUP_BASE = ["#c9674c", "#c59a4a", "#547f76", "#5a6e88"];
  const GROUP_NAMES = ["A 地综", "B 花综", "C 纹综", "D 边综"];

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hash(index) {
    const value = Math.sin(index * 91.73 + 7.13) * 43758.5453;
    return value - Math.floor(value);
  }

  function countActive(steps) {
    return steps.reduce((count, active) => count + (active ? 1 : 0), 0);
  }

  function dyeFor(groupIndex, warpOffset, step) {
    const palette = GROUP_PALETTES[groupIndex];
    return palette[(warpOffset + step + groupIndex) % palette.length];
  }

  class LoomRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.state = {
        tracks: [],
        activeStep: -1,
        wovenRows: 0,
        playing: false,
        completed: false,
        bpm: 92,
        monitor: "main"
      };
      this.width = 900;
      this.height = 560;
      this.dpr = 1;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.frame = null;
      this.startedAt = performance.now();
      this.running = false;
      this._loop = this._loop.bind(this);
      this._resize = this._resize.bind(this);
      window.addEventListener("resize", this._resize);
      if (window.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(this._resize);
        this.resizeObserver.observe(canvas.parentElement);
      }
      this._resize();
      this.start();
    }

    setState(nextState) {
      this.state = Object.assign({}, this.state, nextState);
    }

    _resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (
        this.canvas.width === Math.round(width * dpr) &&
        this.canvas.height === Math.round(height * dpr)
      ) return;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = width + "px";
      this.canvas.style.height = height + "px";
      this.viewWidth = width;
      this.viewHeight = height;
      this.scale = Math.min(width / this.width, height / this.height);
      this.offsetX = (width - this.width * this.scale) / 2;
      this.offsetY = (height - this.height * this.scale) / 2;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.startedAt = performance.now();
      this.frame = requestAnimationFrame(this._loop);
    }

    stop() {
      this.running = false;
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = null;
    }

    _loop(now) {
      if (!this.running) return;
      this.draw(now);
      this.frame = requestAnimationFrame(this._loop);
    }

    _setWorld(context) {
      context.setTransform(
        this.dpr * this.scale, 0, 0, this.dpr * this.scale,
        this.dpr * this.offsetX, this.dpr * this.offsetY
      );
    }

    draw(now) {
      const context = this.context;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this._setWorld(context);
      this.drawLoom(context, now);
    }

    getGeometry() {
      return {
        frame: { x: 51, y: 25, width: 798, height: 508, radius: 31 },
        cloth: { x: 151, y: 86, width: 568, height: 392 },
        warpStart: 171,
        warpSpacing: 32.9,
        rowStart: 99,
        rowHeight: 43.2,
        rowGap: 5
      };
    }

    drawLoom(context, now) {
      const geometry = this.getGeometry();
      const frame = geometry.frame;
      const cloth = geometry.cloth;
      context.save();
      context.globalAlpha = 1;
      context.fillStyle = "rgba(0, 0, 0, .22)";
      context.filter = "blur(24px)";
      roundedRect(context, frame.x + 13, frame.y + 21, frame.width, frame.height, frame.radius);
      context.fill();
      context.restore();

      this.drawWarpOutsideCloth(context, geometry);
      this.drawFrame(context, frame);
      this.drawCloth(context, geometry, now);
      this.drawHeddles(context, geometry, now);
      this.drawTreadles(context, geometry);
      this.drawShuttle(context, geometry, now);
      this.drawFrameDetails(context, geometry);
    }

    drawWarpOutsideCloth(context, geometry) {
      const { warpStart, warpSpacing, cloth } = geometry;
      const state = this.state;
      const activeGroups = new Set();
      if (state.activeStep >= 0) {
        state.tracks.forEach((track, index) => {
          if (track.steps[state.activeStep]) activeGroups.add(index);
        });
      }
      for (let warp = 0; warp < 16; warp += 1) {
        const groupIndex = Math.floor(warp / 4);
        const x = warpStart + warp * warpSpacing;
        const color = GROUP_BASE[groupIndex];
        context.save();
        context.lineWidth = activeGroups.has(groupIndex) ? 1.8 : 1;
        context.strokeStyle = activeGroups.has(groupIndex)
          ? color
          : "rgba(224, 211, 184, .28)";
        if (activeGroups.has(groupIndex)) {
          context.shadowColor = color;
          context.shadowBlur = 4;
        }
        context.beginPath();
        context.moveTo(x, 54);
        context.lineTo(x, cloth.y + 3);
        context.stroke();
        context.beginPath();
        context.moveTo(x, cloth.y + cloth.height - 3);
        context.lineTo(x, 494);
        context.stroke();
        context.restore();
      }
    }

    drawFrame(context, frame) {
      context.save();
      const wood = context.createLinearGradient(frame.x, frame.y, frame.x, frame.y + frame.height);
      wood.addColorStop(0, "#9f8058");
      wood.addColorStop(0.18, "#765d3f");
      wood.addColorStop(0.55, "#5a4732");
      wood.addColorStop(1, "#3e3225");
      roundedRect(context, frame.x, frame.y, frame.width, frame.height, frame.radius);
      context.fillStyle = wood;
      context.fill();
      context.strokeStyle = "rgba(229, 203, 157, .42)";
      context.lineWidth = 1;
      context.stroke();

      context.strokeStyle = "rgba(34, 28, 20, .55)";
      context.lineWidth = 7;
      roundedRect(context, frame.x + 10, frame.y + 10, frame.width - 20, frame.height - 20, frame.radius - 5);
      context.stroke();

      const innerGlow = context.createLinearGradient(frame.x, frame.y, frame.x + frame.width, frame.y + frame.height);
      innerGlow.addColorStop(0, "rgba(255, 230, 180, .12)");
      innerGlow.addColorStop(0.5, "rgba(255, 255, 255, 0)");
      innerGlow.addColorStop(1, "rgba(0, 0, 0, .24)");
      roundedRect(context, frame.x + 12, frame.y + 12, frame.width - 24, frame.height - 24, frame.radius - 6);
      context.fillStyle = innerGlow;
      context.fill();

      const topBeam = context.createLinearGradient(0, 30, 0, 58);
      topBeam.addColorStop(0, "#b59869");
      topBeam.addColorStop(0.45, "#806543");
      topBeam.addColorStop(1, "#53412e");
      roundedRect(context, 71, 28, 758, 24, 8);
      context.fillStyle = topBeam;
      context.fill();

      const bottomBeam = context.createLinearGradient(0, 487, 0, 511);
      bottomBeam.addColorStop(0, "#ad8b5d");
      bottomBeam.addColorStop(0.55, "#735b3e");
      bottomBeam.addColorStop(1, "#4c3c2b");
      roundedRect(context, 71, 486, 758, 23, 7);
      context.fillStyle = bottomBeam;
      context.fill();

      context.strokeStyle = "rgba(255, 229, 181, .28)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(84, 33);
      context.lineTo(805, 33);
      context.moveTo(84, 490);
      context.lineTo(805, 490);
      context.stroke();
      context.restore();
    }

    drawCloth(context, geometry, now) {
      const { cloth, warpStart, warpSpacing, rowStart, rowHeight } = geometry;
      const state = this.state;
      const tracks = state.tracks.length === 4 ? state.tracks : [
        { steps: Array(8).fill(false) },
        { steps: Array(8).fill(false) },
        { steps: Array(8).fill(false) },
        { steps: Array(8).fill(false) }
      ];
      const woven = clamp(state.wovenRows, 0, 8);

      context.save();
      context.shadowColor = "rgba(0, 0, 0, .42)";
      context.shadowBlur = 17;
      context.shadowOffsetY = 8;
      roundedRect(context, cloth.x, cloth.y, cloth.width, cloth.height, 5);
      context.fillStyle = "#6b6559";
      context.fill();
      context.restore();

      context.save();
      roundedRect(context, cloth.x, cloth.y, cloth.width, cloth.height, 4);
      context.clip();

      const ground = context.createLinearGradient(0, cloth.y, 0, cloth.y + cloth.height);
      ground.addColorStop(0, "#9f9787");
      ground.addColorStop(0.45, "#8c8475");
      ground.addColorStop(1, "#706959");
      context.fillStyle = ground;
      context.fillRect(cloth.x, cloth.y, cloth.width, cloth.height);

      for (let warp = 0; warp < 16; warp += 1) {
        const x = warpStart + warp * warpSpacing;
        const group = Math.floor(warp / 4);
        context.strokeStyle = "rgba(225, 215, 193, .18)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, cloth.y + 4);
        context.lineTo(x, cloth.y + cloth.height - 4);
        context.stroke();
        context.strokeStyle = GROUP_BASE[group] + "33";
        context.beginPath();
        context.moveTo(x + 1.2, cloth.y + 4);
        context.lineTo(x + 1.2, cloth.y + cloth.height - 4);
        context.stroke();
      }

      for (let row = 0; row < 8; row += 1) {
        const rowY = rowStart + row * rowHeight;
        const isCurrent = state.activeStep === row && state.playing;
        const isWoven = row < woven;
        const rowAlpha = isWoven ? 1 : 0.105;

        for (let group = 0; group < 4; group += 1) {
          const steps = tracks[group].steps;
          const active = !!steps[row];
          const activeCount = countActive(steps);
          const dense = activeCount >= 6;
          const breakWarp = group * 4 + (group % 4);
          const cyclicStep = (row + group * 2) % 8;
          for (let offset = 0; offset < 4; offset += 1) {
            const warp = group * 4 + offset;
            const centerX = warpStart + warp * warpSpacing;
            const x = centerX - warpSpacing / 2 + 1.5;
            const cellWidth = warpSpacing - 3;
            if (!active) {
              context.fillStyle = isWoven
                ? "rgba(45, 42, 36, .36)"
                : "rgba(26, 32, 28, .16)";
              context.fillRect(x, rowY, cellWidth, rowHeight - 6);
              if (isWoven) {
                context.strokeStyle = "rgba(226, 216, 193, .13)";
                context.setLineDash([2, 4]);
                context.beginPath();
                context.moveTo(x + 3, rowY + rowHeight - 8);
                context.lineTo(x + cellWidth - 3, rowY + rowHeight - 8);
                context.stroke();
                context.setLineDash([]);
              }
              continue;
            }
            const color = dyeFor(group, offset, cyclicStep + row);
            context.globalAlpha = rowAlpha;
            const threadGradient = context.createLinearGradient(0, rowY, 0, rowY + rowHeight);
            threadGradient.addColorStop(0, this.lighten(color, 10));
            threadGradient.addColorStop(0.22, color);
            threadGradient.addColorStop(0.8, this.darken(color, 7));
            threadGradient.addColorStop(1, this.darken(color, 18));
            context.fillStyle = threadGradient;
            context.fillRect(x, rowY + 1, cellWidth, rowHeight - 8);
            context.globalAlpha = rowAlpha * 0.6;
            context.strokeStyle = "rgba(255, 246, 225, .34)";
            context.lineWidth = 0.75;
            context.beginPath();
            context.moveTo(x + 2, rowY + rowHeight - 9);
            context.lineTo(x + cellWidth - 2, rowY + rowHeight - 9);
            context.stroke();

            if (dense && warp === breakWarp && row >= 3) {
              context.globalAlpha = isWoven ? 0.98 : 0.25;
              context.fillStyle = "#1d2721";
              context.fillRect(x + cellWidth / 2 - 1.6, rowY, 3.2, rowHeight - 6);
              context.strokeStyle = "rgba(224, 132, 99, .8)";
              context.lineWidth = 1;
              context.beginPath();
              context.moveTo(centerX - 4, rowY + rowHeight / 2 - 2);
              context.lineTo(centerX - 10, rowY + rowHeight / 2 + 5);
              context.moveTo(centerX + 4, rowY + rowHeight / 2 - 2);
              context.lineTo(centerX + 10, rowY + rowHeight / 2 + 5);
              context.stroke();
            }
            context.globalAlpha = 1;
          }
        }

        context.globalAlpha = isWoven ? 0.28 : 0.1;
        context.fillStyle = "#362f27";
        context.fillRect(cloth.x + 6, rowY + rowHeight - 10, cloth.width - 12, 1.5);
        context.globalAlpha = 1;

        if (isCurrent) {
          context.save();
          context.strokeStyle = "rgba(245, 207, 145, .7)";
          context.lineWidth = 1;
          context.shadowColor = "rgba(243, 193, 116, .55)";
          context.shadowBlur = 8;
          context.strokeRect(cloth.x + 8, rowY - 1.5, cloth.width - 16, rowHeight - 4);
          context.restore();
        }
      }

      this.drawWeaveTexture(context, cloth);
      this.drawBrokenWarp(context, geometry);

      const edgeShade = context.createLinearGradient(cloth.x, 0, cloth.x + 24, 0);
      edgeShade.addColorStop(0, "rgba(38, 33, 27, .26)");
      edgeShade.addColorStop(1, "rgba(38, 33, 27, 0)");
      context.fillStyle = edgeShade;
      context.fillRect(cloth.x, cloth.y, 24, cloth.height);
      const edgeShadeRight = context.createLinearGradient(cloth.x + cloth.width - 24, 0, cloth.x + cloth.width, 0);
      edgeShadeRight.addColorStop(0, "rgba(38, 33, 27, 0)");
      edgeShadeRight.addColorStop(1, "rgba(38, 33, 27, .26)");
      context.fillStyle = edgeShadeRight;
      context.fillRect(cloth.x + cloth.width - 24, cloth.y, 24, cloth.height);
      context.restore();

      context.save();
      context.strokeStyle = "#d1b684";
      context.lineWidth = 1.4;
      roundedRect(context, cloth.x, cloth.y, cloth.width, cloth.height, 4);
      context.stroke();
      context.restore();

      this.drawGroupTabs(context, geometry);
      this.drawProgressThread(context, geometry, now);
    }

    drawWeaveTexture(context, cloth) {
      context.save();
      context.globalAlpha = 0.12;
      context.strokeStyle = "rgba(255, 248, 230, .45)";
      context.lineWidth = 0.5;
      for (let y = cloth.y + 5; y < cloth.y + cloth.height - 3; y += 4) {
        context.beginPath();
        context.moveTo(cloth.x + 3, y);
        context.lineTo(cloth.x + cloth.width - 3, y);
        context.stroke();
      }
      context.globalAlpha = 0.08;
      context.strokeStyle = "#322b22";
      for (let x = cloth.x + 9; x < cloth.x + cloth.width - 5; x += 17) {
        context.beginPath();
        context.moveTo(x, cloth.y + 3);
        context.lineTo(x, cloth.y + cloth.height - 3);
        context.stroke();
      }
      context.restore();
    }

    drawBrokenWarp(context, geometry) {
      const state = this.state;
      const { warpStart, warpSpacing, rowStart, rowHeight } = geometry;
      state.tracks.forEach((track, group) => {
        if (countActive(track.steps) < 6) return;
        const warp = group * 4 + (group % 4);
        const x = warpStart + warp * warpSpacing;
        const y = rowStart + rowHeight * 3;
        context.save();
        context.strokeStyle = "rgba(238, 216, 181, .9)";
        context.lineWidth = 1;
        context.setLineDash([2, 4]);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + rowHeight * 5 - 6);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = "#c35e47";
        context.beginPath();
        context.arc(x, y + 3, 2.3, 0, Math.PI * 2);
        context.fill();
        context.font = '500 6px "Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
        context.fillStyle = "rgba(247, 222, 185, .82)";
        context.fillText("断经", x + 5, y - 4);
        context.restore();
      });
    }

    drawGroupTabs(context, geometry) {
      const { cloth, warpStart, warpSpacing } = geometry;
      const state = this.state;
      context.save();
      for (let group = 0; group < 4; group += 1) {
        const x = warpStart + (group * 4 + 1.5) * warpSpacing;
        const active = state.activeStep >= 0 &&
          state.tracks[group] &&
          state.tracks[group].steps[state.activeStep];
        roundedRect(context, x - 12, cloth.y + 4, 24, 12, 6);
        context.fillStyle = active
          ? GROUP_BASE[group]
          : "rgba(28, 36, 30, .62)";
        context.fill();
        context.strokeStyle = active ? "rgba(255, 245, 222, .6)" : "rgba(231, 219, 194, .25)";
        context.stroke();
        context.fillStyle = active ? "#fff8ea" : "rgba(238, 229, 211, .72)";
        context.font = '500 6px "DM Mono", monospace';
        context.textAlign = "center";
        context.fillText("ABCD"[group], x, cloth.y + 12.7);
      }
      context.restore();
    }

    drawProgressThread(context, geometry, now) {
      const { cloth, rowStart, rowHeight } = geometry;
      const woven = clamp(this.state.wovenRows, 0, 8);
      const y = rowStart + woven * rowHeight;
      context.save();
      context.strokeStyle = "rgba(221, 170, 93, .76)";
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(cloth.x + 9, Math.min(y, cloth.y + cloth.height - 7));
      context.lineTo(cloth.x + cloth.width - 9, Math.min(y, cloth.y + cloth.height - 7));
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#d5a45d";
      context.beginPath();
      const markerY = Math.min(y, cloth.y + cloth.height - 7);
      context.moveTo(cloth.x + cloth.width - 5, markerY);
      context.lineTo(cloth.x + cloth.width + 3, markerY - 4);
      context.lineTo(cloth.x + cloth.width + 3, markerY + 4);
      context.closePath();
      context.fill();
      if (this.state.completed) {
        context.fillStyle = "rgba(244, 221, 178, .82)";
        context.font = '500 7px "DM Mono", monospace';
        context.textAlign = "right";
        context.fillText("LOOP COMPLETE", cloth.x + cloth.width - 9, cloth.y + cloth.height - 8);
      }
      context.restore();
    }

    drawHeddles(context, geometry, now) {
      const { cloth } = geometry;
      const state = this.state;
      context.save();
      for (let group = 0; group < 4; group += 1) {
        const y = 58 + group * 6;
        const active = state.activeStep >= 0 &&
          state.tracks[group] &&
          state.tracks[group].steps[state.activeStep];
        context.strokeStyle = active ? GROUP_BASE[group] : "rgba(205, 188, 157, .24)";
        context.lineWidth = active ? 2 : 1;
        if (active) {
          context.shadowColor = GROUP_BASE[group];
          context.shadowBlur = 7;
        }
        context.beginPath();
        context.moveTo(cloth.x + 8, y);
        context.lineTo(cloth.x + cloth.width - 8, y);
        context.stroke();
        context.shadowBlur = 0;
      }
      context.strokeStyle = "rgba(217, 193, 155, .22)";
      context.lineWidth = 1;
      for (let x = cloth.x + 8; x < cloth.x + cloth.width; x += 21) {
        context.beginPath();
        context.moveTo(x, 55);
        context.lineTo(x, 82);
        context.stroke();
      }
      context.restore();
    }

    drawTreadles(context, geometry) {
      const state = this.state;
      const { cloth } = geometry;
      context.save();
      for (let group = 0; group < 4; group += 1) {
        const active = state.activeStep >= 0 &&
          state.tracks[group] &&
          state.tracks[group].steps[state.activeStep];
        const pedalX = 93;
        const pedalY = 242 + group * 53;
        context.strokeStyle = active
          ? GROUP_BASE[group] + "cc"
          : "rgba(216, 196, 161, .22)";
        context.lineWidth = active ? 1.6 : 0.8;
        context.beginPath();
        context.moveTo(cloth.x + 12, 58 + group * 6);
        context.bezierCurveTo(121, 115, 56, pedalY - 24, pedalX + 18, pedalY);
        context.stroke();
        context.save();
        context.translate(pedalX, pedalY);
        context.rotate(-0.18);
        roundedRect(context, 0, 0, 36, 11, 5);
        context.fillStyle = active ? GROUP_BASE[group] : "rgba(151, 128, 92, .74)";
        context.fill();
        context.strokeStyle = active
          ? "rgba(255, 237, 205, .58)"
          : "rgba(236, 216, 182, .22)";
        context.stroke();
        context.restore();
        context.fillStyle = active ? "#f7e8ce" : "rgba(215, 202, 179, .44)";
        context.font = '500 7px "DM Mono", monospace';
        context.textAlign = "center";
        context.fillText("ABCD"[group], pedalX + 18, pedalY - 7);
      }
      context.restore();
    }

    drawShuttle(context, geometry, now) {
      const { cloth, rowStart, rowHeight } = geometry;
      const state = this.state;
      const hasRow = state.wovenRows > 0 || state.activeStep >= 0;
      const row = clamp(
        Math.max(0, (state.activeStep >= 0 ? state.activeStep : state.wovenRows - 1)),
        0,
        7
      );
      const y = rowStart + row * rowHeight - 4;
      let x = cloth.x + cloth.width - 70;
      if (state.playing && hasRow) {
        const phase = Math.sin(now / 430);
        x = cloth.x + cloth.width / 2 + phase * (cloth.width / 2 - 62);
      }
      if (!hasRow) {
        x = cloth.x + cloth.width - 67;
      }

      context.save();
      if (state.playing && hasRow) {
        context.strokeStyle = "rgba(244, 208, 148, .32)";
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(x + 27, y + 5);
        context.lineTo(cloth.x + 15, y + 5);
        context.stroke();
      }
      context.shadowColor = "rgba(0, 0, 0, .48)";
      context.shadowBlur = 8;
      context.shadowOffsetY = 4;
      const shuttle = context.createLinearGradient(x, y, x + 58, y + 12);
      shuttle.addColorStop(0, "#6c4d30");
      shuttle.addColorStop(0.35, "#a97e49");
      shuttle.addColorStop(0.72, "#785534");
      shuttle.addColorStop(1, "#4d3826");
      roundedRect(context, x, y, 58, 12, 6);
      context.fillStyle = shuttle;
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = "rgba(237, 205, 154, .38)";
      context.lineWidth = 0.7;
      context.stroke();
      context.fillStyle = "#d3b276";
      context.fillRect(x + 21, y + 4, 16, 3.5);
      context.fillStyle = "#3d2d20";
      context.beginPath();
      context.arc(x + 28, y + 6, 1.2, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    drawFrameDetails(context, geometry) {
      const { frame, cloth } = geometry;
      context.save();
      const bolts = [
        [72, 41], [828, 41], [72, 497], [828, 497]
      ];
      bolts.forEach(([x, y]) => {
        context.fillStyle = "rgba(34, 27, 19, .62)";
        context.beginPath();
        context.arc(x, y, 4.5, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(228, 201, 150, .4)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x - 2.5, y);
        context.lineTo(x + 2.5, y);
        context.stroke();
      });
      context.fillStyle = "rgba(235, 217, 184, .38)";
      context.font = '500 6px "DM Mono", monospace';
      context.textAlign = "left";
      context.fillText("WARP 16 / WEFT 08", frame.x + 28, frame.y + frame.height - 17);
      context.textAlign = "right";
      context.fillText("LOOM 04 · " + this.state.bpm + " BPM", frame.x + frame.width - 28, frame.y + frame.height - 17);
      context.strokeStyle = "rgba(227, 206, 169, .16)";
      context.beginPath();
      context.moveTo(frame.x + 24, frame.y + frame.height - 32);
      context.lineTo(frame.x + frame.width - 24, frame.y + frame.height - 32);
      context.stroke();
      context.restore();
    }

    lighten(color, amount) {
      return this.mixColor(color, "#fff7e8", amount / 100);
    }

    darken(color, amount) {
      return this.mixColor(color, "#1b211b", amount / 100);
    }

    mixColor(from, to, ratio) {
      const parse = (hex) => [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
      ];
      const a = parse(from);
      const b = parse(to);
      const values = a.map((value, index) =>
        Math.round(value + (b[index] - value) * ratio));
      return "#" + values.map((value) =>
        clamp(value, 0, 255).toString(16).padStart(2, "0")).join("");
    }

    exportCloth() {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1200;
      const context = canvas.getContext("2d");
      const tracks = this.state.tracks.length === 4 ? this.state.tracks : [];
      const cloth = { x: 183, y: 245, width: 1234, height: 746 };
      const warpStart = 226;
      const warpSpacing = 73.9;
      const rowStart = 273;
      const rowHeight = 86.5;

      context.fillStyle = "#f1eadc";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const paperGradient = context.createRadialGradient(330, 140, 10, 800, 600, 940);
      paperGradient.addColorStop(0, "rgba(255, 253, 246, .95)");
      paperGradient.addColorStop(0.58, "rgba(241, 234, 220, .28)");
      paperGradient.addColorStop(1, "rgba(203, 188, 160, .2)");
      context.fillStyle = paperGradient;
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = "#24342b";
      context.font = '600 18px "Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      context.fillText("纬声 / LOOM RHYTHM", 86, 93);
      context.fillStyle = "#776f60";
      context.font = '400 11px "DM Mono", monospace';
      context.fillText("WARP 16 × WEFT 08 · ONE COMPLETE LOOP", 86, 118);
      context.textAlign = "right";
      context.fillText(this.state.bpm + " BPM · " + this.loopSignature(), 1514, 91);
      context.fillStyle = "#9b907d";
      context.fillText("OFFLINE WOVEN CLOTH", 1514, 116);

      context.strokeStyle = "rgba(49, 63, 52, .28)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(86, 147);
      context.lineTo(1514, 147);
      context.stroke();
      context.fillStyle = "#24342b";
      context.font = '600 42px "Noto Serif SC", "Songti SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", serif';
      context.textAlign = "left";
      context.fillText("一循环 · 一匹布", 86, 207);
      context.fillStyle = "#8b8272";
      context.font = '400 11px "Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      context.fillText("四组踏综 / SIXTEEN WARPS / EIGHT PICKS", 89, 228);

      context.save();
      context.shadowColor = "rgba(45, 42, 32, .24)";
      context.shadowBlur = 32;
      context.shadowOffsetY = 16;
      roundedRect(context, cloth.x, cloth.y, cloth.width, cloth.height, 5);
      context.fillStyle = "#81796a";
      context.fill();
      context.restore();

      context.save();
      roundedRect(context, cloth.x, cloth.y, cloth.width, cloth.height, 3);
      context.clip();
      context.fillStyle = "#8d8575";
      context.fillRect(cloth.x, cloth.y, cloth.width, cloth.height);

      for (let warp = 0; warp < 16; warp += 1) {
        const x = warpStart + warp * warpSpacing;
        context.strokeStyle = "rgba(231, 220, 197, .25)";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x, cloth.y + 3);
        context.lineTo(x, cloth.y + cloth.height - 3);
        context.stroke();
      }

      for (let row = 0; row < 8; row += 1) {
        const y = rowStart + row * rowHeight;
        for (let group = 0; group < 4; group += 1) {
          const active = tracks[group] && tracks[group].steps[row];
          const dense = tracks[group] && countActive(tracks[group].steps) >= 6;
          const cyclicStep = (row + group * 2) % 8;
          for (let offset = 0; offset < 4; offset += 1) {
            const warp = group * 4 + offset;
            const centerX = warpStart + warp * warpSpacing;
            const x = centerX - warpSpacing / 2 + 2;
            const width = warpSpacing - 4;
            if (!active) {
              context.fillStyle = "rgba(46, 43, 36, .38)";
              context.fillRect(x, y, width, rowHeight - 8);
              context.strokeStyle = "rgba(232, 220, 196, .18)";
              context.setLineDash([5, 9]);
              context.beginPath();
              context.moveTo(x + 7, y + rowHeight - 12);
              context.lineTo(x + width - 7, y + rowHeight - 12);
              context.stroke();
              context.setLineDash([]);
              continue;
            }
            const color = dyeFor(group, offset, cyclicStep + row);
            const gradient = context.createLinearGradient(0, y, 0, y + rowHeight);
            gradient.addColorStop(0, this.lighten(color, 11));
            gradient.addColorStop(0.25, color);
            gradient.addColorStop(0.86, this.darken(color, 9));
            gradient.addColorStop(1, this.darken(color, 20));
            context.fillStyle = gradient;
            context.fillRect(x, y + 2, width, rowHeight - 12);
            context.fillStyle = "rgba(255, 247, 229, .32)";
            context.fillRect(x + 5, y + rowHeight - 16, width - 10, 1.5);
            if (dense && warp === group * 4 + (group % 4) && row >= 3) {
              context.fillStyle = "#202b24";
              context.fillRect(centerX - 3, y + 2, 6, rowHeight - 12);
              context.strokeStyle = "#d67b60";
              context.lineWidth = 2;
              context.beginPath();
              context.moveTo(centerX - 10, y + rowHeight / 2 - 3);
              context.lineTo(centerX - 22, y + rowHeight / 2 + 12);
              context.moveTo(centerX + 10, y + rowHeight / 2 - 3);
              context.lineTo(centerX + 22, y + rowHeight / 2 + 12);
              context.stroke();
            }
          }
        }
        context.fillStyle = "rgba(36, 32, 26, .25)";
        context.fillRect(cloth.x + 8, y + rowHeight - 12, cloth.width - 16, 2);
      }

      context.globalAlpha = 0.14;
      context.strokeStyle = "#fff5dd";
      context.lineWidth = 0.7;
      for (let y = cloth.y + 8; y < cloth.y + cloth.height; y += 6) {
        context.beginPath();
        context.moveTo(cloth.x + 2, y);
        context.lineTo(cloth.x + cloth.width - 2, y);
        context.stroke();
      }
      context.restore();

      context.strokeStyle = "#b89d70";
      context.lineWidth = 2;
      roundedRect(context, cloth.x, cloth.y, cloth.width, cloth.height, 3);
      context.stroke();

      for (let group = 0; group < 4; group += 1) {
        const x = warpStart + (group * 4 + 1.5) * warpSpacing;
        context.fillStyle = GROUP_BASE[group];
        context.beginPath();
        context.arc(x, 1085, 6, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#5e574a";
        context.font = '500 10px "Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
        context.textAlign = "left";
        context.fillText(GROUP_NAMES[group], x + 13, 1089);
      }
      context.textAlign = "right";
      context.fillStyle = "#8b8272";
      context.font = '400 9px "Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      context.fillText(
        "错拍留白 / 密集换色断经 / 40 THREAD PICKS",
        1514,
        1089
      );
      context.strokeStyle = "rgba(49, 63, 52, .2)";
      context.beginPath();
      context.moveTo(86, 1118);
      context.lineTo(1514, 1118);
      context.stroke();
      context.fillStyle = "#9a907e";
      context.textAlign = "left";
      context.font = '400 8px "DM Mono", monospace';
      context.fillText("WOVEN IN THE BROWSER · EVERY SOUND SYNTHESIZED IN REAL TIME", 86, 1142);

      context.globalAlpha = 0.06;
      for (let index = 0; index < 1800; index += 1) {
        const x = hash(index * 3 + 1) * canvas.width;
        const y = hash(index * 7 + 5) * canvas.height;
        context.fillStyle = index % 2 ? "#2b392e" : "#fffdf6";
        context.fillRect(x, y, 1, 1);
      }
      context.globalAlpha = 1;
      return canvas;
    }

    loopSignature() {
      return this.state.tracks.map((track) =>
        track.steps.map((active) => active ? "1" : "0").join("")
      ).join("·");
    }
  }

  window.LoomRenderer = LoomRenderer;
  window.LOOM_GROUPS = {
    palettes: GROUP_PALETTES,
    base: GROUP_BASE,
    names: GROUP_NAMES
  };
})();
