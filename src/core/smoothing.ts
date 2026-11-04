/**
 * Exponential moving average: s_t = α·x_t + (1 − α)·s_{t−1}.
 *
 * A higher α follows the signal more closely; a lower α suppresses more jitter at the
 * cost of lag. The first sample seeds the average so there is no ramp-up from zero.
 */
export class Ema {
  private current: number | null = null;

  constructor(readonly alpha: number) {
    if (!(alpha > 0 && alpha <= 1)) throw new RangeError("alpha must be in (0, 1]");
  }

  /** Blend in a sample. `alpha` overrides the default weight for this one sample. */
  update(sample: number, alpha = this.alpha): number {
    if (!Number.isFinite(sample)) {
      throw new RangeError("EMA sample must be a finite number");
    }
    this.current = this.current === null ? sample : alpha * sample + (1 - alpha) * this.current;
    return this.current;
  }

  get value(): number | null {
    return this.current;
  }

  reset(): void {
    this.current = null;
  }
}

/**
 * Per-sample EMA weight for a time constant `tauMs`, given the time since the previous
 * sample. Frame-rate independent: at 30 fps with tau = 65 ms this is ≈ 0.4, and at
 * 10 fps it rises to ≈ 0.78, so a slow device doesn't lag behind the movement.
 */
export function alphaForInterval(dtMs: number, tauMs: number): number {
  if (!(dtMs > 0) || !(tauMs > 0)) return 1;
  return 1 - Math.exp(-dtMs / tauMs);
}
