import { useCallback, useEffect, useState } from "react";
import type { AppSettings, Result, TvSnapshot } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/types";

const EMPTY: TvSnapshot = {
  state: "disconnected",
  statusMessage: "Not connected",
  driverId: "webos",
  driverName: "LG (webOS)",
  features: {},
  host: null,
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

export function useTvState() {
  const [snapshot, setSnapshot] = useState<TvSnapshot>(EMPTY);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void window.tvApi.getSnapshot().then(setSnapshot);
    void window.tvApi.getSettings().then(setSettings);
    return window.tvApi.onStateChanged(setSnapshot);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const result = await window.tvApi.updateSettings(patch);
    if (result.ok) setSettings(result.value);
    else setToast(result.error);
    return result;
  }, []);

  /** Runs an API call and surfaces its failure as a toast. */
  const run = useCallback(async <T,>(task: () => Promise<Result<T>>, successMessage?: string) => {
    const result = await task();
    if (!result.ok) setToast(result.error);
    else if (successMessage) setToast(successMessage);
    return result;
  }, []);

  const connected = snapshot.state === "connected";

  return { snapshot, settings, saveSettings, toast, setToast, run, connected };
}

export type TvStateApi = ReturnType<typeof useTvState>;
