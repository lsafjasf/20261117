import { CAMERAS } from "./project.mjs";
import { BEAT_INTERVAL, timeToFrame } from "./timebase.mjs";

// 场景状态只与“节目时间”有关，与当前播到哪个机位无关。
// 因此切镜、分割、移动片段都不会让动画跳回起点。
export function sceneState(programTime, beatInterval = BEAT_INTERVAL) {
  const beatIndex = Math.floor(programTime / beatInterval + 1e-9);
  const beatPhase = (programTime % beatInterval) / beatInterval;
  const orbs = [0, 1, 2].map((i) => {
    const angle = programTime * 0.9 + (i * Math.PI * 2) / 3;
    const radius = 0.26 + 0.03 * Math.sin(programTime * 1.4 + i);
    return {
      id: i,
      angle,
      radius,
      x: 0.5 + Math.cos(angle) * radius,
      y: 0.5 + Math.sin(angle) * radius * 0.62
    };
  });
  return {
    time: programTime,
    frame: timeToFrame(programTime),
    hue: (programTime * 24) % 360,
    ringAngle: programTime * 0.8,
    pulse: 1 - beatPhase,
    beatIndex,
    beatPhase,
    orbs
  };
}

export function backgroundColor(programTime) {
  const { hue } = sceneState(programTime);
  return `hsl(${hue.toFixed(1)} 45% 22%)`;
}

const FRAMING = {
  camA: { zoom: 1, cx: 0.5, cy: 0.5 },
  camB: { zoom: 1.55, cx: 0.5, cy: 0.46 },
  camC: { zoom: 2.4, cx: 0.5, cy: 0.5 }
};

function cameraOf(cameraId) {
  return CAMERAS.find((c) => c.id === cameraId) ?? CAMERAS[0];
}

// 在任意类 Canvas 2D 上下文上绘制（浏览器真实 ctx 或测试桩均可）。
export function drawFrame(ctx, {
  time,
  cameraId,
  width = 640,
  height = 360,
  subtitle = "",
  beatInterval = BEAT_INTERVAL,
  alpha = 1
}) {
  const state = sceneState(time, beatInterval);
  const camera = cameraOf(cameraId);
  const framing = FRAMING[cameraId] ?? FRAMING.camA;
  const previousAlpha = ctx.globalAlpha ?? 1;
  ctx.globalAlpha = alpha;

  // 整幅背景始终被不透明绘制，保证不会出现黑帧/透明帧。
  ctx.fillStyle = backgroundColor(time);
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(framing.zoom, framing.zoom);
  ctx.translate(-framing.cx * width, -framing.cy * height);

  const gradient = ctx.createLinearGradient
    ? ctx.createLinearGradient(0, 0, width, height)
    : null;
  if (gradient) {
    gradient.addColorStop(0, `hsla(${state.hue}, 70%, 55%, 0.55)`);
    gradient.addColorStop(1, `hsla(${(state.hue + 90) % 360}, 70%, 35%, 0.55)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // 节拍脉冲环
  const ringR = (0.16 + state.pulse * 0.08) * Math.min(width, height);
  ctx.strokeStyle = `hsla(${(state.hue + 180) % 360}, 90%, 80%, 0.9)`;
  ctx.lineWidth = 4 / framing.zoom;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, ringR, state.ringAngle, state.ringAngle + Math.PI * 1.6);
  ctx.stroke();

  // 三个共享轨道球体：特写机位始终锁定同一个连续运动的球体。
  state.orbs.forEach((orb, i) => {
    const focus = cameraId === "camC" && i !== state.beatIndex % 3;
    ctx.globalAlpha = alpha * (focus ? 0.25 : 1);
    ctx.fillStyle = `hsl(${camera.hue + i * 40} 85% ${60 + state.pulse * 18}%)`;
    ctx.beginPath();
    ctx.arc(
      orb.x * width,
      orb.y * height,
      (0.05 + (i === 0 ? 0.015 : 0)) * Math.min(width, height)
    );
    ctx.fill();
  });
  ctx.globalAlpha = alpha;
  ctx.restore();

  // HUD：机位名、时间码、节拍
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(12, 12, 250, 54);
  ctx.fillStyle = "#ffffff";
  ctx.font = "16px monospace";
  ctx.fillText(camera.label, 24, 34);
  ctx.fillText(
    `t=${time.toFixed(3)}s f=${state.frame} beat=${state.beatIndex}`,
    24,
    56
  );
  ctx.fillStyle = state.beatPhase < 0.18 ? "#ffd54a" : "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.arc(width - 28, 30, 10, 0, Math.PI * 2);
  ctx.fill();

  if (subtitle) {
    ctx.font = "20px sans-serif";
    const metrics = ctx.measureText ? ctx.measureText(subtitle) : { width: subtitle.length * 12 };
    const boxW = Math.min(width - 40, metrics.width + 32);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect((width - boxW) / 2, height - 64, boxW, 40);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(subtitle, width / 2, height - 37);
    ctx.textAlign = "left";
  }

  ctx.globalAlpha = previousAlpha;
}
