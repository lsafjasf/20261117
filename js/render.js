/* Canvas 场景渲染：果园 → 公路 → 第二片花田，含卡车/蜂箱/天气/目标落点 */
(function (G) {
  const { CFG, weatherAt, ambientTemp } = G.BeeConfig;

  function Renderer(canvas) {
    const cv = canvas;
    const ctx = cv.getContext('2d');

  function draw(sim) {
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    drawSky(ctx, W, H, sim);
    drawOrchard(ctx, W, H);
    drawRoad(ctx, W, H, sim);
    drawField(ctx, W, H, sim);
    drawWeather(ctx, W, H, sim);
    if (sim.phase === 'idle') drawParkedTruck(ctx, W, H, sim);
    else drawTruck(ctx, W, H, sim);
    drawHudOverlay(ctx, W, H, sim);
  }

  function drawSky(c, W, H, sim) {
    const w = weatherAt(sim.world, sim.t);
    const grad = c.createLinearGradient(0, 0, 0, H);
    if (w.rain) {
      grad.addColorStop(0, '#46566b'); grad.addColorStop(1, '#6e7d86');
    } else if (w.heatwave) {
      grad.addColorStop(0, '#7a4a2a'); grad.addColorStop(1, '#c98a48');
    } else {
      grad.addColorStop(0, '#87b7e0'); grad.addColorStop(1, '#d8ecc9');
    }
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
    // 太阳（热浪时更大更红）
    c.fillStyle = w.heatwave ? '#ff7a3c' : '#ffe98a';
    c.beginPath();
    c.arc(W - 90, 70, w.heatwave ? 42 : 32, 0, Math.PI * 2);
    c.fill();
  }

  function drawOrchard(c, W, H) {
    c.fillStyle = '#5e7d43';
    c.fillRect(0, H * 0.55, 150, H * 0.45);
    c.fillStyle = '#3f5c2c';
    for (let i = 0; i < 5; i++) {
      const x = 20 + i * 28;
      c.fillRect(x + 8, H * 0.68, 6, 40);
      c.beginPath();
      c.arc(x + 11, H * 0.66, 18, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#cfe6b0';
    c.font = 'bold 13px sans-serif';
    c.fillText('果园（出发地）', 18, H * 0.6);
  }

  function drawRoad(c, W, H, sim) {
    const ry = H * 0.72;
    c.fillStyle = '#4a4a4f';
    c.fillRect(0, ry, W, 46);
    c.strokeStyle = '#d9d27a';
    c.lineWidth = 2;
    c.setLineDash([18, 14]);
    c.beginPath();
    c.moveTo(0, ry + 23);
    c.lineTo(W, ry + 23);
    c.stroke();
    c.setLineDash([]);
    // 路线标识
    c.fillStyle = '#cfd3cf';
    c.font = '12px sans-serif';
    const route = CFG.ROUTES[sim.route];
    c.fillText('路线' + sim.route + ' · ' + route.name + ' · 颠簸系数 ' + route.bump, 170, ry - 8);
  }

  function drawField(c, W, H, sim) {
    const fx = W * 0.62;
    c.fillStyle = '#6f9a48';
    c.fillRect(fx, H * 0.3, W - fx, H * 0.4);
    c.fillStyle = '#e8f5d0';
    c.font = 'bold 13px sans-serif';
    c.fillText('第二片花田（授粉目标 ' + CFG.HIVE_COUNT + ' 箱）', fx + 12, H * 0.35);
    // 花簇斑块
    for (const p of sim.world.patches) {
      const px = fx + (p.x - 60) / 40 * (W - fx - 30);
      const py = H * 0.32 + (p.y - 18) / 64 * (H * 0.34);
      const isTarget = p.assignedHive >= 0;
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        c.fillStyle = ['#f5d142', '#f28bb0', '#fff3f8'][k % 3];
        c.beginPath();
        c.arc(px + Math.cos(ang) * 9, py + Math.sin(ang) * 9, 3.4, 0, Math.PI * 2);
        c.fill();
      }
      if (isTarget) {
        const hive = sim.hives[p.assignedHive];
        c.strokeStyle = hive.alive ? '#ffe066' : '#e0604d';
        c.lineWidth = 2.5;
        c.beginPath();
        c.arc(px, py, 16, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = '#fff';
        c.font = 'bold 11px sans-serif';
        c.fillText('#' + (p.assignedHive + 1), px - 7, py - 20);
      }
    }
  }

  function drawWeather(c, W, H, sim) {
    const w = weatherAt(sim.world, sim.t);
    c.font = '12px sans-serif';
    const tags = [];
    if (w.heatwave) tags.push('🔥 热浪');
    if (w.wind) tags.push('🌬️ 大风');
    if (w.rain) tags.push('🌧️ 降雨');
    c.fillStyle = 'rgba(10,18,10,.7)';
    c.fillRect(12, 12, 150, 26);
    c.fillStyle = '#fff';
    c.fillText(tags.length ? tags.join('  ') : '☀️ 晴好', 22, 30);

    if (w.rain) {
      c.strokeStyle = 'rgba(180,210,240,.55)';
      c.lineWidth = 1.5;
      for (let i = 0; i < 60; i++) {
        const x = (i * 47 + sim.t * 90) % W;
        const y = (i * 31 + sim.t * 220) % H;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x - 4, y + 12);
        c.stroke();
      }
    }
    if (w.wind) {
      c.strokeStyle = 'rgba(255,255,255,.35)';
      c.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const y = 90 + i * 48;
        const off = (sim.t * 60 + i * 80) % (W + 120) - 60;
        c.beginPath();
        c.moveTo(off, y);
        c.quadraticCurveTo(off + 30, y - 8, off + 60, y);
        c.stroke();
      }
    }
  }

  function truckX(cv, sim) {
    const route = CFG.ROUTES[sim.route];
    const progress = Math.min(1, sim.distance / route.length);
    return 110 + progress * (cv.width * 0.62 - 150);
  }

  function drawParkedTruck(c, W, H, sim) {
    drawTruckAt(c, 110, H * 0.72 - 34, sim, true);
  }

  function drawTruck(c, W, H, sim) {
    const x = sim.phase === 'arrived' || sim.phase === 'pollinated' || sim.phase === 'failed'
      ? (sim.distance >= CFG.ROUTES[sim.route].length ? W * 0.62 - 40 : truckX(cv, sim))
      : truckX(cv, sim);
    // 颠簸抖动
    const jitter = sim.phase === 'transport'
      ? Math.sin(sim.t * 22) * CFG.ROUTES[sim.route].bump * 14 : 0;
    drawTruckAt(c, x, H * 0.72 - 34 + jitter, sim, false);
  }

  function drawTruckAt(c, x, y, sim, parked) {
    // 货厢
    c.fillStyle = '#b8803e';
    c.fillRect(x - 60, y, 78, 40);
    c.strokeStyle = '#6e4a22';
    c.strokeRect(x - 60, y, 78, 40);
    // 驾驶室
    c.fillStyle = '#2f6d8f';
    c.fillRect(x + 18, y + 8, 34, 32);
    c.fillStyle = '#bfe4f5';
    c.fillRect(x + 24, y + 12, 20, 12);
    // 车轮
    c.fillStyle = '#222';
    c.beginPath(); c.arc(x - 38, y + 42, 9, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 34, y + 42, 9, 0, Math.PI * 2); c.fill();

    // 三只蜂箱：颜色按实际箱温，叉号表示损毁
    sim.hives.forEach((h, i) => {
      const hx = x - 54 + i * 24;
      const hy = y + 6;
      const heat = Math.max(0, Math.min(1, (h.temp - 30) / 12));
      c.fillStyle = h.alive
        ? `rgb(${200 + heat * 40},${170 - heat * 110},${90 - heat * 70})`
        : '#5a3a3a';
      c.fillRect(hx, hy, 20, 26);
      c.strokeStyle = '#4a3517';
      c.strokeRect(hx, hy, 20, 26);
      // 损伤裂纹
      if (h.damage > 30) {
        c.strokeStyle = 'rgba(40,20,10,.8)';
        c.beginPath();
        c.moveTo(hx + 4, hy + 4);
        c.lineTo(hx + 12, hy + 13);
        c.lineTo(hx + 8, hy + 22);
        c.stroke();
      }
      if (!h.alive) {
        c.strokeStyle = '#ff5a45';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(hx + 3, hy + 3); c.lineTo(hx + 17, hy + 23);
        c.moveTo(hx + 17, hy + 3); c.lineTo(hx + 3, hy + 23);
        c.stroke();
        c.lineWidth = 1;
      }
      c.fillStyle = '#1d1508';
      c.font = 'bold 10px sans-serif';
      c.fillText(String(i + 1), hx + 7, hy + 17);
    });

    // 通风气流
    if (sim.vent && !parked) {
      c.strokeStyle = 'rgba(170,225,255,.7)';
      c.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const off = (sim.t * 40 + i * 14) % 30;
        c.beginPath();
        c.moveTo(x - 62 - off, y + 8 + i * 10);
        c.lineTo(x - 70 - off, y + 8 + i * 10);
        c.stroke();
      }
    }
    // 喷淋水帘
    if (sim.spray && sim.water > 0) {
      c.strokeStyle = 'rgba(150,205,255,.8)';
      for (let i = 0; i < 12; i++) {
        const px = x - 58 + (i % 3) * 24;
        const py = y - 6 + ((sim.t * 80 + i * 13) % 18);
        c.beginPath();
        c.moveTo(px, py);
        c.lineTo(px - 2, py + 6);
        c.stroke();
      }
    }
  }

  function drawHudOverlay(c, W, H, sim) {
    const remain = Math.max(0, CFG.BLOOM_WINDOW - sim.t);
    c.fillStyle = 'rgba(10,18,10,.75)';
    c.fillRect(W - 232, 12, 220, 58);
    c.fillStyle = '#fff';
    c.font = '12px monospace';
    c.fillText('仿真时刻 ' + G.BeeSim.fmt(sim.t) + ' / 窗口截止 ' + G.BeeSim.fmt(CFG.BLOOM_WINDOW), W - 222, 32);
    c.fillText('窗口剩余 ' + G.BeeSim.fmt(remain) +
      (sim.observed.eta !== null && sim.phase === 'transport'
        ? '  ETA ' + sim.observed.eta.toFixed(0) + 's' : ''), W - 222, 52);
    const env = ambientTemp(sim.world, sim.t);
    c.fillText('环境实际温度 ' + env.toFixed(1) + '°C', W - 222, 66);
  }

  return { draw, ctx };
  }

  G.BeeRenderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
