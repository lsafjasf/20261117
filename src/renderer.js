import {
  BED_SIZE,
  PATH_HALF,
  PLAZA_HALF,
  SEASON_LABELS,
  clamp
} from "./scene.js";

const ISO_X = Math.cos(Math.PI / 6);
const ISO_Y = 0.5;

export const PALETTES = {
  spring: {
    skyTop: "#f3efe4",
    skyBottom: "#e2ddcf",
    glow: "rgba(251, 232, 190, 0.72)",
    haze: "rgba(255, 248, 233, 0.7)",
    shadow: "rgba(74, 72, 52, 0.17)",
    plateauTop: "#d8cdb6",
    plateauEdge: "#b9aa8e",
    plateauSide: "#95866a",
    plateauDark: "#796b54",
    path: "#e8dfcd",
    pathAlt: "#e1d5c0",
    pathSeam: "#cbbda4",
    pathDark: "#a89a82",
    stone: "#d9cfbc",
    stoneDark: "#aa9a81",
    soil: "#76533f",
    soilLight: "#8e6950",
    foliage: ["#5a8252", "#6d9460", "#48744d", "#7c9c68", "#3e6947"],
    foliageDark: "#34593f",
    flowers: ["#d96f87", "#efa65d", "#bc6f9a", "#f3df8e", "#e98b74"],
    accent: "#c76460",
    water: "#82a6a1",
    wood: "#a86742",
    woodLight: "#c28255",
    snow: null,
    label: "#566451"
  },
  summer: {
    skyTop: "#e7eee2",
    skyBottom: "#d3dfd0",
    glow: "rgba(255, 244, 191, 0.68)",
    haze: "rgba(245, 250, 234, 0.68)",
    shadow: "rgba(46, 68, 47, 0.2)",
    plateauTop: "#cbd4b4",
    plateauEdge: "#aebc94",
    plateauSide: "#8a9974",
    plateauDark: "#6d7b59",
    path: "#e5ddc9",
    pathAlt: "#dcd2bc",
    pathSeam: "#c4b89f",
    pathDark: "#9f947e",
    stone: "#d7d0bd",
    stoneDark: "#a49a85",
    soil: "#5f4737",
    soilLight: "#7d5d46",
    foliage: ["#397448", "#4f8c53", "#2e6745", "#689a5d", "#276043"],
    foliageDark: "#214f38",
    flowers: ["#e46169", "#f0b847", "#9a62aa", "#f5e06e", "#e7794e"],
    accent: "#b94f48",
    water: "#6e9d99",
    wood: "#a56039",
    woodLight: "#be7849",
    snow: null,
    label: "#526348"
  },
  autumn: {
    skyTop: "#f3eadb",
    skyBottom: "#e4d5c0",
    glow: "rgba(251, 218, 164, 0.7)",
    haze: "rgba(255, 245, 228, 0.65)",
    shadow: "rgba(84, 61, 42, 0.2)",
    plateauTop: "#d4c3a4",
    plateauEdge: "#bba77f",
    plateauSide: "#947e5b",
    plateauDark: "#796447",
    path: "#e7dac4",
    pathAlt: "#ddcdb4",
    pathSeam: "#c8b498",
    pathDark: "#a48d71",
    stone: "#d8cbb5",
    stoneDark: "#ab9981",
    soil: "#6d4e35",
    soilLight: "#896346",
    foliage: ["#9b673d", "#b57c43", "#7e623b", "#c18b4e", "#6f5b37"],
    foliageDark: "#665035",
    flowers: ["#b65a44", "#d98845", "#9f5649", "#e7b65b", "#b86d3f"],
    accent: "#a84e37",
    water: "#819992",
    wood: "#975b39",
    woodLight: "#b8784c",
    snow: null,
    label: "#65543d"
  },
  winter: {
    skyTop: "#eef1ee",
    skyBottom: "#dfe4df",
    glow: "rgba(249, 242, 217, 0.62)",
    haze: "rgba(251, 252, 248, 0.72)",
    shadow: "rgba(62, 76, 72, 0.18)",
    plateauTop: "#dfe2dc",
    plateauEdge: "#c7cec5",
    plateauSide: "#a8b1a9",
    plateauDark: "#8b968e",
    path: "#e9e8e2",
    pathAlt: "#e1e2dc",
    pathSeam: "#cbd2ca",
    pathDark: "#aab4ac",
    stone: "#d9ddd7",
    stoneDark: "#aeb7b0",
    soil: "#6a5f54",
    soilLight: "#82776a",
    foliage: ["#788d7e", "#8c9c8f", "#6d8177", "#9ba79c", "#63786f"],
    foliageDark: "#596a62",
    flowers: ["#bec9c2", "#d8d3bd", "#b4c5c8", "#d9e1dc", "#c8b8ae"],
    accent: "#8b5e56",
    water: "#a8c4c5",
    wood: "#8f6245",
    woodLight: "#ae7d59",
    snow: "rgba(247, 249, 245, 0.9)",
    label: "#5d6c64"
  }
};

export class PlazaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
    this.data = null;
    this.lastObjectOrder = [];
  }

  setData(data) {
    this.data = data;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    this.width = width;
    this.height = height;
    this.pixelRatio = ratio;
    return { width, height, ratio };
  }

  draw(now = 0) {
    if (!this.data) return;
    const { width, height, ratio } = this.resize();
    const ctx = this.ctx;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.paint(ctx, width, height, now);
  }

  renderExport() {
    if (!this.data) throw new Error("当前没有可导出的有效画面");
    const ratio = Math.max(2, Math.min(3, 2400 / Math.max(this.width, 1)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(this.width * ratio);
    canvas.height = Math.round(this.height * ratio);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.paint(ctx, this.width, this.height, 0, { exporting: true });
    return canvas;
  }

  paint(ctx, width, height, now, options = {}) {
    const { scene, state, selectedBench = null } = this.data;
    const palette = PALETTES[state.season];
    const camera = this.camera(width, height, state);
    this.lastCamera = camera;
    ctx.save();
    this.trace?.push("background");
    this.drawBackground(ctx, width, height, palette, now, state.paused);
    if (state.layers.ground) {
      this.trace?.push("ground");
      this.drawPlateau(ctx, camera, palette, state, now);
    }
    if (state.layers.paths) this.trace?.push("paths");
    if (state.layers.paths) this.drawPaths(ctx, camera, palette, state, now);
    if (state.layers.beds) this.trace?.push("beds");
    if (state.layers.beds) this.drawBeds(ctx, camera, palette, state);
    if (state.layers.decor) this.trace?.push("decor-back");
    this.drawDecorBack(ctx, camera, palette, state, now);
    if (state.layers.plants || state.layers.benches) this.trace?.push("objects");
    this.drawObjects(ctx, camera, palette, state, scene, selectedBench, now);
    if (state.layers.decor) this.trace?.push("decor-front");
    this.drawDecorFront(ctx, camera, palette, state, now);
    if (options.exporting) this.drawExportMark(ctx, width, height, palette, state);
    ctx.restore();
  }

  camera(width, height, state) {
    const scale = Math.min(width / 20.4, height / 13.8) * state.view.zoom;
    return {
      width,
      height,
      scale,
      cx: width * 0.515,
      cy: height * 0.55,
      theta: state.view.angle * Math.PI / 180
    };
  }

  project(x, z, y, camera) {
    const cos = Math.cos(camera.theta);
    const sin = Math.sin(camera.theta);
    const rx = x * cos - z * sin;
    const rz = x * sin + z * cos;
    return {
      x: camera.cx + (rx - rz) * ISO_X * camera.scale,
      y: camera.cy + (rx + rz) * ISO_Y * camera.scale - y * camera.scale,
      depth: rx + rz
    };
  }

  worldPolygon(points, y, camera) {
    return points.map(([x, z]) => this.project(x, z, y, camera));
  }

  fillPolygon(ctx, points, fill, stroke = null, lineWidth = 1) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  drawBackground(ctx, width, height, palette, now, paused) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, palette.skyTop);
    gradient.addColorStop(1, palette.skyBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const sunX = width * 0.73;
    const sunY = height * 0.17;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, width * 0.46);
    glow.addColorStop(0, palette.glow);
    glow.addColorStop(0.45, palette.haze);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = palette.label;
    ctx.lineWidth = 1;
    const arcX = width * 0.79;
    const arcY = height * 0.2;
    for (let index = 0; index < 3; index += 1) {
      ctx.beginPath();
      ctx.arc(arcX, arcY, 54 + index * 22, Math.PI * 0.78, Math.PI * 1.58);
      ctx.stroke();
    }
    ctx.restore();

    this.drawPaperGrain(ctx, width, height, palette);
    this.drawDistantGarden(ctx, width, height, palette, now, paused);
  }

  drawPaperGrain(ctx, width, height, palette) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = palette.label;
    const step = 29;
    for (let y = 20; y < height; y += step) {
      for (let x = 15 + ((y / step) % 2) * 8; x < width; x += step) {
        const size = ((x * 7 + y * 13) % 5 === 0) ? 1.1 : 0.55;
        ctx.fillRect(x, y, size, size);
      }
    }
    ctx.restore();
  }

  drawDistantGarden(ctx, width, height, palette, now, paused) {
    const time = paused ? 0 : now / 1000;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = palette.foliageDark;
    for (let index = 0; index < 13; index += 1) {
      const x = width * (0.05 + index * 0.075);
      const y = height * (0.15 + ((index * 17) % 11) / 100);
      const r = 12 + (index % 4) * 7;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.7, r, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.22;
    for (let index = 0; index < 5; index += 1) {
      const x = width * (0.15 + index * 0.18) + Math.sin(time * 0.08 + index) * 10;
      const y = height * (0.33 + (index % 2) * 0.05);
      ctx.strokeStyle = palette.label;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.quadraticCurveTo(x, y - 2.5, x + 5, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPlateau(ctx, camera, palette, state, now) {
    const center = this.project(0, 0, 0, camera);
    ctx.save();
    const shadow = ctx.createRadialGradient(center.x, center.y + camera.scale * 0.55, camera.scale, center.x, center.y + camera.scale * 0.55, camera.scale * 8);
    shadow.addColorStop(0, palette.shadow);
    shadow.addColorStop(0.54, palette.shadow);
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y + camera.scale * 0.55, camera.scale * 7.6, camera.scale * 3.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const h = PLAZA_HALF;
    const corner = 0.95;
    const top = [
      [-h, -h + corner], [-h + corner, -h], [h - corner, -h], [h, -h + corner],
      [h, h - corner], [h - corner, h], [-h + corner, h], [-h, h - corner]
    ];
    const depth = 0.74;
    const topPoints = this.worldPolygon(top, 0, camera);
    const bottomPoints = this.worldPolygon(top, -depth, camera);
    const sides = [[0, 7], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]];
    for (const [start, end] of sides) {
      const face = [topPoints[start], topPoints[end], bottomPoints[end], bottomPoints[start]];
      const shade = (start + 1) % 2 === 0 ? palette.plateauSide : palette.plateauDark;
      this.fillPolygon(ctx, face, shade);
    }
    this.fillPolygon(ctx, topPoints, palette.plateauTop, palette.plateauEdge, 0.9);

    const inset = 0.25;
    const inner = [
      [-h + inset, -h + corner], [-h + corner, -h + inset], [h - corner, -h + inset], [h - inset, -h + corner],
      [h - inset, h - corner], [h - corner, h - inset], [-h + corner, h - inset], [-h + inset, h - corner]
    ];
    this.fillPolygon(ctx, this.worldPolygon(inner, 0.006, camera), palette.plateauEdge, "rgba(255,255,255,0.16)", 0.6);

    ctx.save();
    ctx.globalAlpha = 0.19;
    ctx.strokeStyle = palette.plateauDark;
    ctx.lineWidth = 0.65;
    for (let index = -6; index <= 6; index += 1.5) {
      this.strokeWorldLine(ctx, [-h + 0.45, index], [h - 0.45, index], 0.02, camera);
    }
    ctx.restore();

    if (state.season === "winter") {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = palette.snow;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const path = topPoints.map((point, index) => ({ ...point, edge: index }));
      ctx.moveTo(path[0].x, path[0].y);
      for (let index = 1; index < path.length; index += 1) ctx.lineTo(path[index].x, path[index].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawPaths(ctx, camera, palette, state, now) {
    const reach = PLAZA_HALF - 0.22;
    const half = PATH_HALF;
    const horizontal = [[-reach, -half], [reach, -half], [reach, half], [-reach, half]];
    const vertical = [[-half, -reach], [half, -reach], [half, reach], [-half, reach]];

    this.fillPolygon(ctx, this.worldPolygon(horizontal, 0.018, camera), palette.path, palette.pathSeam, 0.8);
    this.fillPolygon(ctx, this.worldPolygon(vertical, 0.019, camera), palette.pathAlt, palette.pathSeam, 0.8);

    ctx.save();
    ctx.beginPath();
    this.tracePolygon(ctx, this.worldPolygon(horizontal, 0.02, camera));
    this.tracePolygon(ctx, this.worldPolygon(vertical, 0.02, camera));
    ctx.clip();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = palette.pathSeam;
    ctx.lineWidth = 0.55;
    for (let x = -reach; x <= reach + 0.01; x += 0.72) {
      this.strokeWorldLine(ctx, [x, -half - 0.1], [x, half + 0.1], 0.026, camera);
    }
    for (let z = -reach; z <= reach + 0.01; z += 0.72) {
      this.strokeWorldLine(ctx, [-half - 0.1, z], [half + 0.1, z], 0.027, camera);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.46;
    ctx.strokeStyle = "rgba(255,255,255,0.62)";
    ctx.lineWidth = 1.15;
    this.strokeWorldLine(ctx, [-reach, -half], [reach, -half], 0.035, camera);
    this.strokeWorldLine(ctx, [-half, -reach], [half, -reach], 0.036, camera);
    ctx.strokeStyle = palette.pathDark;
    ctx.globalAlpha = 0.32;
    this.strokeWorldLine(ctx, [-reach, half], [reach, half], 0.035, camera);
    this.strokeWorldLine(ctx, [half, -reach], [half, reach], 0.036, camera);
    ctx.restore();

    this.drawMedallion(ctx, camera, palette, state, now);
  }

  drawMedallion(ctx, camera, palette, state, now) {
    const points = [];
    const segments = 40;
    for (let index = 0; index < segments; index += 1) {
      const angle = index / segments * Math.PI * 2;
      points.push([Math.cos(angle) * 1.38, Math.sin(angle) * 1.38]);
    }
    this.fillPolygon(ctx, this.worldPolygon(points, 0.038, camera), palette.path, palette.pathSeam, 1);

    const innerPoints = points.map(([x, z]) => [x * 0.82, z * 0.82]);
    this.fillPolygon(ctx, this.worldPolygon(innerPoints, 0.042, camera), palette.pathAlt, palette.stoneDark, 0.7);
    const center = this.project(0, 0, 0.045, camera);
    const radius = camera.scale * 0.82;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(1, ISO_Y / ISO_X);
    ctx.strokeStyle = palette.pathDark;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(state.view.angle * Math.PI / 180);
    ctx.beginPath();
    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * radius * 0.7, Math.sin(angle) * radius * 0.7);
    }
    ctx.stroke();
    ctx.restore();

    const leaf = this.project(0, 0, 0.048, camera);
    ctx.save();
    ctx.translate(leaf.x, leaf.y);
    ctx.rotate(-0.55 + Math.sin(now / 5000) * 0.02);
    ctx.fillStyle = palette.foliage[1];
    ctx.beginPath();
    ctx.ellipse(-3.4, 0, 4.5, 1.8, 0, 0, Math.PI * 2);
    ctx.ellipse(3.4, 0, 4.5, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  tracePolygon(ctx, points) {
    if (!points.length) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
    ctx.closePath();
  }

  strokeWorldLine(ctx, from, to, y, camera) {
    const start = this.project(from[0], from[1], y, camera);
    const end = this.project(to[0], to[1], y, camera);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  drawBeds(ctx, camera, palette, state) {
    const sorted = this.data.scene.beds
      .map((bed) => ({ bed, depth: this.project(bed.x, bed.z, 0, camera).depth }))
      .sort((a, b) => a.depth - b.depth);
    for (const { bed } of sorted) this.drawBed(ctx, camera, palette, state, bed);
  }

  drawBed(ctx, camera, palette, state, bed) {
    const half = bed.width / 2;
    const h = 0.36;
    const x0 = bed.x - half;
    const x1 = bed.x + half;
    const z0 = bed.z - half;
    const z1 = bed.z + half;
    const outer = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const top = this.worldPolygon(outer, h, camera);
    const bottom = this.worldPolygon(outer, 0.025, camera);
    const center = this.project(bed.x, bed.z, 0, camera);

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = palette.shadow;
    ctx.beginPath();
    ctx.ellipse(center.x + camera.scale * 0.08, center.y + camera.scale * 0.12, camera.scale * 2.2, camera.scale * 0.78, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (let index = 0; index < 4; index += 1) {
      const next = (index + 1) % 4;
      const face = [top[index], top[next], bottom[next], bottom[index]];
      this.fillPolygon(ctx, face, index % 2 ? palette.stone : palette.stoneDark);
    }
    this.fillPolygon(ctx, top, palette.stone, palette.stoneDark, 0.8);

    const inset = 0.19;
    const soil = [[x0 + inset, z0 + inset], [x1 - inset, z0 + inset], [x1 - inset, z1 - inset], [x0 + inset, z1 - inset]];
    this.fillPolygon(ctx, this.worldPolygon(soil, h + 0.012, camera), palette.soil, "rgba(49,35,26,0.2)", 0.5);

    const inner = [[x0 + 0.33, z0 + 0.33], [x1 - 0.33, z0 + 0.33], [x1 - 0.33, z1 - 0.33], [x0 + 0.33, z1 - 0.33]];
    this.fillPolygon(ctx, this.worldPolygon(inner, h + 0.016, camera), palette.soilLight);

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = 0.7;
    for (let index = 0; index <= 6; index += 1) {
      const t = index / 6;
      const a = [x0 + inset + (x1 - x0 - inset * 2) * t, z0 + inset];
      const b = [x0 + inset + (x1 - x0 - inset * 2) * t, z1 - inset];
      this.strokeWorldLine(ctx, a, b, h + 0.02, camera);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = palette.stoneDark;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 0.55;
    for (let index = 1; index < 8; index += 1) {
      const t = index / 8;
      const leftTop = [x0 + half * 2 * t, z0];
      const rightTop = [x0 + half * 2 * t, z1];
      this.strokeWorldLine(ctx, leftTop, [x0 + half * 2 * t, z0 + inset], h + 0.022, camera);
      this.strokeWorldLine(ctx, rightTop, [x0 + half * 2 * t, z1 - inset], h + 0.022, camera);
    }
    for (let index = 1; index < 8; index += 1) {
      const t = index / 8;
      const z = z0 + half * 2 * t;
      this.strokeWorldLine(ctx, [x0, z], [x0 + inset, z], h + 0.022, camera);
      this.strokeWorldLine(ctx, [x1, z], [x1 - inset, z], h + 0.022, camera);
    }
    ctx.restore();

    if (state.season === "winter") {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = palette.snow;
      this.fillPolygon(ctx, this.worldPolygon([
        [x0 + 0.08, z0 + 0.08], [x1 - 0.08, z0 + 0.08], [x1 - 0.13, z0 + 0.3], [x0 + 0.16, z0 + 0.25]
      ], h + 0.03, camera), palette.snow);
      ctx.restore();
    }
  }

  drawObjects(ctx, camera, palette, state, scene, selectedBench, now) {
    const objects = [];
    if (state.layers.plants) {
      for (const bed of scene.beds) {
        for (const plant of bed.plants) {
          objects.push({
            kind: "plant",
            plant,
            depth: this.project(plant.x, plant.z, 0, camera).depth
          });
        }
      }
    }
    if (state.layers.benches) {
      for (const bench of state.benches) {
        objects.push({
          kind: "bench",
          bench,
          depth: this.project(bench.x, bench.z, 0, camera).depth
        });
      }
    }
    objects.sort((a, b) => a.depth - b.depth);
    this.lastObjectOrder = objects.map((object) => ({
      kind: object.kind,
      id: object.kind === "bench" ? object.bench.id : object.plant.id,
      depth: object.depth
    }));
    for (const object of objects) {
      if (object.kind === "plant") {
        this.drawPlant(ctx, camera, palette, state, object.plant, now);
      } else {
        this.drawBench(ctx, camera, palette, state, object.bench, object.bench.id === selectedBench, now);
      }
    }
  }

  drawPlant(ctx, camera, palette, state, plant, now) {
    const sway = state.paused ? 0 : Math.sin(now / 1100 + plant.phase) * 0.035;
    const base = this.project(plant.x, plant.z, 0.38, camera);
    const top = this.project(plant.x + sway, plant.z, 0.38 + plant.height, camera);
    const foliage = palette.foliage[plant.tone % palette.foliage.length];
    const dark = palette.foliageDark;
    ctx.save();

    ctx.globalAlpha = 0.14;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y + 1.8, 3.3 * plant.size, 1.1 * plant.size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (plant.type === "flower") {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = foliage;
      ctx.beginPath();
      ctx.ellipse(base.x, base.y - 1.8, 4.2 * plant.size, 2.1 * plant.size, -0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.foliageDark;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(base.x - sway * camera.scale * 0.4, (base.y + top.y) / 2, top.x, top.y);
      ctx.stroke();
      this.drawLeaf(ctx, base, top, -1, plant.size, foliage);
      this.drawLeaf(ctx, base, top, 1, plant.size, foliage);
      const color = palette.flowers[plant.tone % palette.flowers.length];
      if (plant.tone % 3 === 0) {
        for (let index = 0; index < 3; index += 1) {
          const t = index / 3;
          this.drawBlossom(
            ctx,
            top.x + (base.x - top.x) * t * 0.32,
            top.y + (base.y - top.y) * t * 0.32,
            plant.size * (3.5 - index * 0.45),
            index % 2 ? palette.flowers[(plant.tone + 2) % palette.flowers.length] : color
          );
        }
      } else {
        this.drawBlossom(ctx, top.x, top.y, plant.size * 3.7, color);
        if (plant.tone % 2 === 0) {
          this.drawBlossom(ctx, top.x + 3.6, top.y + 2.8, plant.size * 2.2, palette.flowers[(plant.tone + 1) % palette.flowers.length]);
        }
      }
    } else if (plant.type === "grass") {
      ctx.strokeStyle = foliage;
      ctx.lineWidth = 1;
      for (let index = -3; index <= 3; index += 1) {
        const bend = index * 1.6 * plant.size;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.quadraticCurveTo(base.x + bend * 0.5, (base.y + top.y) / 2, top.x + bend + sway * 8, top.y + Math.abs(index) * 1.6);
        ctx.stroke();
      }
    } else {
      const r = 4.3 * plant.size;
      ctx.fillStyle = foliage;
      ctx.beginPath();
      ctx.arc(base.x - r * 0.55, base.y - r * 0.5, r * 0.72, 0, Math.PI * 2);
      ctx.arc(base.x + r * 0.5, base.y - r * 0.55, r * 0.68, 0, Math.PI * 2);
      ctx.arc(base.x, base.y - r, r * 0.82, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.foliage[(plant.tone + 2) % palette.foliage.length];
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.arc(base.x - r * 0.15, base.y - r * 0.92, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.season === "winter" && plant.type !== "grass") {
      ctx.fillStyle = palette.snow;
      ctx.globalAlpha = 0.78;
      ctx.beginPath();
      ctx.ellipse(top.x, top.y - 1, 2.4 * plant.size, 0.9 * plant.size, -0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawLeaf(ctx, base, top, side, size, color) {
    const x = (base.x + top.x) / 2 + side * 3.5 * size;
    const y = (base.y + top.y) / 2 + 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(side * 0.55);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.2 * size, 1.35 * size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawBlossom(ctx, x, y, radius, color) {
    ctx.fillStyle = color;
    for (let index = 0; index < 5; index += 1) {
      const angle = index / 5 * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.ellipse(
        x + Math.cos(angle) * radius * 0.55,
        y + Math.sin(angle) * radius * 0.42,
        radius * 0.52,
        radius * 0.37,
        angle,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255, 244, 199, 0.9)";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, radius * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }

  drawBench(ctx, camera, palette, state, bench, selected, now) {
    const rad = bench.rotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const length = 1.58;
    const width = 0.54;
    const seatY = 0.46;
    const map = (lx, lz, y) => this.project(
      bench.x + lx * cos - lz * sin,
      bench.z + lx * sin + lz * cos,
      y,
      camera
    );
    const p = (lx, lz, y) => map(lx, lz, y);
    const center = p(0, 0, 0);
    const sway = state.paused ? 0 : Math.sin(now / 1600 + bench.x) * 0.08;

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = palette.shadow;
    this.fillPolygon(ctx, [
      p(-length / 2 - 0.1, -width / 2, 0.02),
      p(length / 2 + 0.1, -width / 2, 0.02),
      p(length / 2 + 0.15, width / 2 + 0.1, 0.02),
      p(-length / 2 - 0.15, width / 2 + 0.1, 0.02)
    ], palette.shadow);
    ctx.restore();

    if (selected) {
      ctx.save();
      ctx.strokeStyle = palette.accent;
      ctx.globalAlpha = 0.78;
      ctx.lineWidth = 1.15;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.ellipse(center.x, center.y + 3, camera.scale * 1.02, camera.scale * 0.5, -0.04, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const legPositions = [
      [-length * 0.37, -width * 0.34], [length * 0.37, -width * 0.34],
      [-length * 0.37, width * 0.34], [length * 0.37, width * 0.34]
    ];
    for (const [lx, lz] of legPositions) {
      const foot = p(lx, lz, 0.01);
      const hip = p(lx, lz, seatY - 0.09);
      ctx.strokeStyle = "rgba(68,43,27,0.54)";
      ctx.lineWidth = 3.1;
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y);
      ctx.lineTo(hip.x, hip.y);
      ctx.stroke();
      ctx.strokeStyle = palette.wood;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(foot.x - 0.5, foot.y);
      ctx.lineTo(hip.x - 0.5, hip.y);
      ctx.stroke();
    }

    const seatBottom = seatY - 0.1;
    for (const zSide of [-width / 2, width / 2]) {
      this.fillPolygon(ctx, [
        p(-length / 2, zSide, seatBottom),
        p(length / 2, zSide, seatBottom),
        p(length / 2, zSide, seatY),
        p(-length / 2, zSide, seatY)
      ], palette.wood, "rgba(64,38,24,0.34)", 0.55);
    }
    const seatTop = [
      p(-length / 2, -width / 2, seatY),
      p(length / 2, -width / 2, seatY),
      p(length / 2, width / 2, seatY),
      p(-length / 2, width / 2, seatY)
    ];
    this.fillPolygon(ctx, seatTop, palette.woodLight, "rgba(87,50,31,0.5)", 0.7);
    ctx.save();
    ctx.globalAlpha = 0.44;
    ctx.strokeStyle = palette.wood;
    ctx.lineWidth = 0.7;
    for (const lz of [-0.14, 0.02, 0.18]) {
      this.strokeWorldLine(ctx, [bench.x - length / 2 * cos - lz * sin, bench.z - length / 2 * sin + lz * cos],
        [bench.x + length / 2 * cos - lz * sin, bench.z + length / 2 * sin + lz * cos], seatY + 0.004, camera);
    }
    ctx.restore();

    const backZ = -width * 0.45;
    for (const lx of [-length * 0.37, length * 0.37]) {
      const bottom = p(lx, backZ, seatY);
      const top = p(lx, backZ + sway * 0.015, seatY + 0.62);
      ctx.strokeStyle = palette.wood;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(bottom.x, bottom.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }
    for (let index = 0; index < 3; index += 1) {
      const y = seatY + 0.28 + index * 0.15;
      const a = p(-length * 0.44, backZ + sway * 0.015, y);
      const b = p(length * 0.44, backZ + sway * 0.015, y);
      ctx.strokeStyle = index === 2 ? palette.wood : palette.woodLight;
      ctx.lineWidth = index === 2 ? 3.2 : 2.4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (index === 2) {
        ctx.strokeStyle = "rgba(255,241,207,0.26)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y - 1);
        ctx.lineTo(b.x, b.y - 1);
        ctx.stroke();
      }
    }

    if (selected) {
      const tag = p(0, 0, 1.28 + sway * 0.015);
      ctx.save();
      ctx.font = '600 8px "Avenir Next", "PingFang SC", "Noto Sans SC", sans-serif';
      const label = `长椅 ${bench.id.slice(-1).toUpperCase()}`;
      const width = ctx.measureText(label).width + 15;
      ctx.fillStyle = "rgba(37,53,45,0.88)";
      ctx.beginPath();
      ctx.roundRect(tag.x - width / 2, tag.y - 10, width, 18, 9);
      ctx.fill();
      ctx.fillStyle = "#f6f1e5";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, tag.x, tag.y);
      ctx.restore();
    }
  }

  drawDecorBack(ctx, camera, palette, state, now) {
    if (!state.layers.decor) return;
    const time = state.paused ? 0 : now / 1000;
    for (let index = 0; index < 6; index += 1) {
      const bed = this.data.scene.beds[index % 4];
      const x = bed.x + Math.sin(index * 2.7) * 1.2;
      const z = bed.z + Math.cos(index * 1.9) * 0.9;
      const lift = 0.95 + (index % 3) * 0.18 + Math.sin(time * 0.8 + index) * 0.06;
      const point = this.project(x, z, lift, camera);
      const flap = Math.sin(time * 4 + index * 1.3) * 0.55;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(-0.2 + flap * 0.15);
      ctx.fillStyle = index % 2 ? palette.accent : palette.flowers[index % palette.flowers.length];
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.ellipse(-2.2, 0, 2.6, 1.2, -0.65, 0, Math.PI * 2);
      ctx.ellipse(2.2, 0, 2.6, 1.2, 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawDecorFront(ctx, camera, palette, state, now) {
    if (!state.layers.decor) return;
    const time = state.paused ? 0 : now / 1000;
    const particleColor = state.season === "winter" ? "rgba(255,255,255,0.85)" : palette.flowers[0];
    ctx.save();
    ctx.fillStyle = particleColor;
    ctx.strokeStyle = particleColor;
    for (let index = 0; index < 15; index += 1) {
      const x = 0.13 + ((index * 0.618) % 0.76);
      const drift = Math.sin(time * 0.22 + index * 1.9) * 0.012;
      const py = 0.24 + ((index * 0.413 + time * 0.006) % 0.55);
      const px = x + drift;
      ctx.globalAlpha = state.season === "winter" ? 0.58 : 0.32;
      if (state.season === "winter") {
        ctx.beginPath();
        ctx.arc(px * camera.width, py * camera.height, index % 3 === 0 ? 1.5 : 0.85, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(px * camera.width, py * camera.height);
        ctx.rotate(time * 0.25 + index);
        ctx.beginPath();
        ctx.ellipse(0, 0, 2.2, 0.75, 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
    this.drawBedLabels(ctx, camera, palette, state);
  }

  drawBedLabels(ctx, camera, palette, state) {
    if (!state.layers.beds) return;
    ctx.save();
    ctx.font = '600 7px "Avenir Next", "Noto Sans SC", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.data.scene.beds.forEach((bed, index) => {
      const point = this.project(bed.x - bed.width * 0.36, bed.z - bed.depth * 0.36, 0.41, camera);
      ctx.fillStyle = "rgba(250,247,238,0.72)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(61,78,63,0.25)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = palette.label;
      ctx.fillText(String(index + 1).padStart(2, "0"), point.x, point.y + 0.4);
    });
    ctx.restore();
  }

  drawExportMark(ctx, width, height, palette, state) {
    ctx.save();
    ctx.globalAlpha = 0.58;
    ctx.strokeStyle = palette.label;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(36, height - 34);
    ctx.lineTo(69, height - 34);
    ctx.stroke();
    ctx.fillStyle = palette.label;
    ctx.font = '500 8px "Avenir Next", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillText(`小满广场 · ${SEASON_LABELS[state.season]}  /  SEED ${state.seed}`, 36, height - 22);
    ctx.textAlign = "right";
    ctx.fillText("ISOMETRIC COURTYARD  ·  01", width - 36, height - 22);
    ctx.restore();
  }

  hitBench(screenX, screenY) {
    if (!this.data || !this.lastCamera) return null;
    const camera = this.lastCamera;
    let hit = null;
    let best = 34;
    for (const bench of this.data.state.benches) {
      const point = this.project(bench.x, bench.z, 0.6, camera);
      const distance = Math.hypot(point.x - screenX, point.y - screenY);
      if (distance < best) {
        best = distance;
        hit = bench;
      }
    }
    return hit;
  }

  screenToWorld(screenX, screenY) {
    if (!this.lastCamera) return { x: 0, z: 0 };
    const camera = this.lastCamera;
    const dx = (screenX - camera.cx) / (ISO_X * camera.scale);
    const dy = (screenY - camera.cy) / (ISO_Y * camera.scale);
    const rx = (dx + dy) / 2;
    const rz = (dy - dx) / 2;
    const cos = Math.cos(camera.theta);
    const sin = Math.sin(camera.theta);
    return { x: rx * cos + rz * sin, z: -rx * sin + rz * cos };
  }
}
