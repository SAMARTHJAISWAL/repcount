import { LANDMARK_COUNT, type Landmark, type Triple } from "../src/core/landmarks";

/** Linear ramp from `from` to `to` inclusive, in `steps` samples (steps ≥ 2). */
export function ramp(from: number, to: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => from + ((to - from) * i) / (steps - 1));
}

export function hold(value: number, frames: number): number[] {
  return Array.from({ length: frames }, () => value);
}

/** One clean rep: rest → active → rest, with a pause at each end. */
export function rep(rest: number, active: number, travel = 10, pause = 5): number[] {
  return [...hold(rest, pause), ...ramp(rest, active, travel), ...hold(active, pause), ...ramp(active, rest, travel)];
}

export function repeat<T>(times: number, make: () => T[]): T[] {
  return Array.from({ length: times }, make).flat();
}

/** Deterministic PRNG (mulberry32) so noisy tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Add uniform jitter of ±`amplitude` degrees. */
export function jitter(values: number[], amplitude: number, seed = 1): number[] {
  const r = rng(seed);
  return values.map((v) => v + (r() * 2 - 1) * amplitude);
}

/**
 * Builds a 33-landmark pose in which chosen joints have exact angles. Positions are
 * laid out in pixel space for the given frame size and then normalised by width and
 * height, exactly like MediaPipe output, so aspect-ratio handling is exercised too.
 */
export class PoseBuilder {
  private readonly px: ({ x: number; y: number } | null)[] = Array.from({ length: LANDMARK_COUNT }, () => null);
  private readonly vis: number[] = Array.from({ length: LANDMARK_COUNT }, () => 0.99);

  constructor(
    readonly width = 1280,
    readonly height = 720,
  ) {}

  /** Place a fixed point (pixel coordinates). */
  point(index: number, x: number, y: number): this {
    this.px[index] = { x, y };
    return this;
  }

  /**
   * Make the angle at `b` equal `degrees`. `a` keeps its position if already placed
   * (so joints sharing a landmark compose), otherwise it is put at `origin`. `b` hangs
   * `length` px from `a` along `direction` (radians, 90° = straight down the screen).
   */
  joint(
    [a, b, c]: Triple,
    degrees: number,
    { origin = { x: 640, y: 200 }, direction = Math.PI / 2, length = 150 } = {},
  ): this {
    const pa = this.px[a] ?? origin;
    this.px[a] = pa;
    const pb = { x: pa.x + length * Math.cos(direction), y: pa.y + length * Math.sin(direction) };
    this.px[b] = pb;
    // Ray b→a points back along `direction + π`; rotate it by `degrees` to get b→c.
    const back = direction + Math.PI;
    const toC = back - (degrees * Math.PI) / 180;
    this.px[c] = { x: pb.x + length * Math.cos(toC), y: pb.y + length * Math.sin(toC) };
    return this;
  }

  visibility(indices: readonly number[], value: number): this {
    for (const i of indices) this.vis[i] = value;
    return this;
  }

  build(): Landmark[] {
    // Unplaced landmarks sit at the centre: valid input that matters to no joint under test.
    return this.px.map((p, i) => ({
      x: (p?.x ?? this.width / 2) / this.width,
      y: (p?.y ?? this.height / 2) / this.height,
      z: 0,
      visibility: this.vis[i] ?? 0,
    }));
  }
}
