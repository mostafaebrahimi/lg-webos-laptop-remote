import { describe, expect, it } from "vitest";
import { commandSchema, sceneSchema, sleepTimerSchema, gifSchema, snippetAddSchema, snippetSendSchema } from "../../src/main/ipc/schemas";

describe("scene validation", () => {
  it("accepts a realistic scene", () => {
    const scene = {
      id: "scene-1",
      name: "Movie night",
      steps: [
        { kind: "switchInput", inputId: "HDMI_1" },
        { kind: "setVolume", volume: 12 },
        { kind: "launchApp", appId: "youtube.leanback.v4" },
      ],
    };
    expect(sceneSchema.safeParse(scene).success).toBe(true);
  });

  it("rejects an empty or oversized scene", () => {
    expect(sceneSchema.safeParse({ id: "a", name: "x", steps: [] }).success).toBe(false);
    const steps = Array.from({ length: 13 }, () => ({ kind: "volumeUp" }));
    expect(sceneSchema.safeParse({ id: "a", name: "x", steps }).success).toBe(false);
  });

  it("rejects a scene containing an unknown command", () => {
    const scene = { id: "a", name: "x", steps: [{ kind: "rm", path: "/" }] };
    expect(sceneSchema.safeParse(scene).success).toBe(false);
  });

  it("still validates each step the same way a direct command is validated", () => {
    expect(commandSchema.safeParse({ kind: "setVolume", volume: 200 }).success).toBe(false);
    expect(sceneSchema.safeParse({ id: "a", name: "x", steps: [{ kind: "setVolume", volume: 200 }] }).success).toBe(false);
  });
});

describe("sleep timer validation", () => {
  it("accepts 0 as cancel and bounds the maximum", () => {
    expect(sleepTimerSchema.safeParse({ minutes: 0 }).success).toBe(true);
    expect(sleepTimerSchema.safeParse({ minutes: 600 }).success).toBe(true);
    expect(sleepTimerSchema.safeParse({ minutes: 601 }).success).toBe(false);
    expect(sleepTimerSchema.safeParse({ minutes: -5 }).success).toBe(false);
  });
});

describe("snippet validation", () => {
  it("requires a label and a value", () => {
    expect(snippetAddSchema.safeParse({ label: "Gmail", value: "a@b.com", secret: true }).success).toBe(true);
    expect(snippetAddSchema.safeParse({ label: "", value: "x", secret: false }).success).toBe(false);
    expect(snippetAddSchema.safeParse({ label: "x", value: "", secret: false }).success).toBe(false);
  });

  it("only allows the three known routes when sending", () => {
    expect(snippetSendSchema.safeParse({ id: "a", route: "osk" }).success).toBe(true);
    expect(snippetSendSchema.safeParse({ id: "a", route: "shell" }).success).toBe(false);
  });
});

describe("gif export validation", () => {
  it("bounds the frame rate", () => {
    expect(gifSchema.safeParse({ frameDir: "/tmp/x", fps: 2 }).success).toBe(true);
    expect(gifSchema.safeParse({ frameDir: "/tmp/x", fps: 9 }).success).toBe(false);
  });
});
