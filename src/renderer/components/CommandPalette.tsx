import { useEffect, useMemo, useRef, useState } from "react";
import type { TvApp, TvCommand, TvInput } from "@shared/types";
import type { TvStateApi } from "../hooks/useTvState";

interface Action {
  id: string;
  label: string;
  group: string;
  run: () => void;
}

/**
 * Ctrl+K: type a few letters to reach any app, input or remote action without
 * hunting through tabs.
 */
export default function CommandPalette({ tv, send }: { tv: TvStateApi; send: (command: TvCommand) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [apps, setApps] = useState<TvApp[]>([]);
  const [inputs, setInputs] = useState<TvInput[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyK") {
        event.preventDefault();
        setOpen((current) => !current);
        setQuery("");
        setIndex(0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Load the lists lazily, the first time the palette is opened while connected.
  useEffect(() => {
    if (!open || !tv.connected || apps.length > 0) return;
    void window.tvApi.listApps().then((result) => result.ok && setApps(result.value));
    void window.tvApi.listInputs().then((result) => result.ok && setInputs(result.value));
  }, [open, tv.connected, apps.length]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [
      { id: "home", label: "Home", group: "Remote", run: () => send({ kind: "button", button: "HOME" }) },
      { id: "back", label: "Back", group: "Remote", run: () => send({ kind: "button", button: "BACK" }) },
      { id: "ok", label: "OK", group: "Remote", run: () => send({ kind: "ok" }) },
      { id: "vol-up", label: "Volume up", group: "Remote", run: () => send({ kind: "volumeUp" }) },
      { id: "vol-down", label: "Volume down", group: "Remote", run: () => send({ kind: "volumeDown" }) },
      { id: "mute", label: tv.snapshot.muted ? "Unmute" : "Mute", group: "Remote", run: () => send({ kind: "setMute", mute: !tv.snapshot.muted }) },
      { id: "play", label: "Play", group: "Media", run: () => send({ kind: "media", action: "play" }) },
      { id: "pause", label: "Pause", group: "Media", run: () => send({ kind: "media", action: "pause" }) },
      { id: "stop", label: "Stop", group: "Media", run: () => send({ kind: "media", action: "stop" }) },
      { id: "screen-off", label: "Screen off", group: "Power", run: () => send({ kind: "screenOff" }) },
      { id: "power", label: "Power off", group: "Power", run: () => send({ kind: "turnOff" }) },
    ];

    for (const app of apps) {
      list.push({ id: `app-${app.id}`, label: app.title, group: "App", run: () => send({ kind: "launchApp", appId: app.id }) });
    }
    for (const input of inputs) {
      list.push({
        id: `input-${input.id}`,
        label: `${input.label}${input.connected ? "" : " (no signal)"}`,
        group: "Input",
        run: () => send({ kind: "switchInput", inputId: input.id }),
      });
    }
    for (const scene of tv.settings.scenes) {
      list.push({
        id: `scene-${scene.id}`,
        label: scene.name,
        group: "Scene",
        run: () => void tv.run(() => window.tvApi.runScene(scene), `Ran “${scene.name}”`),
      });
    }
    return list;
  }, [apps, inputs, send, tv]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? actions.filter((action) => `${action.group} ${action.label}`.toLowerCase().includes(needle))
      : actions;
    return filtered.slice(0, 40);
  }, [actions, query]);

  if (!open) return null;

  const choose = (action: Action | undefined) => {
    if (!action) return;
    action.run();
    setOpen(false);
  };

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="Run an action, launch an app, switch an input…"
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((current) => Math.min(current + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(matches[index]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        />
        <ul className="palette-list">
          {matches.length === 0 && <li className="palette-empty">Nothing matches.</li>}
          {matches.map((action, position) => (
            <li
              key={action.id}
              className={`palette-item ${position === index ? "palette-item-active" : ""}`}
              onMouseEnter={() => setIndex(position)}
              onClick={() => choose(action)}
            >
              <span className="palette-group">{action.group}</span>
              <span>{action.label}</span>
            </li>
          ))}
        </ul>
        <div className="palette-foot">↑↓ to move · Enter to run · Esc to close</div>
      </div>
    </div>
  );
}
