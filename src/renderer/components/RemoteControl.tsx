import { useState } from "react";
import type { Scene, TvCommand } from "@shared/types";
import type { TvStateApi } from "../hooks/useTvState";
import PointerPad from "./PointerPad";
import ShortcutHelp from "./ShortcutHelp";

interface Props {
  tv: TvStateApi;
  send: (command: TvCommand) => void;
}

const SLEEP_CHOICES = [15, 30, 60, 90, 120];

export default function RemoteControl({ tv, send }: Props) {
  const { snapshot, connected, settings, run } = tv;
  const volume = snapshot.volume ?? 0;

  return (
    <div className="remote-grid">
      <section className="card">
        <h2>Navigation</h2>
        <div className="dpad">
          <button className="dpad-up" disabled={!connected} onClick={() => send({ kind: "button", button: "UP" })}>
            ▲
          </button>
          <button className="dpad-left" disabled={!connected} onClick={() => send({ kind: "button", button: "LEFT" })}>
            ◀
          </button>
          <button className="dpad-ok" disabled={!connected} onClick={() => send({ kind: "ok" })}>
            OK
          </button>
          <button className="dpad-right" disabled={!connected} onClick={() => send({ kind: "button", button: "RIGHT" })}>
            ▶
          </button>
          <button className="dpad-down" disabled={!connected} onClick={() => send({ kind: "button", button: "DOWN" })}>
            ▼
          </button>
        </div>
        <div className="row">
          <button className="btn grow" disabled={!connected} onClick={() => send({ kind: "button", button: "HOME" })}>
            Home
          </button>
          <button className="btn grow" disabled={!connected} onClick={() => send({ kind: "button", button: "BACK" })}>
            Back
          </button>
        </div>
      </section>

      <section className="card">
        <h2>
          Volume
          <span className="volume-value">{snapshot.volume ?? "–"}</span>
        </h2>
        <input
          type="range"
          min={0}
          max={100}
          step={settings.volumeStep}
          value={volume}
          disabled={!connected}
          onChange={(event) => send({ kind: "setVolume", volume: Number(event.target.value) })}
        />
        <div className="row">
          <button className="btn grow" disabled={!connected} onClick={() => send({ kind: "volumeDown" })}>
            −
          </button>
          <button className="btn grow" disabled={!connected} onClick={() => send({ kind: "volumeUp" })}>
            +
          </button>
          <button
            className={`btn grow ${snapshot.muted ? "btn-active" : ""}`}
            disabled={!connected}
            onClick={() => send({ kind: "setMute", mute: !snapshot.muted })}
          >
            {snapshot.muted ? "Unmute" : "Mute"}
          </button>
        </div>
        <div className="row">
          <button className="btn grow" disabled={!connected} onClick={() => send({ kind: "channelDown" })}>
            Ch −
          </button>
          <button className="btn grow" disabled={!connected} onClick={() => send({ kind: "channelUp" })}>
            Ch +
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Media</h2>
        <div className="transport">
          <button className="btn" disabled={!connected} title="Rewind" onClick={() => send({ kind: "media", action: "rewind" })}>
            ◀◀
          </button>
          <button className="btn" disabled={!connected} title="Play" onClick={() => send({ kind: "media", action: "play" })}>
            ▶
          </button>
          <button className="btn" disabled={!connected} title="Pause" onClick={() => send({ kind: "media", action: "pause" })}>
            ❙❙
          </button>
          <button className="btn" disabled={!connected} title="Stop" onClick={() => send({ kind: "media", action: "stop" })}>
            ■
          </button>
          <button
            className="btn"
            disabled={!connected}
            title="Fast-forward"
            onClick={() => send({ kind: "media", action: "fastForward" })}
          >
            ▶▶
          </button>
        </div>
        <p className="hint">P play · K pause · X stop · [ rewind · ] fast-forward</p>
      </section>

      <section className="card">
        <h2>Power</h2>
        <div className="power-grid">
          <button className="btn btn-danger" disabled={!connected} onClick={() => send({ kind: "turnOff" })}>
            Power off
          </button>
          <button className="btn" disabled={!connected} onClick={() => send({ kind: "screenOff" })}>
            Screen off
          </button>
          <button className="btn" disabled={!connected} onClick={() => send({ kind: "screenOn" })}>
            Screen on
          </button>
        </div>

        <h3>Sleep timer</h3>
        <div className="timer-grid">
          {SLEEP_CHOICES.map((minutes) => (
            <button
              key={minutes}
              className="btn btn-small"
              disabled={!connected}
              onClick={() => void run(() => window.tvApi.setSleepTimer(minutes), `TV switches off in ${minutes} minutes`)}
            >
              {minutes}m
            </button>
          ))}
          {snapshot.sleepTimerAt && (
            <button
              className="btn btn-small btn-danger"
              onClick={() => void run(() => window.tvApi.setSleepTimer(0), "Sleep timer cancelled")}
            >
              Cancel
            </button>
          )}
        </div>
        {snapshot.sleepTimerAt && (
          <p className="hint">Switching off at {new Date(snapshot.sleepTimerAt).toLocaleTimeString()}.</p>
        )}
      </section>

      <PointerPad tv={tv} />

      <ScenesCard tv={tv} />

      <ShortcutHelp enabled={settings.shortcutsEnabled && connected} />
    </div>
  );
}

/** One-click sequences: switch input, set volume, launch an app. */
function ScenesCard({ tv }: { tv: TvStateApi }) {
  const { settings, saveSettings, connected, run, snapshot } = tv;
  const [name, setName] = useState("");

  /** Capture what the TV is doing right now as a reusable scene. */
  const captureCurrent = async () => {
    const steps: TvCommand[] = [];
    if (snapshot.foregroundAppId) steps.push({ kind: "launchApp", appId: snapshot.foregroundAppId });
    if (typeof snapshot.volume === "number") steps.push({ kind: "setVolume", volume: snapshot.volume });
    if (steps.length === 0) {
      tv.setToast("Nothing to capture yet — open an app on the TV first.");
      return;
    }
    const scene: Scene = { id: `scene-${Date.now().toString(36)}`, name: name.trim() || "Scene", steps };
    await saveSettings({ scenes: [...settings.scenes, scene] });
    setName("");
  };

  return (
    <section className="card">
      <h2>Scenes</h2>
      <p className="hint">One click to put the TV into a known state — the app you want, at the volume you want.</p>

      <div className="row wrap">
        {settings.scenes.length === 0 && <span className="muted">No scenes yet.</span>}
        {settings.scenes.map((scene) => (
          <span key={scene.id} className="snippet">
            <button
              className="btn btn-small"
              disabled={!connected}
              title={scene.steps.map((step) => step.kind).join(" → ")}
              onClick={() => void run(() => window.tvApi.runScene(scene), `Ran “${scene.name}”`)}
            >
              {scene.name}
            </button>
            <button
              className="snippet-remove"
              title="Delete scene"
              onClick={() => void saveSettings({ scenes: settings.scenes.filter((entry) => entry.id !== scene.id) })}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <div className="scene-form">
        <input
          value={name}
          placeholder="Name, e.g. “Movie night”"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void captureCurrent();
          }}
        />
        <button className="btn btn-small" disabled={!connected} onClick={() => void captureCurrent()}>
          Save current
        </button>
      </div>
    </section>
  );
}
