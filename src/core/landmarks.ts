/**
 * BlazePose 33-landmark indices (the subset RepCount uses) and a structural landmark
 * type, so the pure logic can be tested without importing MediaPipe.
 *
 * "Left" and "right" are the person's own sides, as MediaPipe reports them for an
 * un-mirrored frame. Mirroring is a display concern only.
 */
export const LM = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export const LANDMARK_COUNT = 33;

/** Structurally compatible with MediaPipe's `NormalizedLandmark`. */
export interface Landmark {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  readonly visibility?: number;
}

export type Side = "left" | "right";

/** Three landmark indices: the angle is measured at the middle one. */
export type Triple = readonly [number, number, number];

/**
 * Visibility of one landmark, in [0, 1]. Points the model places well outside the
 * frame are treated as invisible regardless of their score, because their position
 * is extrapolated rather than observed.
 */
export function landmarkVisibility(lm: Landmark | undefined): number {
  if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return 0;
  const margin = 0.05;
  if (lm.x < -margin || lm.x > 1 + margin || lm.y < -margin || lm.y > 1 + margin) return 0;
  return lm.visibility ?? 1;
}

/** The weakest link decides: a joint angle is only as reliable as its least visible point. */
export function tripleVisibility(landmarks: readonly Landmark[], triple: Triple): number {
  return Math.min(...triple.map((i) => landmarkVisibility(landmarks[i])));
}
