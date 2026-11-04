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

  update(sample: number): number {
    if (!Number.isFinite(sample)) {
      throw new RangeError("EMA sample must be a finite number");
    }
    this.current = this.current === null ? sample : this.alpha * sample + (1 - this.alpha) * this.current;
    return this.current;
  }

  get value(): number | null {
    return this.current;
  }

  reset(): void {
    this.current = null;
  }
}
