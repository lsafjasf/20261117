import { PROFILES, SOURCE } from "./scenario";
import type { Contact, ContactKind, Point } from "./types";

interface RenderState {
  contacts: Contact[];
  discovered: Set<string>;
  selectedTool: ContactKind;
  hoveredId: string | null;
  scanStartedAt: number | null;
  heat: number;
  paused: boolean;
  success: boolean;
  wrongIds: Set<string>;
}

interface Particle {
  x: number;
  y: number;
  size: number;
  speed: number;
  drift: number;
  alpha: number;
}

const INK = "#dceff0";
const MUTED = "#6f9296";
const FAINT = "#2d4b50";
const CYAN = "#78e6dc";
const AMBER = "#f5b45b";
const RED = "#f1705f";

export class SonarRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scope: HTMLCanvasElement;
  private scopeCtx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private particles: Particle[] = [];
  private resizeObserver: ResizeObserver;
  private state: RenderState = {
    contacts: [],
    discovered: new Set(),
    selectedTool: "shallow",
    hoveredId: null,
    scanStartedAt: null,
    heat: 18,
    paused: true,
    success: false,
    wrongIds: new Set(),
  };

  constructor(canvas: HTMLCanvasElement, scope: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    const scopeCtx = scope.getContext("2d");
    if (!ctx || !scopeCtx) throw new Error("Canvas 2D is unavailable");
    this.ctx = ctx;
    this.scope = scope;
    this.scopeCtx = scopeCtx;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resizeObserver.observe(scope);
    this.resize();
    this.seedParticles();
    this.tick();
  }

  setState(patch: Partial<RenderState>): void {
    this.state = { ...this.state, ...patch };
  }

  getState(): RenderState {
    return this.state;
  }

  pick(clientX: number, clientY: number): Contact | null {
    const rect = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    let nearest: Contact | null = null;
    let distance = 46;
    for (const contact of this.state.contacts) {
      if (!this.state.discovered.has(contact.id)) continue;
      const screen = this.toScreen(contact.position);
      const d = Math.hypot(point.x - screen.x, point.y - screen.y);
      if (d < distance) {
        distance = d;
        nearest = contact;
      }
    }
    return nearest;
  }

  toScreen(point: Point): Point {
    return { x: point.x * this.width, y: point.y * this.height };
  }

  triggerScan(): void {
    this.state.scanStartedAt = performance.now();
  }

  drawScope(left: Float32Array, right: Float32Array): void {
    const ctx = this.scopeCtx;
    const width = this.scope.clientWidth;
    const height = this.scope.clientHeight;
    ctx.clearRect(0, 0, width, height);
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, "rgba(10, 34, 38, 0.3)");
    grad.addColorStop(0.5, "rgba(4, 16, 20, 0.7)");
    grad.addColorStop(1, "rgba(10, 34, 38, 0.3)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(120, 191, 193, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = (height * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    this.drawTrace(left, "rgba(120, 230, 220, 0.92)", 0.55);
    this.drawTrace(right, "rgba(245, 180, 91, 0.62)", 0.92);
  }

  private drawTrace(samples: Float32Array, color: string, amplify: number): void {
    if (!samples.length) return;
    const ctx = this.scopeCtx;
    const width = this.scope.clientWidth;
    const height = this.scope.clientHeight;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(samples.length / width));
    for (let i = 0; i < samples.length; i += step) {
      const x = (i / (samples.length - 1)) * width;
      const y = height / 2 + samples[i] * height * 3.2 * amplify;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const scopeRect = this.scope.getBoundingClientRect();
    this.scope.width = Math.max(1, Math.floor(scopeRect.width * this.dpr));
    this.scope.height = Math.max(1, Math.floor(scopeRect.height * this.dpr));
    this.scopeCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.seedParticles();
  }

  private seedParticles(): void {
    let seed = 7319;
    const random = () => {
      seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
      return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
    };
    this.particles = Array.from({ length: 92 }, () => ({
      x: random(),
      y: random(),
      size: random() * 1.5 + 0.35,
      speed: random() * 0.008 + 0.002,
      drift: (random() - 0.5) * 0.005,
      alpha: random() * 0.35 + 0.08,
    }));
  }

  private tick = (): void => {
    this.draw();
    requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    const now = performance.now() / 1000;
    ctx.clearRect(0, 0, width, height);
    this.drawWater(width, height, now);
    this.drawGrid(width, height);
    this.drawParticles(now, width, height);
    this.drawLandforms(width, height);
    this.drawRoute(width, height, now);
    this.drawScanWave(width);
    this.drawContacts(width, height, now);
    this.drawVehicle(width, height, now);
    this.drawAnnotations(width, height);
    if (this.state.heat > 76) this.drawHeat(width, height);
  }

  private drawWater(width: number, height: number, now: number): void {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#071c22");
    gradient.addColorStop(0.42, "#06161b");
    gradient.addColorStop(1, "#040e12");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const beam = ctx.createRadialGradient(
      width * 0.13,
      height * 0.5,
      0,
      width * 0.13,
      height * 0.5,
      width * 0.72,
    );
    beam.addColorStop(0, "rgba(54, 149, 148, 0.13)");
    beam.addColorStop(0.45, "rgba(30, 91, 96, 0.055)");
    beam.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = beam;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 5; i += 1) {
      const x = width * (0.22 + i * 0.18) + Math.sin(now * 0.07 + i) * 24;
      const y = height * (0.14 + (i % 3) * 0.29);
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, width * 0.18);
      cloud.addColorStop(0, "rgba(70, 127, 128, 0.035)");
      cloud.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = cloud;
      ctx.fillRect(x - width * 0.22, y - width * 0.18, width * 0.44, width * 0.36);
    }
    ctx.restore();
  }

  private drawGrid(width: number, height: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(99, 180, 181, 0.065)";
    ctx.lineWidth = 1;
    const cell = Math.max(52, width / 16);
    for (let x = cell; x < width; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = cell; y < height; y += cell) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(99, 180, 181, 0.11)";
    for (let i = 1; i < 8; i += 1) {
      const x = (width * i) / 8;
      ctx.beginPath();
      ctx.moveTo(x, height - 18);
      ctx.lineTo(x, height - 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawParticles(now: number, width: number, height: number): void {
    const ctx = this.ctx;
    ctx.save();
    for (const particle of this.particles) {
      particle.y -= particle.speed * 0.018;
      particle.x += Math.sin(now * 0.2 + particle.y * 16) * 0.00006 + particle.drift * 0.001;
      if (particle.y < 0.08) particle.y = 0.96;
      if (particle.x < 0.02) particle.x = 0.98;
      if (particle.x > 0.99) particle.x = 0.02;
      ctx.fillStyle = `rgba(159, 210, 205, ${particle.alpha})`;
      ctx.beginPath();
      ctx.arc(particle.x * width, particle.y * height, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawLandforms(width: number, height: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(17, 42, 46, 0.65)";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.9);
    ctx.bezierCurveTo(width * 0.13, height * 0.86, width * 0.2, height * 0.96, width * 0.36, height * 0.89);
    ctx.lineTo(width * 0.36, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(119, 183, 181, 0.11)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, height * (0.83 + i * 0.035));
      ctx.bezierCurveTo(
        width * 0.12,
        height * (0.8 + i * 0.038),
        width * 0.22,
        height * (0.89 + i * 0.02),
        width * 0.39,
        height * (0.83 + i * 0.04),
      );
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(12, 31, 34, 0.9)";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(width * 0.79, height);
    ctx.bezierCurveTo(width * 0.8, height * 0.7, width * 0.74, height * 0.54, width * 0.78, height * 0.28);
    ctx.stroke();
    ctx.strokeStyle = "rgba(67, 105, 107, 0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width * 0.79, height);
    ctx.bezierCurveTo(width * 0.8, height * 0.7, width * 0.74, height * 0.54, width * 0.78, height * 0.28);
    ctx.stroke();
    ctx.restore();
  }

  private drawRoute(width: number, height: number, now: number): void {
    const ctx = this.ctx;
    const from = this.toScreen(SOURCE);
    const exit = this.state.contacts.find((contact) => contact.kind === "exit");
    if (!exit || !this.state.discovered.has(exit.id)) return;
    const to = this.toScreen(exit.position);
    ctx.save();
    ctx.setLineDash([3, 8]);
    ctx.strokeStyle = this.state.success ? "rgba(138, 223, 158, 0.75)" : "rgba(138, 223, 158, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(width * 0.46, height * 0.46, width * 0.7, height * 0.42, to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (this.state.success) {
      const progress = (now * 0.35) % 1;
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      ctx.fillStyle = CYAN;
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawScanWave(width: number): void {
    if (this.state.scanStartedAt === null) return;
    const ctx = this.ctx;
    const elapsed = (performance.now() - this.state.scanStartedAt) / 1000;
    if (elapsed > 2.6) {
      this.state.scanStartedAt = null;
      return;
    }
    const origin = this.toScreen(SOURCE);
    const maxRadius = width * 0.88;
    ctx.save();
    for (let i = 0; i < 3; i += 1) {
      const local = elapsed - i * 0.18;
      if (local < 0) continue;
      const progress = Math.min(1, local / 1.65);
      const radius = progress * maxRadius;
      const alpha = Math.pow(1 - progress, 1.4) * (0.34 - i * 0.07);
      ctx.strokeStyle = `rgba(121, 230, 220, ${alpha})`;
      ctx.lineWidth = i === 0 ? 1.5 : 0.8;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    const sweep = (elapsed * 0.88) % 1;
    const angle = -Math.PI * 0.85 + sweep * Math.PI * 1.35;
    ctx.translate(origin.x, origin.y);
    ctx.rotate(angle);
    const cone = ctx.createLinearGradient(0, 0, maxRadius * 0.7, 0);
    cone.addColorStop(0, "rgba(121, 230, 220, 0.13)");
    cone.addColorStop(1, "rgba(121, 230, 220, 0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, maxRadius * 0.7, -0.17, 0.17);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawContacts(width: number, height: number, now: number): void {
    const ctx = this.ctx;
    for (const contact of this.state.contacts) {
      if (!this.state.discovered.has(contact.id)) continue;
      const point = this.toScreen(contact.position);
      const hovered = contact.id === this.state.hoveredId;
      const wrong = this.state.wrongIds.has(contact.id);
      const color = wrong ? RED : contact.mark ? PROFILES[contact.mark].color : CYAN;
      const pulse = 0.5 + Math.sin(now * 2.5 + point.x * 0.01) * 0.5;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = hovered ? 0.95 : 0.62;
      ctx.lineWidth = hovered ? 1.5 : 1;
      ctx.beginPath();
      ctx.arc(0, 0, 17 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.24;
      ctx.beginPath();
      ctx.arc(0, 0, 25 + pulse * 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, hovered ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `${color}88`;
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(0, -34);
      ctx.lineTo(8, -40);
      ctx.stroke();
      ctx.font = "500 9px 'Chakra Petch', monospace";
      ctx.fillStyle = color;
      ctx.fillText(contact.id, 12, -37);
      ctx.font = "400 8px 'Noto Sans SC', sans-serif";
      ctx.fillStyle = contact.mark ? color : MUTED;
      const label = contact.mark ? PROFILES[contact.mark].shortLabel : "未标记回波";
      ctx.fillText(label, -20, 42);
      if (hovered) {
        ctx.strokeStyle = `${color}55`;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, 32, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    void width;
    void height;
  }

  private drawVehicle(width: number, height: number, now: number): void {
    const ctx = this.ctx;
    const p = this.toScreen(SOURCE);
    ctx.save();
    ctx.translate(p.x, p.y);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 48);
    glow.addColorStop(0, "rgba(121, 230, 220, 0.2)");
    glow.addColorStop(1, "rgba(121, 230, 220, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.strokeStyle = "rgba(121, 230, 220, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 23 + Math.sin(now * 2) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#0d2d32";
    ctx.strokeStyle = CYAN;
    ctx.beginPath();
    ctx.moveTo(-20, -9);
    ctx.lineTo(17, -9);
    ctx.lineTo(27, 0);
    ctx.lineTo(17, 9);
    ctx.lineTo(-20, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(121, 230, 220, 0.72)";
    ctx.fillRect(-9, -4, 12, 8);
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.arc(22, 0, 2.3 + Math.sin(now * 4) * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(107, 160, 162, 0.4)";
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(-20, 6);
    ctx.bezierCurveTo(-60, 20, -80, -4, -width * 0.11, 32);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "500 8px 'Chakra Petch', monospace";
    ctx.fillStyle = MUTED;
    ctx.fillText("ROV / ACOUSTIC ARRAY", -29, 32);
    ctx.restore();
    void height;
  }

  private drawAnnotations(width: number, height: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(94, 145, 147, 0.17)";
    ctx.setLineDash([1, 5]);
    ctx.beginPath();
    ctx.moveTo(width * 0.12, height * 0.1);
    ctx.lineTo(width * 0.12, height * 0.88);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(114, 154, 156, 0.38)";
    ctx.font = "500 7px 'Chakra Petch', monospace";
    ctx.fillText("42m", width * 0.12 + 6, height * 0.14);
    ctx.fillText("28m", width * 0.36 + 6, height * 0.14);
    ctx.fillText("14m", width * 0.6 + 6, height * 0.14);
    ctx.fillText("0m", width * 0.84 + 6, height * 0.14);
    ctx.restore();
  }

  private drawHeat(width: number, height: number): void {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(
      width * 0.13,
      height * 0.54,
      0,
      width * 0.13,
      height * 0.54,
      width * 0.55,
    );
    const alpha = Math.min(0.16, (this.state.heat - 76) / 110);
    gradient.addColorStop(0, `rgba(241, 112, 95, ${alpha})`);
    gradient.addColorStop(1, "rgba(241, 112, 95, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

export { INK, MUTED, FAINT, CYAN, AMBER, RED };
