(function (root) {
  "use strict";

  const BASE_W = 1600;
  const BASE_H = 900;
  const COLORS = {
    skyTop: "#07151b",
    skyMid: "#10292d",
    haze: "#335d59",
    ridgeFar: "#163238",
    ridgeNear: "#0b2026",
    cliff: "#07171b",
    cliffEdge: "#24433f",
    cable: "#b7c9bf",
    cyan: "#77e0d0",
    amber: "#f4bd65",
    red: "#ff7770",
    green: "#9be08e",
    ink: "#ecf3eb",
    muted: "#7f9b96",
  };

  function path(ctx, fn) {
    ctx.beginPath();
    fn();
  }

  function poly(ctx, points, close) {
    path(ctx, () => {
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (close) ctx.closePath();
    });
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    path(ctx, () => {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + width, y, x + width, y + height, r);
      ctx.arcTo(x + width, y + height, x, y + height, r);
      ctx.arcTo(x, y + height, x, y, r);
      ctx.arcTo(x, y, x + width, y, r);
      ctx.closePath();
    });
  }

  function dashedLine(ctx, x1, y1, x2, y2, dash, color, width) {
    ctx.save();
    ctx.setLineDash(dash || [5, 5]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1;
    path(ctx, () => {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawSky(ctx, state) {
    const gradient = ctx.createLinearGradient(0, 0, 0, BASE_H);
    gradient.addColorStop(0, COLORS.skyTop);
    gradient.addColorStop(0.43, COLORS.skyMid);
    gradient.addColorStop(0.72, "#27433f");
    gradient.addColorStop(1, "#09191c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    const glow = ctx.createRadialGradient(1020, 430, 20, 1020, 430, 470);
    glow.addColorStop(0, "rgba(240, 187, 112, 0.16)");
    glow.addColorStop(0.55, "rgba(111, 139, 118, 0.04)");
    glow.addColorStop(1, "rgba(5, 15, 18, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(450, 0, 1150, 820);

    for (let i = 0; i < 46; i += 1) {
      const x = (i * 197 + 61) % BASE_W;
      const y = 90 + ((i * 83) % 390);
      const alpha = 0.09 + ((i * 7) % 13) / 100;
      ctx.fillStyle = `rgba(206, 232, 219, ${alpha})`;
      ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1, 1);
    }

    const moon = ctx.createRadialGradient(1120, 140, 0, 1120, 140, 46);
    moon.addColorStop(0, "rgba(230, 238, 218, 0.28)");
    moon.addColorStop(0.32, "rgba(211, 224, 204, 0.08)");
    moon.addColorStop(1, "rgba(211, 224, 204, 0)");
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(1120, 140, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(220, 233, 215, 0.36)";
    ctx.beginPath();
    ctx.arc(1120, 140, 11, 0, Math.PI * 2);
    ctx.fill();
  }

  function mountainPoints(baseY, step, heights, offset) {
    const points = [[-40, BASE_H]];
    let x = -40;
    let index = 0;
    while (x < BASE_W + 80) {
      const h = heights[index % heights.length];
      points.push([x, baseY - h]);
      x += step * (0.72 + ((index * 13) % 9) / 18);
      index += 1;
    }
    points.push([BASE_W + 40, BASE_H]);
    return points;
  }

  function drawMountains(ctx, state) {
    const drift = (state.elapsed || 0) * 2.2;
    const far = mountainPoints(610, 120, [172, 96, 132, 76, 158, 110, 190], drift);
    poly(ctx, far, true);
    ctx.fillStyle = "rgba(22, 50, 56, 0.72)";
    ctx.fill();

    const near = mountainPoints(675, 155, [146, 90, 174, 62, 120, 200, 98], drift + 300);
    poly(ctx, near, true);
    ctx.fillStyle = "rgba(10, 31, 36, 0.9)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, 500);
    ctx.bezierCurveTo(220, 485, 390, 560, 565, 535);
    ctx.bezierCurveTo(755, 506, 930, 575, 1120, 530);
    ctx.bezierCurveTo(1310, 486, 1460, 550, 1600, 500);
    ctx.lineTo(1600, 690);
    ctx.lineTo(0, 690);
    ctx.closePath();
    ctx.fillStyle = "rgba(24, 58, 60, 0.36)";
    ctx.fill();
  }

  function drawWind(ctx, state) {
    const t = state.elapsed || 0;
    const dir = state.wind.dir || 1;
    const speed = state.wind.value || 8;
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < 22; i += 1) {
      const phase = ((t * (24 + speed * 2.2) + i * 89) % 1850) - 125;
      const x = dir > 0 ? phase : BASE_W - phase;
      const y = 190 + ((i * 73 + Math.sin(t * 0.3 + i) * 30) % 510);
      const length = 34 + (i % 7) * 10 + speed * 2.4;
      const alpha = 0.055 + (i % 4) * 0.018;
      ctx.strokeStyle = `rgba(164, 224, 212, ${alpha})`;
      ctx.lineWidth = i % 5 === 0 ? 1.3 : 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(
        x - dir * length * 0.35,
        y - 7,
        x - dir * length * 0.7,
        y + 4,
        x - dir * length,
        y - 1
      );
      ctx.stroke();
    }

    if (state.wind.gust > 4.7) {
      ctx.fillStyle = "rgba(198, 236, 219, 0.035)";
      for (let i = 0; i < 5; i += 1) {
        ctx.beginPath();
        const x = dir > 0 ? ((t * 160 + i * 320) % 1800) - 100 : 1700 - ((t * 160 + i * 320) % 1800);
        ctx.ellipse(x, 410 + i * 27, 150, 12, -0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawCanyon(ctx) {
    ctx.fillStyle = "rgba(5, 14, 17, 0.97)";
    poly(
      ctx,
      [
        [0, 300],
        [112, 325],
        [168, 390],
        [145, 476],
        [218, 560],
        [182, 670],
        [250, 720],
        [260, 900],
        [0, 900],
      ],
      true
    );
    ctx.fill();
    poly(
      ctx,
      [
        [1600, 250],
        [1470, 292],
        [1410, 364],
        [1438, 450],
        [1358, 538],
        [1395, 648],
        [1324, 728],
        [1300, 900],
        [1600, 900],
      ],
      true
    );
    ctx.fill();

    ctx.strokeStyle = "rgba(83, 126, 119, 0.24)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(112, 325);
    ctx.lineTo(168, 390);
    ctx.lineTo(145, 476);
    ctx.lineTo(218, 560);
    ctx.lineTo(182, 670);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(1470, 292);
    ctx.lineTo(1410, 364);
    ctx.lineTo(1438, 450);
    ctx.lineTo(1358, 538);
    ctx.lineTo(1395, 648);
    ctx.stroke();

    const fog = ctx.createLinearGradient(0, 600, 0, 900);
    fog.addColorStop(0, "rgba(66, 106, 100, 0)");
    fog.addColorStop(0.6, "rgba(46, 83, 80, 0.16)");
    fog.addColorStop(1, "rgba(8, 24, 27, 0.86)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 560, BASE_W, 340);

    ctx.strokeStyle = "rgba(118, 173, 161, 0.13)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = 700 + i * 45;
      ctx.beginPath();
      ctx.moveTo(190 - i * 20, y);
      ctx.bezierCurveTo(460, y - 25, 620, y + 23, 820, y);
      ctx.bezierCurveTo(1050, y - 22, 1230, y + 16, 1410 + i * 18, y - 4);
      ctx.stroke();
    }
  }

  function drawTower(ctx, x, baseY, topY, side) {
    ctx.save();
    ctx.strokeStyle = "rgba(146, 180, 171, 0.48)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 35, baseY);
    ctx.lineTo(x, topY);
    ctx.lineTo(x + 35, baseY);
    ctx.stroke();

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(146, 180, 171, 0.32)";
    for (let y = topY + 32; y < baseY; y += 34) {
      const spread = ((y - topY) / (baseY - topY)) * 34;
      ctx.beginPath();
      ctx.moveTo(x - spread, y);
      ctx.lineTo(x + spread, y + 29);
      ctx.moveTo(x + spread, y);
      ctx.lineTo(x - spread, y + 29);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(127, 162, 153, 0.44)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 60, topY + 3);
    ctx.lineTo(x + 60, topY + 3);
    ctx.stroke();
    ctx.fillStyle = "rgba(180, 208, 195, 0.65)";
    ctx.fillRect(x - 36, topY - 6, 72, 9);
    ctx.fillStyle = side === "left" ? COLORS.cyan : COLORS.amber;
    ctx.fillRect(x - 3, topY - 27, 6, 6);
    ctx.strokeStyle = "rgba(119, 224, 208, 0.18)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(x + (side === "left" ? 2 : -2), topY - 24, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function cablePoints() {
    const points = [];
    for (let x = 128; x <= 1470; x += 14) {
      points.push([x, root.RigSim.cableY(x)]);
    }
    points.push([1470, root.RigSim.cableY(1470)]);
    return points;
  }

  function drawCable(ctx, state) {
    const points = cablePoints();
    ctx.save();
    ctx.lineCap = "round";

    ctx.strokeStyle = "rgba(199, 222, 209, 0.11)";
    ctx.lineWidth = 14;
    poly(ctx, points, false);
    ctx.stroke();
    ctx.strokeStyle = "rgba(214, 229, 218, 0.25)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(232, 241, 230, 0.72)";
    ctx.lineWidth = 1.3;
    ctx.stroke();

    const item = root.RigSim.target(state);
    if (item) {
      const y = root.RigSim.cableY(item.x);
      const window = root.RigSim.CONFIG.physics.clampDistance;
      ctx.strokeStyle = "rgba(119, 224, 208, 0.32)";
      ctx.lineWidth = 9;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(item.x - window, root.RigSim.cableY(item.x - window));
      ctx.lineTo(item.x + window, root.RigSim.cableY(item.x + window));
      ctx.stroke();
      ctx.setLineDash([]);

      dashedLine(ctx, item.x, y - 30, item.x, y - 74, [4, 5], "rgba(119, 224, 208, 0.45)", 1);
      ctx.fillStyle = "rgba(7, 20, 24, 0.82)";
      roundRect(ctx, item.x - 29, y - 99, 58, 20, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(119, 224, 208, 0.42)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = COLORS.cyan;
      ctx.font = "600 8px 'SFMono-Regular', 'Rig Sans', Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`窗口 ${item.x}m`, item.x, y - 86);
    }

    const minX = root.RigSim.CONFIG.world.minX;
    const maxX = root.RigSim.CONFIG.world.maxX;
    ctx.textAlign = "left";
    ctx.font = "600 8px 'SFMono-Regular', 'Rig Sans', Consolas, monospace";
    ctx.fillStyle = "rgba(119, 224, 208, 0.53)";
    ctx.fillText("P1 驱动域  A / D", minX, root.RigSim.cableY(minX) + 50);
    ctx.textAlign = "right";
    ctx.fillText("S 急停", maxX, root.RigSim.cableY(maxX) + 50);
    dashedLine(
      ctx,
      minX,
      root.RigSim.cableY(minX) + 38,
      maxX,
      root.RigSim.cableY(maxX) + 38,
      [3, 8],
      "rgba(119, 224, 208, 0.15)",
      1
    );
    ctx.restore();
  }

  function drawPulley(ctx, state, pulley) {
    const y = root.RigSim.cableY(pulley.x);
    const isCurrent = pulley.status === "pending" && pulley.index === state.targetIndex;
    const done = pulley.status === "done";
    const align = isCurrent ? root.RigSim.alignMetrics(state, pulley) : null;
    const accent = done ? COLORS.green : isCurrent ? COLORS.cyan : "rgba(146, 177, 168, 0.55)";
    ctx.save();

    if (isCurrent) {
      const pulse = 0.5 + Math.sin((state.elapsed || 0) * 3.1) * 0.16;
      ctx.strokeStyle = `rgba(119, 224, 208, ${pulse * 0.45})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pulley.x, y + 28, 31 + (align && align.aligned ? 4 : 0), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pulley.x, y);
    ctx.lineTo(pulley.x, y + 13);
    ctx.stroke();
    ctx.fillStyle = "#20373a";
    ctx.fillRect(pulley.x - 5, y + 11, 10, 8);

    ctx.fillStyle = done ? "rgba(155, 224, 142, 0.12)" : "rgba(13, 31, 34, 0.9)";
    ctx.beginPath();
    ctx.arc(pulley.x, y + 29, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(218, 231, 219, 0.52)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(pulley.x, y + 29, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(pulley.x, y + 29, 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (done) {
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pulley.x - 5, y + 29);
      ctx.lineTo(pulley.x - 1, y + 33);
      ctx.lineTo(pulley.x + 7, y + 24);
      ctx.stroke();
    } else if (isCurrent && state.installProgress > 0) {
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        pulley.x,
        y + 29,
        19,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * state.installProgress
      );
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.font = "600 8px 'SFMono-Regular', 'Rig Sans', Consolas, monospace";
    ctx.fillStyle = accent;
    ctx.fillText(`P-${pulley.index + 1}`, pulley.x, y + 62);
    ctx.fillStyle = "rgba(143, 170, 162, 0.62)";
    ctx.fillText(done ? "已更换" : isCurrent ? "作业点" : "待命", pulley.x, y + 73);
    ctx.restore();
  }

  function drawToolBeacon(ctx, state) {
    if (state.resources.tool !== "lost" || state.resources.dropX === null) return;
    const x = state.resources.dropX;
    const cable = root.RigSim.cableY(x);
    const wave = (state.elapsed || 0) * 2.2;
    ctx.save();
    dashedLine(ctx, x, cable + 40, x, cable + 190, [3, 7], "rgba(255, 119, 112, 0.35)", 1);
    ctx.translate(x, cable + 206);
    ctx.rotate(Math.sin(wave) * 0.09);
    ctx.fillStyle = "rgba(47, 18, 16, 0.94)";
    roundRect(ctx, -15, -11, 30, 20, 3);
    ctx.fill();
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = COLORS.amber;
    ctx.fillRect(-9, -4, 18, 5);
    ctx.strokeStyle = COLORS.red;
    ctx.beginPath();
    ctx.arc(0, 0, 23 + Math.sin(wave) * 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.red;
    ctx.font = "600 8px 'SFMono-Regular', 'Rig Sans', Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("锁扣坠落点", 0, 38);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255, 119, 112, 0.36)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x - 44, root.RigSim.cableY(x - 44));
    ctx.lineTo(x + 44, root.RigSim.cableY(x + 44));
    ctx.stroke();
    ctx.restore();
  }

  function drawReachArc(ctx, state, basket) {
    const radius = 145;
    const baseAngle = -Math.PI / 2;
    const span = 1.03;
    ctx.save();
    ctx.translate(basket.x, basket.y - 7);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, baseAngle - span, baseAngle + span);
    ctx.closePath();
    ctx.fillStyle = "rgba(244, 189, 101, 0.045)";
    ctx.fill();

    ctx.setLineDash([4, 7]);
    ctx.strokeStyle = "rgba(244, 189, 101, 0.19)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius, baseAngle - span, baseAngle + span);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(244, 189, 101, 0.16)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.sin(-span) * radius, -Math.cos(span) * radius);
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.sin(span) * radius, -Math.cos(span) * radius);
    ctx.stroke();

    ctx.fillStyle = "rgba(244, 189, 101, 0.58)";
    ctx.font = "600 8px 'SFMono-Regular', 'Rig Sans', Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("P2 摆臂域 ±59°", 0, -radius - 9);
    ctx.restore();
  }

  function drawArm(ctx, state, basket, current) {
    const baseX = basket.x;
    const baseY = basket.y - 9;
    const angle = state.arm.angle;
    let length = 98;
    let targetTip = null;
    if (current) {
      const py = root.RigSim.cableY(current.x);
      const distance = Math.hypot(current.x - basket.x, py - basket.y);
      if (distance < 158) length = Math.max(84, distance);
      const desired = Math.atan2(current.x - basket.x, Math.max(12, basket.y - py));
      targetTip = {
        x: basket.x + Math.sin(desired) * distance,
        y: basket.y - Math.cos(desired) * distance,
      };
    }
    const tipX = baseX + Math.sin(angle) * length;
    const tipY = baseY - Math.cos(angle) * length;
    const metrics = current ? root.RigSim.alignMetrics(state, current) : null;
    const activeColor = metrics && metrics.aligned ? COLORS.green : COLORS.amber;

    if (targetTip) {
      dashedLine(
        ctx,
        tipX,
        tipY,
        targetTip.x,
        targetTip.y,
        [2, 6],
        metrics && metrics.aligned ? "rgba(155, 224, 142, 0.58)" : "rgba(244, 189, 101, 0.28)",
        1
      );
    }

    ctx.save();
    ctx.strokeStyle = "rgba(244, 189, 101, 0.22)";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "rgba(8, 21, 24, 0.84)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const jointX = baseX + Math.sin(angle) * length * 0.52;
    const jointY = baseY - Math.cos(angle) * length * 0.52;
    ctx.fillStyle = "#0b1b1f";
    ctx.beginPath();
    ctx.arc(jointX, jointY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.translate(tipX, tipY);
    ctx.rotate(angle);
    ctx.fillStyle = state.clampHeld ? activeColor : "rgba(244, 189, 101, 0.2)";
    roundRect(ctx, -7, -5, 14, 10, 2);
    ctx.fill();
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawTrolley(ctx, state) {
    const x = state.trolley.x;
    const y = root.RigSim.cableY(x);
    const basket = root.RigSim.basketPosition(state);
    const current = root.RigSim.target(state);
    const metrics = current ? root.RigSim.alignMetrics(state, current) : null;

    drawReachArc(ctx, state, basket);

    ctx.save();
    ctx.strokeStyle = "rgba(193, 212, 201, 0.28)";
    ctx.lineWidth = 1;
    dashedLine(ctx, x, y, x, y + 62, [3, 5], "rgba(180, 204, 193, 0.22)", 1);
    ctx.beginPath();
    ctx.moveTo(x, y + 35);
    ctx.arc(x, y + 35, 22, Math.PI / 2, Math.PI / 2 + state.swing.theta);
    ctx.stroke();

    ctx.strokeStyle = "rgba(211, 224, 213, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 13, y + 6);
    ctx.lineTo(basket.x - 20, basket.y - 14);
    ctx.moveTo(x + 13, y + 6);
    ctx.lineTo(basket.x + 20, basket.y - 14);
    ctx.stroke();

    ctx.fillStyle = "#09181b";
    roundRect(ctx, x - 34, y - 18, 68, 25, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(196, 215, 203, 0.62)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(x - 26, y - 14, 21, 3);
    ctx.fillStyle = "rgba(119, 224, 208, 0.28)";
    ctx.fillRect(x - 26, y - 9, 36, 2);
    ctx.fillStyle = "rgba(220, 229, 216, 0.75)";
    for (const wheelX of [x - 20, x + 20]) {
      ctx.beginPath();
      ctx.arc(wheelX, y - 19, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(8, 20, 23, 0.8)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(8, 20, 23, 0.96)";
    roundRect(ctx, basket.x - 34, basket.y - 20, 68, 40, 3);
    ctx.fill();
    ctx.strokeStyle = metrics && metrics.aligned ? COLORS.green : "rgba(224, 192, 126, 0.7)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = "rgba(244, 189, 101, 0.74)";
    ctx.fillRect(basket.x - 30, basket.y + 13, 60, 3);
    ctx.fillStyle = "rgba(14, 34, 36, 0.9)";
    for (let i = -2; i <= 2; i += 1) {
      ctx.save();
      ctx.translate(basket.x + i * 11, basket.y + 14);
      ctx.rotate(-0.68);
      ctx.fillRect(-2, -3, 4, 7);
      ctx.restore();
    }

    ctx.fillStyle = "#142a2c";
    ctx.beginPath();
    ctx.arc(basket.x - 11, basket.y - 7, 5, 0, Math.PI * 2);
    ctx.arc(basket.x + 10, basket.y - 7, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.amber;
    ctx.fillRect(basket.x - 26, basket.y - 14, 4, 3);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(basket.x + 22, basket.y - 14, 4, 3);
    ctx.restore();

    drawArm(ctx, state, basket, current);

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "600 8px 'SFMono-Regular', 'Rig Sans', Consolas, monospace";
    if (metrics && metrics.aligned) {
      ctx.fillStyle = COLORS.green;
      ctx.fillText("双席对位 · 可夹持", basket.x, basket.y + 49);
    } else if (metrics && state.clampHeld) {
      ctx.fillStyle = COLORS.amber;
      ctx.fillText("夹持偏位 · 调整中", basket.x, basket.y + 49);
    } else if (state.resources.tool === "lost") {
      ctx.fillStyle = COLORS.red;
      ctx.fillText("锁扣遗失 · 前往红标", basket.x, basket.y + 49);
    }
    ctx.restore();
  }

  function drawSceneAnnotations(ctx, state) {
    const item = root.RigSim.target(state);
    if (!item) return;
    const metrics = root.RigSim.alignMetrics(state, item);
    const x = state.trolley.x;
    const y = root.RigSim.cableY(x);
    const dir = item.x > x ? 1 : -1;
    const distance = Math.abs(item.x - x);
    if (distance < 8) return;

    ctx.save();
    ctx.translate(Math.min(BASE_W - 120, Math.max(120, x + dir * 74)), y + 98);
    ctx.strokeStyle = metrics.aligned ? COLORS.green : "rgba(119, 224, 208, 0.38)";
    ctx.fillStyle = metrics.aligned ? COLORS.green : "rgba(119, 224, 208, 0.58)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dir * 24, 0);
    ctx.lineTo(dir * 18, -4);
    ctx.moveTo(dir * 24, 0);
    ctx.lineTo(dir * 18, 4);
    ctx.stroke();
    ctx.font = "600 8px 'SFMono-Regular', 'Rig Sans', Consolas, monospace";
    ctx.textAlign = dir > 0 ? "left" : "right";
    ctx.fillText(`${Math.round(distance)}m`, dir > 0 ? 30 : -30, 3);
    ctx.restore();
  }

  function render(ctx, width, height, state, options) {
    const settings = options || {};
    const scale = Math.max(width / BASE_W, height / BASE_H);
    const offsetX = (width - BASE_W * scale) / 2;
    const offsetY = (height - BASE_H * scale) / 2;
    ctx.save();
    ctx.fillStyle = "#061116";
    ctx.fillRect(0, 0, width, height);
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    drawBackground(ctx, state);
    drawCable(ctx, state);
    state.pulleys.forEach((pulley) => drawPulley(ctx, state, pulley));
    drawToolBeacon(ctx, state);
    drawTrolley(ctx, state);
    drawSceneAnnotations(ctx, state);

    if (state.protection) {
      ctx.fillStyle = "rgba(50, 8, 7, 0.1)";
      ctx.fillRect(0, 0, BASE_W, BASE_H);
    }
    ctx.restore();
  }

  function drawWindLabel(ctx, state) {
    ctx.save();
    ctx.fillStyle = "rgba(142, 190, 179, 0.38)";
    ctx.font = "600 9px 'SFMono-Regular', 'Rig Sans', Consolas, monospace";
    ctx.letterSpacing = "2px";
    ctx.fillText("CROSSWIND / 峡谷风廊", 78, 190);
    ctx.fillStyle = "rgba(119, 224, 208, 0.55)";
    ctx.fillText(`${state.wind.value.toFixed(1)} m/s →`, 78, 206);
    ctx.restore();
  }

  function drawAtmosphere(ctx, state) {
    const tunnel = ctx.createRadialGradient(800, 410, 40, 800, 410, 560);
    tunnel.addColorStop(0, "rgba(197, 222, 209, 0.025)");
    tunnel.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = tunnel;
    ctx.fillRect(0, 0, BASE_W, BASE_H);
  }

  function drawBackground(ctx, state) {
    drawSky(ctx, state);
    drawMountains(ctx, state);
    drawWind(ctx, state);
    drawCanyon(ctx);
    drawTower(ctx, 128, 560, 230, "left");
    drawTower(ctx, 1470, 560, 248, "right");
    drawWindLabel(ctx, state);
    drawAtmosphere(ctx, state);
  }

  root.RigRender = {
    BASE_W,
    BASE_H,
    COLORS,
    path,
    poly,
    roundRect,
    dashedLine,
    drawBackground,
    render,
  };
})(window);
