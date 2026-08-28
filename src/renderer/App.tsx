import { useCallback, useState } from "react";
import type { TvCommand } from "@shared/types";
import { useTvState } from "./hooks/useTvState";
import { useRemoteKeyboard } from "./hooks/useRemoteKeyboard";
import ConnectionHeader from "./components/ConnectionHeader";
import RemoteControl from "./components/RemoteControl";
import TextInputPanel from "./components/TextInputPanel";
import AppsPanel from "./components/AppsPanel";
import DiagnosticsPanel from "./components/DiagnosticsPanel";
import SettingsPanel from "./components/SettingsPanel";
import LiveTypeBar from "./components/LiveTypeBar";
import ScreenPanel from "./components/ScreenPanel";
import CommandPalette from "./components/CommandPalette";
import StreamPanel from "./components/StreamPanel";

const TABS = ["Remote", "Text", "Apps", "Stream", "Screen", "Diagnostics", "Settings"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const tv = useTvState();
  const [tab, setTab] = useState<Tab>("Remote");

  const send = useCallback(
    (command: TvCommand) => {
      void tv.run(() => window.tvApi.command(command));
    },
    [tv],
  );

  useRemoteKeyboard({
    enabled: tv.settings.shortcutsEnabled && tv.connected,
    repeatMs: tv.settings.keyRepeatMs,
    volumeStep: tv.settings.volumeStep,
    experimentalButtons: tv.settings.experimentalButtons,
    send,
  });

  return (
    <div className="app">
      <ConnectionHeader tv={tv} />

      <nav className="tabs">
        {TABS.map((name) => (
          <button key={name} className={`tab ${tab === name ? "tab-active" : ""}`} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>

      <LiveTypeBar tv={tv} />

      <main className="content">
        {tab === "Remote" && <RemoteControl tv={tv} send={send} />}
        {tab === "Text" && <TextInputPanel tv={tv} />}
        {tab === "Apps" && <AppsPanel tv={tv} />}
        {tab === "Stream" && <StreamPanel tv={tv} />}
        {tab === "Screen" && <ScreenPanel tv={tv} />}
        {tab === "Diagnostics" && <DiagnosticsPanel tv={tv} />}
        {tab === "Settings" && <SettingsPanel tv={tv} />}
      </main>

      <CommandPalette tv={tv} send={send} />

      {tv.toast && (
        <div className="toast" role="status" onClick={() => tv.setToast(null)}>
          {tv.toast}
        </div>
      )}
    </div>
  );
}
