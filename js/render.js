/* Canvas 俯视港区渲染：水面、湿滑码头、窄巷、障碍、拖车、货柜与调试路径。 */
(function (G) {
  'use strict';
  const { CFG, currentWind, wetSurface } = G.TowConfig;
  const CJK_MONO = '"Noto Sans SC Local", "DejaVu Sans Mono", monospace';

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function seededColor(id, saturation, light) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 35 + 18) + ' ' + saturation + '% ' + light + '%)';
  }

  function drawWater(ctx, sim) {
    const water = ctx.createLinearGradient(0, 0, 0, sim.world.waterY);
    water.addColorStop(0, '#061a24');
    water.addColorStop(0.55, '#0a2b38');
    water.addColorStop(1, '#0d3745');
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, CFG.WORLD_W, sim.world.waterY);

    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.strokeStyle = '#66bfc7';
    ctx.lineWidth = 1;
    for (let row = 0; row < 5; row++) {
      const y = 12 + row * 16;
      ctx.beginPath();
      for (let x = -20; x <= CFG.WORLD_W + 20; x += 12) {
        const yy = y + Math.sin(x * 0.018 + sim.t * (0.7 + row * 0.07) + row) * 2.2;
        if (x === -20) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(161, 221, 220, 0.22)';
    ctx.font = '700 9px ' + CJK_MONO;
    ctx.fillText('TERMINAL BASIN  /  BERTH 04', 826, 40);
    ctx.fillStyle = 'rgba(217, 166, 80, 0.58)';
    ctx.fillRect(0, CFG.WATER_Y - 5, CFG.WORLD_W, 2);
    for (let x = 0; x < CFG.WORLD_W; x += 28) {
      ctx.fillStyle = x % 56 === 0 ? '#d89b46' : '#20343a';
      ctx.fillRect(x, CFG.WATER_Y - 8, 14, 3);
    }
  }

  function drawCrane(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#36565e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-30, 0); ctx.lineTo(-30, -34);
    ctx.moveTo(26, 0); ctx.lineTo(26, -34);
    ctx.moveTo(-38, -34); ctx.lineTo(52, -34);
    ctx.moveTo(12, -34); ctx.lineTo(12, -57);
    ctx.moveTo(12, -52); ctx.lineTo(-24, -42);
    ctx.stroke();
    ctx.fillStyle = '#cf9148';
    ctx.fillRect(8, -61, 8, 7);
    ctx.fillStyle = '#26434b';
    ctx.fillRect(-36, -2, 68, 5);
    ctx.restore();
  }

  function drawGround(ctx, sim) {
    const ground = ctx.createLinearGradient(0, CFG.WATER_Y, 0, CFG.WORLD_H);
    ground.addColorStop(0, '#18333a');
    ground.addColorStop(0.22, '#172e33');
    ground.addColorStop(1, '#102329');
    ctx.fillStyle = ground;
    ctx.fillRect(0, CFG.WATER_Y, CFG.WORLD_W, CFG.WORLD_H - CFG.WATER_Y);

    ctx.save();
    ctx.strokeStyle = 'rgba(134, 166, 166, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 50; x < CFG.WORLD_W; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, CFG.WATER_Y); ctx.lineTo(x, CFG.WORLD_H); ctx.stroke();
    }
    for (let y = CFG.WATER_Y + 40; y < CFG.WORLD_H; y += 65) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CFG.WORLD_W, y); ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(85, 134, 138, 0.08)';
    ctx.font = '800 76px ' + CJK_MONO;
    ctx.fillText('YARD 04', 430, 435);
    ctx.fillStyle = 'rgba(96, 148, 151, 0.18)';
    ctx.font = '700 10px ' + CJK_MONO;
    ctx.fillText('QUARANTINE TRANSFER LANE', 92, 518);
  }

  function drawWetQuay(ctx, sim) {
    const h = sim.world.wetQuayY - sim.world.waterY;
    const grad = ctx.createLinearGradient(0, sim.world.waterY, 0, sim.world.wetQuayY);
    grad.addColorStop(0, 'rgba(63, 137, 148, 0.3)');
    grad.addColorStop(0.45, 'rgba(41, 94, 103, 0.42)');
    grad.addColorStop(1, 'rgba(24, 55, 62, 0.18)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, sim.world.waterY, CFG.WORLD_W, h);
    ctx.save();
    ctx.globalAlpha = 0.38;
    for (let i = 0; i < 12; i++) {
      const x = 70 + i * 98 + Math.sin(i * 4.2) * 25;
      const y = sim.world.waterY + 17 + (i * 19) % 58;
      const rw = 36 + (i * 17) % 65;
      const p = ctx.createRadialGradient(x, y, 0, x, y, rw);
      p.addColorStop(0, 'rgba(119, 195, 196, 0.22)');
      p.addColorStop(1, 'rgba(53, 112, 121, 0)');
      ctx.fillStyle = p;
      ctx.beginPath(); ctx.ellipse(x, y, rw, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(91, 217, 207, 0.45)';
    ctx.font = '700 9px ' + CJK_MONO;
    ctx.fillText('WET QUAY · 低摩擦', 48, 202);
    ctx.strokeStyle = 'rgba(112, 189, 190, 0.18)';
    ctx.beginPath(); ctx.moveTo(42, sim.world.wetQuayY + 8); ctx.lineTo(1160, sim.world.wetQuayY + 8); ctx.stroke();
  }

  function drawDecor(ctx, sim) {
    for (const d of sim.world.decorStacks) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);
      ctx.fillStyle = '#203b42';
      ctx.fillRect(-29, -13, 58, 26);
      ctx.strokeStyle = '#36565d';
      ctx.strokeRect(-29, -13, 58, 26);
      ctx.fillStyle = 'rgba(154, 183, 181, 0.12)';
      for (let i = -18; i <= 18; i += 9) ctx.fillRect(i, -11, 2, 22);
      ctx.restore();
    }
    drawCrane(ctx, 128, 84, 0.9);
    drawCrane(ctx, 1058, 84, 1.05);
    drawCrane(ctx, 596, 84, 0.75);
  }

  function drawDropZone(ctx, sim) {
    const x = 78, y = 522, w = 330, h = 118;
    ctx.save();
    ctx.fillStyle = 'rgba(58, 84, 60, 0.16)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255, 178, 90, 0.46)';
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 178, 90, 0.8)';
    ctx.font = '700 9px ' + CJK_MONO;
    ctx.fillText('QUARANTINE DROP / 隔离交付位', x + 10, y + 17);
    for (const slot of sim.world.dropSlots) {
      const missionIndex = sim.world.mission.findIndex((m) => m.drop.x === slot.x && m.drop.y === slot.y);
      const delivered = missionIndex >= 0 && sim.cargoStates[missionIndex].status === 'delivered';
      ctx.strokeStyle = delivered ? 'rgba(120, 222, 155, 0.75)' : 'rgba(255, 178, 90, 0.55)';
      ctx.strokeRect(slot.x - 31, slot.y - 23, 62, 46);
      ctx.fillStyle = delivered ? 'rgba(120, 222, 155, 0.12)' : 'rgba(255, 178, 90, 0.06)';
      ctx.fillRect(slot.x - 31, slot.y - 23, 62, 46);
      ctx.fillStyle = delivered ? '#78de9b' : '#c9904a';
      ctx.font = '700 9px ' + CJK_MONO;
      ctx.fillText(delivered ? '✓' : 'S' + (missionIndex + 1), slot.x - 26, slot.y - 11);
    }
    ctx.restore();
  }

  function drawAlley(ctx, sim) {
    const a = sim.world.alley;
    ctx.save();
    ctx.fillStyle = 'rgba(9, 27, 32, 0.34)';
    ctx.fillRect(a.left, a.top, a.right - a.left, a.bottom - a.top);
    ctx.strokeStyle = 'rgba(255, 178, 90, 0.42)';
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(a.left + 14, a.top + 12, a.right - a.left - 28, a.bottom - a.top - 24);
    ctx.setLineDash([]);
    const walls = [
      [a.left - 10, a.top, 10, a.bottom - a.top],
      [a.right, a.top, 10, a.bottom - a.top],
      [a.left - 10, a.top - 10, a.right - a.left + 20, 10]
    ];
    for (const [x, y, w, h] of walls) {
      ctx.fillStyle = '#293b3e';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#4a6363';
      ctx.strokeRect(x, y, w, h);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(255, 178, 90, 0.32)';
      ctx.lineWidth = 5;
      for (let i = -h; i < w + h; i += 20) {
        ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.translate(a.left + 34, (a.top + a.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255, 178, 90, 0.52)';
    ctx.font = '700 9px ' + CJK_MONO;
    ctx.textAlign = 'center';
    ctx.fillText('NARROW REVERSE CHANNEL / 精确倒车', 0, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 178, 90, 0.56)';
    ctx.font = '700 8px ' + CJK_MONO;
    ctx.fillText('↕ REVERSE OUT', a.left + 62, a.bottom - 12);
    ctx.restore();
  }

  function drawObstacle(ctx, sim, o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.type === 'stack') {
      ctx.fillStyle = '#1d343b';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 7;
      ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = seededColor(o.id, 32, 48);
      ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
      ctx.fillStyle = 'rgba(255, 178, 90, 0.48)';
      ctx.fillRect(-o.w / 2, -2, o.w, 2);
      ctx.fillStyle = 'rgba(198, 216, 213, 0.27)';
      ctx.font = '700 7px ' + CJK_MONO;
      ctx.textAlign = 'center';
      ctx.fillText('STACK', 0, 2);
      ctx.fillStyle = 'rgba(255, 178, 90, 0.55)';
      ctx.fillText(o.id, 0, o.h / 2 + 8);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, o.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#16282d';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 178, 90, 0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb25a'; ctx.fill();
    }
    ctx.restore();
  }

  function drawMissionObjects(ctx, sim) {
    for (let i = 0; i < sim.world.mission.length; i++) {
      const mission = sim.world.mission[i];
      const cargo = sim.cargoStates[i];
      if (cargo.status !== 'pending') continue;
      const active = sim.progress.activeIndex === i;
      ctx.save();
      ctx.translate(cargo.x, cargo.y);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = active ? seededColor(cargo.cargoId, 44, 42) : 'rgba(40, 63, 67, 0.55)';
      ctx.shadowColor = active ? 'rgba(255, 178, 90, 0.28)' : 'transparent';
      ctx.shadowBlur = active ? 18 : 0;
      ctx.fillRect(-22, -11, 44, 22);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = active ? 'rgba(255, 205, 140, 0.85)' : 'rgba(87, 119, 122, 0.5)';
      ctx.strokeRect(-22, -11, 44, 22);
      ctx.fillStyle = active ? 'rgba(255, 235, 201, 0.78)' : 'rgba(163, 186, 184, 0.45)';
      ctx.font = '700 7px ' + CJK_MONO;
      ctx.textAlign = 'center';
      ctx.fillText(cargo.cargoId, 0, 2);
      ctx.restore();
      if (active) {
        const pulse = 0.5 + Math.sin(sim.t * 3) * 0.18;
        ctx.strokeStyle = 'rgba(255, 178, 90, ' + pulse + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cargo.x, cargo.y, 31 + Math.sin(sim.t * 2) * 2, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#ffb25a';
        ctx.font = '700 9px ' + CJK_MONO;
        ctx.fillText('PICKUP ' + mission.seq, cargo.x - 24, cargo.y - 26);
      }
    }
    for (const cargo of sim.cargoStates) {
      if (cargo.status !== 'delivered') continue;
      drawCargoBox(ctx, cargo.x, cargo.y, Math.PI / 2, cargo.cargoId, 0.8);
    }
  }

  function drawPath(ctx, sim, path) {
    if (!path || !path.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(91, 217, 207, 0.65)';
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -sim.t * 18;
    ctx.beginPath();
    ctx.moveTo(sim.truck.x, sim.truck.y);
    for (const p of path) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 1; i < path.length; i++) {
      ctx.beginPath();
      ctx.arc(path[i].x, path[i].y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = i === path.length - 1 ? '#ffb25a' : '#5bd9cf';
      ctx.fill();
    }
    const target = path[path.length - 1];
    ctx.strokeStyle = 'rgba(255, 178, 90, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(target.x, target.y, 15, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawCargoBox(ctx, x, y, heading, id, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.fillStyle = seededColor(id, 44, 39);
    roundRect(ctx, -24, -12, 48, 24, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 212, 153, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(22, 37, 39, 0.32)';
    for (let i = -15; i <= 15; i += 7) {
      ctx.beginPath(); ctx.moveTo(i, -11); ctx.lineTo(i, 11); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 233, 199, 0.88)';
    ctx.font = '700 7px ' + CJK_MONO;
    ctx.textAlign = 'center';
    ctx.fillText(id, 0, 2.5);
    ctx.restore();
  }

  function drawTruck(ctx, sim) {
    const cargo = G.TowSim.attachedCargo(sim);
    if (cargo) {
      const pose = G.TowSim.cargoPose(sim, cargo);
      ctx.save();
      ctx.strokeStyle = '#8d9c99';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sim.truck.x - Math.cos(sim.truck.heading) * 20, sim.truck.y - Math.sin(sim.truck.heading) * 20);
      ctx.lineTo(pose.x + Math.cos(pose.heading) * 23, pose.y + Math.sin(pose.heading) * 23);
      ctx.stroke();
      ctx.strokeStyle = '#ffb25a';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      drawCargoBox(ctx, pose.x, pose.y, pose.heading, cargo.cargoId, 1);
    }

    ctx.save();
    ctx.translate(sim.truck.x, sim.truck.y);
    ctx.rotate(sim.truck.heading);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.ellipse(-2, 4, 27, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#111d20';
    for (const x of [-16, 12]) {
      for (const y of [-14, 11]) {
        roundRect(ctx, x, y, 12, 4, 1.5);
        ctx.fill();
      }
    }

    const bodyGrad = ctx.createLinearGradient(-23, 0, 23, 0);
    bodyGrad.addColorStop(0, '#b9c8c6');
    bodyGrad.addColorStop(0.65, '#e1e9e6');
    bodyGrad.addColorStop(1, '#8ba39f');
    ctx.fillStyle = bodyGrad;
    roundRect(ctx, -23, -12, 46, 24, 4);
    ctx.fill();
    ctx.strokeStyle = '#3d575b';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = '#16353d';
    roundRect(ctx, 7, -10, 13, 20, 2);
    ctx.fill();
    ctx.fillStyle = '#6fd7cf';
    ctx.fillRect(14, -8, 3, 16);
    ctx.fillStyle = 'rgba(219, 247, 241, 0.7)';
    ctx.fillRect(10, -8, 2, 6);
    ctx.fillRect(10, 2, 2, 6);

    ctx.fillStyle = '#ffb25a';
    ctx.fillRect(-21, -12, 3, 3);
    ctx.fillRect(-21, 9, 3, 3);
    ctx.fillStyle = '#fff0c3';
    ctx.beginPath(); ctx.arc(22, -7, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(22, 7, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sim.truck.speed < -0.5 ? '#ff7164' : '#27464d';
    ctx.fillRect(-24, -9, 2, 18);

    ctx.fillStyle = '#ffb25a';
    ctx.beginPath();
    ctx.moveTo(-8, -5); ctx.lineTo(1, -5); ctx.lineTo(1, -9); ctx.lineTo(7, 0);
    ctx.lineTo(1, 9); ctx.lineTo(1, 5); ctx.lineTo(-8, 5);
    ctx.closePath(); ctx.fill();

    if (sim.stats.motorWork > 0.35) {
      ctx.strokeStyle = 'rgba(91, 217, 207, 0.34)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-27 - i * 5, -5 + i * 3);
        ctx.lineTo(-33 - i * 5, -5 + i * 3);
        ctx.stroke();
      }
    }
    ctx.restore();

    if (sim.collisionFlash > 0) {
      ctx.save();
      ctx.globalAlpha = sim.collisionFlash * 0.32;
      ctx.fillStyle = '#ff5d50';
      ctx.fillRect(0, 0, CFG.WORLD_W, CFG.WORLD_H);
      ctx.restore();
    }
  }

  function drawInteractionHint(ctx, sim) {
    if (sim.phase !== 'playing') return;
    const cargo = G.TowSim.attachedCargo(sim);
    let point = null;
    let text = '';
    if (!cargo) {
      const m = G.TowSim.activeMission(sim);
      if (m && Math.hypot(sim.truck.x - m.pickup.x, sim.truck.y - m.pickup.y) < 78) {
        point = m.pickup;
        text = 'E  挂接 ' + m.cargoId;
      }
    } else {
      const m = G.TowSim.activeMission(sim);
      const pose = G.TowSim.cargoPose(sim, cargo);
      if (m && Math.hypot(pose.x - m.drop.x, pose.y - m.drop.y) < 82) {
        point = m.drop;
        text = 'E  放入隔离位';
      }
    }
    if (!point) return;
    const y = point.y - 43;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 25, 30, 0.92)';
    roundRect(ctx, point.x - 52, y - 12, 104, 20, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 178, 90, 0.72)';
    ctx.stroke();
    ctx.fillStyle = '#ffd59e';
    ctx.font = '700 9px ' + CJK_MONO;
    ctx.textAlign = 'center';
    ctx.fillText(text, point.x, y + 2);
    ctx.restore();
  }

  function drawWindField(ctx, sim) {
    const wind = currentWind(sim.world, sim.t);
    const dx = Math.cos(wind.angle);
    const dy = Math.sin(wind.angle);
    ctx.save();
    ctx.strokeStyle = 'rgba(132, 205, 207, 0.13)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const x = 410 + (i * 83) % 650;
      const y = 238 + (i * 47) % 280;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dx * (14 + i % 3 * 4), y + dy * (14 + i % 3 * 4));
      ctx.stroke();
    }
    ctx.restore();
  }

  function TowRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    let path = [];
    let pathTarget = '';
    let pathAt = -10;
    let pathOrigin = { x: 0, y: 0 };

    function updatePath(sim, debug) {
      if (!debug) return;
      const target = G.TowSim.navTarget(sim);
      if (!target) { path = []; return; }
      const key = target.kind + ':' + target.cargoId;
      const age = sim.t - pathAt;
      const moved = Math.hypot(sim.truck.x - pathOrigin.x, sim.truck.y - pathOrigin.y);
      if (key !== pathTarget || age > 0.85 || moved > 42) {
        path = G.TowNav.findPath(sim.world, sim.truck, target, 25);
        pathTarget = key;
        pathAt = sim.t;
        pathOrigin = { x: sim.truck.x, y: sim.truck.y };
      }
    }

    function draw(sim, options) {
      const opts = options || {};
      updatePath(sim, opts.debug);
      ctx.clearRect(0, 0, CFG.WORLD_W, CFG.WORLD_H);
      drawWater(ctx, sim);
      drawGround(ctx, sim);
      drawWetQuay(ctx, sim);
      drawDecor(ctx, sim);
      drawWindField(ctx, sim);
      drawDropZone(ctx, sim);
      drawAlley(ctx, sim);
      for (const o of sim.world.obstacles) drawObstacle(ctx, sim, o);
      drawMissionObjects(ctx, sim);
      if (opts.debug) drawPath(ctx, sim, path);
      drawTruck(ctx, sim);
      drawInteractionHint(ctx, sim);

      if (wetSurface(sim.world, sim.truck.x, sim.truck.y)) {
        ctx.strokeStyle = 'rgba(91, 217, 207, 0.44)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sim.truck.x, sim.truck.y, 27 + Math.sin(sim.t * 4) * 2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(142, 177, 178, 0.35)';
      ctx.font = '700 8px ' + CJK_MONO;
      ctx.textAlign = 'left';
      ctx.fillText('SEED ' + sim.seed + '  ·  ' + sim.world.signature + '  ·  OBSTACLE ORDER LOCKED', 50, CFG.WORLD_H - 20);
      ctx.textAlign = 'right';
      ctx.fillStyle = sim.phase === 'failed' ? 'rgba(255,113,100,0.7)' :
        sim.phase === 'won' ? 'rgba(120,222,155,0.7)' : 'rgba(91,217,207,0.42)';
      ctx.fillText(sim.phase === 'failed' ? 'MISSION FAILED' :
        sim.phase === 'won' ? 'MISSION COMPLETE' : 'LIVE SIMULATION / ' + G.TowSim.fmtTime(sim.t), 1150, CFG.WORLD_H - 20);
    }

    return { draw };
  }

  G.TowRenderer = TowRenderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = { TowRenderer };
})(typeof globalThis !== 'undefined' ? globalThis : this);


