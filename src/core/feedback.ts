import type { ExerciseDef, PostureRule } from "./exercises";
import type { RepEvent } from "./repCounter";

export type CueTone = "good" | "warn" | "info";

export interface Cue {
  /** Stable identifier, so the UI can avoid re-announcing the same cue every frame. */
  readonly id: string;
  readonly text: string;
  readonly tone: CueTone;
}

/**
 * Turn a rep-counter event into a cue. Every cue here is derived from the measured
 * joint angle crossing (or failing to cross) the exercise's thresholds; nothing is
 * inferred that the angle can't actually show.
 */
export function cueForEvent(def: ExerciseDef, event: RepEvent | null): Cue | null {
  if (!event) return null;
  switch (event.type) {
    case "rep":
      return { id: `${def.id}:good`, text: def.cues.good, tone: "good" };
    case "shallow":
      return { id: `${def.id}:shallow`, text: def.cues.shallow, tone: "warn" };
    case "incomplete":
      return { id: `${def.id}:incomplete`, text: def.cues.incomplete, tone: "warn" };
    case "lost":
      return { id: "lost", text: "Lost track of you, return to the start position", tone: "info" };
  }
}

export function visibilityCue(def: ExerciseDef): Cue {
  return { id: `${def.id}:visibility`, text: def.visibilityHint, tone: "info" };
}

/**
 * Sustained-condition check for a posture rule. A single bad frame is usually noise,
 * so the rule only reports a violation after `holdFrames` consecutive offending frames,
 * and any frame where the joint isn't visible clears the run.
 */
export class PostureMonitor {
  private run = 0;

  constructor(
    readonly rule: PostureRule,
    readonly holdFrames = 8,
  ) {}

  update(angle: number | null): Cue | null {
    const violated =
      angle !== null &&
      Number.isFinite(angle) &&
      (this.rule.when === "below" ? angle < this.rule.threshold : angle > this.rule.threshold);
    this.run = violated ? this.run + 1 : 0;
    return this.run >= this.holdFrames ? { id: `posture:${this.rule.id}`, text: this.rule.message, tone: "warn" } : null;
  }

  reset(): void {
    this.run = 0;
  }
}
