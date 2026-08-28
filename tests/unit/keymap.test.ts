import { describe, expect, it } from "vitest";
import { isTypingTarget, mapKeyToCommand } from "../../src/renderer/hooks/useRemoteKeyboard";

const base = { volumeStep: 1, experimentalButtons: false };

describe("mapKeyToCommand", () => {
  it("maps the arrow keys to pointer buttons", () => {
    expect(mapKeyToCommand("ArrowUp", base)).toEqual({ kind: "button", button: "UP" });
    expect(mapKeyToCommand("ArrowRight", base)).toEqual({ kind: "button", button: "RIGHT" });
  });

  it("sends the OK action, letting the main process choose ENTER or click", () => {
    expect(mapKeyToCommand("Enter", base)).toEqual({ kind: "ok" });
    expect(mapKeyToCommand("NumpadEnter", base)).toEqual({ kind: "ok" });
  });

  it("leaves Space alone so it stays a literal space when typing", () => {
    expect(mapKeyToCommand("Space", base)).toBeNull();
  });

  it("maps Escape to Back", () => {
    expect(mapKeyToCommand("Escape", base)).toEqual({ kind: "button", button: "BACK" });
  });

  it("leaves Backspace alone so it deletes characters while typing", () => {
    expect(mapKeyToCommand("Backspace", base)).toBeNull();
  });

  it("uses dedicated endpoints for volume and channel, not pointer guesses", () => {
    expect(mapKeyToCommand("Equal", base)).toEqual({ kind: "volumeUp" });
    expect(mapKeyToCommand("Minus", base)).toEqual({ kind: "volumeDown" });
    expect(mapKeyToCommand("PageUp", base)).toEqual({ kind: "channelUp" });
  });

  it("hides model-dependent keys unless experimental buttons are enabled", () => {
    expect(mapKeyToCommand("Digit5", base)).toBeNull();
    expect(mapKeyToCommand("F1", base)).toBeNull();
    expect(mapKeyToCommand("Digit5", { ...base, experimentalButtons: true })).toEqual({
      kind: "button",
      button: "5",
    });
    expect(mapKeyToCommand("F1", { ...base, experimentalButtons: true })).toEqual({
      kind: "button",
      button: "RED",
    });
  });

  it("ignores unmapped keys", () => {
    expect(mapKeyToCommand("KeyQ", base)).toBeNull();
    expect(mapKeyToCommand("Tab", base)).toBeNull();
  });
});

describe("isTypingTarget", () => {
  const element = (tag: string, contentEditable = false) =>
    ({ tagName: tag, isContentEditable: contentEditable }) as unknown as EventTarget;

  it("detects local editing contexts", () => {
    expect(isTypingTarget(element("INPUT"))).toBe(true);
    expect(isTypingTarget(element("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(element("SELECT"))).toBe(true);
    expect(isTypingTarget(element("DIV", true))).toBe(true);
  });

  it("allows shortcuts elsewhere", () => {
    expect(isTypingTarget(element("DIV"))).toBe(false);
    expect(isTypingTarget(element("BUTTON"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
