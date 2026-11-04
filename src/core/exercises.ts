import { LM, type Side, type Triple } from "./landmarks";
import type { RepThresholds } from "./repCounter";

export type ExerciseId = "squat" | "pushup" | "curl" | "jack";

/**
 * How the tracked joint is chosen each frame:
 * - `best-side`: whichever side of the body the camera sees better (side-on exercises).
 * - `per-arm`:   each arm has its own counter (curls; the user picks left, right or both).
 * - `both-average`: mean of left and right; both sides must be visible (front-on jacks).
 */
export type SideStrategy = "best-side" | "per-arm" | "both-average";

/**
 * A form check evaluated continuously while tracking. It only fires when the
 * condition holds for a sustained run of frames and its landmarks are visible.
 */
export interface PostureRule {
  readonly id: string;
  readonly joint: Readonly<Record<Side, Triple>>;
  /** The cue fires when the angle is below (or above) the threshold. */
  readonly when: "below" | "above";
  readonly threshold: number;
  readonly message: string;
}

export interface ExerciseDef {
  readonly id: ExerciseId;
  readonly name: string;
  /** Joint measured, for labels: "Knee", "Elbow", "Shoulder". */
  readonly jointLabel: string;
  readonly strategy: SideStrategy;
  readonly joint: Readonly<Record<Side, Triple>>;
  readonly thresholds: RepThresholds;
  /** Where to put the camera. */
  readonly cameraTip: string;
  /** Shown when the landmarks needed for counting aren't visible. */
  readonly visibilityHint: string;
  readonly cues: {
    /** Moved toward the active position but turned back too early. */
    readonly shallow: string;
    /** Reached the active position but didn't return all the way to rest. */
    readonly incomplete: string;
    /** A full rep was counted. */
    readonly good: string;
  };
  readonly posture: readonly PostureRule[];
}

const KNEE: Record<Side, Triple> = {
  left: [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
  right: [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
};
const ELBOW: Record<Side, Triple> = {
  left: [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST],
  right: [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
};
/** Angle at the shoulder between the torso (hip) and the upper arm (elbow). */
const SHOULDER: Record<Side, Triple> = {
  left: [LM.LEFT_HIP, LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  right: [LM.RIGHT_HIP, LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
};
/** Angle at the hip between shoulder and ankle: 180° is a straight plank. */
const BODY_LINE: Record<Side, Triple> = {
  left: [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_ANKLE],
  right: [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_ANKLE],
};

const WHOLE_BODY = "Step back so your whole body is in view";

export const EXERCISES: Readonly<Record<ExerciseId, ExerciseDef>> = {
  squat: {
    id: "squat",
    name: "Squat",
    jointLabel: "Knee",
    strategy: "best-side",
    joint: KNEE,
    thresholds: { rest: 160, active: 100 },
    cameraTip: "Stand side-on or at 45° to the camera",
    visibilityHint: WHOLE_BODY,
    cues: { shallow: "Go deeper", incomplete: "Stand all the way up", good: "Good depth" },
    posture: [],
  },
  pushup: {
    id: "pushup",
    name: "Push-up",
    jointLabel: "Elbow",
    strategy: "best-side",
    joint: ELBOW,
    thresholds: { rest: 155, active: 95 },
    cameraTip: "Put the camera at floor level, side-on",
    visibilityHint: WHOLE_BODY,
    cues: { shallow: "Lower your chest further", incomplete: "Lock out at the top", good: "Full range" },
    posture: [
      {
        id: "body-line",
        joint: BODY_LINE,
        when: "below",
        threshold: 150,
        message: "Keep a straight line from shoulders to ankles",
      },
    ],
  },
  curl: {
    id: "curl",
    name: "Bicep curl",
    jointLabel: "Elbow",
    strategy: "per-arm",
    joint: ELBOW,
    thresholds: { rest: 150, active: 55 },
    cameraTip: "Face the camera or stand side-on, arms in view",
    visibilityHint: "Step back so your shoulders, elbows and wrists are in view",
    cues: { shallow: "Curl all the way up", incomplete: "Lower all the way down", good: "Full curl" },
    posture: [
      {
        id: "elbow-drift",
        joint: SHOULDER,
        when: "above",
        threshold: 40,
        message: "Keep your elbow pinned to your side",
      },
    ],
  },
  jack: {
    id: "jack",
    name: "Jumping jack",
    jointLabel: "Shoulder",
    strategy: "both-average",
    joint: SHOULDER,
    thresholds: { rest: 45, active: 135 },
    cameraTip: "Face the camera with your arms in view",
    visibilityHint: WHOLE_BODY,
    cues: { shallow: "Raise your arms overhead", incomplete: "Bring your arms down to your sides", good: "Nice rhythm" },
    posture: [],
  },
};

export const EXERCISE_ORDER: readonly ExerciseId[] = ["squat", "pushup", "curl", "jack"];

export function isExerciseId(value: unknown): value is ExerciseId {
  return typeof value === "string" && Object.hasOwn(EXERCISES, value);
}
