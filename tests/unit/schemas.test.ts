import { describe, expect, it } from "vitest";
import {
  commandSchema,
  connectSchema,
  deleteCharactersSchema,
  insertTextSchema,
  macSchema,
} from "../../src/main/ipc/schemas";

describe("connectSchema", () => {
  it("accepts an IP address and a hostname", () => {
    expect(connectSchema.safeParse({ host: "192.168.1.220" }).success).toBe(true);
    expect(connectSchema.safeParse({ host: "living-room-tv.local" }).success).toBe(true);
  });

  it("rejects URLs, empty values and injected characters", () => {
    expect(connectSchema.safeParse({ host: "http://192.168.1.220:3001" }).success).toBe(false);
    expect(connectSchema.safeParse({ host: "" }).success).toBe(false);
    expect(connectSchema.safeParse({ host: "192.168.1.1; rm -rf /" }).success).toBe(false);
  });
});

describe("macSchema", () => {
  it("accepts colon and dash separated MACs", () => {
    expect(macSchema.safeParse("24:e8:53:22:1d:9a").success).toBe(true);
    expect(macSchema.safeParse("24-E8-53-22-1D-9A").success).toBe(true);
  });

  it("rejects malformed MACs", () => {
    expect(macSchema.safeParse("24:e8:53:22:1d").success).toBe(false);
    expect(macSchema.safeParse("hello").success).toBe(false);
  });
});

describe("commandSchema", () => {
  it("clamps volume to 0..100", () => {
    expect(commandSchema.safeParse({ kind: "setVolume", volume: 50 }).success).toBe(true);
    expect(commandSchema.safeParse({ kind: "setVolume", volume: 101 }).success).toBe(false);
    expect(commandSchema.safeParse({ kind: "setVolume", volume: -1 }).success).toBe(false);
  });

  it("only allows known buttons", () => {
    expect(commandSchema.safeParse({ kind: "button", button: "HOME" }).success).toBe(true);
    expect(commandSchema.safeParse({ kind: "button", button: "SELF_DESTRUCT" }).success).toBe(false);
  });

  it("accepts the OK command", () => {
    expect(commandSchema.safeParse({ kind: "ok" }).success).toBe(true);
  });

  it("rejects an unknown command kind", () => {
    expect(commandSchema.safeParse({ kind: "request", uri: "ssap://system/turnOff" }).success).toBe(false);
  });
});

describe("text schemas", () => {
  it("bounds the delete count", () => {
    expect(deleteCharactersSchema.safeParse({ count: 1 }).success).toBe(true);
    expect(deleteCharactersSchema.safeParse({ count: 0 }).success).toBe(false);
    expect(deleteCharactersSchema.safeParse({ count: 501 }).success).toBe(false);
  });

  it("accepts Unicode text and rejects empty text", () => {
    expect(insertTextSchema.safeParse({ text: "سلام دنیا" }).success).toBe(true);
    expect(insertTextSchema.safeParse({ text: "" }).success).toBe(false);
  });
});
