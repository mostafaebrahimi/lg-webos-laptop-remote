export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  /** Fraction of the delay applied as random jitter, 0..1. */
  jitter?: number;
}

/**
 * Bounded exponential backoff with jitter. `attempt` is 1-based; the caller keeps
 * the counter so the delay can be shown in the UI.
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const { baseMs = 1000, maxMs = 60_000, factor = 2, jitter = 0.2 } = options;
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const raw = baseMs * Math.pow(factor, safeAttempt - 1);
  const capped = Math.min(raw, maxMs);
  const spread = capped * jitter;
  const delay = capped - spread / 2 + Math.random() * spread;
  return Math.round(Math.min(maxMs, Math.max(baseMs / 2, delay)));
}
