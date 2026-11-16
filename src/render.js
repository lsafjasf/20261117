/* Canvas 渲染：月尘地形、陨坑、温室舱、岩石、车辙、路径、风向与低重力弹跳 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./prng.js'));
  else root.LunarRender = factory(root.LunarPRNG);
})(typeof self !== 'undefined' ? self : this, function (PRNG) {
  'use strict';

  function drawDust(ctx, world) {
    const g = ctx.createLinearGradient(0, 0, 0, world.config.h);
    g.addColorStop(0, '#3a3a42');
    g.addColorStop(1, '#26262d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, world.config.w, world.config.h);
    for (const p of world.dustPatches) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.shade > 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.16)';
      ctx.fill();
    }
    const rng = PRNG.mulberry32('dust-' + world.seed);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 240; i++) {
      const x = rng.range(0, world.config.w), y = rng.range(0, world.config.h);
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }

  function drawCraters(ctx, world) {
    for (const c of world.craters) {
      const g = ctx.createRadialGradient(c.x - c.radius * 0.3, c.y - c.radius * 0.3,
        c.radius * 0.1, c.x, c.y, c.radius);
      g.addColorStop(0, '#17171c');
      g.addColorStop(0.75, '#202027');
      g.addColorStop(1, '#4a4a55');
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#6a6a78';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius - 14, 0, Math.PI * 2);
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(220,120,90,0.55)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawRocks(ctx, world) {
    for (const r of world.rocks) {
      ctx.beginPath();
      const sides = 7;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const rr = r.radius * (0.82 + 0.28 * Math.sin(i * 3.7 + r.order));
        const x = r.x + Math.cos(a) * rr, y = r.y + Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = '#55555f';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#777783';
      ctx.stroke();
    }
  }

  function drawRoute(ctx, world) {
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(120,200,255,0.6)';
    ctx.beginPath();
    world.waypoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(120,200,255,0.85)';
    world.waypoints.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '13px sans-serif';
      ctx.fillText('W' + i, p.x + 7, p.y - 7);
    });
  }

  function drawCheckpoints(ctx, world) {
    for (const cp of world.checkpoints) {
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 26, 0, Math.PI * 2);
      ctx.fillStyle = cp.visited ? 'rgba(90,220,140,0.22)' : 'rgba(255,210,90,0.18)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = cp.visited ? '#5adc8c' : '#ffd25a';
      ctx.stroke();
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = cp.visited ? '#5adc8c' : '#ffd25a';
      ctx.textAlign = 'center';
      ctx.fillText(cp.visited ? '✓' : 'C', cp.x, cp.y + 5);
      ctx.textAlign = 'left';
      ctx.font = '12px sans-serif';
      ctx.fillText(cp.label, cp.x + 30, cp.y + 4);
    }
  }

  function drawLander(ctx, world) {
    const l = world.lander;
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.fillStyle = '#8a8f9c';
    ctx.fillRect(-26, -22, 52, 44);
    ctx.fillStyle = '#b9bec9';
    ctx.fillRect(-14, -30, 28, 12);
    ctx.strokeStyle = '#d8dde6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-26, 20); ctx.lineTo(-40, 34);
    ctx.moveTo(26, 20); ctx.lineTo(40, 34);
    ctx.stroke();
    ctx.fillStyle = '#9fd0ff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('着陆器', 0, -38);
    ctx.restore();
  }

  function drawPods(ctx, world) {
    for (const pod of world.pods) {
      ctx.save();
      ctx.translate(pod.x, pod.y);
      ctx.beginPath();
      ctx.arc(0, 0, pod.radius, Math.PI, 0);
      ctx.lineTo(pod.radius, 14);
      ctx.lineTo(-pod.radius, 14);
      ctx.closePath();
      ctx.fillStyle = pod.delivered ? '#2f7d52' : '#3d6a9f';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = pod.delivered ? '#5adc8c' : '#9fd0ff';
      ctx.stroke();
      ctx.fillStyle = '#eef4ff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pod.delivered ? '✓ 温室' : '温室', 0, 2);
      ctx.fillText(pod.id, 0, 34);
      ctx.restore();
    }
  }

  return { drawDust, drawCraters, drawRocks, drawRoute, drawCheckpoints,
    drawLander, drawPods, drawRover, drawTracks, drawWind };

  function drawTracks(ctx, tracks) {
    if (tracks.length < 2) return;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    tracks.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }

  function drawRover(ctx, rover) {
    ctx.save();
    ctx.translate(rover.x, rover.y - (rover.air > 0 ? 8 : 0));
    ctx.rotate(rover.heading + Math.PI / 2);
    ctx.fillStyle = '#e0a84b';
    ctx.fillRect(-12, -16, 24, 32);
    ctx.fillStyle = '#f2c878';
    ctx.fillRect(-9, -12, 18, 10);
    ctx.fillStyle = '#222';
    ctx.fillRect(-15, -14, 5, 10);
    ctx.fillRect(10, -14, 5, 10);
    ctx.fillRect(-15, 4, 5, 10);
    ctx.fillRect(10, 4, 5, 10);
    ctx.restore();
  }

  function drawWind(ctx, wind, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(180,220,255,0.9)';
    ctx.fillStyle = 'rgba(180,220,255,0.9)';
    ctx.lineWidth = 2;
    const len = 14 + wind.strength;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(wind.angle) * len, Math.sin(wind.angle) * len);
    ctx.stroke();
    const ax = Math.cos(wind.angle) * len, ay = Math.sin(wind.angle) * len;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - 8 * Math.cos(wind.angle - 0.5), ay - 8 * Math.sin(wind.angle - 0.5));
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - 8 * Math.cos(wind.angle + 0.5), ay - 8 * Math.sin(wind.angle + 0.5));
    ctx.stroke();
    ctx.font = '13px sans-serif';
    ctx.fillText('风 ' + wind.strength.toFixed(0) + ' u/s', -10, 26);
    ctx.restore();
  }
});
