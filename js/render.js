/* Canvas 场景渲染：横梁/小车/滑轮组/绳索/货箱/平台/障碍/受力矢量/故障点。 */
(function (global) {
  'use strict';
  const CFG = global.CRANE_CFG;

  function drawScene(ctx, state, showForces) {
    const W = CFG.view.w, H = CFG.view.h;
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx);
    drawBeamAndTrack(ctx);
    drawPlatforms(ctx);
    drawWall(ctx);
    drawPlacedBoxes(ctx, state);
    drawTrolleyAndRope(ctx, state);
    drawActiveBox(ctx, state, showForces);
    drawClearanceMarks(ctx, state);
    if (state.faults.length) drawFaultMarker(ctx, state.faults[0]);
  }

  function drawBackground(ctx) {
    ctx.fillStyle = '#10161f';
    ctx.fillRect(0, 0, CFG.view.w, CFG.view.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CFG.view.w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CFG.view.h); ctx.stroke();
    }
    for (let y = 0; y < CFG.view.h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CFG.view.w, y); ctx.stroke();
    }
    ctx.fillStyle = '#1c2530';
    ctx.fillRect(0, CFG.groundY, CFG.view.w, CFG.view.h - CFG.groundY);
    ctx.strokeStyle = '#3a4a5c';
    ctx.beginPath(); ctx.moveTo(0, CFG.groundY);
    ctx.lineTo(CFG.view.w, CFG.groundY); ctx.stroke();
  }

  function drawBeamAndTrack(ctx) {
    const b = CFG.beam;
    ctx.fillStyle = '#5b6b7d';
    ctx.fillRect(b.x0, b.y, b.x1 - b.x0, b.thickness);
    ctx.fillStyle = '#3f4c5b';
    ctx.fillRect(b.x0, b.y + b.thickness, b.x1 - b.x0, 4);
    // 轨道边界
    ctx.strokeStyle = '#e0b34a';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(CFG.track.xMin, b.y - 8);
    ctx.lineTo(CFG.track.xMin, CFG.groundY);
    ctx.moveTo(CFG.track.xMax, b.y - 8);
    ctx.lineTo(CFG.track.xMax, CFG.groundY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPlatforms(ctx) {
    CFG.lifts.forEach((lf, i) => {
      const p = lf.platform;
      ctx.fillStyle = i === 0 ? '#2f6d8f' : '#3f7a5b';
      ctx.fillRect(p.x, p.top, p.w, CFG.groundY - p.top);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(p.x, p.top, p.w, 4);
      ctx.fillStyle = '#cfe3ee';
      ctx.font = '12px sans-serif';
      ctx.fillText('平台' + (i + 1), p.x + 8, p.top - 8);
    });
  }

  function drawWall(ctx) {
    const w = CFG.wall;
    ctx.fillStyle = '#7a3b3b';
    ctx.fillRect(w.x, w.top, w.w, w.bottom - w.top);
    ctx.strokeStyle = '#ff7676';
    ctx.lineWidth = 2;
    ctx.strokeRect(w.x, w.top, w.w, w.bottom - w.top);
    ctx.fillStyle = '#ffb3b3';
    ctx.font = '12px sans-serif';
    ctx.fillText('障碍墙', w.x - 4, w.top - 8);
    ctx.lineWidth = 1;
  }

  function drawPlacedBoxes(ctx, state) {
    state.placedBoxes.forEach((b) => {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    });
  }

  function drawTrolleyAndRope(ctx, state) {
    const tx = state.trolleyX;
    const ty = CFG.beam.y + CFG.trolley.height;
    // 小车
    ctx.fillStyle = '#c8d2dc';
    ctx.fillRect(tx - CFG.trolley.width / 2, CFG.beam.y,
      CFG.trolley.width, CFG.trolley.height);
    // 滑轮（固定轮 + 动轮示意）
    drawPulley(ctx, tx, ty + 6, 9, '#9fd0ff');
    if (state.box.attached && !state.box.falling) {
      drawPulley(ctx, state.box.x, state.box.y - state.box.h / 2 - 4, 7, '#ffd479');
      // 绳索：支点到货箱
      ctx.strokeStyle = state.tension > CFG.limits.tension.max ? '#ff5d5d' : '#d9e2ec';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx, ty + 6);
      ctx.lineTo(state.box.x, state.box.y - state.box.h / 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  function drawPulley(ctx, x, y, r, color) {
    ctx.fillStyle = '#2a3440';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 1;
  }

  function drawActiveBox(ctx, state, showForces) {
    const b = state.box;
    if (b.placed) return;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle || 0);
    ctx.fillStyle = b.color;
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();

    if (showForces && (b.airborne || b.falling)) drawForceVectors(ctx, state);
  }

  function drawForceVectors(ctx, state) {
    const b = state.box;
    const scale = 0.012;
    // 重力（向下，红）
    drawArrow(ctx, b.x, b.y, b.x, b.y + b.mass * CFG.G * scale * 3,
      '#ff6b6b', 'G');
    if (state.tension > 0) {
      // 张力（沿绳指向支点，蓝）
      const dx = state.trolleyX - b.x;
      const dy = (CFG.beam.y + CFG.trolley.height + 6) - b.y;
      const len = Math.hypot(dx, dy) || 1;
      const tLen = state.tension * scale;
      drawArrow(ctx, b.x, b.y,
        b.x + dx / len * tLen, b.y + dy / len * tLen, '#5db3ff', 'T');
    }
    // 速度矢量（绿）
    if (state.speed > 0.02) {
      drawArrow(ctx, b.x, b.y,
        b.x + b.vx * 0.12, b.y + b.vy * 0.12, '#7dffa7', 'v');
    }
  }

  function drawArrow(ctx, x0, y0, x1, y1, color, label) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    const ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - 8 * Math.cos(ang - 0.4), y1 - 8 * Math.sin(ang - 0.4));
    ctx.lineTo(x1 - 8 * Math.cos(ang + 0.4), y1 - 8 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
    ctx.font = '11px sans-serif';
    ctx.fillText(label, x1 + 4, y1);
    ctx.lineWidth = 1;
  }

  function drawClearanceMarks(ctx, state) {
    const lift = CFG.lifts[state.liftIndex];
    if (!lift) return;
    ctx.strokeStyle = 'rgba(255,212,121,0.7)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(CFG.wall.x + CFG.wall.w, lift.clearY);
    ctx.lineTo(CFG.view.w - 20, lift.clearY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd479';
    ctx.font = '11px sans-serif';
    ctx.fillText('最低越障高度', CFG.wall.x + CFG.wall.w + 6, lift.clearY - 4);
  }

  function drawFaultMarker(ctx, f) {
    if (typeof f.x !== 'number') return;
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(f.x - 24, f.y); ctx.lineTo(f.x + 24, f.y);
    ctx.moveTo(f.x, f.y - 24); ctx.lineTo(f.x, f.y + 24);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ff8080';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('首次故障点 t=' + f.t.toFixed(2) + 's', f.x + 22, f.y - 18);
  }

  global.CraneRender = { drawScene };
})(typeof window !== 'undefined' ? window : globalThis);
