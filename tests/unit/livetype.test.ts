import { describe, expect, it } from "vitest";
import { commonPrefixLength, diffForTv } from "../../src/renderer/lib/liveTypeDiff";

/** Apply the delete/insert pair the way webOS would, to check the result. */
function applyToTv(current: string, next: string): string {
  const { deletions, insertion } = diffForTv(current, next);
  const kept = [...current].slice(0, [...current].length - deletions).join("");
  return kept + insertion;
}

describe("commonPrefixLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(commonPrefixLength("😀ab", "😀ac")).toBe(2);
    expect(commonPrefixLength("abc", "abc")).toBe(3);
    expect(commonPrefixLength("", "abc")).toBe(0);
  });
});

describe("diffForTv", () => {
  it("appends without deleting", () => {
    expect(diffForTv("hel", "hello")).toEqual({ deletions: 0, insertion: "lo" });
  });

  it("turns a backspace into a delete with no insert", () => {
    expect(diffForTv("hello", "hell")).toEqual({ deletions: 1, insertion: "" });
  });

  it("handles an edit in the middle by rewriting the tail", () => {
    expect(diffForTv("hello world", "hello  world")).toEqual({ deletions: 5, insertion: " world" });
  });

  it("does nothing when the text is unchanged", () => {
    expect(diffForTv("same", "same")).toEqual({ deletions: 0, insertion: "" });
  });

  it("never splits a surrogate pair when deleting", () => {
    expect(diffForTv("ab😀", "ab")).toEqual({ deletions: 1, insertion: "" });
  });

  it.each([
    ["", "hello"],
    ["hello", "hello world"],
    ["hello world", "hello"],
    ["سلام", "سلام دنیا"],
    ["سلام دنیا", "سلام"],
    ["hello", "goodbye"],
    ["abc", ""],
    ["😀😀", "😀🎉"],
  ])("reproduces %j -> %j exactly on the TV", (from, to) => {
    expect(applyToTv(from, to)).toBe(to);
  });
});
