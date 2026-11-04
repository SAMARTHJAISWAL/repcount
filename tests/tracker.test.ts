import { describe, expect, it } from "vitest";
import { EXERCISES, type ExerciseDef } from "../src/core/exercises";
import { LM, type Landmark, type Triple } from "../src/core/landmarks";
import { DEFAULT_TRACKER_OPTIONS, ExerciseTracker, pickSide, type TrackerFrame } from "../src/core/tracker";
import { PoseBuilder, hold, jitter, rep, repeat } from "./helpers";

const W = 1280;
const H = 720;

type PoseFn = (angle: number) => Landmark[];

function feed(tracker: ExerciseTracker, poses: (Landmark[] | null)[]): TrackerFrame[] {
  return poses.map((p) => tracker.update(p, W, H));
}

/** Pose where one side's joint has `angle` and the other side is barely visible. */
function sidePose(joint: Readonly<Record<"left" | "right", Triple>>, side: "left" | "right", hiddenVis = 0.1): PoseFn {
  const other = side === "left" ? "right" : "left";
  return (angle) =>
    new PoseBuilder(W, H)
      .joint(joint[side], angle)
      .joint(joint[other], 175, { origin: { x: 900, y: 200 } })
      .visibility(joint[other], hiddenVis)
      .build();
}

describe("pickSide", () => {
  it("picks the better-seen side, or none when neither clears the threshold", () => {
    expect(pickSide(0.9, 0.6, null, 0.5, 0.15)).toBe("left");
    expect(pickSide(0.3, 0.8, null, 0.5, 0.15)).toBe("right");
    expect(pickSide(0.4, 0.3, null, 0.5, 0.15)).toBeNull();
  });

  it("sticks with the current side unless the other is clearly better", () => {
    expect(pickSide(0.8, 0.9, "left", 0.5, 0.15)).toBe("left");
    expect(pickSide(0.6, 0.9, "left", 0.5, 0.15)).toBe("right");
    // The current side dropped below the threshold: switch even if the margin is small.
    expect(pickSide(0.45, 0.55, "left", 0.5, 0.15)).toBe("right");
  });
});

describe("ExerciseTracker: squat", () => {
  const squat = EXERCISES.squat;

  it("counts reps from landmarks on a 16:9 frame using the visible side", () => {
    const t = new ExerciseTracker(squat);
    const pose = sidePose(squat.joint, "right");
    const frames = feed(t, [...repeat(3, () => rep(172, 80)), ...hold(172, 6)].map(pose));
    expect(t.reps).toBe(3);
    const last = frames.at(-1)!;
    expect(last.tracking).toBe(true);
    expect(last.primary.side).toBe("right");
    expect(last.primary.rawAngle).toBeCloseTo(172, 6); // exact despite the 16:9 frame
  });

  it("gates on visibility: no counting and a step-back cue when the legs are hidden", () => {
    const t = new ExerciseTracker(squat);
    const hidden = (angle: number) =>
      new PoseBuilder(W, H)
        .joint(squat.joint.left, angle)
        .joint(squat.joint.right, angle, { origin: { x: 900, y: 200 } })
        .visibility([LM.LEFT_ANKLE, LM.RIGHT_ANKLE], 0.2)
        .build();
    const frames = feed(t, [...repeat(3, () => rep(172, 80)), ...hold(172, 6)].map(hidden));
    expect(t.reps).toBe(0);
    expect(frames.every((f) => !f.tracking)).toBe(true);
    expect(frames.at(-1)!.cue).toMatchObject({ text: "Step back so your whole body is in view", tone: "info" });
  });

  it("treats landmarks extrapolated outside the frame as invisible, even with a high score", () => {
    const t = new ExerciseTracker(squat);
    const offscreen = (angle: number) => {
      const lms = sidePose(squat.joint, "left")(angle);
      lms[LM.LEFT_ANKLE] = { x: 0.5, y: 1.4, visibility: 0.95 };
      return lms;
    };
    feed(t, [...rep(172, 80), ...hold(172, 6)].map(offscreen));
    expect(t.reps).toBe(0);
  });

  it("no person detected → not tracking, visibility cue", () => {
    const t = new ExerciseTracker(squat);
    const [f] = feed(t, [null]);
    expect(f!.tracking).toBe(false);
    expect(f!.reps).toBe(0);
    expect(f!.cue?.tone).toBe("info");
  });

  it("emits a 'go deeper' cue for a half squat, and 'good depth' for a full one", () => {
    const t = new ExerciseTracker(squat);
    const pose = sidePose(squat.joint, "left");
    const half = feed(t, [...hold(172, 6), ...rep(172, 120).slice(5), ...hold(172, 6)].map(pose));
    expect(half.map((f) => f.cue?.text).filter(Boolean)).toContain("Go deeper");
    const full = feed(t, [...rep(172, 80), ...hold(172, 6)].map(pose));
    expect(full.map((f) => f.cue?.text)).toContain("Good depth");
    expect(t.reps).toBe(1);
  });

  it("survives jittery landmarks and a brief detection dropout", () => {
    const t = new ExerciseTracker(squat);
    const pose = sidePose(squat.joint, "left");
    const angles = jitter([...repeat(4, () => rep(172, 82, 12, 6)), ...hold(172, 6)], 5, 3);
    const poses: (Landmark[] | null)[] = angles.map(pose);
    poses.splice(40, 5, null, null, null, null, null);
    feed(t, poses);
    expect(t.reps).toBe(4);
  });

  it("reset() zeroes the count", () => {
    const t = new ExerciseTracker(squat);
    feed(t, [...rep(172, 80), ...hold(172, 6)].map(sidePose(squat.joint, "left")));
    expect(t.reps).toBe(1);
    t.reset();
    expect(t.reps).toBe(0);
  });
});

describe("ExerciseTracker: push-up", () => {
  const pushup = EXERCISES.pushup;
  const pose =
    (bodyLine: number) =>
    (elbow: number): Landmark[] =>
      new PoseBuilder(W, H)
        // Body line first (shoulder → hip → ankle), then the arm hangs off the same shoulder.
        .joint([LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_ANKLE], bodyLine, { direction: 0, length: 300 })
        .joint(pushup.joint.left, elbow, { length: 120 })
        .visibility([LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_HIP, LM.RIGHT_ANKLE], 0.1)
        .build();

  it("counts push-ups and stays quiet about a straight body line", () => {
    const t = new ExerciseTracker(pushup);
    const frames = feed(t, [...repeat(2, () => rep(170, 80)), ...hold(170, 6)].map(pose(176)));
    expect(t.reps).toBe(2);
    expect(frames.some((f) => f.cue?.id === "posture:body-line")).toBe(false);
  });

  it("flags sagging hips only once the fault is sustained", () => {
    const t = new ExerciseTracker(pushup);
    const brief = feed(t, [...hold(176, 6), ...hold(135, 4), ...hold(176, 6)].map((line) => pose(line)(170)));
    expect(brief.some((f) => f.cue?.id === "posture:body-line")).toBe(false);
    const sustained = feed(t, hold(170, 12).map(pose(135)));
    expect(sustained.at(-1)!.cue).toMatchObject({ id: "posture:body-line", tone: "warn" });
  });

  it("'lock out' cue when the rep bottoms out twice without straightening", () => {
    const t = new ExerciseTracker(pushup);
    const angles = [...hold(170, 6), ...hold(80, 6), ...hold(130, 6), ...hold(80, 6), ...hold(170, 6)];
    const frames = feed(t, angles.map(pose(176)));
    expect(frames.map((f) => f.cue?.text)).toContain("Lock out at the top");
    expect(t.reps).toBe(1);
  });
});

describe("ExerciseTracker: bicep curl (per arm)", () => {
  const curl = EXERCISES.curl;
  const arms = (left: number, right: number) =>
    new PoseBuilder(W, H)
      .joint([LM.LEFT_HIP, LM.LEFT_SHOULDER, LM.LEFT_ELBOW], 10, { origin: { x: 700, y: 500 }, direction: -Math.PI / 2 })
      .joint(curl.joint.left, left, { length: 120 })
      .joint([LM.RIGHT_HIP, LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW], 10, { origin: { x: 560, y: 500 }, direction: -Math.PI / 2 })
      .joint(curl.joint.right, right, { length: 120 })
      .build();

  /** Alternating curls: left arm does a rep, then the right arm does one. */
  const alternating = (n: number) =>
    repeat(n, () => [...rep(165, 35).map((a) => arms(a, 165)), ...rep(165, 35).map((a) => arms(165, a))]);

  it("both: counts each arm independently", () => {
    const t = new ExerciseTracker(curl, { ...DEFAULT_TRACKER_OPTIONS, armMode: "both" });
    feed(t, [...alternating(3), ...hold(0, 6).map(() => arms(165, 165))]);
    expect(t.armReps).toEqual({ left: 3, right: 3 });
    expect(t.reps).toBe(6);
  });

  it("left only: right-arm reps are ignored", () => {
    const t = new ExerciseTracker(curl, { ...DEFAULT_TRACKER_OPTIONS, armMode: "left" });
    feed(t, [...alternating(3), ...hold(0, 6).map(() => arms(165, 165))]);
    expect(t.armReps).toEqual({ left: 3 });
    expect(t.reps).toBe(3);
  });

  it("an arm out of view doesn't block counting the other", () => {
    const t = new ExerciseTracker(curl, { ...DEFAULT_TRACKER_OPTIONS, armMode: "both" });
    const rightHidden = (a: number) => {
      const lms = arms(a, 165);
      lms[LM.RIGHT_WRIST] = { x: 0.4, y: 0.5, visibility: 0.05 };
      return lms;
    };
    const frames = feed(t, [...rep(165, 35), ...hold(165, 6)].map(rightHidden));
    expect(t.armReps).toEqual({ left: 1, right: 0 });
    expect(frames.at(-1)!.tracking).toBe(true);
    expect(frames.at(-1)!.channels.find((c) => c.arm === "right")!.angle).toBeNull();
  });

  it("flags an elbow drifting forward during the curl", () => {
    const t = new ExerciseTracker(curl, { ...DEFAULT_TRACKER_OPTIONS, armMode: "left" });
    const drift = (a: number) =>
      new PoseBuilder(W, H)
        .joint([LM.LEFT_HIP, LM.LEFT_SHOULDER, LM.LEFT_ELBOW], 60, { origin: { x: 700, y: 500 }, direction: -Math.PI / 2 })
        // Upper arm swung 60° forward of the torso.
        .joint(curl.joint.left, a, { length: 120, direction: Math.PI / 2 - Math.PI / 3 })
        .build();
    const frames = feed(t, hold(165, 12).map(drift));
    expect(frames.at(-1)!.cue?.text).toBe("Keep your elbow pinned to your side");
  });
});

describe("ExerciseTracker: jumping jack (both arms averaged)", () => {
  const jack: ExerciseDef = EXERCISES.jack;
  const pose = (angle: number, rightVis = 0.99) =>
    new PoseBuilder(W, H)
      .joint(jack.joint.left, angle, { origin: { x: 700, y: 550 }, direction: -Math.PI / 2 })
      .joint(jack.joint.right, angle, { origin: { x: 560, y: 550 }, direction: -Math.PI / 2 })
      .visibility(jack.joint.right, rightVis)
      .build();

  it("counts arm cycles", () => {
    const t = new ExerciseTracker(jack);
    const frames = feed(t, [...repeat(4, () => rep(15, 165, 6, 3)), ...hold(15, 4)].map((a) => pose(a)));
    expect(t.reps).toBe(4);
    expect(frames.at(-1)!.primary.side).toBe("both");
  });

  it("needs both arms in view", () => {
    const t = new ExerciseTracker(jack);
    feed(t, [...repeat(2, () => rep(15, 165)), ...hold(15, 4)].map((a) => pose(a, 0.2)));
    expect(t.reps).toBe(0);
  });
});
