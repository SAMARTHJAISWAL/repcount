import { describe, expect, it } from "vitest";
import { clamp, jointAngle, toPixels } from "../src/core/geometry";
import { Ema, alphaForInterval } from "../src/core/smoothing";
import { formatDuration } from "../src/core/format";
import { Stopwatch } from "../src/core/stopwatch";

describe("jointAngle", () => {
  it("measures a right angle", () => {
    expect(jointAngle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90, 10);
  });

  it("reads 180° for a straight limb and 0° for a fully folded one", () => {
    expect(jointAngle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180, 10);
    expect(jointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 })).toBeCloseTo(0, 10);
  });

  it("is the interior angle: never above 180 and independent of point order", () => {
    const a = { x: 1, y: 0.2 };
    const b = { x: 0, y: 0 };
    const c = { x: -0.5, y: -1 };
    expect(jointAngle(a, b, c)).toBeCloseTo(jointAngle(c, b, a), 10);
    expect(jointAngle(a, b, c)).toBeLessThanOrEqual(180);
  });

  it("is unchanged by mirroring, so a flipped preview reads the same", () => {
    const a = { x: 0.3, y: 0.2 };
    const b = { x: 0.5, y: 0.5 };
    const c = { x: 0.8, y: 0.55 };
    const m = (p: { x: number; y: number }) => ({ x: 1 - p.x, y: p.y });
    expect(jointAngle(m(a), m(b), m(c))).toBeCloseTo(jointAngle(a, b, c), 10);
  });

  it("returns NaN for a zero-length segment", () => {
    expect(jointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNaN();
  });

  it("needs pixel space: normalised coords on a 16:9 frame distort the angle", () => {
    // A true 90° joint, tilted 45° on screen, in a 1280×720 frame.
    const w = 1280;
    const h = 720;
    const norm = [
      { x: 640 / w, y: 200 / h },
      { x: 840 / w, y: 400 / h },
      { x: 1040 / w, y: 200 / h },
    ] as const;
    expect(jointAngle(norm[0], norm[1], norm[2])).not.toBeCloseTo(90, 0);
    const px = norm.map((p) => toPixels(p, w, h));
    expect(jointAngle(px[0]!, px[1]!, px[2]!)).toBeCloseTo(90, 6);
  });

  it("clamps", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe("Ema", () => {
  it("seeds with the first sample, then blends", () => {
    const ema = new Ema(0.5);
    expect(ema.update(100)).toBe(100);
    expect(ema.update(80)).toBe(90);
    expect(ema.update(80)).toBe(85);
  });

  it("damps a one-frame spike", () => {
    const ema = new Ema(0.3);
    for (let i = 0; i < 10; i++) ema.update(170);
    expect(ema.update(60)).toBeCloseTo(137, 6);
  });

  it("derives a frame-rate independent weight from the frame interval", () => {
    expect(alphaForInterval(33, 65)).toBeCloseTo(0.4, 1);
    expect(alphaForInterval(100, 65)).toBeGreaterThan(0.75);
    expect(alphaForInterval(0, 65)).toBe(1);
    const ema = new Ema(0.4);
    ema.update(100);
    expect(ema.update(0, 1)).toBe(0); // per-sample override
  });

  it("resets and validates its inputs", () => {
    const ema = new Ema(0.4);
    ema.update(10);
    ema.reset();
    expect(ema.value).toBeNull();
    expect(() => new Ema(0)).toThrow(RangeError);
    expect(() => new Ema(1.5)).toThrow(RangeError);
    expect(() => ema.update(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [61_000, "1:01"],
    [3_599_000, "59:59"],
    [3_723_000, "1:02:03"],
    [-5, "0:00"],
    [Number.NaN, "0:00"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("Stopwatch", () => {
  it("accumulates only while running", () => {
    let t = 1000;
    const sw = new Stopwatch(() => t);
    sw.start();
    t += 5000;
    sw.pause();
    t += 60_000; // paused: must not count
    sw.start();
    sw.start(); // idempotent
    t += 2000;
    expect(sw.elapsedMs).toBe(7000);
    expect(sw.running).toBe(true);
    sw.reset();
    expect(sw.elapsedMs).toBe(0);
    expect(sw.running).toBe(false);
  });
});
