(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  class GlazeRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.width = 0;
      this.height = 0;
      this.resize = this.resize.bind(this);
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(canvas);
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(320, rect.width);
      this.height = Math.max(320, rect.height);
      this.dpr = Math.min(2, global.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
    }

    draw(sim, now) {
      const ctx = this.ctx;
      const W = this.width;
      const H = this.height;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      this._background(ctx, W, H, now);

      const layout = this._layout(W, H, sim);
      this._tankBack(ctx, layout);
      this._shelf(ctx, layout, sim);
      this._pot(ctx, layout, sim, now);
      this._liquid(ctx, layout, sim);
      this._tankFront(ctx, layout);
      this._drips(ctx, layout, sim);
      this._measurement(ctx, layout, sim);
      this._gauge(ctx, W, H, sim);
      this._statusText(ctx, W, H, sim);
    }

    _layout(W, H, sim) {
      const tankW = Math.min(W * 0.43, 480);
      const tankH = Math.min(H * 0.245, 142);
      const cx = W * 0.455;
      const tankTop = H * 0.715;
      const surfaceY = tankTop + 18 + ((100 - sim.level) / 100) * (tankH - 45);
      const type = sim.currentType;
      const dims = {
        cup: { h: 118, mouth: 55, body: 48, bottom: 29 },
        jar: { h: 138, mouth: 33, body: 64, bottom: 35 },
        vase: { h: 156, mouth: 25, body: 58, bottom: 31 }
      }[type.id];
      let bottomY = surfaceY - dims.h * 0.52;
      if (sim.phase === 'dip') {
        const fraction = clamp(sim.phaseElapsed / Math.max(sim.params.soakTime, 0.1), 0, 1);
        bottomY = surfaceY + 52 * (0.35 + fraction * 0.65);
      } else if (sim.phase === 'spin' || sim.phase === 'drip') {
        bottomY = surfaceY - dims.h * 0.72;
      } else if (sim.phase === 'complete') {
        bottomY = surfaceY - dims.h * 0.52;
      }
      return {
        W, H, tankW, tankH, tankTop, tankBottom: tankTop + tankH,
        cx, surfaceY, dims, bottomY, type
      };
    }

    _background(ctx, W, H, now) {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#151b17');
      bg.addColorStop(0.62, '#171c18');
      bg.addColorStop(1, '#101310');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(W * 0.43, H * 0.29, 5, W * 0.43, H * 0.29, W * 0.42);
      glow.addColorStop(0, 'rgba(203, 212, 166, 0.105)');
      glow.addColorStop(0.55, 'rgba(164, 180, 139, 0.025)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(222, 222, 198, 0.038)';
      ctx.lineWidth = 1;
      for (let x = 25; x < W; x += 46) {
        ctx.beginPath();
        ctx.moveTo(x, H * 0.61);
        ctx.lineTo(x - 34, H);
        ctx.stroke();
      }
      for (let y = H * 0.63; y < H; y += 27) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(232, 225, 197, 0.075)';
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.moveTo(W * 0.11, H * 0.15);
      ctx.lineTo(W * 0.11, H * 0.83);
      ctx.moveTo(W * 0.89, H * 0.15);
      ctx.lineTo(W * 0.89, H * 0.83);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(219, 218, 197, 0.27)';
      ctx.font = '9px "DM Mono", monospace';
      ctx.letterSpacing = '1px';
      ctx.fillText('GLAZE VAT / 01', 28, H - 22);
      ctx.fillText('WET PROCESS', W - 100, H - 22);

      const pulse = 0.5 + Math.sin(now * 0.0008) * 0.08;
      ctx.fillStyle = `rgba(205, 190, 143, ${pulse * 0.06})`;
      ctx.beginPath();
      ctx.arc(W * 0.43, H * 0.1, 140, 0, TAU);
      ctx.fill();
    }

    _tankBack(ctx, layout) {
      const { cx, tankTop, tankW, tankH } = layout;
      ctx.save();
      ctx.fillStyle = '#202620';
      ctx.beginPath();
      ctx.ellipse(cx, tankTop, tankW / 2, 18, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(221, 217, 190, 0.16)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#171b17';
      ctx.beginPath();
      ctx.ellipse(cx, tankTop + 7, tankW / 2 - 5, 14, 0, 0, TAU);
      ctx.fill();

      const baseGrad = ctx.createLinearGradient(cx - tankW / 2, 0, cx + tankW / 2, 0);
      baseGrad.addColorStop(0, 'rgba(6, 8, 7, 0.7)');
      baseGrad.addColorStop(0.5, 'rgba(40, 45, 39, 0.5)');
      baseGrad.addColorStop(1, 'rgba(6, 8, 7, 0.7)');
      ctx.fillStyle = baseGrad;
      ctx.beginPath();
      ctx.ellipse(cx, tankTop + tankH - 11, tankW / 2 + 5, 12, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#232923';
      ctx.fillRect(cx - tankW / 2 - 23, tankTop + 14, 12, tankH - 13);
      ctx.fillRect(cx + tankW / 2 + 11, tankTop + 14, 12, tankH - 13);
      ctx.restore();
    }

    _shelf(ctx, layout, sim) {
      if (!sim.batch) return;
      const pieces = sim.batch.pieces;
      const startX = 62;
      const y = layout.H * 0.42;
      ctx.save();
      ctx.strokeStyle = 'rgba(215, 208, 184, 0.16)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX - 20, y + 4);
      ctx.lineTo(startX + 150, y + 4);
      ctx.stroke();
      for (let index = 0; index < 3; index += 1) {
        const item = pieces[index];
        const x = startX + index * 50;
        ctx.globalAlpha = item ? 1 : 0.22;
        this._miniPot(ctx, x, y, index, item);
      }
      ctx.fillStyle = 'rgba(214, 212, 191, 0.32)';
      ctx.font = '8px "DM Mono", monospace';
      ctx.fillText('FINISHED', startX - 18, y + 28);
      ctx.restore();
    }

    _miniPot(ctx, x, y, index, item) {
      const type = window.GlazeSimulation.PIECE_TYPES[index];
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(0.29, 0.29);
      this._potShape(ctx, type.id);
      ctx.fillStyle = item ? (item.status === 'good' ? type.glaze : '#82594d') : '#4a4e45';
      ctx.fill();
      ctx.strokeStyle = 'rgba(236, 231, 210, 0.4)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
      if (item) {
        ctx.fillStyle = item.status === 'good' ? '#b8c69a' : '#e26d5c';
        ctx.beginPath();
        ctx.arc(x + 15, y - 41, 5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#142016';
        ctx.font = '7px "DM Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(item.status === 'good' ? '✓' : '!', x + 15, y - 38.5);
        ctx.textAlign = 'left';
      }
    }

    _potShape(ctx, typeId) {
      if (typeId === 'cup') {
        ctx.beginPath();
        ctx.moveTo(-55, -118);
        ctx.bezierCurveTo(-57, -95, -50, -46, -30, -9);
        ctx.quadraticCurveTo(0, 2, 30, -9);
        ctx.bezierCurveTo(50, -46, 57, -95, 55, -118);
        ctx.closePath();
      } else if (typeId === 'jar') {
        ctx.beginPath();
        ctx.moveTo(-31, -138);
        ctx.bezierCurveTo(-35, -121, -62, -106, -64, -77);
        ctx.bezierCurveTo(-67, -38, -50, -5, -34, -4);
        ctx.quadraticCurveTo(0, 5, 34, -4);
        ctx.bezierCurveTo(50, -5, 67, -38, 64, -77);
        ctx.bezierCurveTo(62, -106, 35, -121, 31, -138);
        ctx.closePath();
      } else {
        ctx.beginPath();
        ctx.moveTo(-24, -156);
        ctx.bezierCurveTo(-23, -132, -20, -119, -30, -101);
        ctx.bezierCurveTo(-59, -77, -58, -36, -30, -7);
        ctx.quadraticCurveTo(0, 4, 30, -7);
        ctx.bezierCurveTo(58, -36, 59, -77, 30, -101);
        ctx.bezierCurveTo(20, -119, 23, -132, 24, -156);
        ctx.closePath();
      }
    }

    _pot(ctx, layout, sim, now) {
      const { cx, bottomY, dims, type } = layout;
      const active = sim.phase === 'dip' || sim.phase === 'spin' || sim.phase === 'drip';
      const thickness = sim.thickness;
      const range = sim.window;
      const quality = thickness < range.min ? 'thin' : thickness > range.max ? 'thick' : 'good';

      ctx.save();
      ctx.translate(cx, bottomY);

      if (sim.devices.motor && sim.params.rotation > 0) {
        const spin = (sim.simTime * sim.params.rotation * 0.035) % TAU;
        ctx.save();
        ctx.translate(0, -dims.h * 0.5);
        ctx.rotate(spin);
        ctx.strokeStyle = 'rgba(184, 198, 154, 0.27)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 7]);
        ctx.beginPath();
        ctx.ellipse(0, 0, dims.body + 23, 17, 0, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(184, 198, 154, 0.55)';
        ctx.beginPath();
        ctx.arc(dims.body + 23, 0, 2.5, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 15;
      this._potShape(ctx, type.id);
      const bodyGrad = ctx.createLinearGradient(-64, 0, 64, 0);
      bodyGrad.addColorStop(0, '#82705f');
      bodyGrad.addColorStop(0.19, type.color);
      bodyGrad.addColorStop(0.62, '#b8aa96');
      bodyGrad.addColorStop(1, '#776858');
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.restore();

      this._potShape(ctx, type.id);
      ctx.save();
      ctx.clip();
      const coverage = clamp(thickness / Math.max(range.min, 0.1), 0, 1);
      const glazeGrad = ctx.createLinearGradient(-60, 0, 60, 0);
      glazeGrad.addColorStop(0, 'rgba(26, 40, 35, 0.74)');
      glazeGrad.addColorStop(0.24, `${type.glaze}b3`);
      glazeGrad.addColorStop(0.56, `${type.glaze}9e`);
      glazeGrad.addColorStop(0.86, 'rgba(96, 132, 121, 0.58)');
      glazeGrad.addColorStop(1, 'rgba(21, 34, 29, 0.72)');
      ctx.globalAlpha = 0.18 + coverage * 0.58;
      ctx.fillStyle = glazeGrad;
      ctx.fillRect(-70, -dims.h - 10, 140, dims.h + 20);

      if (quality === 'thin') {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = type.color;
        ctx.lineWidth = 2;
        for (let i = 0; i < 5; i += 1) {
          const x = -55 + i * 27;
          ctx.beginPath();
          ctx.moveTo(x, -40 - (i % 2) * 24);
          ctx.lineTo(x + 18, -80 - (i % 3) * 12);
          ctx.stroke();
        }
      }
      if (quality === 'thick') {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = type.glaze;
        for (let i = 0; i < 4; i += 1) {
          const x = -29 + i * 19;
          ctx.beginPath();
          ctx.ellipse(x, -8, 4 + (i % 2) * 2, 13 + i * 2, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      const shine = ctx.createLinearGradient(-42, -dims.h, 34, 0);
      shine.addColorStop(0, 'rgba(255,255,244,0.26)');
      shine.addColorStop(0.18, 'rgba(255,255,244,0.03)');
      shine.addColorStop(0.62, 'rgba(255,255,255,0)');
      ctx.fillStyle = shine;
      ctx.fillRect(-70, -dims.h, 140, dims.h);
      ctx.restore();

      this._potShape(ctx, type.id);
      ctx.strokeStyle = 'rgba(31, 37, 30, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.save();
      ctx.globalAlpha = 0.62 + coverage * 0.34;
      ctx.strokeStyle = type.glaze;
      ctx.lineWidth = 2.4 + Math.min(5.5, thickness * 3.4);
      ctx.lineJoin = 'round';
      if (quality === 'thin') ctx.setLineDash([6, 8]);
      this._potShape(ctx, type.id);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.beginPath();
      ctx.ellipse(0, -dims.h, dims.mouth, 8, 0, 0, TAU);
      ctx.fillStyle = '#4f4b41';
      ctx.fill();
      ctx.strokeStyle = quality === 'thin' ? 'rgba(201, 130, 94, 0.8)' : type.glaze;
      ctx.lineWidth = 2.5 + thickness * 2.6;
      ctx.stroke();

      if (sim.phase === 'spin' && sim.devices.motor) {
        ctx.strokeStyle = 'rgba(226, 179, 101, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(-dims.body * 0.7, -dims.h * 0.6, 12, 0.2, 1.9);
        ctx.arc(dims.body * 0.7, -dims.h * 0.48, 12, 3.3, 5);
        ctx.stroke();
      }

      if (active && sim.devices.pump) {
        for (let index = 0; index < 5; index += 1) {
          const phase = ((sim.simTime * 0.8 + index * 0.21) % 1);
          const bx = -dims.body + index * (dims.body / 2.2);
          const by = -12 - phase * 34;
          ctx.fillStyle = `rgba(184, 213, 194, ${0.32 * (1 - phase)})`;
          ctx.beginPath();
          ctx.arc(bx, by, 1.6 + index * 0.2, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    _liquid(ctx, layout, sim) {
      const { cx, tankW, tankTop, tankH, surfaceY } = layout;
      const left = cx - tankW / 2 + 7;
      const right = cx + tankW / 2 - 7;
      const bottom = tankTop + tankH - 8;
      const liquidGrad = ctx.createLinearGradient(0, surfaceY, 0, bottom);
      liquidGrad.addColorStop(0, 'rgba(117, 159, 144, 0.74)');
      liquidGrad.addColorStop(0.08, 'rgba(69, 108, 95, 0.86)');
      liquidGrad.addColorStop(0.62, 'rgba(37, 72, 63, 0.93)');
      liquidGrad.addColorStop(1, 'rgba(20, 43, 38, 0.97)');
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(left, tankTop + 8);
      ctx.lineTo(left, bottom);
      ctx.quadraticCurveTo(cx, bottom + 24, right, bottom);
      ctx.lineTo(right, tankTop + 8);
      ctx.quadraticCurveTo(cx, tankTop + 28, left, tankTop + 8);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = liquidGrad;
      ctx.fillRect(left, surfaceY, right - left, bottom - surfaceY + 18);

      ctx.strokeStyle = 'rgba(197, 227, 208, 0.72)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = left; x <= right; x += 5) {
        const t = (x - left) / (right - left);
        const wave = Math.sin(t * 18 + sim.simTime * 1.7) * 2.2 + Math.sin(t * 32 - sim.simTime) * 0.8;
        const y = surfaceY + wave;
        if (x === left) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const glint = ((sim.simTime * 10) % (right - left + 120)) - 60;
      ctx.strokeStyle = 'rgba(228, 238, 218, 0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left + glint, surfaceY + 8);
      ctx.lineTo(left + glint - 45, bottom - 13);
      ctx.stroke();

      ctx.fillStyle = 'rgba(214, 235, 219, 0.16)';
      for (let i = 0; i < 9; i += 1) {
        const bx = left + ((i * 47 + sim.simTime * (4 + i)) % (right - left));
        const by = surfaceY + 25 + ((i * 31 + sim.simTime * 5) % (bottom - surfaceY - 35));
        ctx.beginPath();
        ctx.arc(bx, by, 1.2 + (i % 3) * 0.5, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    _tankFront(ctx, layout) {
      const { cx, tankW, tankTop, tankH } = layout;
      ctx.save();
      const rim = ctx.createLinearGradient(cx - tankW / 2, 0, cx + tankW / 2, 0);
      rim.addColorStop(0, '#3d443b');
      rim.addColorStop(0.35, '#abb09e');
      rim.addColorStop(0.6, '#646b5e');
      rim.addColorStop(1, '#343a32');
      ctx.strokeStyle = rim;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(cx, tankTop, tankW / 2, 18, 0, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(210, 214, 192, 0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - tankW / 2 + 6, tankTop + 8);
      ctx.lineTo(cx - tankW / 2 + 6, tankTop + tankH - 14);
      ctx.quadraticCurveTo(cx, tankTop + tankH + 12, cx + tankW / 2 - 6, tankTop + tankH - 14);
      ctx.lineTo(cx + tankW / 2 - 6, tankTop + 8);
      ctx.stroke();

      ctx.fillStyle = 'rgba(226, 226, 204, 0.32)';
      ctx.font = '8px "DM Mono", monospace';
      ctx.fillText('GLAZE', cx - tankW * 0.22, tankTop + tankH - 13);
      ctx.textAlign = 'right';
      ctx.fillText(`${layout.W > 780 ? `${Math.round(layout.W)} / ` : ''}${layout.H} px`, cx + tankW * 0.25, tankTop + tankH - 13);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    _drips(ctx, layout, sim) {
      const active = sim.phase === 'drip' || sim.thickness > sim.window.max;
      if (!active) return;
      const { cx, bottomY, dims, surfaceY } = layout;
      const speed = sim.phase === 'drip' ? sim.params.dripSpeed : 1.1;
      if (speed <= 0 && sim.phase === 'drip') return;
      const count = sim.phase === 'drip' ? 4 : 3;
      ctx.save();
      for (let index = 0; index < count; index += 1) {
        const travel = ((sim.simTime * (0.23 + speed * 0.11) + index * 0.19) % 1);
        const x = cx - 24 + index * 16 + Math.sin(index * 2.7) * 4;
        const start = bottomY + 7;
        const end = surfaceY - 2;
        if (end <= start) continue;
        const y = start + (end - start) * travel;
        const radius = 2.2 + travel * 1.1;
        ctx.fillStyle = `rgba(174, 210, 192, ${0.65 - travel * 0.25})`;
        ctx.beginPath();
        ctx.ellipse(x, y, radius, radius * 1.55, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    _measurement(ctx, layout, sim) {
      const { cx, bottomY, dims } = layout;
      const x = cx + dims.body + 56;
      const top = bottomY - dims.h * 0.7;
      const scale = 95 / 0.55;
      const minY = top + 16;
      const range = sim.window;
      const low = minY - Math.min(85, (range.min - 0.45) * scale);
      const high = minY - Math.min(85, (range.max - 0.45) * scale);
      const cursor = minY - Math.min(85, (sim.thickness - 0.45) * scale);
      ctx.save();
      ctx.strokeStyle = 'rgba(221, 218, 195, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, minY);
      ctx.lineTo(x, top + 95);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(184, 198, 154, 0.68)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, high);
      ctx.lineTo(x, low);
      ctx.stroke();
      ctx.strokeStyle = '#e2b365';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 7, cursor);
      ctx.lineTo(x + 7, cursor);
      ctx.stroke();
      ctx.fillStyle = 'rgba(221, 218, 195, 0.42)';
      ctx.font = '8px "DM Mono", monospace';
      ctx.fillText('TARGET', x + 12, (low + high) / 2 + 3);
      ctx.restore();
    }

    _gauge(ctx, W, H, sim) {
      if (W < 720) return;
      const x = W - 101;
      const y = H * 0.49;
      const radius = 57;
      const start = Math.PI * 0.76;
      const end = Math.PI * 2.24;
      const range = sim.window;
      const maxValue = 1.65;
      const angleFor = (value) => start + clamp(value / maxValue, 0, 1) * (end - start);
      const thickness = sim.thickness;
      const quality = thickness < range.min ? 'thin' : thickness > range.max ? 'thick' : 'good';
      const color = quality === 'thin' ? '#e2b365' : quality === 'thick' ? '#e26d5c' : '#b8c69a';

      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = 'rgba(16, 20, 17, 0.62)';
      ctx.beginPath();
      ctx.arc(0, 0, radius + 13, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(224, 219, 196, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, radius, start, end);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(184, 198, 154, 0.35)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(0, 0, radius, angleFor(range.min), angleFor(range.max));
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, radius, start, angleFor(thickness));
      ctx.stroke();

      const needle = angleFor(thickness);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(needle) * 27, Math.sin(needle) * 27);
      ctx.lineTo(Math.cos(needle) * (radius - 9), Math.sin(needle) * (radius - 9));
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 3.3, 0, TAU);
      ctx.fill();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#eee9db';
      ctx.font = '500 21px "DM Mono", monospace';
      ctx.fillText(thickness.toFixed(2), 0, 19);
      ctx.fillStyle = 'rgba(219, 216, 195, 0.48)';
      ctx.font = '8px "DM Mono", monospace';
      ctx.fillText('WET FILM · mm', 0, 32);
      ctx.fillText(`TARGET ${range.min.toFixed(2)}–${range.max.toFixed(2)}`, 0, radius + 29);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    _statusText(ctx, W, H, sim) {
      let title = '';
      let detail = '';
      let color = '#e2b365';
      if (sim.fault) {
        title = '设备急停';
        detail = sim.fault.reason;
        color = '#e26d5c';
      } else if (sim.paused) {
        title = '共享时钟已暂停';
        detail = '可检查缓存、参数与事件，再恢复当前批次';
      } else if (sim.phase === 'complete') {
        title = sim.batch && sim.batch.success ? '批次合格' : '批次完成';
        detail = sim.batch
          ? `良品 ${sim.goodCount}/3 · 良品率 ${Math.round(sim.yieldRate * 100)}%`
          : '';
        color = sim.batch && sim.batch.success ? '#b8c69a' : '#e2b365';
      } else if (!sim.batch || sim.phase === 'idle') {
        title = sim.batch ? '装载完成，等待浸釉' : '设置参数，开始第一件';
        detail = sim.batch ? `${sim.currentType.name} 目标 ${sim.currentType.target} mm` : '三件达到各自目标厚度即成功';
        color = 'rgba(232, 228, 213, 0.72)';
      }
      if (!title) return;
      const width = Math.min(360, W * 0.42);
      const x = W / 2 - width / 2;
      const y = H * 0.19;
      ctx.save();
      ctx.fillStyle = 'rgba(13, 17, 14, 0.75)';
      ctx.beginPath();
      ctx.roundRect(x, y, width, sim.fault ? 50 : 43, 9);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.36;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.font = '500 11px "Noto Sans SC", sans-serif';
      ctx.fillText(title, W / 2, y + 18);
      ctx.fillStyle = 'rgba(224, 220, 203, 0.46)';
      ctx.font = '8px "Noto Sans SC", "PingFang SC", sans-serif';
      const shortDetail = detail.length > 42 ? `${detail.slice(0, 42)}…` : detail;
      ctx.fillText(shortDetail, W / 2, y + 32);
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }

  global.GlazeRenderer = GlazeRenderer;
})(window);
