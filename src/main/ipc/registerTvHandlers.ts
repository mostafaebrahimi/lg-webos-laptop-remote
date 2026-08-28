import { promises as fs } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { z } from "zod";
import {
  AppSettings,
  PublicTvConfig,
  Result,
  TvApp,
  TvCommand,
  TvInput,
  CaptureResult,
  DiscoveredTv,
  MediaInfo,
  Snippet,
  StreamStatus,
  OskLayoutInfo,
  RecordingResult,
  TvTypeInfo,
  TvSnapshot,
  YOUTUBE_APP_ID,
} from "@shared/types";
import { CHANNELS } from "@shared/channels";
import { TvConnectionManager } from "../tv/TvConnectionManager";
import { SettingsRepository } from "../settings/SettingsRepository";
import { SecretStore } from "../settings/SecretStore";
import { sanitiseError } from "../util/errors";
import { normaliseYouTubeInput } from "../util/youtube";
import { discoverTvs } from "../discovery/ssdp";
import { listDrivers } from "../tv/drivers/registry";
import { GlobalShortcutManager } from "../shortcuts/GlobalShortcutManager";
import { LAYER_LABELS, LAYOUTS } from "../tv/keyboards/layouts";
import { encodeGif } from "../tv/CaptureManager";
import { clipboardText } from "../TrayController";
import { StreamManager } from "../stream/StreamManager";
import { GlobalShortcutManager as Shortcuts } from "../shortcuts/GlobalShortcutManager";
import {
  commandSchema,
  connectSchema,
  deleteCharactersSchema,
  insertTextSchema,
  pointerDeltaSchema,
  globalShortcutSchema,
  openPathSchema,
  oskLayoutIdSchema,
  oskLearnSchema,
  oskTypeSchema,
  verifySchema,
  streamFileSchema,
  streamSeekSchema,
  gifSchema,
  sceneSchema,
  sleepTimerSchema,
  snippetAddSchema,
  snippetIdSchema,
  snippetSendSchema,
  recordingSchema,
  settingsPatchSchema,
  youtubeSchema,
} from "./schemas";

async function guard<T>(task: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await task() };
  } catch (error) {
    const { message, code } = sanitiseError(error);
    return { ok: false, error: message, code };
  }
}

/** Validate first, then run; a schema failure never reaches the TV layer. */
function validated<S extends z.ZodTypeAny, T>(
  schema: S,
  task: (input: z.infer<S>) => Promise<T> | T,
): (event: unknown, raw: unknown) => Promise<Result<T>> {
  return async (_event, raw) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request", code: "EVALIDATION" };
    }
    return guard(() => task(parsed.data));
  };
}

/** Keep the scheme and port, drop the address: the report is meant to be shared. */
function redactHost(url: string | null): string {
  if (!url) return "-";
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//<tv>:${parsed.port || "(default)"}`;
  } catch {
    return "(unparseable)";
  }
}

export function registerTvHandlers(
  tv: TvConnectionManager,
  settings: SettingsRepository,
  userDataDir: string,
  getWindows: () => BrowserWindow[],
): void {
  let lastRecordingDir: string | null = null;
  const secrets = new SecretStore(userDataDir);
  void secrets.retain(settings.get().snippets.map((snippet) => snippet.id));

  // OS-level shortcuts are opt-in and only registered while enabled.
  const shortcuts = new GlobalShortcutManager(
    (command) => {
      void tv.runCommand(command).catch(() => undefined);
    },
    () => sendClipboardToTv(),
  );

  /** Ctrl+Alt+V and the tray both drop the clipboard into the focused TV field. */
  function sendClipboardToTv(): void {
    const text = clipboardText();
    if (!text) return;
    void tv.insertText(text).catch(() => undefined);
  }
  if (settings.get().globalShortcuts) shortcuts.enable();
  app.on("will-quit", () => shortcuts.disable());
  tv.on("snapshot", (snapshot: TvSnapshot) => {
    for (const window of getWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.stateChanged, snapshot);
    }
  });

  ipcMain.handle(
    CHANNELS.connect,
    validated(connectSchema, async (config: PublicTvConfig) => {
      await settings.update({
        host: config.host,
        ...(config.mac ? { mac: config.mac } : {}),
        ...(config.driverId ? { driverId: config.driverId } : {}),
      });
      await tv.connect(config);
    }),
  );

  ipcMain.handle(CHANNELS.disconnect, () => guard(() => tv.disconnect()));
  ipcMain.handle(CHANNELS.wake, () => guard(() => tv.wake()));

  ipcMain.handle(
    CHANNELS.command,
    validated(commandSchema, (command) => tv.runCommand(command as TvCommand)),
  );

  ipcMain.handle(
    CHANNELS.insertText,
    validated(insertTextSchema, ({ text, replace }) => tv.insertText(text, replace ?? false)),
  );

  ipcMain.handle(
    CHANNELS.deleteCharacters,
    validated(deleteCharactersSchema, ({ count }) => tv.deleteCharacters(count)),
  );

  ipcMain.handle(CHANNELS.sendEnter, () => guard(() => tv.sendEnter()));
  ipcMain.handle(CHANNELS.listApps, () => guard<TvApp[]>(() => tv.listApps()));
  ipcMain.handle(CHANNELS.listInputs, () => guard<TvInput[]>(() => tv.listInputs()));
  ipcMain.handle(CHANNELS.snapshot, () => tv.getSnapshot());
  ipcMain.handle(CHANNELS.settingsGet, () => settings.get());

  ipcMain.handle(
    CHANNELS.settingsUpdate,
    validated(settingsPatchSchema, (patch) => settings.update(patch as Partial<AppSettings>)),
  );

  ipcMain.handle(
    CHANNELS.openYouTube,
    validated(youtubeSchema, async ({ input }) => {
      const target = normaliseYouTubeInput(input);
      if (!target) throw new Error("Enter a YouTube URL, video id, or search text.");
      await tv.runCommand({
        kind: "launchApp",
        appId: YOUTUBE_APP_ID,
        contentTarget: target.contentTarget,
      });
      return target.kind;
    }),
  );

  ipcMain.handle(CHANNELS.forgetPairing, () =>
    guard(async () => {
      await tv.disconnect();
      const dir = path.join(userDataDir, "pairing");
      await fs.rm(dir, { recursive: true, force: true });
      await settings.update({ mac: "" });
    }),
  );

  ipcMain.handle(CHANNELS.discover, () => guard<DiscoveredTv[]>(() => discoverTvs()));

  ipcMain.handle(CHANNELS.listTypes, () =>
    listDrivers().map(
      (driver): TvTypeInfo => ({
        id: driver.id,
        name: driver.name,
        summary: driver.summary,
        setupHint: driver.setupHint,
        implemented: driver.implemented,
        features: driver.features as unknown as Record<string, boolean>,
      }),
    ),
  );

  ipcMain.handle(
    CHANNELS.globalShortcuts,
    validated(globalShortcutSchema, async ({ enabled }) => {
      await settings.update({ globalShortcuts: enabled });
      const registered = enabled ? shortcuts.enable() : (shortcuts.disable(), []);
      return { registered, available: GlobalShortcutManager.describe() };
    }),
  );

  // --------------------------------------------------------------- streaming
  //
  // Playing a local file needs the TV to fetch it over HTTP, so this is the one
  // place the app opens a listening socket. It is bound to the interface facing
  // the TV, answers only the TV's address, and stops when playback stops.
  const stream = new StreamManager(path.join(userDataDir, "stream-cache"));
  stream.on("status", (status: StreamStatus) => {
    for (const window of getWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.streamChanged, status);
    }
  });
  app.on("before-quit", () => void stream.stop());

  ipcMain.handle(CHANNELS.streamStatus, () => stream.getStatus());

  ipcMain.handle(CHANNELS.streamPick, (event) =>
    guard(async () => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const choice = await dialog.showOpenDialog(window!, {
        title: "Choose something to play on the TV",
        properties: ["openFile"],
        filters: [
          { name: "Video", extensions: ["mp4", "mkv", "avi", "mov", "m4v", "ts", "m2ts", "mpg", "mpeg", "wmv", "webm", "flv"] },
          { name: "Audio", extensions: ["mp3", "flac", "m4a", "aac", "wav", "ogg"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (choice.canceled || choice.filePaths.length === 0) return null;
      return stream.analyse(choice.filePaths[0]);
    }),
  );

  ipcMain.handle(
    CHANNELS.streamAnalyse,
    validated(streamFileSchema, ({ file }) => stream.analyse(file) as Promise<MediaInfo>),
  );

  ipcMain.handle(
    CHANNELS.streamStart,
    validated(streamFileSchema, ({ file }) => {
      const host = tv.getSnapshot().host ?? settings.get().host;
      if (!host) throw new Error("Connect to a TV first.");
      return stream.start(host, file);
    }),
  );

  ipcMain.handle(CHANNELS.streamPause, () => guard(() => stream.pause()));
  ipcMain.handle(CHANNELS.streamResume, () => guard(() => stream.resume()));
  ipcMain.handle(CHANNELS.streamStop, () => guard(() => stream.stop()));
  ipcMain.handle(
    CHANNELS.streamSeek,
    validated(streamSeekSchema, ({ seconds }) => stream.seek(seconds)),
  );

  // ------------------------------------------------------------- snippets
  //
  // A secret snippet's text lives only in the encrypted store; it is resolved
  // and typed inside the main process and never crosses to the renderer.
  ipcMain.handle(CHANNELS.secretsAvailable, () => SecretStore.available());

  ipcMain.handle(
    CHANNELS.snippetAdd,
    validated(snippetAddSchema, async ({ label, value, secret }) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (secret) await secrets.set(id, value);
      const snippet: Snippet = { id, label, secret, value: secret ? undefined : value };
      const current = settings.get().snippets;
      await settings.update({ snippets: [...current, snippet] });
      return snippet;
    }),
  );

  ipcMain.handle(
    CHANNELS.snippetRemove,
    validated(snippetIdSchema, async ({ id }) => {
      await settings.update({ snippets: settings.get().snippets.filter((entry) => entry.id !== id) });
      await secrets.remove(id);
    }),
  );

  ipcMain.handle(
    CHANNELS.snippetSend,
    validated(snippetSendSchema, async (options) => {
      const snippet = settings.get().snippets.find((entry) => entry.id === options.id);
      if (!snippet) throw new Error("That snippet no longer exists.");
      const value = snippet.secret ? await secrets.get(snippet.id) : (snippet.value ?? "");
      if (!value) {
        throw new Error("That snippet could not be unlocked. It may have been saved under a different keyring.");
      }

      switch (options.route) {
        case "youtube":
          await tv.openDeepLink(YOUTUBE_APP_ID, `q=${encodeURIComponent(value)}`);
          return;
        case "osk":
          await tv.typeOnScreenKeyboard({
            layoutId: options.layoutId ?? settings.get().oskLayoutId,
            text: value,
            delayMs: options.delayMs ?? settings.get().oskDelayMs,
            fromHome: true,
            startLayer: options.startLayer ?? settings.get().oskLayer,
            submit: options.submit,
          });
          return;
        default:
          await tv.insertText(value);
          if (options.submit) await tv.sendEnter();
      }
    }),
  );

  ipcMain.handle(
    CHANNELS.runScene,
    validated(sceneSchema, (scene) => tv.runScene(scene.steps as TvCommand[])),
  );

  ipcMain.handle(
    CHANNELS.sleepTimer,
    // Date.now() lives here so the TV layer stays deterministic for tests.
    validated(sleepTimerSchema, ({ minutes }) => tv.setSleepTimer(minutes, Date.now())),
  );

  ipcMain.handle(
    CHANNELS.exportGif,
    validated(gifSchema, async ({ frameDir, fps }) => {
      // Only ever inside our own captures directory.
      const root = path.resolve(userDataDir, "captures");
      const target = path.resolve(frameDir);
      if (!target.startsWith(root + path.sep)) throw new Error("That folder is not one of this app's recordings.");
      const gif = await encodeGif(target, fps ?? 2);
      if (!gif) throw new Error("ffmpeg is not installed, so a GIF could not be made.");
      return gif;
    }),
  );

  ipcMain.handle(CHANNELS.diagnostics, () => {
    const snapshot = tv.getSnapshot();
    const current = settings.get();
    // Deliberately excludes hosts, MACs, snippets and anything else identifying.
    return [
      `app ${app.getVersion()} · electron ${process.versions.electron} · node ${process.versions.node}`,
      `platform ${process.platform} ${process.arch}`,
      `driver ${snapshot.driverId} (${snapshot.driverName})`,
      `state ${snapshot.state} · transport ${redactHost(snapshot.transport)}`,
      `model ${snapshot.modelName ?? "unknown"} · firmware ${snapshot.firmwareVersion ?? "unknown"}`,
      `pointer socket ${snapshot.pointerSocketReady ? "open" : "closed"} · keyboard focus ${String(snapshot.keyboardFocus)}`,
      `power ${snapshot.powerState ?? "unknown"} · foreground ${snapshot.foregroundAppId ?? "-"}`,
      `capabilities ${JSON.stringify(snapshot.capabilities)}`,
      `osk layout ${current.oskLayoutId} · page ${current.oskLayer} · delay ${current.oskDelayMs}ms`,
      `ok mode ${current.okMode} · shortcuts ${current.shortcutsEnabled} · global ${current.globalShortcuts}`,
      `last command ${snapshot.lastCommand ?? "-"}`,
      `last error ${snapshot.lastError ?? "-"}`,
      `global shortcut chords ${Shortcuts.describe().map((entry) => entry.accelerator).join(", ")}`,
    ].join("\n");
  });

  ipcMain.handle(CHANNELS.oskLayouts, () =>
    LAYOUTS.map(
      (layout): OskLayoutInfo => ({
        id: layout.id,
        name: layout.name,
        where: layout.where,
        baseLayer: layout.baseLayer,
        layers: layout.layers.map((layer) => ({ id: layer.id, label: LAYER_LABELS[layer.id] ?? layer.id })),
      }),
    ),
  );

  ipcMain.handle(
    CHANNELS.oskType,
    validated(oskTypeSchema, async (options) => {
      const endedOn = await tv.typeOnScreenKeyboard(options);
      // The page cannot be read from the TV, so remember where we left it.
      await settings.update({ oskLayer: endedOn });
      return endedOn;
    }),
  );

  ipcMain.on(CHANNELS.oskCancel, () => tv.cancelOnScreenKeyboard());

  ipcMain.handle(
    CHANNELS.oskLearnPage,
    validated(oskLearnSchema, ({ layoutId, layer }) => tv.learnKeyboardPage(layoutId, layer)),
  );

  ipcMain.handle(
    CHANNELS.oskDetectPage,
    validated(oskLayoutIdSchema, ({ layoutId }) => tv.detectKeyboardPage(layoutId)),
  );

  ipcMain.handle(
    CHANNELS.oskVerify,
    validated(verifySchema, ({ expected }) => tv.verifyTyped(expected)),
  );

  ipcMain.handle(
    CHANNELS.oskKnownPages,
    validated(oskLayoutIdSchema, ({ layoutId }) => tv.knownKeyboardPages(layoutId)),
  );

  ipcMain.handle(CHANNELS.capture, () => guard<CaptureResult>(() => tv.captureScreen()));

  ipcMain.handle(CHANNELS.saveCapture, (event) =>
    guard(async () => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const defaultPath = path.join(app.getPath("pictures"), `lg-tv-${stamp}.jpg`);
      const choice = window
        ? await dialog.showSaveDialog(window, { defaultPath, filters: [{ name: "JPEG image", extensions: ["jpg"] }] })
        : { canceled: false, filePath: defaultPath };
      if (choice.canceled || !choice.filePath) return "";
      return tv.saveCapture(choice.filePath);
    }),
  );

  ipcMain.handle(
    CHANNELS.startRecording,
    validated(recordingSchema, ({ fps }) => {
      // Date.now() lives here so the TV layer stays deterministic for tests.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      return tv.startRecording(fps, stamp);
    }),
  );

  ipcMain.handle(
    CHANNELS.stopRecording,
    validated(recordingSchema, async ({ fps }) => {
      const result = (await tv.stopRecording(fps)) as RecordingResult;
      lastRecordingDir = result.frameDir;
      return result;
    }),
  );

  ipcMain.handle(
    CHANNELS.openPath,
    validated(openPathSchema, async ({ target }) => {
      const dir = target === "captures" ? path.join(userDataDir, "captures") : lastRecordingDir;
      if (!dir) throw new Error("Nothing has been recorded yet.");
      await fs.mkdir(dir, { recursive: true });
      const error = await shell.openPath(dir);
      if (error) throw new Error(error);
      return dir;
    }),
  );

  // High-frequency, fire-and-forget: no response is sent back to the renderer.
  ipcMain.on(CHANNELS.pointerMove, (_event, raw) => {
    const parsed = pointerDeltaSchema.safeParse(raw);
    if (parsed.success) tv.pointerMove(parsed.data.dx, parsed.data.dy, parsed.data.dragging);
  });

  ipcMain.on(CHANNELS.pointerScroll, (_event, raw) => {
    const parsed = pointerDeltaSchema.safeParse(raw);
    if (parsed.success) tv.pointerScroll(parsed.data.dx, parsed.data.dy);
  });

  ipcMain.on(CHANNELS.pointerClick, () => tv.pointerClick());
}
