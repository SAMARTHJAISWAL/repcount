/** Joint-angle geometry. Pure math: no DOM or MediaPipe imports. */

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Interior angle at `b` between segments b→a and b→c, in degrees within [0, 180].
 *
 * 180° means the three points are collinear (a fully extended limb); small values
 * mean a tightly bent joint. The result is identical for a pose and its mirror image,
 * so it doesn't matter whether the preview is mirrored. Returns `NaN` when either
 * segment has zero length, because the angle is undefined there.
 */
export function jointAngle(a: Point2, b: Point2, c: Point2): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  if ((abx === 0 && aby === 0) || (cbx === 0 && cby === 0)) return Number.NaN;
  // atan2(|cross|, dot) is numerically stable at 0° and 180°, unlike acos(dot / norms).
  const cross = abx * cby - aby * cbx;
  const dot = abx * cbx + aby * cby;
  return Math.atan2(Math.abs(cross), dot) * RAD_TO_DEG;
}

/**
 * MediaPipe returns x and y normalised separately by frame width and height, so a
 * 16:9 frame squashes horizontal distances relative to vertical ones. Angles must be
 * measured in pixel space or a 90° knee reads as something else entirely.
 */
export function toPixels(p: Point2, width: number, height: number): Point2 {
  return { x: p.x * width, y: p.y * height };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
