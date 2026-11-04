import { describe, expect, it } from "vitest";
import { DEFAULT_COUNTER_OPTIONS, RepCounter, type RepEvent } from "../src/core/repCounter";
import { Ema } from "../src/core/smoothing";
import { hold, jitter, ramp, rep, repeat } from "./helpers";

const SQUAT = { rest: 160, active: 100, ...DEFAULT_COUNTER_OPTIONS };

function run(counter: RepCounter, angles: (number | null)[]): RepEvent[] {
  const events: RepEvent[] = [];
  for (const a of angles) {
    const { event } = counter.update(a);
    if (event) events.push(event);
  }
  return events;
}

const types = (events: RepEvent[]) => events.map((e) => e.type);

describe("RepCounter: clean motion", () => {
  it("counts each rest → active → rest cycle once", () => {
    const c = new RepCounter(SQUAT);
    const events = run(c, [...repeat(5, () => rep(175, 80)), ...hold(175, 5)]);
    expect(c.reps).toBe(5);
    expect(types(events)).toEqual(["rep", "rep", "rep", "rep", "rep"]);
  });

  it("counts on the way back up, not at the bottom", () => {
    const c = new RepCounter(SQUAT);
    run(c, [...hold(175, 5), ...ramp(175, 80, 10), ...hold(80, 10)]);
    expect(c.reps).toBe(0);
    expect(c.currentPhase).toBe("active");
    run(c, [...ramp(80, 175, 10), ...hold(175, 2)]);
    expect(c.reps).toBe(1);
  });

  it("reports the deepest angle reached in the rep", () => {
    const c = new RepCounter(SQUAT);
    const events = run(c, [...rep(175, 72), ...hold(175, 5)]);
    expect(events[0]).toEqual({ type: "rep", count: 1, extreme: 72 });
  });

  it("does nothing until the start position has been seen", () => {
    // The user is already at the bottom when tracking starts, then stands up:
    // that is not a rep because we never saw them leave the top.
    const c = new RepCounter(SQUAT);
    run(c, [...hold(80, 10), ...ramp(80, 175, 10), ...hold(175, 5)]);
    expect(c.reps).toBe(0);
    expect(c.currentPhase).toBe("rest");
    run(c, [...rep(175, 80), ...hold(175, 5)]);
    expect(c.reps).toBe(1);
  });

  it("works for joints that open into the active position (jumping-jack arms)", () => {
    const c = new RepCounter({ rest: 45, active: 135, ...DEFAULT_COUNTER_OPTIONS });
    run(c, [...repeat(3, () => rep(20, 165)), ...hold(20, 5)]);
    expect(c.reps).toBe(3);
  });

  it("exposes progress from rest (0) to active (1), clamped", () => {
    const c = new RepCounter(SQUAT);
    expect(c.update(175).progress).toBe(0);
    expect(c.update(130).progress).toBeCloseTo(0.5, 10);
    expect(c.update(60).progress).toBe(1);
  });
});

describe("RepCounter: partial reps never count", () => {
  it("a half squat that turns back above the threshold is reported as shallow", () => {
    const c = new RepCounter(SQUAT);
    const events = run(c, [...hold(175, 5), ...ramp(175, 115, 10), ...ramp(115, 175, 10), ...hold(175, 5)]);
    expect(c.reps).toBe(0);
    expect(types(events)).toEqual(["shallow"]);
    expect(events[0]).toMatchObject({ extreme: 115 });
  });

  it("a tiny dip is ignored entirely (no count, no nagging)", () => {
    const c = new RepCounter(SQUAT);
    const events = run(c, [...hold(175, 5), ...ramp(175, 150, 6), ...ramp(150, 175, 6), ...hold(175, 5)]);
    expect(c.reps).toBe(0);
    expect(events).toEqual([]);
  });

  it("bouncing at the bottom without standing up is one rep, flagged incomplete", () => {
    const c = new RepCounter(SQUAT);
    const events = run(c, [
      ...hold(175, 5),
      ...ramp(175, 85, 10),
      ...hold(85, 4),
      ...ramp(85, 140, 6), // half way up…
      ...ramp(140, 85, 6), // …and back down
      ...hold(85, 4),
      ...ramp(85, 175, 10),
      ...hold(175, 5),
    ]);
    expect(c.reps).toBe(1);
    expect(types(events)).toEqual(["incomplete", "rep"]);
  });
});

describe("RepCounter: hysteresis and dwell", () => {
  it("boundary values belong to their zone", () => {
    const c = new RepCounter(SQUAT);
    expect(c.zoneOf(160)).toBe("rest");
    expect(c.zoneOf(159.9)).toBe("mid");
    expect(c.zoneOf(100)).toBe("active");
    expect(c.zoneOf(100.1)).toBe("mid");
  });

  it("hovering around the active threshold doesn't produce extra reps", () => {
    const c = new RepCounter(SQUAT);
    const flutter = repeat(10, () => [98, 103]);
    run(c, [...hold(175, 5), ...ramp(175, 98, 8), ...hold(98, 3), ...flutter, ...ramp(98, 175, 8), ...hold(175, 5)]);
    expect(c.reps).toBe(1);
  });

  it("hovering around the rest threshold waits for a settled lockout before counting", () => {
    const c = new RepCounter(SQUAT);
    run(c, [...hold(175, 5), ...ramp(175, 85, 10), ...hold(85, 5), ...ramp(85, 158, 8)]);
    run(c, repeat(10, () => [161, 158]));
    expect(c.reps).toBe(0); // never 3 consecutive frames at rest
    run(c, hold(165, 3));
    expect(c.reps).toBe(1);
  });

  it("a one- or two-frame spike into the active zone is rejected", () => {
    const c = new RepCounter(SQUAT);
    run(c, [...hold(175, 5), 90, 175, 175, 90, 90, ...hold(175, 6)]);
    expect(c.reps).toBe(0);
    expect(c.currentPhase).toBe("rest");
  });

  it("minDwellFrames = 1 accepts single frames (sanity check of the knob)", () => {
    const c = new RepCounter({ ...SQUAT, minDwellFrames: 1 });
    run(c, [175, 90, 175]);
    expect(c.reps).toBe(1);
  });
});

describe("RepCounter: visibility dropouts", () => {
  it("a short dropout mid-rep is bridged", () => {
    const c = new RepCounter(SQUAT);
    run(c, [...hold(175, 5), ...ramp(175, 85, 10), ...Array<null>(8).fill(null), ...hold(85, 3), ...ramp(85, 175, 10), ...hold(175, 3)]);
    expect(c.reps).toBe(1);
  });

  it("a long dropout abandons the rep: the user must return to the start", () => {
    const c = new RepCounter(SQUAT);
    const gap = Array<null>(SQUAT.maxGapFrames + 5).fill(null);
    const events = run(c, [...hold(175, 5), ...ramp(175, 85, 10), ...gap, ...hold(85, 3), ...ramp(85, 175, 10)]);
    expect(types(events)).toEqual(["lost"]);
    expect(c.reps).toBe(0);
    // Back at the top now, so the next full rep counts normally.
    run(c, [...rep(175, 85), ...hold(175, 5)]);
    expect(c.reps).toBe(1);
  });

  it("a dropout resets dwell, so frames either side of it don't add up", () => {
    const c = new RepCounter(SQUAT);
    run(c, [...hold(175, 5), 90, 90, null, 90, 175, 175, 175]);
    expect(c.currentPhase).toBe("rest");
    expect(c.reps).toBe(0);
  });

  it("NaN is treated as missing, and reset() clears everything", () => {
    const c = new RepCounter(SQUAT);
    expect(c.update(Number.NaN).zone).toBeNull();
    run(c, [...rep(175, 80), ...hold(175, 5)]);
    expect(c.reps).toBe(1);
    c.reset();
    expect(c.reps).toBe(0);
    expect(c.currentPhase).toBe("idle");
  });
});

describe("RepCounter: noisy input through the EMA", () => {
  it("counts 10 jittery reps exactly, including occasional outlier frames", () => {
    const c = new RepCounter(SQUAT);
    const ema = new Ema(0.4);
    const clean = [...repeat(10, () => rep(172, 78, 12, 6)), ...hold(172, 6)];
    const noisy = jitter(clean, 6, 42);
    // Sprinkle single-frame outliers (bad detections).
    for (let i = 7; i < noisy.length; i += 23) noisy[i] = (noisy[i] ?? 0) > 130 ? 60 : 179;
    run(
      c,
      noisy.map((a) => ema.update(a)),
    );
    expect(c.reps).toBe(10);
  });

  it("does not count jitter around a standing position", () => {
    const c = new RepCounter(SQUAT);
    const ema = new Ema(0.4);
    run(
      c,
      jitter(hold(170, 300), 8, 7).map((a) => ema.update(a)),
    );
    expect(c.reps).toBe(0);
  });
});

describe("RepCounter: configuration", () => {
  it("rejects nonsensical options", () => {
    expect(() => new RepCounter({ ...SQUAT, active: 160 })).toThrow(RangeError);
    expect(() => new RepCounter({ ...SQUAT, minDwellFrames: 0 })).toThrow(RangeError);
  });
});
