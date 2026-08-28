import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  CaptureResult,
  DiscoveredTv,
  Scene,
  MediaInfo,
  Snippet,
  StreamStatus,
  OskLayoutInfo,
  RecordingResult,
  TvTypeInfo,
  PublicTvConfig,
  Result,
  TvApp,
  TvCommand,
  TvInput,
  TvSnapshot,
} from "@shared/types";
import { CHANNELS } from "@shared/channels";

/**
 * The only surface the renderer gets. No ipcRenderer, no raw SSAP request, no
 * filesystem, no lgtv2 object.
 */
const api = {
  connect: (config: PublicTvConfig): Promise<Result> => ipcRenderer.invoke(CHANNELS.connect, config),
  disconnect: (): Promise<Result> => ipcRenderer.invoke(CHANNELS.disconnect),
  wake: (): Promise<Result> => ipcRenderer.invoke(CHANNELS.wake),
  command: (command: TvCommand): Promise<Result> => ipcRenderer.invoke(CHANNELS.command, command),
  insertText: (text: string, replace = false): Promise<Result> =>
    ipcRenderer.invoke(CHANNELS.insertText, { text, replace }),
  deleteCharacters: (count: number): Promise<Result> =>
    ipcRenderer.invoke(CHANNELS.deleteCharacters, { count }),
  sendEnter: (): Promise<Result> => ipcRenderer.invoke(CHANNELS.sendEnter),
  listApps: (): Promise<Result<TvApp[]>> => ipcRenderer.invoke(CHANNELS.listApps),
  listInputs: (): Promise<Result<TvInput[]>> => ipcRenderer.invoke(CHANNELS.listInputs),
  openYouTube: (input: string): Promise<Result<"video" | "search">> =>
    ipcRenderer.invoke(CHANNELS.openYouTube, { input }),
  forgetPairing: (): Promise<Result> => ipcRenderer.invoke(CHANNELS.forgetPairing),
  getSnapshot: (): Promise<TvSnapshot> => ipcRenderer.invoke(CHANNELS.snapshot),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(CHANNELS.settingsGet),
  updateSettings: (patch: Partial<AppSettings>): Promise<Result<AppSettings>> =>
    ipcRenderer.invoke(CHANNELS.settingsUpdate, patch),

  discover: (): Promise<Result<DiscoveredTv[]>> => ipcRenderer.invoke(CHANNELS.discover),
  listTvTypes: (): Promise<TvTypeInfo[]> => ipcRenderer.invoke(CHANNELS.listTypes),
  setGlobalShortcuts: (
    enabled: boolean,
  ): Promise<Result<{ registered: string[]; available: Array<{ accelerator: string; label: string }> }>> =>
    ipcRenderer.invoke(CHANNELS.globalShortcuts, { enabled }),

  runScene: (scene: Scene): Promise<Result> => ipcRenderer.invoke(CHANNELS.runScene, scene),
  setSleepTimer: (minutes: number): Promise<Result> => ipcRenderer.invoke(CHANNELS.sleepTimer, { minutes }),
  getDiagnostics: (): Promise<string> => ipcRenderer.invoke(CHANNELS.diagnostics),
  exportGif: (frameDir: string, fps?: number): Promise<Result<string>> =>
    ipcRenderer.invoke(CHANNELS.exportGif, { frameDir, fps }),

  pickMedia: (): Promise<Result<MediaInfo | null>> => ipcRenderer.invoke(CHANNELS.streamPick),
  analyseMedia: (file: string): Promise<Result<MediaInfo>> => ipcRenderer.invoke(CHANNELS.streamAnalyse, { file }),
  streamStart: (file: string): Promise<Result> => ipcRenderer.invoke(CHANNELS.streamStart, { file }),
  streamPause: (): Promise<Result> => ipcRenderer.invoke(CHANNELS.streamPause),
  streamResume: (): Promise<Result> => ipcRenderer.invoke(CHANNELS.streamResume),
  streamSeek: (seconds: number): Promise<Result> => ipcRenderer.invoke(CHANNELS.streamSeek, { seconds }),
  streamStop: (): Promise<Result> => ipcRenderer.invoke(CHANNELS.streamStop),
  getStreamStatus: (): Promise<StreamStatus> => ipcRenderer.invoke(CHANNELS.streamStatus),
  onStreamChanged: (listener: (status: StreamStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: StreamStatus) => listener(status);
    ipcRenderer.on(CHANNELS.streamChanged, handler);
    return () => ipcRenderer.removeListener(CHANNELS.streamChanged, handler);
  },

  secretsAvailable: (): Promise<boolean> => ipcRenderer.invoke(CHANNELS.secretsAvailable),
  addSnippet: (label: string, value: string, secret: boolean): Promise<Result<Snippet>> =>
    ipcRenderer.invoke(CHANNELS.snippetAdd, { label, value, secret }),
  removeSnippet: (id: string): Promise<Result> => ipcRenderer.invoke(CHANNELS.snippetRemove, { id }),
  sendSnippet: (options: {
    id: string;
    route: "ime" | "osk" | "youtube";
    layoutId?: string;
    delayMs?: number;
    startLayer?: string;
    submit?: boolean;
  }): Promise<Result> => ipcRenderer.invoke(CHANNELS.snippetSend, options),

  oskLayouts: (): Promise<OskLayoutInfo[]> => ipcRenderer.invoke(CHANNELS.oskLayouts),
  oskType: (options: {
    layoutId: string;
    text: string;
    submit?: boolean;
    delayMs?: number;
    fromHome?: boolean;
    startLayer?: string;
  }): Promise<Result<string>> => ipcRenderer.invoke(CHANNELS.oskType, options),
  oskCancel: (): void => ipcRenderer.send(CHANNELS.oskCancel),
  oskLearnPage: (layoutId: string, layer: string): Promise<Result> =>
    ipcRenderer.invoke(CHANNELS.oskLearnPage, { layoutId, layer }),
  oskDetectPage: (layoutId: string): Promise<Result<{ layer: string; confident: boolean } | null>> =>
    ipcRenderer.invoke(CHANNELS.oskDetectPage, { layoutId }),
  oskVerify: (
    expected: string,
  ): Promise<Result<{ dataUrl: string; matched: boolean | null; readText?: string }>> =>
    ipcRenderer.invoke(CHANNELS.oskVerify, { expected }),
  oskKnownPages: (layoutId: string): Promise<Result<string[]>> =>
    ipcRenderer.invoke(CHANNELS.oskKnownPages, { layoutId }),

  captureScreen: (): Promise<Result<CaptureResult>> => ipcRenderer.invoke(CHANNELS.capture),
  saveCapture: (): Promise<Result<string>> => ipcRenderer.invoke(CHANNELS.saveCapture),
  startRecording: (fps: number): Promise<Result> => ipcRenderer.invoke(CHANNELS.startRecording, { fps }),
  stopRecording: (fps: number): Promise<Result<RecordingResult>> =>
    ipcRenderer.invoke(CHANNELS.stopRecording, { fps }),
  openCapturesFolder: (target: "captures" | "lastRecording"): Promise<Result<string>> =>
    ipcRenderer.invoke(CHANNELS.openPath, { target }),

  pointerMove: (dx: number, dy: number, dragging = false): void =>
    ipcRenderer.send(CHANNELS.pointerMove, { dx, dy, dragging }),
  pointerScroll: (dx: number, dy: number): void => ipcRenderer.send(CHANNELS.pointerScroll, { dx, dy }),
  pointerClick: (): void => ipcRenderer.send(CHANNELS.pointerClick),

  onStateChanged: (listener: (snapshot: TvSnapshot) => void): (() => void) => {
    const handler = (_event: unknown, snapshot: TvSnapshot) => listener(snapshot);
    ipcRenderer.on(CHANNELS.stateChanged, handler);
    return () => ipcRenderer.removeListener(CHANNELS.stateChanged, handler);
  },
};

contextBridge.exposeInMainWorld("tvApi", api);

export type TvDesktopApi = typeof api;
