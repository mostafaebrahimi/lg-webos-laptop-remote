import { globalShortcut } from "electron";
import type { TvCommand } from "@shared/types";

/** Chords that do something other than send a single command. */
export const CLIPBOARD_ACCELERATOR = "CommandOrControl+Alt+V";

/**
 * Opt-in OS-level shortcuts, so the TV can be controlled while the window is in
 * the background. Only conflict-resistant chords and media keys are registered -
 * never plain letters, digits, arrows, Escape or Backspace.
 */
const BINDINGS: Array<{ accelerator: string; command: TvCommand; label: string }> = [
  { accelerator: "MediaPlayPause", command: { kind: "media", action: "play" }, label: "Play/Pause" },
  { accelerator: "MediaStop", command: { kind: "media", action: "stop" }, label: "Stop" },
  { accelerator: "MediaNextTrack", command: { kind: "media", action: "fastForward" }, label: "Fast-forward" },
  { accelerator: "MediaPreviousTrack", command: { kind: "media", action: "rewind" }, label: "Rewind" },
  { accelerator: "CommandOrControl+Alt+Up", command: { kind: "volumeUp" }, label: "Volume up" },
  { accelerator: "CommandOrControl+Alt+Down", command: { kind: "volumeDown" }, label: "Volume down" },
  { accelerator: "CommandOrControl+Alt+Left", command: { kind: "button", button: "LEFT" }, label: "Left" },
  { accelerator: "CommandOrControl+Alt+Right", command: { kind: "button", button: "RIGHT" }, label: "Right" },
];

export class GlobalShortcutManager {
  private registered: string[] = [];

  constructor(
    private readonly run: (command: TvCommand) => void,
    private readonly sendClipboard?: () => void,
  ) {}

  /** Returns the accelerators that could actually be claimed from the OS. */
  enable(): string[] {
    this.disable();
    for (const binding of BINDINGS) {
      try {
        if (globalShortcut.register(binding.accelerator, () => this.run(binding.command))) {
          this.registered.push(binding.accelerator);
        }
      } catch {
        // Another application already owns this chord; skip it silently.
      }
    }
    if (this.sendClipboard) {
      try {
        if (globalShortcut.register(CLIPBOARD_ACCELERATOR, () => this.sendClipboard?.())) {
          this.registered.push(CLIPBOARD_ACCELERATOR);
        }
      } catch {
        // Already owned by another application.
      }
    }
    return [...this.registered];
  }

  disable(): void {
    for (const accelerator of this.registered) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        /* nothing to undo */
      }
    }
    this.registered = [];
  }

  static describe(): Array<{ accelerator: string; label: string }> {
    return [
      ...BINDINGS.map(({ accelerator, label }) => ({ accelerator, label })),
      { accelerator: CLIPBOARD_ACCELERATOR, label: "Send clipboard to the TV" },
    ];
  }
}
