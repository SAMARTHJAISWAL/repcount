/**
 * Per-frame orchestration: landmarks in, counted reps and cues out.
 *
 * Pure and deterministic. It knows nothing about MediaPipe, video or the DOM, so the
 * whole pipeline (visibility gating → side choice → angle → smoothing → state machine
 * → feedback) is exercised in unit tests with synthetic landmarks.
 */
import type { ExerciseDef } from "./exercises";
import { PostureMonitor, cueForEvent, visibilityCue, type Cue } from "./feedback";
import { jointAngle, toPixels } from "./geometry";
import { tripleVisibility, type Landmark, type Side, type Triple } from "./landmarks";
import { RepCounter, DEFAULT_COUNTER_OPTIONS, type Phase, type RepEvent, type Zone } from "./repCounter";
import { Ema } from "./smoothing";

export type ArmMode = "left" | "right" | "both";

export interface TrackerOptions {
  /** EMA weight of the newest angle sample. */
  readonly alpha: number;
  readonly minDwellFrames: number;
  readonly maxGapFrames: number;
  readonly partialFraction: number;
  /** Minimum MediaPipe visibility score for every landmark of a joint. */
  readonly visibilityThreshold: number;
  /** How much better the other side must be seen before switching to it. */
  readonly sideSwitchMargin: number;
  readonly postureHoldFrames: number;
  /** Which arm(s) to count for per-arm exercises. */
  readonly armMode: ArmMode;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  alpha: 0.4,
  ...DEFAULT_COUNTER_OPTIONS,
  visibilityThreshold: 0.5,
  sideSwitchMargin: 0.15,
  postureHoldFrames: 8,
  armMode: "both",
};

export interface ChannelState {
  /** Which side the angle came from this frame; "both" for averaged exercises. */
  readonly side: Side | "both" | null;
  /** Arm label for per-arm exercises, otherwise null. */
  readonly arm: Side | null;
  readonly rawAngle: number | null;
  readonly angle: number | null;
  readonly phase: Phase;
  readonly zone: Zone | null;
  readonly reps: number;
  readonly progress: number | null;
}

export interface TrackerFrame {
  /** True when at least one counted joint was visible and measured this frame. */
  readonly tracking: boolean;
  readonly reps: number;
  readonly channels: readonly ChannelState[];
  /** The channel to feature on the gauge: the most-flexed visible one. */
  readonly primary: ChannelState;
  readonly events: readonly RepEvent[];
  readonly cue: Cue | null;
}

/**
 * Choose which side of the body to measure. Sticks with the current side unless the
 * other side is better by `margin`, so the reading doesn't flip-flop between two
 * similarly visible sides mid-rep. Returns null when neither side is usable.
 */
export function pickSide(
  left: number,
  right: number,
  current: Side | null,
  threshold: number,
  margin: number,
): Side | null {
  const best: Side = right > left ? "right" : "left";
  const scores: Record<Side, number> = { left, right };
  if (scores[best] < threshold) return null;
  if (current !== null && scores[current] >= threshold && scores[best] - scores[current] < margin) return current;
  return best;
}

interface Channel {
  readonly arm: Side | null;
  side: Side | null;
  gap: number;
  readonly ema: Ema;
  readonly counter: RepCounter;
  readonly posture: PostureMonitor[];
}

export class ExerciseTracker {
  private channels: Channel[];

  constructor(
    readonly def: ExerciseDef,
    readonly options: TrackerOptions = DEFAULT_TRACKER_OPTIONS,
  ) {
    const arms: (Side | null)[] =
      def.strategy === "per-arm" ? (options.armMode === "both" ? ["left", "right"] : [options.armMode]) : [null];
    this.channels = arms.map((arm) => this.makeChannel(arm));
  }

  get reps(): number {
    return this.channels.reduce((sum, ch) => sum + ch.counter.reps, 0);
  }

  /** Per-arm rep counts (only meaningful for per-arm exercises). */
  get armReps(): Partial<Record<Side, number>> {
    const out: Partial<Record<Side, number>> = {};
    for (const ch of this.channels) if (ch.arm) out[ch.arm] = ch.counter.reps;
    return out;
  }

  reset(): void {
    this.channels = this.channels.map((ch) => this.makeChannel(ch.arm));
  }

  /**
   * Process one frame. `landmarks` is null when no person was detected. `width` and
   * `height` are the frame's pixel dimensions, needed to measure angles correctly.
   */
  update(landmarks: readonly Landmark[] | null, width: number, height: number): TrackerFrame {
    const events: RepEvent[] = [];
    let postureCue: Cue | null = null;

    const states = this.channels.map((ch): ChannelState => {
      const raw = landmarks ? this.measure(ch, landmarks, width, height) : null;
      if (raw === null) {
        ch.gap += 1;
        if (ch.gap > this.options.maxGapFrames) ch.ema.reset();
        ch.posture.forEach((p) => p.reset());
      } else ch.gap = 0;

      const angle = raw === null ? null : ch.ema.update(raw);
      const result = ch.counter.update(angle);
      if (result.event) events.push(result.event);

      if (raw !== null && landmarks && ch.side) {
        for (const monitor of ch.posture) {
          const triple = monitor.rule.joint[ch.side];
          const seen = tripleVisibility(landmarks, triple) >= this.options.visibilityThreshold;
          const cue = monitor.update(seen ? this.angleOn(landmarks, triple, width, height) : null);
          postureCue ??= cue;
        }
      }

      return {
        side: this.def.strategy === "both-average" && raw !== null ? "both" : raw === null ? null : ch.side,
        arm: ch.arm,
        rawAngle: raw,
        angle,
        phase: result.phase,
        zone: result.zone,
        reps: result.count,
        progress: result.progress,
      };
    });

    const tracking = states.some((s) => s.angle !== null);
    const primary =
      states
        .filter((s) => s.progress !== null)
        .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0] ?? (states[0] as ChannelState);

    let cue: Cue | null = null;
    if (!tracking) cue = visibilityCue(this.def);
    else {
      for (const event of events) cue ??= cueForEvent(this.def, event);
      cue ??= postureCue;
    }

    return { tracking, reps: this.reps, channels: states, primary, events, cue };
  }

  private makeChannel(arm: Side | null): Channel {
    const o = this.options;
    return {
      arm,
      side: arm,
      gap: 0,
      ema: new Ema(o.alpha),
      counter: new RepCounter({
        ...this.def.thresholds,
        minDwellFrames: o.minDwellFrames,
        maxGapFrames: o.maxGapFrames,
        partialFraction: o.partialFraction,
      }),
      posture: this.def.posture.map((rule) => new PostureMonitor(rule, o.postureHoldFrames)),
    };
  }

  /** The joint angle this channel should count this frame, or null if not reliably visible. */
  private measure(ch: Channel, lms: readonly Landmark[], w: number, h: number): number | null {
    const { joint, strategy } = this.def;
    const t = this.options.visibilityThreshold;
    const visible = (side: Side) => tripleVisibility(lms, joint[side]) >= t;

    switch (strategy) {
      case "per-arm": {
        const arm = ch.arm as Side;
        return visible(arm) ? this.angleOn(lms, joint[arm], w, h) : null;
      }
      case "both-average": {
        if (!visible("left") || !visible("right")) return null;
        ch.side = "left";
        const l = this.angleOn(lms, joint.left, w, h);
        const r = this.angleOn(lms, joint.right, w, h);
        return l === null || r === null ? null : (l + r) / 2;
      }
      case "best-side": {
        const side = pickSide(
          tripleVisibility(lms, joint.left),
          tripleVisibility(lms, joint.right),
          ch.side,
          t,
          this.options.sideSwitchMargin,
        );
        if (side === null) return null;
        ch.side = side;
        return this.angleOn(lms, joint[side], w, h);
      }
    }
  }

  private angleOn(lms: readonly Landmark[], [a, b, c]: Triple, w: number, h: number): number | null {
    const pa = lms[a];
    const pb = lms[b];
    const pc = lms[c];
    if (!pa || !pb || !pc) return null;
    const angle = jointAngle(toPixels(pa, w, h), toPixels(pb, w, h), toPixels(pc, w, h));
    return Number.isFinite(angle) ? angle : null;
  }
}
