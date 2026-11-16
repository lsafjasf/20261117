import { SCENE_RENDERERS } from './scenes.js';

function paint(canvas, ctx, clip, localMs) {
  const renderer = SCENE_RENDERERS[clip.source];
  renderer(ctx, canvas.width, canvas.height, localMs);
}

// 转场进度 p∈[0,1]。from/to 各自使用自身源时间，互不继承。
export function renderTransition(canvas, fromClip, toClip, fromLocal, toLocal, type, p) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const off = renderTransition._off || (renderTransition._off = document.createElement('canvas'));
  off.width = w; off.height = h;
  const octx = off.getContext('2d');

  if (type === 'dissolve') {
    paint(canvas, ctx, fromClip, fromLocal);
    octx.clearRect(0, 0, w, h);
    paint(off, octx, toClip, toLocal);
    ctx.globalAlpha = p;
    ctx.drawImage(off, 0, 0);
    ctx.globalAlpha = 1;
    return;
  }

  if (type === 'push') {
    const shift = p * w;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, Math.max(0, w - shift), h);
    ctx.clip();
    paint(canvas, ctx, fromClip, fromLocal);
    ctx.restore();

    octx.clearRect(0, 0, w, h);
    paint(off, octx, toClip, toLocal);
    ctx.save();
    ctx.beginPath();
    ctx.rect(w - shift, 0, Math.ceil(shift), h);
    ctx.clip();
    ctx.drawImage(off, -(w - shift), 0);
    ctx.restore();
    return;
  }

  // mask：圆形遮罩由小到大揭示第二场景。
  paint(canvas, ctx, fromClip, fromLocal);
  octx.clearRect(0, 0, w, h);
  paint(off, octx, toClip, toLocal);
  const radius = p * Math.hypot(w, h) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.max(0.1, radius), 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(off, 0, 0);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.max(0.1, radius), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.stroke();
}
