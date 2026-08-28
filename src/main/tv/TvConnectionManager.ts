import path from "node:path";
import { EventEmitter } from "node:events";
import {
  AppSettings,
  CapabilityState,
  CaptureResult,
  MAX_TEXT_CHUNK,
  PublicTvConfig,
  RecordingResult,
  RemoteButton,
  TvApp,
  TvCommand,
  TvConnectionState,
  TvInput,
  TvSnapshot,
} from "@shared/types";
import { CaptureManager } from "./CaptureManager";
import { IconCache } from "./IconCache";
import { createDriver, DEFAULT_DRIVER_ID, describeDriver } from "./drivers/registry";
import { OnScreenKeyboardTyper } from "./keyboards/OnScreenKeyboardTyper";
import { findLayout } from "./keyboards/layouts";
import { PageDetector } from "./keyboards/PageDetector";
import { TypingVerifier, type VerifyResult } from "./keyboards/TypingVerifier";
import type { TyperState } from "./keyboards/OnScreenKeyboardTyper";
import type { DriverEvents, TvDriver } from "./drivers/types";
import { backoffDelay } from "../util/backoff";
import { sanitiseError } from "../util/errors";
import { chunkText } from "../util/text";

const OFFLINE_AFTER_ATTEMPTS = 6;

/**
 * Brand-independent connection state: the state machine, reconnect policy,
 * capability memory, text serialisation and screen capture all live here. The
 * protocol itself lives behind a `TvDriver`.
 */
export class TvConnectionManager extends EventEmitter {
  private driver: TvDriver | null = null;
  private config: PublicTvConfig | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private intentionalDisconnect = false;
  private textChain: Promise<unknown> = Promise.resolve();
  private capabilities = new Map<string, CapabilityState>();
  private snapshot: TvSnapshot = emptySnapshot();
  private readonly capture: CaptureManager;
  private readonly icons = new IconCache();
  private readonly pages: PageDetector;
  private sleepTimer: NodeJS.Timeout | null = null;
  private typer: OnScreenKeyboardTyper | null = null;
  private oskPosition: TyperState | null = null;

  constructor(
    private readonly userDataDir: string,
    private readonly settings: () => AppSettings,
  ) {
    super();
    this.pages = new PageDetector(userDataDir);
    this.capture = new CaptureManager(
      path.join(userDataDir, "captures"),
      () => this.requireDriver().captureScreen(),
      (frames) => this.patch({ recordingFrames: frames, recordingActive: this.capture.recording }),
    );
  }

  getSnapshot(): TvSnapshot {
    return this.snapshot;
  }

  // ---------------------------------------------------------------- lifecycle

  async connect(config: PublicTvConfig): Promise<void> {
    await this.disconnect();
    this.intentionalDisconnect = false;
    this.reconnectAttempt = 0;
    this.capabilities.clear();

    const driverId = config.driverId ?? DEFAULT_DRIVER_ID;
    const descriptor = describeDriver(driverId);
    this.driver = createDriver(driverId);
    this.config = { ...config, driverId };

    const host = config.host.trim();
    this.patch({
      host,
      driverId,
      driverName: descriptor.name,
      features: descriptor.features as unknown as Record<string, boolean>,
      state: "connecting",
      statusMessage: `Connecting to ${host}…`,
      lastError: null,
      capabilities: {},
    });

    await this.driver.connect(
      { host, mac: config.mac, stateDir: path.join(this.userDataDir, "pairing") },
      this.driverEvents(host, descriptor.pairingHint),
    );
  }

  private driverEvents(host: string, pairingHint: string): DriverEvents {
    return {
      connecting: (transport) => this.patch({ transport }),
      pairingRequired: () => this.patch({ state: "pairing", statusMessage: pairingHint }),
      connected: () => {
        this.reconnectAttempt = 0;
        this.patch({
          state: "connected",
          paired: true,
          statusMessage: `Connected to ${host}`,
          lastError: null,
          reconnectAttempt: 0,
        });
      },
      closed: () => {
        if (this.intentionalDisconnect) return;
        this.patch({ state: "reconnecting", statusMessage: "Connection lost, reconnecting…" });
        this.scheduleReconnect();
      },
      error: (error) => {
        if (this.intentionalDisconnect) return;
        const { message } = sanitiseError(error);
        const state: TvConnectionState = this.reconnectAttempt >= OFFLINE_AFTER_ATTEMPTS ? "offline" : "error";
        this.patch({ state, statusMessage: message, lastError: message });
        this.scheduleReconnect();
      },
      macDiscovered: (mac) => this.patch({ mac }),
      volumeChanged: (volume, muted) =>
        this.patch({
          volume: volume ?? this.snapshot.volume,
          muted: muted ?? this.snapshot.muted,
        }),
      powerStateChanged: (state) => {
        this.patch({ powerState: state });
        if (state === "standby" || state === "off") {
          this.patch({ state: "sleeping", statusMessage: "TV is in standby." });
        }
      },
      foregroundAppChanged: (appId) => this.patch({ foregroundAppId: appId }),
      textFocusChanged: (focused) => this.patch({ keyboardFocus: focused }),
      capabilityChanged: (key, supported) => {
        if (key === "pointerSocket") this.patch({ pointerSocketReady: supported });
        this.setCapability(key, supported ? "supported" : "unsupported");
      },
      deviceInfo: (info) =>
        this.patch({
          modelName: info.modelName ?? this.snapshot.modelName,
          firmwareVersion: info.firmwareVersion ?? this.snapshot.firmwareVersion,
        }),
    };
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.clearReconnect();
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.capture.cancel();
    const driver = this.driver;
    this.driver = null;
    if (driver) await driver.disconnect();
    this.patch({
      state: "disconnected",
      statusMessage: "Disconnected",
      pointerSocketReady: false,
      recordingActive: false,
      recordingFrames: 0,
      oskTyping: false,
      sleepTimerAt: null,
      keyboardFocus: null,
      volume: null,
      muted: null,
      powerState: null,
      foregroundAppId: null,
      reconnectAttempt: 0,
    });
  }

  /** Wake-on-LAN. Works while the socket is down; that is the whole point. */
  async wake(): Promise<void> {
    const mac = (this.settings().mac || this.snapshot.mac || "").trim();
    const driverId = this.config?.driverId ?? this.settings().driverId ?? DEFAULT_DRIVER_ID;
    const driver = this.driver ?? createDriver(driverId);

    await driver.wake(mac || undefined);
    this.patch({ statusMessage: "Magic packet sent, waiting for the TV to answer…" });

    if (!this.driver) {
      const host = this.config?.host ?? this.settings().host;
      if (host) await this.connect({ host, mac, driverId });
    } else if (!this.driver.connected) {
      this.reconnectAttempt = 0;
      this.scheduleReconnect(1500);
    }
  }

  private scheduleReconnect(fixedDelay?: number): void {
    if (this.intentionalDisconnect || this.reconnectTimer || !this.driver || !this.config) return;
    this.reconnectAttempt += 1;
    const delay = fixedDelay ?? backoffDelay(this.reconnectAttempt, { baseMs: 2000, maxMs: 60_000 });
    const givenUp = this.reconnectAttempt >= OFFLINE_AFTER_ATTEMPTS;
    this.patch({
      reconnectAttempt: this.reconnectAttempt,
      state: givenUp ? "offline" : "reconnecting",
      statusMessage: givenUp
        ? "TV appears to be off or unreachable. Use Wake, or check the network."
        : `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempt})…`,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalDisconnect || !this.driver || !this.config) return;
      const descriptor = describeDriver(this.config.driverId ?? DEFAULT_DRIVER_ID);
      void this.driver
        .connect(
          {
            host: this.config.host,
            mac: this.config.mac,
            stateDir: path.join(this.userDataDir, "pairing"),
          },
          this.driverEvents(this.config.host, descriptor.pairingHint),
        )
        .catch((error) => {
          this.patch({ lastError: sanitiseError(error).message });
          this.scheduleReconnect();
        });
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
  }

  // ----------------------------------------------------------------- commands

  async runCommand(command: TvCommand): Promise<void> {
    const driver = this.requireDriver();

    if (command.kind === "ok") {
      this.sendOk();
      return;
    }

    await driver.runCommand(command);
    this.patch({ lastCommand: describeCommand(command), lastError: null });
  }

  /**
   * OK is not one single action. While the user navigates with the arrow keys the
   * TV highlights an item and only the ENTER button activates it; a pointer click
   * acts at the cursor instead. The mode is therefore a user setting.
   */
  private sendOk(): void {
    const driver = this.requireDriver();
    const mode = this.settings().okMode;

    if (mode === "click") {
      driver.pointerClick();
      this.patch({ lastCommand: "OK (pointer click)" });
      return;
    }

    driver.pointerButton("ENTER");
    if (mode === "both") {
      setTimeout(() => {
        if (this.driver?.connected) this.driver.pointerClick();
      }, 120);
      this.patch({ lastCommand: "OK (ENTER then click)" });
      return;
    }
    this.patch({ lastCommand: "OK (ENTER button)" });
  }

  pointerMove(dx: number, dy: number, dragging = false): void {
    this.driver?.pointerMove(dx, dy, dragging);
  }

  pointerScroll(dx: number, dy: number): void {
    this.driver?.pointerScroll(dx, dy);
  }

  pointerClick(): void {
    this.driver?.pointerClick();
  }

  pointerButton(button: RemoteButton): void {
    this.driver?.pointerButton(button);
  }

  // ------------------------------------------------------- scenes and timers

  /** Run a saved sequence of commands, stopping at the first failure. */
  async runScene(steps: TvCommand[]): Promise<void> {
    for (const step of steps) {
      await this.runCommand(step);
      // TVs need a breath between switching input and launching an app.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    this.patch({ lastCommand: `Ran a scene of ${steps.length} step(s)` });
  }

  /** Switch the TV off after a delay. 0 cancels a pending timer. */
  setSleepTimer(minutes: number, now: number): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;

    if (minutes <= 0) {
      this.patch({ sleepTimerAt: null, lastCommand: "Sleep timer cancelled" });
      return;
    }

    const delay = minutes * 60_000;
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null;
      this.patch({ sleepTimerAt: null });
      void this.runCommand({ kind: "turnOff" }).catch(() => undefined);
    }, delay);

    this.patch({ sleepTimerAt: now + delay, lastCommand: `Sleep timer set for ${minutes} minutes` });
  }

  // ------------------------------------------------------------------ capture

  async captureScreen(): Promise<CaptureResult> {
    const result = await this.capture.single();
    this.patch({ lastCommand: "Screen capture" });
    return result;
  }

  async saveCapture(file: string): Promise<string> {
    const saved = await this.capture.saveTo(file);
    this.patch({ lastCommand: `Saved capture to ${saved}` });
    return saved;
  }

  async startRecording(fps: number, timestamp: string): Promise<void> {
    await this.capture.start(fps, timestamp);
    this.patch({ recordingActive: true, recordingFrames: 0, lastCommand: `Recording at ${fps} fps` });
  }

  async stopRecording(fps: number): Promise<RecordingResult> {
    const result = await this.capture.stop(fps);
    this.patch({ recordingActive: false, recordingFrames: 0, lastCommand: `Recorded ${result.frames} frames` });
    return result;
  }

  // ------------------------------------------------- app on-screen keyboards

  /**
   * Type by driving an app's own on-screen keyboard with the D-pad. Needed for
   * apps such as YouTube that draw their own grid and never focus a webOS IME
   * widget, so `insertText` is accepted by the TV and then silently discarded.
   */
  async typeOnScreenKeyboard(options: {
    layoutId: string;
    text: string;
    submit?: boolean;
    delayMs?: number;
    fromHome?: boolean;
    startLayer?: string;
  }): Promise<string> {
    const driver = this.requireDriver();
    if (this.typer) throw new Error("Already typing on the TV keyboard.");

    this.typer = new OnScreenKeyboardTyper(
      (button) => driver.pointerButton(button),
      () => this.sendOk(),
      options.delayMs ?? 150,
    );

    this.patch({ oskTyping: true, oskTyped: 0, oskTotal: [...options.text].length });
    try {
      const layout = findLayout(options.layoutId);
      let startLayer = options.startLayer ?? layout.baseLayer;

      if (startLayer === "auto") {
        const detected = await this.detectKeyboardPage(options.layoutId);
        if (!detected || !detected.confident) {
          throw new Error(
            "Could not tell which page of the TV keyboard is showing. Use “Learn this page” once for each page, or pick the page by hand.",
          );
        }
        startLayer = detected.layer;
      }
      // Homing normalises the highlight; the page has to be told to us.
      const from = options.fromHome
        ? await this.typer.home(layout, startLayer)
        : (this.oskPosition ?? (await this.typer.home(layout, startLayer)));

      this.oskPosition = await this.typer.type(options.layoutId, options.text, from, (progress) =>
        this.patch({ oskTyped: progress.typed, oskTotal: progress.total }),
      );
      if (options.submit) {
        this.oskPosition = (await this.typer.submit(options.layoutId, this.oskPosition)) ?? this.oskPosition;
      }
      this.patch({ lastCommand: `Typed “${options.text}” on the TV keyboard` });
      return this.oskPosition?.layer ?? layout.baseLayer;
    } finally {
      this.typer = null;
      this.patch({ oskTyping: false });
    }
  }

  /** Capture the TV and check that the text really landed. */
  async verifyTyped(expected: string): Promise<VerifyResult> {
    const image = await this.requireDriver().captureScreen();
    return TypingVerifier.verify(image, expected);
  }

  /** Learn what the page currently on screen looks like, for later detection. */
  async learnKeyboardPage(layoutId: string, layer: string): Promise<void> {
    const image = await this.requireDriver().captureScreen();
    await this.pages.learn(layoutId, layer, image);
    this.patch({ lastCommand: `Learned the “${layer}” page of ${layoutId}` });
  }

  async forgetKeyboardPages(layoutId: string): Promise<void> {
    await this.pages.forget(layoutId);
  }

  async knownKeyboardPages(layoutId: string): Promise<string[]> {
    return this.pages.known(layoutId);
  }

  /** Which page is on screen, from a capture. Null when it cannot be told. */
  async detectKeyboardPage(layoutId: string): Promise<{ layer: string; confident: boolean } | null> {
    const image = await this.requireDriver().captureScreen();
    const match = await this.pages.detect(layoutId, image);
    if (!match || !match.confident) return match ? { layer: match.layer, confident: false } : null;
    return { layer: match.layer, confident: true };
  }

  cancelOnScreenKeyboard(): void {
    this.typer?.cancel();
    // The highlight is wherever it stopped; re-home before the next run.
    this.oskPosition = null;
  }

  // --------------------------------------------------------------- text input

  /** Text operations are serialised so characters can never arrive out of order. */
  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const run = this.textChain.then(task, task);
    this.textChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  insertText(text: string, replace = false): Promise<void> {
    return this.serialise(async () => {
      const driver = this.requireDriver();
      const chunks = chunkText(text, MAX_TEXT_CHUNK);
      for (let i = 0; i < chunks.length; i += 1) {
        await driver.insertText(chunks[i], replace && i === 0);
      }
      this.patch({ lastCommand: `Insert text (${chunks.length} chunk${chunks.length === 1 ? "" : "s"})` });
    });
  }

  deleteCharacters(count: number): Promise<void> {
    return this.serialise(async () => {
      await this.requireDriver().deleteCharacters(count);
      this.patch({ lastCommand: `Delete ${count} character(s)` });
    });
  }

  sendEnter(): Promise<void> {
    return this.serialise(async () => {
      await this.requireDriver().sendEnter();
      this.patch({ lastCommand: "Send Enter" });
    });
  }

  // -------------------------------------------------------- apps and inputs

  async listApps(): Promise<TvApp[]> {
    const apps = await this.requireDriver().listApps();
    // Icons come from the TV over https with a self-signed certificate, so they
    // are fetched here and inlined rather than loaded by the renderer.
    const resolved = await this.icons.getMany(apps.map((app) => app.icon));
    return apps.map((app, index) => ({ ...app, icon: resolved[index] }));
  }

  async listInputs(): Promise<TvInput[]> {
    const inputs = await this.requireDriver().listInputs();
    const resolved = await this.icons.getMany(inputs.map((input) => input.icon));
    return inputs.map((input, index) => ({ ...input, icon: resolved[index] }));
  }

  async openDeepLink(appId: string, contentTarget?: string): Promise<void> {
    await this.requireDriver().launchAppWithTarget(appId, contentTarget);
    this.patch({ lastCommand: `Launch ${appId}` });
  }

  // ------------------------------------------------------------------ plumbing

  private requireDriver(): TvDriver {
    if (!this.driver) throw new Error("Not connected to a TV.");
    return this.driver;
  }

  private setCapability(key: string, state: CapabilityState): void {
    if (this.capabilities.get(key) === state) return;
    this.capabilities.set(key, state);
    this.patch({ capabilities: Object.fromEntries(this.capabilities) });
  }

  private patch(patch: Partial<TvSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit("snapshot", this.snapshot);
  }
}

function describeCommand(command: TvCommand): string {
  switch (command.kind) {
    case "button":
      return `Remote button: ${command.button}`;
    case "launchApp":
      return `Launch ${command.appId}`;
    case "switchInput":
      return `Switch to ${command.inputId}`;
    case "media":
      return `Media: ${command.action}`;
    default:
      return command.kind;
  }
}

export function emptySnapshot(): TvSnapshot {
  return {
    state: "disconnected",
    statusMessage: "Not connected",
    host: null,
    driverId: DEFAULT_DRIVER_ID,
    driverName: "LG (webOS)",
    features: {},
    paired: false,
    volume: null,
    muted: null,
    powerState: null,
    foregroundAppId: null,
    keyboardFocus: null,
    pointerSocketReady: false,
    transport: null,
    mac: null,
    lastCommand: null,
    lastError: null,
    recordingFrames: 0,
    recordingActive: false,
    oskTyping: false,
    oskTyped: 0,
    oskTotal: 0,
    sleepTimerAt: null,
    capabilities: {},
    modelName: null,
    firmwareVersion: null,
    reconnectAttempt: 0,
  };
}
