import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { YOUTUBE_APP_ID, type TvApp, type TvInput } from "@shared/types";
import type { TvStateApi } from "../hooks/useTvState";

export default function AppsPanel({ tv }: { tv: TvStateApi }) {
  const { connected, settings, saveSettings, run, snapshot } = tv;
  const [apps, setApps] = useState<TvApp[]>([]);
  const [inputs, setInputs] = useState<TvInput[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSystem, setShowSystem] = useState(true);
  const filterRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    const [appResult, inputResult] = await Promise.all([window.tvApi.listApps(), window.tvApi.listInputs()]);
    if (appResult.ok) setApps(appResult.value);
    else tv.setToast(appResult.error);
    if (inputResult.ok) setInputs(inputResult.value);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!connected) {
      setApps([]);
      setInputs([]);
    }
  }, [connected]);

  const launch = (app: TvApp) =>
    run(() => window.tvApi.command({ kind: "launchApp", appId: app.id }), `Launching ${app.title}`);

  const toggleFavourite = (id: string) => {
    const next = settings.favouriteApps.includes(id)
      ? settings.favouriteApps.filter((appId) => appId !== id)
      : [...settings.favouriteApps, id];
    void saveSettings({ favouriteApps: next });
  };

  const { favourites, others } = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = apps.filter(
      (app) =>
        (showSystem || !app.systemApp) &&
        (needle === "" || app.title.toLowerCase().includes(needle) || app.id.toLowerCase().includes(needle)),
    );
    return {
      favourites: matching.filter((app) => settings.favouriteApps.includes(app.id)),
      others: matching.filter((app) => !settings.favouriteApps.includes(app.id)),
    };
  }, [apps, filter, settings.favouriteApps, showSystem]);

  const tileProps = { tv, snapshot, launch, toggleFavourite, favourites: settings.favouriteApps };

  return (
    <div className="panel-grid">
      <YouTubeCard tv={tv} />

      <section className="card card-wide">
        <div className="row space-between apps-head">
          <h2>
            Apps
            <span className="pill pill-muted">{apps.length || "–"} installed</span>
          </h2>
          <div className="row wrap">
            <input
              ref={filterRef}
              className="filter-input"
              value={filter}
              placeholder="Filter apps… (Enter launches)"
              disabled={!connected}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const first = favourites[0] ?? others[0];
                  if (first) void launch(first);
                } else if (event.key === "Escape") {
                  setFilter("");
                  event.currentTarget.blur();
                }
              }}
            />
            <label className="check">
              <input type="checkbox" checked={showSystem} onChange={(event) => setShowSystem(event.target.checked)} />
              System apps
            </label>
            <button className="btn btn-small" disabled={!connected || loading} onClick={() => void refresh()}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {!connected && <p className="muted">Connect to load the app list from the TV.</p>}
        {connected && apps.length === 0 && !loading && <p className="muted">No apps reported by the TV.</p>}

        {favourites.length > 0 && (
          <>
            <h3>Favourites</h3>
            <div className="app-grid">
              {favourites.map((app) => (
                <AppTile key={`fav-${app.id}`} app={app} {...tileProps} />
              ))}
            </div>
          </>
        )}

        {others.length > 0 && (
          <>
            {favourites.length > 0 && <h3>All apps</h3>}
            <div className="app-grid">
              {others.map((app) => (
                <AppTile key={app.id} app={app} {...tileProps} />
              ))}
            </div>
          </>
        )}

        {connected && apps.length > 0 && favourites.length === 0 && others.length === 0 && (
          <p className="muted">Nothing matches “{filter}”.</p>
        )}
      </section>

      <section className="card card-wide">
        <div className="row space-between">
          <h2>
            Inputs
            <span className="pill pill-muted">{inputs.filter((input) => input.connected).length} connected</span>
          </h2>
        </div>
        {!connected && <p className="muted">Connect to load the input list.</p>}
        {connected && inputs.length === 0 && <p className="muted">This TV reported no external inputs.</p>}
        <div className="input-grid">
          {inputs.map((input) => (
            <button
              key={input.id}
              className={`input-tile ${input.connected ? "" : "input-idle"} ${
                snapshot.foregroundAppId === input.appId ? "input-current" : ""
              }`}
              disabled={!connected}
              title={input.id}
              onClick={() => void run(() => window.tvApi.command({ kind: "switchInput", inputId: input.id }), `Switching to ${input.label}`)}
            >
              {input.icon ? <img src={input.icon} alt="" /> : <span className="input-dot" />}
              <span className="input-label">{input.label}</span>
              <span className="muted input-state">{input.connected ? "connected" : "no signal"}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function YouTubeCard({ tv }: { tv: TvStateApi }) {
  const { connected, run, snapshot } = tv;
  const [value, setValue] = useState("");
  const open = () => {
    if (!value.trim()) return;
    void run(() => window.tvApi.openYouTube(value), `Sent “${value.trim()}” to YouTube`);
  };

  return (
    <section className="card card-wide">
      <h2>
        YouTube
        {snapshot.foregroundAppId === YOUTUBE_APP_ID && <span className="pill pill-ok">running</span>}
      </h2>
      <div className="row">
        <input
          className="grow"
          value={value}
          dir="auto"
          placeholder="Search text, video URL, or video id"
          disabled={!connected}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") open();
          }}
        />
        <button className="btn btn-primary" disabled={!connected || !value.trim()} onClick={open}>
          Open on TV
        </button>
        <button
          className="btn"
          disabled={!connected}
          onClick={() => void run(() => window.tvApi.command({ kind: "launchApp", appId: YOUTUBE_APP_ID }), "Launching YouTube")}
        >
          Just open YouTube
        </button>
      </div>
      <p className="hint">
        Search and direct video links are both sent as launch deep links, which is the only route that works —
        YouTube draws its own on-screen keyboard, so typed text cannot reach its search box.
      </p>
    </section>
  );
}

function AppTile({
  app,
  tv,
  snapshot,
  launch,
  toggleFavourite,
  favourites,
}: {
  app: TvApp;
  tv: TvStateApi;
  snapshot: TvStateApi["snapshot"];
  launch: (app: TvApp) => void;
  toggleFavourite: (id: string) => void;
  favourites: string[];
}) {
  const running = snapshot.foregroundAppId === app.id;
  const favourite = favourites.includes(app.id);

  return (
    <div className={`app-tile ${running ? "app-running" : ""}`}>
      <button
        className="app-launch"
        disabled={!tv.connected}
        onClick={() => launch(app)}
        title={`${app.title} — ${app.id}`}
      >
        {app.icon ? (
          <img src={app.icon} alt="" loading="lazy" />
        ) : (
          <span className="app-fallback" style={app.bgColor ? { background: app.bgColor } : undefined}>
            {app.title.trim()[0]?.toUpperCase() ?? "?"}
          </span>
        )}
        <span className="app-title">{app.title}</span>
      </button>

      {running && <span className="app-badge">on screen</span>}

      <button
        className={`star ${favourite ? "star-on" : ""}`}
        onClick={() => toggleFavourite(app.id)}
        title={favourite ? "Remove from favourites" : "Add to favourites"}
      >
        ★
      </button>

      {running && (
        <button
          className="app-close"
          title="Close this app on the TV"
          onClick={() => void tv.run(() => window.tvApi.command({ kind: "closeApp", appId: app.id }), `Closed ${app.title}`)}
        >
          ✕
        </button>
      )}
    </div>
  );
}
