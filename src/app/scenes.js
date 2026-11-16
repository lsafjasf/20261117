// 两个程序化动画场景。入参 localMs 始终是该片段自身的源时间，
// 因此第二场景在转场结束后从自身时间起点继续，不会继承第一场景的旧时间。
const TAU = Math.PI * 2;

function label(ctx, w, h, text, localMs) {
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(text, 24, 40);
  ctx.font = '14px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`self t=${(localMs / 1000).toFixed(2)}s`, 24, h - 24);
}

export function renderSceneA(ctx, w, h, localMs) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#10243f');
  grad.addColorStop(1, '#1d5c8a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const t = localMs / 1000;
  const cx = w / 2 + Math.cos(t * 0.9) * 120;
  const cy = h / 2 + Math.sin(t * 1.1) * 90;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 1.6);
  const size = 90 + Math.sin(t * 3) * 14;
  ctx.fillStyle = '#ff8a3d';
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeStyle = '#ffd9b0';
  ctx.lineWidth = 4;
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
  label(ctx, w, h, 'Scene A · orbit blocks', localMs);
}

export function renderSceneB(ctx, w, h, localMs) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#2b0f3f');
  grad.addColorStop(1, '#7a1f5c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const t = localMs / 1000;
  const cx = w / 2;
  const cy = h / 2;
  for (let i = 0; i < 4; i++) {
    const r = 40 + i * 34 + Math.sin(t * 2 + i) * 12;
    ctx.beginPath();
    ctx.arc(cx, cy, r, t * (0.6 + i * 0.2), t * (0.6 + i * 0.2) + TAU * 0.82);
    ctx.strokeStyle = `hsla(${280 + i * 20}, 85%, ${60 + i * 6}%, 0.9)`;
    ctx.lineWidth = 10 - i;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 14 + Math.sin(t * 4) * 5, 0, TAU);
  ctx.fillStyle = '#f6d365';
  ctx.fill();
  label(ctx, w, h, 'Scene B · pulse rings', localMs);
}

export const SCENE_RENDERERS = { sceneA: renderSceneA, sceneB: renderSceneB };
