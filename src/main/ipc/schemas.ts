import { z } from "zod";
import { CONSERVATIVE_BUTTONS, EXPERIMENTAL_BUTTONS, MAX_TEXT_CHUNK } from "@shared/types";

/** Accepts an IPv4/IPv6 literal or a hostname; rejects URLs and paths. */
const hostSchema = z
  .string()
  .trim()
  .min(1, "Enter the TV IP address")
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/, "Use a plain IP address or hostname, without http:// or a port");

export const macSchema = z
  .string()
  .trim()
  .regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/, "MAC must look like 3c:cd:93:11:22:33");

const driverIdSchema = z.string().regex(/^[a-z0-9-]{2,32}$/);

export const connectSchema = z.object({
  host: hostSchema,
  mac: z.union([macSchema, z.literal("")]).optional(),
  driverId: driverIdSchema.optional(),
});

export const profileSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  host: hostSchema,
  mac: z.union([macSchema, z.literal("")]),
  driverId: driverIdSchema,
});

export const globalShortcutSchema = z.object({ enabled: z.boolean() });

const buttonSchema = z.enum([...CONSERVATIVE_BUTTONS, ...EXPERIMENTAL_BUTTONS] as [string, ...string[]]);

export const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("volumeUp") }),
  z.object({ kind: z.literal("volumeDown") }),
  z.object({ kind: z.literal("setVolume"), volume: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal("setMute"), mute: z.boolean() }),
  z.object({ kind: z.literal("button"), button: buttonSchema }),
  z.object({ kind: z.literal("click") }),
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("media"), action: z.enum(["play", "pause", "stop", "rewind", "fastForward"]) }),
  z.object({ kind: z.literal("channelUp") }),
  z.object({ kind: z.literal("channelDown") }),
  z.object({ kind: z.literal("turnOff") }),
  z.object({ kind: z.literal("screenOff") }),
  z.object({ kind: z.literal("screenOn") }),
  z.object({
    kind: z.literal("launchApp"),
    appId: z.string().min(1).max(120),
    contentTarget: z.string().max(1024).optional(),
  }),
  z.object({ kind: z.literal("switchInput"), inputId: z.string().min(1).max(120) }),
  z.object({ kind: z.literal("closeApp"), appId: z.string().min(1).max(120) }),
  z.object({ kind: z.literal("toast"), message: z.string().min(1).max(400) }),
]);

export const insertTextSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_CHUNK * 10),
  replace: z.boolean().optional(),
});

export const deleteCharactersSchema = z.object({
  count: z.number().int().min(1).max(500),
});

export const pointerDeltaSchema = z.object({
  dx: z.number().finite(),
  dy: z.number().finite(),
  dragging: z.boolean().optional(),
});

export const sceneSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(40),
  steps: z.array(commandSchema).min(1).max(12),
});

export const sceneIdSchema = z.object({ id: z.string().min(1).max(64) });

export const settingsPatchSchema = z.object({
  host: hostSchema.optional(),
  mac: z.union([macSchema, z.literal("")]).optional(),
  keyRepeatMs: z.number().int().min(40).max(1000).optional(),
  volumeStep: z.number().int().min(1).max(10).optional(),
  shortcutsEnabled: z.boolean().optional(),
  experimentalButtons: z.boolean().optional(),
  okMode: z.enum(["enter", "click", "both"]).optional(),
  pointerSensitivity: z.number().min(0.25).max(3).optional(),
  scrollSensitivity: z.number().min(0.25).max(3).optional(),
  invertScrollY: z.boolean().optional(),
  driverId: driverIdSchema.optional(),
  profiles: z.array(profileSchema).max(20).optional(),
  activeProfileId: z.string().max(64).optional(),
  globalShortcuts: z.boolean().optional(),
  snippets: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(60),
        secret: z.boolean(),
        value: z.string().max(500).optional(),
      }),
    )
    .max(30)
    .optional(),
  scenes: z.array(sceneSchema).max(20).optional(),
  oskLayoutId: z.string().min(1).max(40).optional(),
  oskDelayMs: z.number().int().min(80).max(600).optional(),
  oskLayer: z.string().min(1).max(40).optional(),
  liveTyping: z.boolean().optional(),
  favouriteApps: z.array(z.string().min(1).max(120)).max(50).optional(),
});

export const recordingSchema = z.object({
  fps: z.number().int().min(1).max(5),
});

export const openPathSchema = z.object({
  target: z.enum(["captures", "lastRecording"]),
});

export const oskTypeSchema = z.object({
  layoutId: z.string().min(1).max(40),
  text: z.string().min(1).max(200),
  submit: z.boolean().optional(),
  delayMs: z.number().int().min(60).max(600).optional(),
  fromHome: z.boolean().optional(),
  // "auto" asks the app to work the page out from a screen capture.
  startLayer: z.string().min(1).max(40).optional(),
});

export const oskLearnSchema = z.object({
  layoutId: z.string().min(1).max(40),
  layer: z.string().min(1).max(40),
});

export const oskLayoutIdSchema = z.object({ layoutId: z.string().min(1).max(40) });


export const sleepTimerSchema = z.object({
  minutes: z.number().int().min(0).max(600),
});

export const gifSchema = z.object({
  frameDir: z.string().min(1).max(4096),
  fps: z.number().int().min(1).max(5).optional(),
});

export const streamFileSchema = z.object({ file: z.string().min(1).max(4096) });
export const streamSeekSchema = z.object({ seconds: z.number().min(0).max(86400) });

export const verifySchema = z.object({ expected: z.string().min(1).max(200) });

export const snippetAddSchema = z.object({
  label: z.string().trim().min(1).max(60),
  value: z.string().min(1).max(500),
  secret: z.boolean(),
});

export const snippetIdSchema = z.object({ id: z.string().min(1).max(64) });

export const snippetSendSchema = z.object({
  id: z.string().min(1).max(64),
  route: z.enum(["ime", "osk", "youtube"]),
  layoutId: z.string().min(1).max(40).optional(),
  delayMs: z.number().int().min(80).max(600).optional(),
  startLayer: z.string().min(1).max(40).optional(),
  submit: z.boolean().optional(),
});

export const youtubeSchema = z.object({
  input: z.string().trim().min(1).max(500),
});
