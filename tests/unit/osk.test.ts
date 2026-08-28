import { describe, expect, it, vi } from "vitest";
import { OnScreenKeyboardTyper } from "../../src/main/tv/keyboards/OnScreenKeyboardTyper";
import { findLayout, locate, unsupportedCharacters } from "../../src/main/tv/keyboards/layouts";

const google = findLayout("google-signin");
const at = (row: number, col: number, layer = "letters") => ({ position: { row, col }, layer });

describe("layouts", () => {
  it("locates characters in the verified Google grid", () => {
    // Verified on a real TV: RIGHT RIGHT DOWN from "1" lands on "e".
    expect(locate(google, "1")).toMatchObject({ layer: "letters", row: 0, col: 0 });
    expect(locate(google, "3")).toMatchObject({ layer: "letters", row: 0, col: 2 });
    expect(locate(google, "e")).toMatchObject({ layer: "letters", row: 1, col: 2 });
    expect(locate(google, "@")).toMatchObject({ layer: "letters", row: 2, col: 9 });
  });

  it("finds symbols on the second page", () => {
    // The bug: `$` is not on the letters page, so it used to be skipped.
    expect(locate(google, "$")).toMatchObject({ layer: "symbols", row: 3, col: 6 });
    expect(locate(google, "!")).toMatchObject({ layer: "symbols", row: 3, col: 9 });
    expect(locate(google, "%")).toMatchObject({ layer: "symbols", row: 3, col: 3 });
    expect(locate(google, "(")).toMatchObject({ layer: "symbols", row: 2, col: 8 });
  });

  it("prefers the page already showing when a key exists on both", () => {
    expect(locate(google, "5", "symbols")).toMatchObject({ layer: "symbols" });
    expect(locate(google, "5", "letters")).toMatchObject({ layer: "letters" });
  });

  it("flags capitals as needing the shift key", () => {
    expect(locate(google, "E")).toMatchObject({ layer: "letters", row: 1, col: 2, shift: true });
  });

  it("reports only characters that are genuinely absent", () => {
    expect(unsupportedCharacters(google, "P@ssw0rd$!")).toEqual([]);
    expect(unsupportedCharacters(google, "سلام")).toHaveLength(4);
  });
});

describe("OnScreenKeyboardTyper", () => {
  const record = () => {
    const presses: string[] = [];
    const typer = new OnScreenKeyboardTyper(
      (button) => presses.push(button),
      () => presses.push("OK"),
      0,
    );
    return { presses, typer };
  };

  it("walks from one key to the next and confirms with OK", async () => {
    const { presses, typer } = record();
    await typer.type("google-signin", "3", at(0, 0));
    expect(presses).toEqual(["RIGHT", "RIGHT", "OK"]);
  });

  it("matches the path verified on a real TV: 1 → e", async () => {
    const { presses, typer } = record();
    await typer.type("google-signin", "e", at(0, 0));
    expect(presses).toEqual(["DOWN", "RIGHT", "RIGHT", "OK"]);
  });

  it("switches to the symbols page for $ and switches back afterwards", async () => {
    const { presses, typer } = record();
    const end = await typer.type("google-signin", "$", at(3, 10));
    // Already on the layer key: press it, walk to $, press it, then return.
    const okPresses = presses.filter((press) => press === "OK");
    expect(okPresses.length).toBe(3); // switch, type, switch back
    expect(end.layer).toBe("letters");
  });

  it("types a password containing $ without dropping anything", async () => {
    const { presses, typer } = record();
    const progress = vi.fn();
    await typer.type("google-signin", "a$b", at(2, 0), progress);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls.map((call) => call[0].character)).toEqual(["a", "$", "b"]);
    expect(presses.filter((press) => press === "OK").length).toBeGreaterThanOrEqual(5);
  });

  it("refuses before typing when a character has no key at all", async () => {
    const { presses, typer } = record();
    await expect(typer.type("google-signin", "سلام", at(0, 0))).rejects.toThrow(/no key for/i);
    expect(presses).toHaveLength(0);
  });

  it("never crosses a row at a column that row does not have", async () => {
    const { presses, typer } = record();
    await typer.type("google-signin", "p", at(0, 10));
    const firstDown = presses.indexOf("DOWN");
    const leftsBefore = presses.slice(0, firstDown).filter((press) => press === "LEFT").length;
    expect(leftsBefore).toBeGreaterThanOrEqual(1);
  });

  it("presses shift before a capital letter", async () => {
    const { presses, typer } = record();
    await typer.type("google-signin", "A", at(2, 10));
    expect(presses[0]).toBe("OK");
    expect(presses.filter((press) => press === "OK")).toHaveLength(2);
  });

  it("stops early when cancelled", async () => {
    const presses: string[] = [];
    const typer = new OnScreenKeyboardTyper(
      (button) => presses.push(button),
      () => {
        presses.push("OK");
        typer.cancel();
      },
      0,
    );
    await typer.type("google-signin", "123456", at(0, 0));
    expect(presses.filter((press) => press === "OK")).toHaveLength(1);
  });

  it("homes to the bottom-left corner with edge-safe overshoot", async () => {
    const { presses, typer } = record();
    const state = await typer.home(google, "letters");
    expect(state).toEqual({ position: { row: 3, col: 0 }, layer: "letters" });
    expect(new Set(presses)).toEqual(new Set(["DOWN", "LEFT"]));
  });
});
