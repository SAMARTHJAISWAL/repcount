/** Skeleton overlay drawn on a canvas that sits exactly over the video. */
import { landmarkVisibility, type Landmark, type Triple } from "../core/landmarks";

/** Body connections (BlazePose indices), face omitted to keep the overlay calm. */
const BONES: readonly (readonly [number, number])[] = [
  [11, 12], [11, 23], [12, 24], [23, 24], // torso
  [11, 13], [13, 15], [12, 14], [14, 16], // arms
  [15, 17], [15, 19], [17, 19], [16, 18], [16, 20], [18, 20], // hands
  [23, 25], [25, 27], [24, 26], [26, 28], // legs
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], // feet
];
const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export interface OverlayTheme {
  readonly bone: string;
  readonly joint: string;
  readonly accent: string;
  readonly accentInk: string;
  readonly warn: string;
}

export interface Highlight {
  readonly triple: Triple;
  readonly angle: number | null;
  /** Whether the joint is in its active zone, to colour the arc. */
  readonly active: boolean;
}

export function readTheme(el: Element): OverlayTheme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bone: v("--overlay-bone", "rgba(255,255,255,0.85)"),
    joint: v("--overlay-joint", "#ffffff"),
    accent: v("--accent", "#c8f135"),
    accentInk: v("--accent-ink", "#0d0f0b"),
    warn: v("--warn", "#ffb020"),
  };
}

export class Overlay {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
  }

  /** Match the canvas bitmap to the video's intrinsic size; CSS scales both identically. */
  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(landmarks: readonly Landmark[] | null, highlights: readonly Highlight[], mirrored: boolean, theme: OverlayTheme): void {
    this.clear();
    if (!landmarks) return;
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scale = Math.max(1, Math.min(w, h) / 360);
    const pt = (i: number) => {
      const lm = landmarks[i];
      if (!lm) return null;
      return { x: (mirrored ? 1 - lm.x : lm.x) * w, y: lm.y * h, vis: landmarkVisibility(lm) };
    };

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Bones, faded by visibility so the user can see which parts the model is unsure of.
    ctx.strokeStyle = theme.bone;
    ctx.lineWidth = 2.5 * scale;
    for (const [a, b] of BONES) {
      const pa = pt(a);
      const pb = pt(b);
      if (!pa || !pb) continue;
      ctx.globalAlpha = Math.max(0.12, Math.min(pa.vis, pb.vis));
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    ctx.fillStyle = theme.joint;
    for (const i of JOINTS) {
      const p = pt(i);
      if (!p) continue;
      ctx.globalAlpha = Math.max(0.12, p.vis);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const hl of highlights) this.drawHighlight(hl, pt, scale, theme);
  }

  private drawHighlight(
    { triple, angle, active }: Highlight,
    pt: (i: number) => { x: number; y: number; vis: number } | null,
    scale: number,
    theme: OverlayTheme,
  ): void {
    const [a, b, c] = triple.map(pt);
    if (!a || !b || !c) return;
    const { ctx } = this;
    const color = theme.accent;

    // The measured limb segments.
    ctx.strokeStyle = color;
    ctx.lineWidth = 6 * scale;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();

    // Arc at the vertex spanning the measured angle (the short way round).
    const r = 26 * scale;
    const a1 = Math.atan2(a.y - b.y, a.x - b.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    ctx.fillStyle = active ? color : "rgba(255,255,255,0.22)";
    ctx.globalAlpha = active ? 0.45 : 1;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.arc(b.x, b.y, r, a1, a1 + delta, delta < 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    for (const p of [a, b, c]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    if (angle !== null) {
      const label = `${Math.round(angle)}°`;
      ctx.font = `700 ${15 * scale}px "Barlow Condensed", system-ui, sans-serif`;
      const tw = ctx.measureText(label).width;
      // Put the label on the outside of the joint, away from the bisector of the angle.
      const bis = a1 + delta / 2 + Math.PI;
      const lx = b.x + Math.cos(bis) * (r + 18 * scale) - tw / 2;
      const ly = b.y + Math.sin(bis) * (r + 18 * scale);
      const padX = 6 * scale;
      const boxH = 20 * scale;
      ctx.fillStyle = color;
      roundRect(ctx, lx - padX, ly - boxH / 2, tw + padX * 2, boxH, 6 * scale);
      ctx.fill();
      ctx.fillStyle = theme.accentInk;
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx, ly + 1 * scale);
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
