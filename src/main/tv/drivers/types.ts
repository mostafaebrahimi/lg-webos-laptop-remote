import type {
  CaptureResult,
  MediaAction,
  RemoteButton,
  TvApp,
  TvCommand,
  TvInput,
} from "@shared/types";

/**
 * What a driver can do. The UI reads these flags and disables what the brand
 * does not support, instead of showing controls that silently fail.
 */
export interface DriverFeatures {
  pointer: boolean;
  /** Text injection into a focused on-TV field. */
  textInput: boolean;
  /** Driver reports whether a TV text field currently has focus. */
  textFocusReporting: boolean;
  apps: boolean;
  inputs: boolean;
  channels: boolean;
  media: boolean;
  volumeLevel: boolean;
  screenPower: boolean;
  capture: boolean;
  wakeOnLan: boolean;
  /** Deep links into an installed app, e.g. a YouTube search. */
  appDeepLinks: boolean;
}

export interface DriverDescriptor {
  id: string;
  /** Shown in the TV brand selector. */
  name: string;
  /** One line describing what this driver talks to. */
  summary: string;
  /** Shown while the TV is waiting for the user to accept pairing. */
  pairingHint: string;
  /** Where to look on the TV to enable remote control. */
  setupHint: string;
  features: DriverFeatures;
  /** SSDP search target, when the brand can be discovered that way. */
  ssdpSearchTarget?: string;
  /** False for drivers that are registered but not implemented yet. */
  implemented: boolean;
}

/** Everything a driver pushes upwards. The manager owns all UI state. */
export interface DriverEvents {
  connecting(transport: string): void;
  /** The TV is showing a pairing prompt the user must accept. */
  pairingRequired(): void;
  connected(): void;
  closed(): void;
  error(error: unknown): void;
  macDiscovered(mac: string): void;
  volumeChanged(volume: number | null, muted: boolean | null): void;
  powerStateChanged(state: string): void;
  foregroundAppChanged(appId: string | null): void;
  textFocusChanged(focused: boolean | null): void;
  /** A feature this model turned out not to have. */
  capabilityChanged(key: string, supported: boolean): void;
  deviceInfo(info: { modelName?: string; firmwareVersion?: string }): void;
}

export interface DriverConfig {
  host: string;
  mac?: string;
  /** Directory the driver may use for pairing keys and certificates. */
  stateDir: string;
}

/**
 * One television brand/protocol. Implement this interface and register the
 * driver to add support for another kind of TV; nothing above this layer knows
 * about webOS, SSAP or lgtv2.
 */
export interface TvDriver {
  readonly descriptor: DriverDescriptor;

  connect(config: DriverConfig, events: DriverEvents): Promise<void>;
  disconnect(): Promise<void>;
  readonly connected: boolean;

  /** Dispatch a validated, brand-independent command. */
  runCommand(command: TvCommand): Promise<void>;

  pointerMove(dx: number, dy: number, dragging: boolean): void;
  pointerClick(): void;
  pointerScroll(dx: number, dy: number): void;
  pointerButton(button: RemoteButton): void;

  insertText(text: string, replace: boolean): Promise<void>;
  deleteCharacters(count: number): Promise<void>;
  sendEnter(): Promise<void>;

  listApps(): Promise<TvApp[]>;
  listInputs(): Promise<TvInput[]>;
  launchAppWithTarget(appId: string, contentTarget?: string): Promise<void>;
  media(action: MediaAction): Promise<void>;

  /** Raw JPEG/PNG bytes of the current screen. */
  captureScreen(): Promise<Buffer>;
  wake(mac?: string): Promise<void>;
}

export type DriverFactory = () => TvDriver;

export type { CaptureResult, TvApp, TvCommand, TvInput };
