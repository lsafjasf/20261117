import { validateProject, projectDuration, buildShotList } from "./project.mjs";
import { composeFrame } from "./composer.mjs";
import { FPS } from "./timebase.mjs";

// 测试/无浏览器环境使用的 Canvas 2D 桩：只记录绘制调用，
// 重点记录全屏不透明填充，用于确定性地判定黑帧。
export function createRecordingCtx(width, height) {
  const ctx = {
    width,
    height,
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "12px sans-serif",
    textAlign: "left",
    fills: [],
    colorFullFillAlpha: 0,
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    fillRect(x, y, w, h) {
      this.fills.push({ style: this.fillStyle, alpha: this.globalAlpha, x, y, w, h });
      if (
        w >= this.width &&
        h >= this.height &&
        !isBlackStyle(this.fillStyle)
      ) {
        this.colorFullFillAlpha += this.globalAlpha;
      }
    },
    fillText() {},
    measureText(text) {
      return { width: String(text).length * 10 };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    }
  };
  return ctx;
}

function isBlackStyle(style) {
  if (style === "#000000" || style === "black") return true;
  if (typeof style !== "string") return false;
  const match = style.match(/hsl\([^)]*?(\d+(?:\.\d+)?)%\s*\)/);
  return Boolean(match) && Number(match[1]) === 0;
}

// 一帧内只要有一次非黑色、不透明的全屏填充，就不是黑帧。
function frameIsBlack(ctx) {
  return ctx.colorFullFillAlpha < 1 - 1e-9;
}

export function verifyExport(project, options = {}) {
  const {
    width = 640,
    height = 360,
    fps = FPS,
    ctxFactory = () => createRecordingCtx(width, height)
  } = options;

  const validation = validateProject(project);
  const duration = projectDuration(project);
  const frameCount = Math.round(duration * fps);
  const blackFrames = [];
  const uncoveredFrames = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / fps;
    const ctx = ctxFactory(width, height);
    const result = composeFrame(ctx, project, time, { width, height });
    if (!result.covered) uncoveredFrames.push({ frame, time });
    if (frameIsBlack(ctx)) blackFrames.push({ frame, time });
  }

  const headBlack = blackFrames.filter((f) => f.time < 1 / fps - 1e-9);
  const tailBlack = blackFrames.filter((f) => f.time >= duration - 1 / fps - 1e-9);

  return {
    exportable:
      validation.exportable &&
      blackFrames.length === 0 &&
      uncoveredFrames.length === 0,
    duration,
    fps,
    frameCount,
    conflicts: validation.conflicts,
    blackFrames,
    uncoveredFrames,
    headBlack,
    tailBlack,
    shots: buildShotList(project)
  };
}

export function toCSV(shotList) {
  const header = "shot,camera,inPoint,outPoint,duration,sourceIn,transition,transitionDuration";
  const rows = shotList.map((s) =>
    [s.shot, s.camera, s.inPoint, s.outPoint, s.duration, s.sourceIn, s.transition, s.transitionDuration]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...rows].join("\n");
}
