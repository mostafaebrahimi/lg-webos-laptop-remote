import { useEffect, useRef } from "react";
import type { TvCommand } from "@shared/types";

export interface KeyboardOptions {
  enabled: boolean;
  repeatMs: number;
  volumeStep: number;
  experimentalButtons: boolean;
  send: (command: TvCommand) => void;
}

/** Keys that may auto-repeat while held. Everything else fires once per press. */
const REPEATABLE = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Equal",
  "Minus",
  "NumpadAdd",
  "NumpadSubtract",
]);

/** True when the event came from a field the user is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return element.isContentEditable === true;
}

/** Maps a physical key (event.code) to a TV command. */
export function mapKeyToCommand(
  code: string,
  options: { volumeStep: number; experimentalButtons: boolean },
): TvCommand | null {
  switch (code) {
    case "ArrowUp":
      return { kind: "button", button: "UP" };
    case "ArrowDown":
      return { kind: "button", button: "DOWN" };
    case "ArrowLeft":
      return { kind: "button", button: "LEFT" };
    case "ArrowRight":
      return { kind: "button", button: "RIGHT" };
    case "Enter":
    case "NumpadEnter":
      // Resolved in the main process according to the OK mode setting.
      // Space is deliberately not mapped: it must stay a literal space for typing.
      return { kind: "ok" };
    case "Escape":
      // Backspace is deliberately NOT mapped: it must delete characters while
      // typing. Escape is the only Back shortcut.
      return { kind: "button", button: "BACK" };
    case "Home":
    case "KeyH":
      return { kind: "button", button: "HOME" };
    case "Equal":
    case "NumpadAdd":
      return { kind: "volumeUp" };
    case "Minus":
    case "NumpadSubtract":
      return { kind: "volumeDown" };
    case "PageUp":
      return { kind: "channelUp" };
    case "PageDown":
      return { kind: "channelDown" };
    case "KeyP":
      return { kind: "media", action: "play" };
    case "KeyK":
      return { kind: "media", action: "pause" };
    case "KeyX":
      return { kind: "media", action: "stop" };
    case "BracketLeft":
      return { kind: "media", action: "rewind" };
    case "BracketRight":
      return { kind: "media", action: "fastForward" };
    default:
      break;
  }

  if (options.experimentalButtons) {
    const digit = /^(Digit|Numpad)([0-9])$/.exec(code);
    if (digit) return { kind: "button", button: digit[2] as never };
    const colour: Record<string, string> = { F1: "RED", F2: "GREEN", F3: "YELLOW", F4: "BLUE" };
    if (colour[code]) return { kind: "button", button: colour[code] as never };
  }
  return null;
}

export function useRemoteKeyboard(options: KeyboardOptions): void {
  const lastFire = useRef<Map<string, number>>(new Map());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = optionsRef.current;
      if (!current.enabled) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;

      const command = mapKeyToCommand(event.code, {
        volumeStep: current.volumeStep,
        experimentalButtons: current.experimentalButtons,
      });
      if (!command) return;

      event.preventDefault();

      if (event.repeat && !REPEATABLE.has(event.code)) return;
      const now = Date.now();
      const previous = lastFire.current.get(event.code) ?? 0;
      if (event.repeat && now - previous < current.repeatMs) return;
      lastFire.current.set(event.code, now);

      current.send(command);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      lastFire.current.delete(event.code);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
