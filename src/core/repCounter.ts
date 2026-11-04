/**
 * Rep-counting state machine for one joint angle.
 *
 * Every exercise RepCount supports is a joint moving between two positions:
 *
 *   rest   – where a rep starts and ends (standing tall, arms locked out, arm hanging)
 *   active – the far end of the movement (bottom of the squat, top of the curl)
 *
 * A rep is counted on the return: rest → active → rest. The two thresholds are
 * separated by a dead band (hysteresis), so an angle hovering near either threshold
 * can't toggle the state, and each zone must hold for `minDwellFrames` consecutive
 * frames before a transition is accepted, which rejects single-frame spikes.
 *
 * Works for both directions: if `active < rest` the joint flexes into the active zone
 * (squat, push-up, curl); if `active > rest` it opens into it (jumping-jack arms).
 */

export type Phase = "idle" | "rest" | "active";
export type Zone = "rest" | "mid" | "active";

export interface RepThresholds {
  /** Angle (degrees) beyond which the joint is in its rest position. */
  readonly rest: number;
  /** Angle (degrees) beyond which the joint is in its active position. */
  readonly active: number;
}

export interface RepCounterOptions extends RepThresholds {
  /** Consecutive frames a zone must hold before the phase changes. */
  readonly minDwellFrames: number;
  /** Consecutive missing frames tolerated before the counter forgets its phase. */
  readonly maxGapFrames: number;
  /**
   * Fraction of the rest↔active range a movement must cover before an aborted rep is
   * reported as partial (a feedback event; it never changes the count).
   */
  readonly partialFraction: number;
}

export type RepEvent =
  /** A full rep was completed. `extreme` is the deepest angle reached during it. */
  | { readonly type: "rep"; readonly count: number; readonly extreme: number }
  /** Left rest, moved meaningfully, came back without reaching the active zone. */
  | { readonly type: "shallow"; readonly extreme: number }
  /** Reached active, moved back meaningfully, returned to active without reaching rest. */
  | { readonly type: "incomplete"; readonly extreme: number }
  /** Landmarks were missing for longer than `maxGapFrames`; the current rep was abandoned. */
  | { readonly type: "lost" };

export interface RepUpdate {
  readonly phase: Phase;
  readonly zone: Zone | null;
  readonly count: number;
  /** 0 at the rest threshold, 1 at the active threshold, clamped. */
  readonly progress: number | null;
  readonly event: RepEvent | null;
}

export const DEFAULT_COUNTER_OPTIONS = {
  minDwellFrames: 3,
  maxGapFrames: 15,
  partialFraction: 0.35,
} as const;

export class RepCounter {
  private phase: Phase = "idle";
  private count = 0;
  private candidate: Zone | null = null;
  private dwell = 0;
  private gap = 0;
  /** Deepest point (toward active) since the last confirmed rest. */
  private deepest: number | null = null;
  /** Highest point (toward rest) since the last confirmed active. */
  private shallowest: number | null = null;

  /** +1 when active angles are smaller than rest angles (flexion), −1 otherwise. */
  private readonly sign: number;
  private readonly restT: number;
  private readonly activeT: number;

  constructor(readonly options: RepCounterOptions) {
    if (options.rest === options.active) throw new RangeError("rest and active thresholds must differ");
    if (!(options.minDwellFrames >= 1)) throw new RangeError("minDwellFrames must be at least 1");
    this.sign = options.active < options.rest ? 1 : -1;
    // Work in a transformed space where "towards active" is always "smaller".
    this.restT = this.sign * options.rest;
    this.activeT = this.sign * options.active;
  }

  get reps(): number {
    return this.count;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  zoneOf(angle: number): Zone {
    const v = this.sign * angle;
    if (v <= this.activeT) return "active";
    if (v >= this.restT) return "rest";
    return "mid";
  }

  progressOf(angle: number): number {
    const v = this.sign * angle;
    const p = (this.restT - v) / (this.restT - this.activeT);
    return Math.min(1, Math.max(0, p));
  }

  /** Feed one frame. Pass `null` when the joint isn't reliably visible this frame. */
  update(angle: number | null): RepUpdate {
    if (angle === null || !Number.isFinite(angle)) return this.handleGap();
    this.gap = 0;

    const zone = this.zoneOf(angle);
    if (zone === this.candidate) this.dwell += 1;
    else {
      this.candidate = zone;
      this.dwell = 1;
    }
    const settled = this.dwell >= this.options.minDwellFrames;
    const v = this.sign * angle;
    let event: RepEvent | null = null;

    switch (this.phase) {
      case "idle":
        // Nothing counts until the starting position has been seen.
        if (zone === "rest" && settled) this.enterRest();
        break;

      case "rest":
        this.deepest = this.deepest === null ? v : Math.min(this.deepest, v);
        if (zone === "active" && settled) {
          this.phase = "active";
          this.shallowest = v;
        } else if (zone === "rest" && settled && this.travelled(this.restT - this.deepest)) {
          event = { type: "shallow", extreme: this.sign * this.deepest };
          this.deepest = v;
        }
        break;

      case "active":
        this.deepest = Math.min(this.deepest ?? v, v);
        this.shallowest = Math.max(this.shallowest ?? v, v);
        if (zone === "rest" && settled) {
          this.count += 1;
          event = { type: "rep", count: this.count, extreme: this.sign * this.deepest };
          this.enterRest();
          this.deepest = v;
        } else if (zone === "active" && settled && this.travelled(this.shallowest - this.activeT)) {
          event = { type: "incomplete", extreme: this.sign * this.shallowest };
          this.shallowest = v;
        }
        break;
    }

    return { phase: this.phase, zone, count: this.count, progress: this.progressOf(angle), event };
  }

  reset(): void {
    this.phase = "idle";
    this.count = 0;
    this.forgetMotion();
    this.gap = 0;
  }

  private handleGap(): RepUpdate {
    this.gap += 1;
    this.candidate = null;
    this.dwell = 0;
    let event: RepEvent | null = null;
    if (this.gap === this.options.maxGapFrames + 1 && this.phase !== "idle") {
      // Too long without seeing the joint: we can't vouch for what happened, so the
      // in-progress rep is dropped and the user must return to the start position.
      this.phase = "idle";
      this.forgetMotion();
      event = { type: "lost" };
    }
    return { phase: this.phase, zone: null, count: this.count, progress: null, event };
  }

  private enterRest(): void {
    this.phase = "rest";
    this.shallowest = null;
  }

  private forgetMotion(): void {
    this.candidate = null;
    this.dwell = 0;
    this.deepest = null;
    this.shallowest = null;
  }

  /** Did the movement cover at least `partialFraction` of the rest↔active range? */
  private travelled(distance: number): boolean {
    return distance >= this.options.partialFraction * (this.restT - this.activeT);
  }
}
