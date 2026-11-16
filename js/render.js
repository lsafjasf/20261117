// Canvas 渲染:海面航线 + 货舱剖面(温区/吊机) + HUD + 调试层
import { windAt, obstaclePositions, WORLD } from './world.js';
import { getProgress, cargoWeight } from './sim.js';

const VIEW_W = 940, VIEW_H = 720, PANEL_X = 940;

export function render(ctx, state, debug) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.fillStyle = '#0b2a3d';
  ctx.fillRect(0, 0, W, H);
  const cam = camera(state);
  drawSea(ctx, state, cam);
  drawPath(ctx, state, cam, debug);
  drawObstacles(ctx, state, cam);
  drawDocks(ctx, state, cam);
  drawShip(ctx, state, cam);
  drawWind(ctx, state);
  drawPanel(ctx, state);
  drawHud(ctx, state);
  if (debug) drawDebug(ctx, state, cam);
  if (state.paused && state.status === 'playing') banner(ctx, '已暂停 (P 继续)');
  if (state.status === 'failed') banner(ctx, `任务失败: ${state.lastFailure.reason}`, '#c0392b');
  if (state.status === 'won') banner(ctx, '任务完成! 三批货全部温控送达', '#27ae60');
}

function drawCompressor(ctx, state, x, y) {
  const c = state.compressor;
  ctx.fillStyle = '#dfe6e9';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('压缩机', x, y);
  ctx.font = '13px sans-serif';
  const status = c.overloaded ? '过载停机!' : c.on ? `运行中 (功率 ${c.power})` : '待机';
  ctx.fillStyle = c.overloaded ? '#e74c3c' : c.on ? '#2ecc71' : '#95a5a6';
  ctx.fillText(status, x, y + 22);
  // 热量条
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(x, y + 34, 240, 14);
  ctx.fillStyle = c.heat > 80 ? '#e74c3c' : '#e67e22';
  ctx.fillRect(x, y + 34, 240 * c.heat / 100, 14);
  ctx.strokeStyle = '#7f8c8d';
  ctx.strokeRect(x, y + 34, 240, 14);
  ctx.fillStyle = '#b2bec3';
  ctx.fillText(`热量 ${c.heat.toFixed(0)}%`, x, y + 66);
}

function drawHud(ctx, state) {
  const p = getProgress(state);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(10, ctx.canvas.height - 96, 700, 86);
  ctx.fillStyle = '#fff';
  ctx.font = '14px sans-serif';
  ctx.fillText(`目标进度: 已装 ${p.loaded}/${p.total}  已送达 ${p.delivered}/${p.total}  变质 ${p.spoiled}`, 24, ctx.canvas.height - 68);
  ctx.fillText(`资源: 燃料 ${p.fuel}  维修包 ${p.repairKits}  船体 ${p.hull}%  剩余时间 ${p.timeLeft}s  载重 ${p.weight}t`, 24, ctx.canvas.height - 44);
  ctx.fillStyle = p.lastFailure ? '#ff7675' : '#b2bec3';
  ctx.fillText(`最近失败原因: ${p.lastFailure || '无'}`, 24, ctx.canvas.height - 20);
}

function drawDebug(ctx, state, cam) {
  const w = windAt(state.world, state.tick);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(VIEW_W - 250, 10, 240, 110);
  ctx.fillStyle = '#f1c40f';
  ctx.font = '12px monospace';
  const s = state.ship;
  ctx.fillText(`DEBUG seed=${state.seedNum}`, VIEW_W - 240, 30);
  ctx.fillText(`pos=(${s.x.toFixed(0)},${s.y.toFixed(0)}) v=${s.speed.toFixed(1)}`, VIEW_W - 240, 48);
  ctx.fillText(`载重=${cargoWeight(state)}t 航速上限受载重影响`, VIEW_W - 240, 66);
  ctx.fillText(`风向=${(w.dir * 180 / Math.PI).toFixed(0)}° 风速=${w.speed.toFixed(1)}`, VIEW_W - 240, 84);
  ctx.fillText(`tick=${state.tick} 检查点已存=${!!state.checkpoint}`, VIEW_W - 240, 102);
}

function banner(ctx, text, color = '#f39c12') {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 300, VIEW_W, 90);
  ctx.fillStyle = color;
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, VIEW_W / 2, 350);
  ctx.textAlign = 'left';
}

// 右侧面板:货舱剖面 + 三个温区 + 吊机
function drawPanel(ctx, state) {
  ctx.fillStyle = '#12222e';
  ctx.fillRect(PANEL_X, 0, ctx.canvas.width - PANEL_X, ctx.canvas.height);
  ctx.fillStyle = '#dfe6e9';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('货舱剖面 / 温区', PANEL_X + 20, 34);
  const bx = PANEL_X + 30, bw = 260, bh = 110;
  for (let i = 0; i < 3; i++) {
    const z = state.zones[i];
    const by = 60 + i * (bh + 16);
    // 舱体颜色随温度:冷蓝 -> 危险红
    const t = Math.max(0, Math.min(1, (z.temp - WORLD.tempMin) / (WORLD.ambientTemp - WORLD.tempMin)));
    ctx.fillStyle = `rgb(${Math.round(40 + 180 * t)},${Math.round(120 - 60 * t)},${Math.round(200 - 150 * t)})`;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#95a5a6'; ctx.strokeRect(bx, by, bw, bh);
    // 舱门(开启时画缺口)
    ctx.fillStyle = z.doorOpen ? '#e67e22' : '#34495e';
    const doorW = z.doorOpen ? 14 : 40;
    ctx.fillRect(bx + bw - doorW, by, doorW, bh);
    // 货物
    const task = state.world.tasks.find((t) => t.zone === i);
    if (task && task.loaded && !task.delivered) {
      ctx.fillStyle = task.spoiled ? '#7f8c8d' : ['#e74c3c', '#3498db', '#2ecc71'][i];
      ctx.fillRect(bx + 30, by + bh - 44, 60, 36);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    const range = `[${WORLD.tempMin}~${WORLD.tempMax}°C]`;
    ctx.fillText(`舱区${i + 1}: ${z.temp.toFixed(1)}°C ${range}`, bx + 8, by + 20);
    if (z.doorOpen) ctx.fillText('舱门开启!', bx + 8, by + 40);
    if (z.overTime > 0) {
      ctx.fillStyle = '#ff7675';
      ctx.fillText(`越限 ${z.overTime.toFixed(0)}s / ${WORLD.spoilGrace}s`, bx + 8, by + 60);
    }
  }
  drawCrane(ctx, state, bx, 60, bw);
  drawCompressor(ctx, state, PANEL_X + 20, 480);
}

function drawCrane(ctx, state, bx, by, bw) {
  // 吊机:装卸时吊臂在对应舱区上方往复
  ctx.strokeStyle = '#f39c12';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(bx + bw + 24, by - 20);
  ctx.lineTo(bx + bw + 24, by + 3 * 126);
  ctx.stroke();
  if (state.loading) {
    const task = state.world.tasks[state.loading.taskId];
    const prog = 1 - state.loading.timer / (12 * 60);
    const cy = by + task.zone * 126;
    const hookX = bx + bw + 24 - prog * (bw * 0.7);
    ctx.beginPath(); ctx.moveTo(bx + bw + 24, cy - 20); ctx.lineTo(hookX, cy - 20); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hookX, cy - 20); ctx.lineTo(hookX, cy + 20); ctx.stroke();
    ctx.fillStyle = ['#e74c3c', '#3498db', '#2ecc71'][task.zone];
    ctx.fillRect(hookX - 14, cy + 20, 28, 22);
    ctx.lineWidth = 4;
  }
}

function drawDocks(ctx, state, cam) {
  for (const d of state.world.docks) {
    const sx = d.x - cam.x, sy = d.y - cam.y;
    if (sx < -150 || sx > VIEW_W + 150) continue;
    ctx.fillStyle = d.isDestination ? '#8e6b3a' : '#5d8a4a';
    ctx.beginPath(); ctx.arc(sx, sy, d.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ecf0f1'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, d.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.name, sx, sy - d.r - 8);
    ctx.textAlign = 'left';
  }
}

function drawShip(ctx, state, cam) {
  const s = state.ship;
  const sx = s.x - cam.x, sy = s.y - cam.y;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(s.heading);
  ctx.fillStyle = state.grounded ? '#c0392b' : '#e8eef2';
  ctx.beginPath();
  ctx.moveTo(30, 0); ctx.lineTo(10, -14); ctx.lineTo(-26, -14);
  ctx.lineTo(-26, 14); ctx.lineTo(10, 14); ctx.closePath(); ctx.fill();
  // 甲板上的冷藏箱(随装载数量增加)
  const n = state.world.tasks.filter((t) => t.loaded && !t.delivered).length;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = ['#e74c3c', '#3498db', '#2ecc71'][i];
    ctx.fillRect(-22 + i * 15, -8, 12, 16);
  }
  ctx.restore();
  if (state.invuln > 0 && state.invuln % 10 < 5) {
    ctx.strokeStyle = '#e74c3c';
    ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawWind(ctx, state) {
  const w = windAt(state.world, state.tick);
  const cx = 60, cy = 60;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(14, 14, 130, 92);
  ctx.strokeStyle = '#fff';
  ctx.translate(cx, cy);
  ctx.rotate(w.dir);
  ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0);
  ctx.lineTo(14, -6); ctx.moveTo(22, 0); ctx.lineTo(14, 6); ctx.stroke();
  ctx.rotate(-w.dir);
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`风 ${w.speed.toFixed(1)} m/s`, 0, 30);
  ctx.fillText(`向 ${(w.dir * 180 / Math.PI).toFixed(0)}°`, 0, 44);
  ctx.restore();
  ctx.textAlign = 'left';
}

function camera(state) {
  return {
    x: Math.max(0, Math.min(WORLD.width - VIEW_W, state.ship.x - VIEW_W / 2)),
    y: Math.max(0, Math.min(WORLD.height - VIEW_H, state.ship.y - VIEW_H / 2)),
  };
}

function drawSea(ctx, state, cam) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, VIEW_W, VIEW_H); ctx.clip();
  ctx.fillStyle = '#10455f';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let x = -cam.x % 120; x < VIEW_W; x += 120) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VIEW_H); ctx.stroke();
  }
  for (let y = -cam.y % 120; y < VIEW_H; y += 120) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VIEW_W, y); ctx.stroke();
  }
  ctx.restore();
}

function drawPath(ctx, state, cam, debug) {
  if (!debug) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(241,196,15,0.7)';
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  state.world.docks.forEach((d, i) => {
    const x = d.x - cam.x, y = d.y - cam.y;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawObstacles(ctx, state, cam) {
  for (const { ob, x, y } of obstaclePositions(state.world, state.tick)) {
    const sx = x - cam.x, sy = y - cam.y;
    if (sx < -150 || sx > VIEW_W + 150 || sy < -150 || sy > VIEW_H + 150) continue;
    if (ob.type === 'ship') {
      ctx.fillStyle = '#7f8c8d';
      ctx.beginPath(); ctx.ellipse(sx, sy, ob.r, ob.r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#95a5a6';
      ctx.fillRect(sx - 10, sy - 14, 20, 12);
    } else {
      ctx.fillStyle = 'rgba(210,180,90,0.5)';
      ctx.beginPath(); ctx.arc(sx, sy, ob.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a6d1f';
      ctx.font = '12px sans-serif';
      ctx.fillText('浅滩', sx - 12, sy + 4);
    }
  }
}
