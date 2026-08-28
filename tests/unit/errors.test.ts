import { describe, expect, it } from "vitest";
import { isUnsupportedError, sanitiseError } from "../../src/main/util/errors";

describe("sanitiseError", () => {
  it("turns network codes into actionable advice", () => {
    expect(sanitiseError({ code: "EHOSTUNREACH", message: "connect EHOSTUNREACH" }).message).toMatch(
      /not reachable/i,
    );
    expect(sanitiseError({ code: "ETIMEDOUT" }).message).toMatch(/did not answer/i);
  });

  it("labels SSAP errors and keeps them short", () => {
    const long = "x".repeat(500);
    const result = sanitiseError({ code: "ESSAP", errorText: long });
    expect(result.message.startsWith("TV error:")).toBe(true);
    expect(result.message.length).toBeLessThan(220);
  });

  it("never returns undefined for odd input", () => {
    expect(sanitiseError(null).message).toBe("Unknown error");
    expect(sanitiseError("boom").message).toBe("boom");
  });
});

describe("isUnsupportedError", () => {
  it("recognises capability errors", () => {
    expect(isUnsupportedError({ errorCode: 404, errorText: "service does not exist" })).toBe(true);
    expect(isUnsupportedError({ errorText: "403 permission denied" })).toBe(true);
  });

  it("does not treat transport failures as capability errors", () => {
    expect(isUnsupportedError({ code: "ECONNRESET", message: "socket hang up" })).toBe(false);
  });
});
