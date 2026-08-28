import { describe, expect, it } from "vitest";
import { backoffDelay } from "../../src/main/util/backoff";

describe("backoffDelay", () => {
  it("grows exponentially and stays bounded", () => {
    const first = backoffDelay(1, { baseMs: 1000, maxMs: 30_000, jitter: 0 });
    const third = backoffDelay(3, { baseMs: 1000, maxMs: 30_000, jitter: 0 });
    expect(first).toBe(1000);
    expect(third).toBe(4000);
  });

  it("never exceeds maxMs, however many attempts", () => {
    for (const attempt of [10, 25, 100]) {
      expect(backoffDelay(attempt, { baseMs: 2000, maxMs: 60_000 })).toBeLessThanOrEqual(60_000);
    }
  });

  it("applies jitter within the expected band", () => {
    const samples = Array.from({ length: 50 }, () => backoffDelay(3, { baseMs: 1000, maxMs: 30_000, jitter: 0.2 }));
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(3600);
      expect(sample).toBeLessThanOrEqual(4400);
    }
    expect(new Set(samples).size).toBeGreaterThan(1);
  });
});
