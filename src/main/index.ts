import path from "node:path";
import { app, BrowserWindow, nativeImage, shell, session } from "electron";
import { TvConnectionManager } from "./tv/TvConnectionManager";
import { SettingsRepository } from "./settings/SettingsRepository";
import { registerTvHandlers } from "./ipc/registerTvHandlers";
import { clipboardText, focusWindow, TrayController } from "./TrayController";
import type { TvSnapshot } from "@shared/types";

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let settings: SettingsRepository;
let tv: TvConnectionManager;
let tray: TrayController | null = null;

/** Icon file on disk; packaged builds carry it next to the resources. */
function iconFile(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "../../build/icon.png");
}

/** Window/taskbar icon. Packaged builds get theirs from electron-builder. */
function appIcon(): Electron.NativeImage | undefined {
  const image = nativeImage.createFromPath(iconFile());
  return image.isEmpty() ? undefined : image;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#0f1115",
    show: false,
    autoHideMenuBar: true,
    title: "LG webOS Laptop Remote",
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // The renderer only ever shows local content; anything else opens in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  // The renderer may only load local content. The single exception is images: app
  // icons come over plain http from the TV itself. In dev the Vite server is
  // allowed as well, otherwise HMR resources would be blocked.
  const devOrigin = process.env.ELECTRON_RENDERER_URL;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    const allowed =
      /^(devtools|file|blob|data):/.test(details.url) ||
      details.resourceType === "image" ||
      (isDev && devOrigin !== undefined && details.url.startsWith(devOrigin));
    callback({ cancel: !allowed });
  });

  settings = new SettingsRepository(app.getPath("userData"));
  await settings.load();

  tv = new TvConnectionManager(app.getPath("userData"), () => settings.get());
  registerTvHandlers(tv, settings, app.getPath("userData"), () => BrowserWindow.getAllWindows());

  createWindow();

  // Tray: volume, transport and clipboard without opening the window.
  tray = new TrayController(
    iconFile(),
    (command) => void tv.runCommand(command).catch(() => undefined),
    () => focusWindow(mainWindow),
    () => {
      const text = clipboardText();
      if (text) void tv.insertText(text).catch(() => undefined);
    },
  );
  tray.start();
  tv.on("snapshot", (snapshot: TvSnapshot) => tray?.update(snapshot));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void tv?.disconnect().finally(() => {
    if (process.platform !== "darwin") app.quit();
  });
});

app.on("before-quit", () => {
  tray?.dispose();
  void tv?.disconnect();
});
