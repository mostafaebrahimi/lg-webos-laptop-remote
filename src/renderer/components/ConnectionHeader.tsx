import { useEffect, useState } from "react";
import type { DiscoveredTv, TvProfile, TvTypeInfo } from "@shared/types";
import type { TvStateApi } from "../hooks/useTvState";

const STATE_LABEL: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  pairing: "Waiting for TV prompt",
  connected: "Connected",
  reconnecting: "Reconnecting",
  sleeping: "Standby",
  offline: "Offline",
  error: "Error",
};

export default function ConnectionHeader({ tv }: { tv: TvStateApi }) {
  const { snapshot, settings, saveSettings, run } = tv;
  const [host, setHost] = useState(settings.host);
  const [types, setTypes] = useState<TvTypeInfo[]>([]);
  const [found, setFound] = useState<DiscoveredTv[] | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => setHost(settings.host), [settings.host]);
  useEffect(() => {
    void window.tvApi.listTvTypes().then(setTypes);
  }, []);

  const busy = snapshot.state === "connecting" || snapshot.state === "pairing";
  const offline = ["disconnected", "offline", "error", "sleeping"].includes(snapshot.state);
  const driverId = settings.driverId || "webos";

  const connect = async (target?: { host: string; driverId?: string; mac?: string }) => {
    const next = target ?? { host: host.trim(), driverId, mac: settings.mac };
    if (!next.host) return;
    await saveSettings({ host: next.host, driverId: next.driverId ?? driverId });
    await run(() => window.tvApi.connect({ host: next.host, mac: next.mac ?? settings.mac, driverId: next.driverId ?? driverId }));
    setFound(null);
  };

  const scan = async () => {
    setScanning(true);
    const result = await run(() => window.tvApi.discover());
    setScanning(false);
    if (!result.ok) return;
    setFound(result.value);
    if (result.value.length === 1) {
      const only = result.value[0];
      setHost(only.host);
      tv.setToast(`Found ${only.name} at ${only.host}`);
    } else if (result.value.length === 0) {
      tv.setToast("No TVs answered. Enter the IP manually — discovery is often blocked by Wi-Fi isolation.");
    }
  };

  const saveProfile = async () => {
    const name = snapshot.modelName ?? `TV at ${host.trim()}`;
    const profile: TvProfile = {
      id: `${driverId}-${host.trim()}`,
      name,
      host: host.trim(),
      mac: snapshot.mac ?? settings.mac,
      driverId,
    };
    const others = settings.profiles.filter((entry) => entry.id !== profile.id);
    await saveSettings({ profiles: [...others, profile], activeProfileId: profile.id });
    tv.setToast(`Saved “${name}”`);
  };

  return (
    <header className="header">
      <div className="header-row">
        <span className={`dot dot-${snapshot.state}`} aria-hidden />
        <div className="header-status">
          <strong>{STATE_LABEL[snapshot.state] ?? snapshot.state}</strong>
          <span className="muted">{snapshot.statusMessage}</span>
        </div>

        <select
          className="type-select"
          value={driverId}
          disabled={snapshot.state === "connected"}
          onChange={(event) => void saveSettings({ driverId: event.target.value })}
          title="TV type"
        >
          {types.map((type) => (
            <option key={type.id} value={type.id} disabled={!type.implemented}>
              {type.name}
              {type.implemented ? "" : " — not yet supported"}
            </option>
          ))}
        </select>

        <input
          className="host-input"
          value={host}
          placeholder="TV IP address, e.g. 192.168.1.42"
          onChange={(event) => setHost(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void connect();
          }}
          spellCheck={false}
        />

        <button className="btn" disabled={scanning} onClick={() => void scan()} title="Search the network for TVs">
          {scanning ? "Scanning…" : "Find TVs"}
        </button>

        {snapshot.state === "connected" ? (
          <button className="btn" onClick={() => void run(() => window.tvApi.disconnect())}>
            Disconnect
          </button>
        ) : (
          <button className="btn btn-primary" disabled={busy || host.trim().length === 0} onClick={() => void connect()}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        )}

        {offline && (
          <button className="btn" onClick={() => void run(() => window.tvApi.wake(), "Magic packet sent")}>
            Wake
          </button>
        )}
      </div>

      {(settings.profiles.length > 0 || snapshot.state === "connected") && (
        <div className="profiles">
          {settings.profiles.map((profile) => (
            <button
              key={profile.id}
              className={`chip ${settings.activeProfileId === profile.id ? "chip-active" : ""}`}
              onClick={() => void connect(profile)}
              title={`${profile.host} · ${profile.driverId}`}
            >
              {profile.name}
              <span
                className="chip-remove"
                title="Forget this TV"
                onClick={(event) => {
                  event.stopPropagation();
                  void saveSettings({ profiles: settings.profiles.filter((entry) => entry.id !== profile.id) });
                }}
              >
                ✕
              </span>
            </button>
          ))}
          {snapshot.state === "connected" && (
            <button className="chip chip-add" onClick={() => void saveProfile()}>
              + Save this TV
            </button>
          )}
        </div>
      )}

      {found && found.length > 0 && (
        <div className="banner banner-info">
          <strong>Found {found.length} TV{found.length === 1 ? "" : "s"}:</strong>
          <div className="row wrap">
            {found.map((entry) => (
              <button key={entry.host} className="btn btn-small" onClick={() => void connect(entry)}>
                {entry.name} · {entry.host}
              </button>
            ))}
          </div>
        </div>
      )}

      {snapshot.state === "pairing" && (
        <div className="banner banner-info">
          Look at the television and accept the prompt with the physical remote. The pairing key is then stored on
          this laptop and reused automatically.
        </div>
      )}
    </header>
  );
}
