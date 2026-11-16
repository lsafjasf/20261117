import {
  TILE,
  waterTopAt,
  waterBottomAt,
  ceilingYAt,
} from './world.js';
import {
  cargoTopOffset,
  isWarehouseDelivered,
  nearestWaypoint,
} from './engine.js';

const VIEW_W = 900;
const VIEW_H = 560;

export function createView(canvas) {
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const ctx = canvas.getContext('2d');
  return {
    canvas,
    ctx,
    width: VIEW_W,
    height: VIEW_H,
    cameraX: 0,
    cameraY: 0,
  };
}

function drawCave(ctx, world, view, state) {
  const leftCol = Math.max(0, Math.floor(view.cameraX / TILE) - 1);
  const rightCol = Math.min(
    world.COLS - 1,
    Math.ceil((view.cameraX + view.width) / TILE) + 1
  );
  ctx.fillStyle = '#141019';
  ctx.fillRect(0, 0, view.width, view.height);

  for (let c = leftCol; c <= rightCol; c++) {
    const x = c * TILE - view.cameraX;
    const top = waterTopAt(world, c * TILE) - view.cameraY;
    const bottom = waterBottomAt(world, c * TILE) - view.cameraY;
    const ceiling = ceilingYAt(world, c * TILE) - view.cameraY;

    ctx.fillStyle = '#241d2c';
    ctx.fillRect(x, 0, TILE + 1, top);
    ctx.fillRect(x, bottom, TILE + 1, view.height - bottom);

    // 低矮洞顶用警示色描边。
    if (world.clearance[c] < 5.4) {
      ctx.fillStyle = '#5a3b26';
      ctx.fillRect(x, ceiling - 10, TILE + 1, 10);
    }
    ctx.strokeStyle = 'rgba(180,150,110,0.35)';
    ctx.beginPath();
    ctx.moveTo(x, ceiling);
    ctx.lineTo(x + TILE, ceiling);
    ctx.stroke();
  }
}

function drawWater(ctx, world, view, state) {
  const leftCol = Math.max(0, Math.floor(view.cameraX / TILE) - 1);
  const rightCol = Math.min(
    world.COLS - 1,
    Math.ceil((view.cameraX + view.width) / TILE) + 1
  );
  const grad = ctx.createLinearGradient(0, 0, 0, view.height);
  grad.addColorStop(0, '#123243');
  grad.addColorStop(1, '#0a1c2b');
  for (let c = leftCol; c <= rightCol; c++) {
    const x = c * TILE - view.cameraX;
    const top = waterTopAt(world, c * TILE) - view.cameraY;
    const bottom = waterBottomAt(world, c * TILE) - view.cameraY;
    ctx.fillStyle = grad;
    ctx.fillRect(x, top, TILE + 1, bottom - top);
  }

  ctx.strokeStyle = 'rgba(120,200,230,0.22)';
  ctx.lineWidth = 1;
  const phase = (state.frame % 90) * 0.08;
  for (let band = 0; band < 4; band++) {
    ctx.beginPath();
    for (let x = 0; x <= view.width; x += 12) {
      const wx = view.cameraX + x;
      const cy = waterTopAt(world, wx) - view.cameraY +
        (band + 1) * 26 + Math.sin(phase + x * 0.05 + band) * 3;
      if (x === 0) ctx.moveTo(x, cy);
      else ctx.lineTo(x, cy);
    }
    ctx.stroke();
  }
}

function drawObstacles(ctx, world, view, state) {
  for (const rock of world.obstacles) {
    if (rock.x < view.cameraX - 60 || rock.x > view.cameraX + view.width + 60) continue;
    const x = rock.x - view.cameraX;
    const y = rock.y - view.cameraY;
    ctx.fillStyle = '#3a3145';
    ctx.beginPath();
    ctx.arc(x, y, rock.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6b5b7d';
    ctx.stroke();
  }
}

function drawWarehouses(ctx, world, view, state) {
  for (const wh of world.warehouses) {
    if (wh.x < view.cameraX - 100 || wh.x > view.cameraX + view.width + 100) continue;
    const x = wh.x - view.cameraX;
    const y = wh.y - view.cameraY;
    const done = isWarehouseDelivered(state, wh.id);
    ctx.fillStyle = done ? '#2e6b4f' : '#7d5a2e';
    ctx.fillRect(x - 20, y - 16, 40, 32);
    ctx.fillStyle = '#d9b46a';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`仓${wh.index + 1}${done ? '✓' : ''}`, x, y + 5);
  }
}

function drawCheckpoints(ctx, world, view, state) {
  world.checkpoints.forEach((cp, idx) => {
    if (cp.x < view.cameraX - 60 || cp.x > view.cameraX + view.width + 60) return;
    const visited = state.checkpointsVisited.includes(idx);
    ctx.strokeStyle = visited ? 'rgba(90,220,150,0.85)' : 'rgba(230,210,120,0.7)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(cp.x - view.cameraX, 0);
    ctx.lineTo(cp.x - view.cameraX, view.height);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function drawBoat(ctx, view, state) {
  const boat = state.boat;
  const x = boat.x - view.cameraX;
  const y = boat.y - view.cameraY;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(boat.angle);

  ctx.fillStyle = boat.invuln > 0 ? '#ff9d7a' : '#c96b3f';
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  const loadH = 12;
  ctx.fillStyle = '#e8d8a8';
  ctx.fillRect(-8, -loadH - 6, 14, loadH);
  ctx.restore();

  // 倾斜用独立指示，避免旋转叠加后不直观。
  ctx.save();
  ctx.translate(x, y - 26);
  ctx.rotate(boat.tilt);
  ctx.fillStyle = '#f2e3b6';
  ctx.fillRect(-9, -7, 18, 14);
  ctx.strokeStyle = '#8a6d3b';
  ctx.strokeRect(-9, -7, 18, 14);
  ctx.restore();

  if (boat.grounded) {
    ctx.fillStyle = '#ffd166';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('搁浅中：按住 S 倒车脱困', x, y - 44);
  }
}

function drawLamp(ctx, view, state) {
  if (!state.boat.lampOn) return;
  const x = state.boat.x - view.cameraX;
  const y = state.boat.y - view.cameraY;
  const radius = 150;
  const grad = ctx.createRadialGradient(x, y, 10, x, y, radius);
  grad.addColorStop(0, 'rgba(255,236,170,0.28)');
  grad.addColorStop(1, 'rgba(255,236,170,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

function drawDebug(ctx, world, view, state) {
  // 推荐路径：连接 waypoint。
  ctx.strokeStyle = 'rgba(110,230,170,0.55)';
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  world.waypoints.forEach((wp, i) => {
    const x = wp.x - view.cameraX;
    const y = wp.y - view.cameraY;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  const wp = nearestWaypoint(world, state.boat);
  ctx.strokeStyle = 'rgba(110,230,170,0.9)';
  ctx.beginPath();
  ctx.moveTo(state.boat.x - view.cameraX, state.boat.y - view.cameraY);
  ctx.lineTo(wp.x - view.cameraX, wp.y - view.cameraY);
  ctx.stroke();

  // 风向箭头。
  const ax = 70;
  const ay = view.height - 46;
  const wind = state.wind;
  ctx.strokeStyle = '#9fd8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + Math.cos(wind.angle) * 34, ay + Math.sin(wind.angle) * 34);
  ctx.stroke();
  ctx.fillStyle = '#9fd8ff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`风 ${wind.strength.toFixed(0)}`, ax - 14, ay + 22);
  ctx.lineWidth = 1;

  const top = state.boat.y - view.cameraY - cargoTopOffset(state, state.boat.angle);
  ctx.strokeStyle = 'rgba(255,170,120,0.9)';
  ctx.beginPath();
  ctx.moveTo(state.boat.x - view.cameraX - 22, top);
  ctx.lineTo(state.boat.x - view.cameraX + 22, top);
  ctx.stroke();
}

export function render(view, world, state, debugOn) {
  const { ctx } = view;
  const boat = state.boat;
  view.cameraX = Math.max(0, Math.min(world.width - view.width, boat.x - view.width * 0.35));
  view.cameraY = Math.max(0, Math.min(world.height - view.height, boat.y - view.height * 0.5));

  drawCave(ctx, world, view, state);
  drawWater(ctx, world, view, state);
  drawObstacles(ctx, world, view, state);
  drawCheckpoints(ctx, world, view, state);
  drawWarehouses(ctx, world, view, state);
  drawBoat(ctx, view, state);
  drawLamp(ctx, view, state);
  if (debugOn) drawDebug(ctx, world, view, state);

  if (state.status === 'paused' || state.status === 'won' || state.status === 'failed') {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px sans-serif';
    const title = state.status === 'paused'
      ? '已暂停'
      : state.status === 'won'
        ? '任务完成：三封信全部送达'
        : '任务失败';
    ctx.fillText(title, view.width / 2, view.height / 2 - 12);
    if (state.status === 'failed' && state.failReason) {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#ffb4a2';
      ctx.fillText(state.failReason, view.width / 2, view.height / 2 + 24);
      ctx.fillStyle = '#cfd6e4';
      ctx.fillText('可点击“检查点继续”从最近检查点恢复', view.width / 2, view.height / 2 + 50);
    }
  }
}

export { VIEW_W, VIEW_H };
