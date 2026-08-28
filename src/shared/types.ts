/** Types shared by the main process, the preload bridge and the renderer. */

export type TvConnectionState =
  | "disconnected"
  | "connecting"
  | "pairing"
  | "connected"
  | "reconnecting"
  | "sleeping"
  | "offline"
  | "error";

/** Remote buttons delivered through the webOS pointer socket. */
export const CONSERVATIVE_BUTTONS = ["HOME", "BACK", "UP", "DOWN", "LEFT", "RIGHT"] as const;

/** Buttons that exist on many, but not all, firmware versions. */
export const EXPERIMENTAL_BUTTONS = [
  "ENTER",
  "MENU",
  "INFO",
  "EXIT",
  "RED",
  "GREEN",
  "YELLOW",
  "BLUE",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
] as const;

export type ConservativeButton = (typeof CONSERVATIVE_BUTTONS)[number];
export type ExperimentalButton = (typeof EXPERIMENTAL_BUTTONS)[number];
export type RemoteButton = ConservativeButton | ExperimentalButton;

export type MediaAction = "play" | "pause" | "stop" | "rewind" | "fastForward";

/**
 * Every action the renderer may ask the main process to perform. The renderer can
 * never send a raw SSAP URI - only a member of this union.
 */
export type TvCommand =
  | { kind: "volumeUp" }
  | { kind: "volumeDown" }
  | { kind: "setVolume"; volume: number }
  | { kind: "setMute"; mute: boolean }
  | { kind: "button"; button: RemoteButton }
  | { kind: "click" }
  | { kind: "ok" }
  | { kind: "media"; action: MediaAction }
  | { kind: "channelUp" }
  | { kind: "channelDown" }
  | { kind: "turnOff" }
  | { kind: "screenOff" }
  | { kind: "screenOn" }
  | { kind: "launchApp"; appId: string; contentTarget?: string }
  | { kind: "switchInput"; inputId: string }
  | { kind: "closeApp"; appId: string }
  | { kind: "toast"; message: string };

export type CommandKind = TvCommand["kind"];

/**
 * How the OK action reaches the TV.
 *
 * `enter`  - the ENTER pointer button, which activates the item the TV has
 *            focused. This is what arrow-key navigation needs.
 * `click`  - a pointer click, which acts at the magic-remote cursor position.
 *            Correct when you are pointing rather than navigating.
 * `both`   - ENTER first, then a click shortly after, for models that ignore one
 *            of them. May double-activate; use only as a last resort.
 */
export type OkMode = "enter" | "click" | "both";

export interface TvApp {
  id: string;
  title: string;
  /** Inlined data URL; the TV serves icons over https with a self-signed cert. */
  icon?: string;
  /** Accent colour the TV ships with the app tile. */
  bgColor?: string;
  systemApp: boolean;
}

export interface TvInput {
  id: string;
  label: string;
  connected: boolean;
  appId?: string;
  icon?: string;
}

export type CapabilityState = "unknown" | "supported" | "unsupported";

export interface TvSnapshot {
  state: TvConnectionState;
  /** Which TV driver is in use, and what it can do. */
  driverId: string;
  driverName: string;
  features: Record<string, boolean>;
  /** Human readable, already sanitised, safe to render. */
  statusMessage: string;
  host: string | null;
  paired: boolean;
  /** Populated from the TV once connected. */
  volume: number | null;
  muted: boolean | null;
  powerState: string | null;
  foregroundAppId: string | null;
  /** webOS IME focus: true / false / null when the model does not report it. */
  keyboardFocus: boolean | null;
  pointerSocketReady: boolean;
  transport: string | null;
  mac: string | null;
  lastCommand: string | null;
  lastError: string | null;
  /** Frames written so far; 0 when no recording is running. */
  recordingFrames: number;
  recordingActive: boolean;
  /** Driving an app's own on-screen keyboard with the D-pad. */
  oskTyping: boolean;
  oskTyped: number;
  oskTotal: number;
  /** Epoch ms when the TV will be switched off, or null. */
  sleepTimerAt: number | null;
  capabilities: Record<string, CapabilityState>;
  modelName: string | null;
  firmwareVersion: string | null;
  reconnectAttempt: number;
}

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string; code?: string };

export interface PublicTvConfig {
  host: string;
  mac?: string;
  /** Defaults to the LG webOS driver. */
  driverId?: string;
}

/** A television the user has saved. */
export interface TvProfile {
  id: string;
  name: string;
  host: string;
  mac: string;
  driverId: string;
}

export interface DiscoveredTv {
  host: string;
  name: string;
  driverId: string;
  /** Raw server string reported over SSDP, for diagnostics. */
  detail?: string;
}

/** A one-click sequence of actions, e.g. "movie night". */
export interface Scene {
  id: string;
  name: string;
  steps: TvCommand[];
}

export type StreamPhase = "idle" | "analysing" | "preparing" | "starting" | "playing" | "paused" | "error";

export interface MediaInfo {
  path: string;
  name: string;
  durationSeconds: number | null;
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  plan: "direct" | "remux" | "transcode";
  reason: string;
  mimeType: string;
}

export interface StreamStatus {
  phase: StreamPhase;
  message: string;
  file: string | null;
  media: MediaInfo | null;
  prepareRatio: number | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  rendererName: string | null;
  serving: boolean;
}

export interface Snippet {
  id: string;
  label: string;
  /** Stored encrypted through the OS keyring; the value is never sent to the UI. */
  secret: boolean;
  /** Present only for non-secret snippets. */
  value?: string;
}

export interface OskLayerInfo {
  id: string;
  label: string;
}

export interface OskLayoutInfo {
  id: string;
  name: string;
  where: string;
  baseLayer: string;
  layers: OskLayerInfo[];
}

export interface TvTypeInfo {
  id: string;
  name: string;
  summary: string;
  setupHint: string;
  implemented: boolean;
  features: Record<string, boolean>;
}

export interface AppSettings {
  host: string;
  mac: string;
  driverId: string;
  profiles: TvProfile[];
  activeProfileId: string;
  globalShortcuts: boolean;
  /** Metadata only: a secret snippet's text never reaches the renderer. */
  snippets: Snippet[];
  oskLayoutId: string;
  oskDelayMs: number;
  /** Which page of the app keyboard is on screen: it cannot be read from the TV. */
  oskLayer: string;
  scenes: Scene[];
  keyRepeatMs: number;
  volumeStep: number;
  shortcutsEnabled: boolean;
  experimentalButtons: boolean;
  okMode: OkMode;
  pointerSensitivity: number;
  scrollSensitivity: number;
  invertScrollY: boolean;
  favouriteApps: string[];
  liveTyping: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  host: "",
  mac: "",
  driverId: "webos",
  profiles: [],
  activeProfileId: "",
  globalShortcuts: false,
  snippets: [],
  oskLayoutId: "google-signin",
  oskDelayMs: 150,
  oskLayer: "letters",
  scenes: [],
  keyRepeatMs: 120,
  volumeStep: 1,
  shortcutsEnabled: true,
  experimentalButtons: false,
  okMode: "enter",
  pointerSensitivity: 1.5,
  scrollSensitivity: 1,
  invertScrollY: false,
  favouriteApps: [],
  liveTyping: false,
};

export interface CaptureResult {
  dataUrl: string;
  bytes: number;
}

export interface RecordingResult {
  frames: number;
  frameDir: string;
  videoPath?: string;
  durationMs: number;
}

export const YOUTUBE_APP_ID = "youtube.leanback.v4";
export const MAX_TEXT_CHUNK = 2000;
