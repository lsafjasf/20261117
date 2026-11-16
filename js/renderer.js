/*
 * renderer.js — Canvas 画面合成。
 * 视频画面为程序化生成（色板 + 移动标尺 + 源时间码），
 * 源时间码直接来自 clip.inPoint + (t - clip.start)，
 * 因此裁切/分割/移动后可在画面上肉眼验证音画对齐。
 */
(function (root) {
  "use strict";

  function drawClipFrame(ctx, clip, project, t, alpha) {
    const s = project.settings;
    const srcTime = clip.inPoint + (t - clip.start); // 源素材时间
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(0, 0, s.width, s.height);
    grad.addColorStop(0, `hsl(${clip.hue}, 45%, 18%)`);
    grad.addColorStop(1, `hsl(${clip.hue + 40}, 50%, 32%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s.width, s.height);
    // 移动标尺：位置由源时间驱动，便于核对对齐
    const px = ((srcTime * 120) % (s.width + 80)) - 40;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(px, 0, 6, s.height);
    // 源时间码
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "28px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${clip.name}  src=${srcTime.toFixed(2)}s`, 24, s.height - 24);
    ctx.restore();
  }

  function drawCredits(ctx, project, t) {
    const M = root.CreditModel;
    const s = project.settings;
    const positions = M.creditsPositionsAt(project, t);
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5f2ea";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    for (const row of positions) {
      if (!row.text) continue;
      if (row.screenY < -s.lineHeight || row.screenY > s.height + s.lineHeight) continue;
      const isTitle = row.index === 0;
      ctx.font = `${isTitle ? "bold " : ""}${isTitle ? 40 : 26}px ${s.fontFamily}`;
      ctx.fillText(row.text, s.width / 2, row.screenY);
    }
    ctx.restore();
  }

  /** 主入口：把 t 时刻的完整画面画到 canvas */
  function renderFrame(canvas, project, t) {
    const M = root.CreditModel;
    const ctx = canvas.getContext("2d");
    const s = project.settings;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, s.width, s.height);

    const active = M.activeClipAt(project, t);
    if (active) {
      drawClipFrame(ctx, active.clip, project, t, 1);
      if (active.blend) {
        // 交叉淡化：下一片段以其源入点起画
        const nextT = active.blend.next.start;
        drawClipFrame(ctx, active.blend.next, project, nextT, active.blend.progress);
      }
    }

    if (t >= project.credits.startTime) drawCredits(ctx, project, t);

    // 结尾背景淡出：最后一帧完全黑前的渐变（淡出结束后保持纯黑一帧以内）
    const dur = M.programDuration(project);
    const fade = s.bgFadeOut;
    if (fade > 0 && t > dur - fade) {
      const k = Math.min(1, (t - (dur - fade)) / fade);
      ctx.fillStyle = `rgba(0,0,0,${k})`;
      ctx.fillRect(0, 0, s.width, s.height);
    }
  }

  root.Renderer = { renderFrame };
})(typeof self !== "undefined" ? self : this);
