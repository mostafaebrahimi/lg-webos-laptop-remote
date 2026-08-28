import { useEffect, useState } from "react";
import type { TvTypeInfo } from "@shared/types";
import type { TvStateApi } from "../hooks/useTvState";

const FEATURE_LABELS: Record<string, string> = {
  pointer: "Pointer / trackpad",
  textInput: "Text input",
  textFocusReporting: "Reports text focus",
  apps: "App list",
  inputs: "Input switching",
  channels: "Channels",
  media: "Media controls",
  volumeLevel: "Volume level",
  screenPower: "Screen on/off",
  capture: "Screen capture",
  wakeOnLan: "Wake-on-LAN",
  appDeepLinks: "App deep links",
};

export default function SettingsPanel({ tv }: { tv: TvStateApi }) {
  const { settings, saveSettings, snapshot, run } = tv;
  const [mac, setMac] = useState(settings.mac);
  const [types, setTypes] = useState<TvTypeInfo[]>([]);
  const [registered, setRegistered] = useState<string[]>([]);

  useEffect(() => setMac(settings.mac), [settings.mac]);
  useEffect(() => {
    void window.tvApi.listTvTypes().then(setTypes);
  }, []);

  const activeType = types.find((type) => type.id === (snapshot.driverId || settings.driverId));

  return (
    <div className="panel-grid">
      <section className="card card-wide">
        <h2>Keyboard</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.shortcutsEnabled}
            onChange={(event) => void saveSettings({ shortcutsEnabled: event.target.checked })}
          />
          Laptop keyboard shortcuts (window focused, outside text fields)
        </label>
        <label className="field">
          Key repeat interval: {settings.keyRepeatMs} ms
          <input
            type="range"
            min={40}
            max={400}
            step={10}
            value={settings.keyRepeatMs}
            onChange={(event) => void saveSettings({ keyRepeatMs: Number(event.target.value) })}
          />
        </label>
        <fieldset className="okmode">
          <legend>What the OK key sends (Enter, Numpad Enter, and the on-screen OK button)</legend>
          {(
            [
              ["enter", "ENTER button", "Activates the item the TV has highlighted. Correct for arrow-key navigation."],
              ["click", "Pointer click", "Clicks at the magic-remote cursor position, not the highlighted item."],
              ["both", "ENTER, then a click", "Fallback for models that ignore one of the two. May activate twice."],
            ] as const
          ).map(([value, label, description]) => (
            <label key={value} className="radio">
              <input
                type="radio"
                name="okMode"
                checked={settings.okMode === value}
                onChange={() => void saveSettings({ okMode: value })}
              />
              <span>
                <strong>{label}</strong>
                <span className="muted"> — {description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.experimentalButtons}
            onChange={(event) => void saveSettings({ experimentalButtons: event.target.checked })}
          />
          Enable experimental buttons (number keys, colour keys, MENU/INFO/EXIT) — firmware dependent
        </label>
      </section>

      <section className="card card-wide">
        <h2>Global shortcuts</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.globalShortcuts}
            onChange={async (event) => {
              const result = await run(() => window.tvApi.setGlobalShortcuts(event.target.checked));
              if (result.ok) setRegistered(result.value.registered);
            }}
          />
          Control the TV while this window is in the background
        </label>
        <p className="hint">
          Media keys, plus Ctrl+Alt+Arrows for volume and left/right. Only conflict-resistant chords are claimed —
          never plain letters, digits, Escape or Backspace. Some chords may already belong to another application;
          those are skipped.
          {registered.length > 0 && ` Claimed: ${registered.join(", ")}.`}
        </p>
      </section>

      <section className="card card-wide">
        <h2>TV type</h2>
        <p className="hint">
          The protocol layer is pluggable: each brand is one driver behind a common interface, so adding another
          kind of TV does not touch the rest of the app.
        </p>
        <div className="type-list">
          {types.map((type) => (
            <div key={type.id} className={`type-row ${type.id === (snapshot.driverId || settings.driverId) ? "type-row-active" : ""}`}>
              <div>
                <strong>{type.name}</strong>
                {!type.implemented && <span className="pill pill-warn">not implemented</span>}
                <div className="muted">{type.summary}</div>
                <div className="muted">{type.setupHint}</div>
              </div>
            </div>
          ))}
        </div>

        {activeType && (
          <>
            <h3>What {activeType.name} supports</h3>
            <div className="row wrap">
              {Object.entries(activeType.features).map(([key, supported]) => (
                <span key={key} className={`pill ${supported ? "pill-ok" : "pill-muted"}`}>
                  {supported ? "✓" : "✕"} {FEATURE_LABELS[key] ?? key}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card card-wide">
        <h2>Pointer</h2>
        <p className="hint">
          Speed, scroll speed and scroll direction live on the Remote tab next to the trackpad itself. Pointer
          position is relative — webOS does not expose absolute cursor coordinates — and right-click is mapped to
          Back, because webOS has no native right-click.
        </p>
      </section>

      <section className="card card-wide">
        <h2>Wake-on-LAN</h2>
        <label className="field">
          TV MAC address
          <div className="row">
            <input
              className="grow"
              value={mac}
              placeholder="24:e8:53:11:22:33"
              spellCheck={false}
              onChange={(event) => setMac(event.target.value)}
            />
            <button className="btn" onClick={() => void saveSettings({ mac: mac.trim() })}>
              Save
            </button>
          </div>
        </label>
        <p className="hint">
          Learned automatically after pairing where the TV reports it{snapshot.mac ? ` (currently ${snapshot.mac})` : ""}.
          Enable the TV setting named <em>Mobile TV On</em>, <em>Turn on via Wi-Fi</em> or <em>Wake on LAN</em> under
          General → Devices → TV Management (or Connection settings) — otherwise power-on cannot work. Wired
          Ethernet is the most reliable; Wi-Fi wake works only when the TV supports it.
        </p>
      </section>

      <section className="card card-wide">
        <h2>What this app cannot do</h2>
        <ul className="limits">
          <li>webOS has no universal PC-keyboard passthrough. Keys are mapped to remote actions, not forwarded.</li>
          <li>Text only reaches the TV while one of its own input widgets is focused.</li>
          <li>There is no absolute cursor positioning and no native right-click.</li>
          <li>Number keys, colour keys and MENU/INFO/EXIT depend on the firmware version.</li>
          <li>Power-on requires Wake-on-LAN; a powered-down TV cannot accept commands.</li>
        </ul>
      </section>
    </div>
  );
}
