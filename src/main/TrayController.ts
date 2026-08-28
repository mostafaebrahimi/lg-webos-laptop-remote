import { app, BrowserWindow, clipboard, Menu, nativeImage, Tray } from "electron";
import type { TvCommand, TvSnapshot } from "@shared/types";

/**
 * Tray icon: volume, mute and transport without opening the window, plus the
 * connection state at a glance.
 */
export class TrayController {
  private tray: Tray | null = null;
  private snapshot: TvSnapshot | null = null;

  constructor(
    private readonly iconPath: string,
    private readonly run: (command: TvCommand) => void,
    private readonly show: () => void,
    private readonly sendClipboard: () => void,
  ) {}

  start(): void {
    if (this.tray) return;
    const image = nativeImage.createFromPath(this.iconPath);
    if (image.isEmpty()) return;

    this.tray = new Tray(image.resize({ width: 22, height: 22 }));
    this.tray.setToolTip("LG webOS Laptop Remote");
    this.tray.on("click", () => this.show());
    this.render();
  }

  update(snapshot: TvSnapshot): void {
    const before = this.snapshot;
    this.snapshot = snapshot;
    // Rebuilding the menu on every pointer event would be wasteful.
    if (
      !before ||
      before.state !== snapshot.state ||
      before.muted !== snapshot.muted ||
      before.volume !== snapshot.volume
    ) {
      this.render();
    }
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private render(): void {
    if (!this.tray) return;
    const snapshot = this.snapshot;
    const connected = snapshot?.state === "connected";

    this.tray.setToolTip(
      connected
        ? `LG Remote — connected${snapshot?.volume !== null && snapshot?.volume !== undefined ? `, volume ${snapshot.volume}` : ""}`
        : `LG Remote — ${snapshot?.state ?? "disconnected"}`,
    );

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: connected ? `Connected${snapshot?.modelName ? ` · ${snapshot.modelName}` : ""}` : `Not connected`, enabled: false },
        { type: "separator" },
        { label: "Volume up", enabled: connected, click: () => this.run({ kind: "volumeUp" }) },
        { label: "Volume down", enabled: connected, click: () => this.run({ kind: "volumeDown" }) },
        {
          label: snapshot?.muted ? "Unmute" : "Mute",
          enabled: connected,
          click: () => this.run({ kind: "setMute", mute: !snapshot?.muted }),
        },
        { type: "separator" },
        { label: "Play", enabled: connected, click: () => this.run({ kind: "media", action: "play" }) },
        { label: "Pause", enabled: connected, click: () => this.run({ kind: "media", action: "pause" }) },
        { type: "separator" },
        { label: "Send clipboard to TV", enabled: connected, click: () => this.sendClipboard() },
        { label: "Home", enabled: connected, click: () => this.run({ kind: "button", button: "HOME" }) },
        { label: "Power off", enabled: connected, click: () => this.run({ kind: "turnOff" }) },
        { type: "separator" },
        { label: "Open remote", click: () => this.show() },
        { label: "Quit", click: () => app.quit() },
      ]),
    );
  }
}

/** Clipboard text, trimmed to something a TV field can reasonably accept. */
export function clipboardText(): string {
  return clipboard.readText().trim().slice(0, 500);
}

export function focusWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
