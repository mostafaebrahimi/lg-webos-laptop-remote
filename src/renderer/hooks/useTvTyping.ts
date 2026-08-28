import { useCallback, useMemo } from "react";
import { YOUTUBE_APP_ID } from "@shared/types";
import type { TvStateApi } from "./useTvState";

/**
 * How text reaches the TV. There is no single mechanism that works everywhere,
 * so the route is chosen from what the TV reports rather than asking the user
 * to know the difference.
 *
 * `ime`     - a webOS text widget has focus; text streams as you type.
 * `osk`     - the app draws its own keyboard (YouTube, Google sign-in); the only
 *             way in is to walk that grid with the D-pad.
 * `youtube` - YouTube is open with nothing focused; a search deep link is both
 *             faster and more reliable than typing.
 */
export type TypingRoute = "ime" | "osk" | "youtube";

export interface TypingPlan {
  route: TypingRoute;
  label: string;
  explanation: string;
  /** True when characters can be streamed as the user types. */
  live: boolean;
}

export function useTvTyping(tv: TvStateApi, override?: TypingRoute | "auto") {
  const { snapshot, settings } = tv;

  const auto: TypingRoute = useMemo(() => {
    if (snapshot.keyboardFocus === true) return "ime";
    if (snapshot.foregroundAppId === YOUTUBE_APP_ID) return "osk";
    return "ime";
  }, [snapshot.keyboardFocus, snapshot.foregroundAppId]);

  const route: TypingRoute = !override || override === "auto" ? auto : override;

  const plan: TypingPlan = useMemo(() => {
    switch (route) {
      case "ime":
        return {
          route,
          label: "TV text field",
          explanation:
            snapshot.keyboardFocus === true
              ? "A TV text field has focus — every keystroke goes straight to it."
              : "Sent to whatever TV text field has focus. If nothing is focused, the TV accepts and discards it.",
          live: true,
        };
      case "osk":
        return {
          route,
          label: "App keyboard",
          explanation:
            "This app draws its own keyboard, so text is typed by walking its grid with the D-pad. Press Enter to start.",
          live: false,
        };
      case "youtube":
        return {
          route,
          label: "YouTube search",
          explanation: "Sent to YouTube as a search deep link, which is the only reliable route into its search.",
          live: false,
        };
    }
  }, [route, snapshot.keyboardFocus]);

  /** Send the whole string by the active route. */
  const send = useCallback(
    async (text: string, options?: { submit?: boolean }) => {
      if (!text.trim()) return { ok: true as const, value: undefined };
      switch (route) {
        case "youtube":
          return tv.run(() => window.tvApi.openYouTube(text), `Searching YouTube for “${text.trim()}”`);
        case "osk":
          return tv.run(
            () =>
              window.tvApi.oskType({
                layoutId: settings.oskLayoutId,
                text,
                submit: options?.submit ?? false,
                delayMs: settings.oskDelayMs,
                fromHome: true,
                startLayer: settings.oskLayer,
              }),
            "Typed on the TV keyboard",
          );
        case "ime":
        default: {
          const result = await tv.run(() => window.tvApi.insertText(text));
          if (result.ok && options?.submit) await window.tvApi.sendEnter();
          return result;
        }
      }
    },
    [route, settings.oskLayoutId, settings.oskDelayMs, settings.oskLayer, tv],
  );

  return { route, plan, send, auto };
}
