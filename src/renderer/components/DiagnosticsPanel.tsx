import { useState } from "react";
import type { TvStateApi } from "../hooks/useTvState";

export default function DiagnosticsPanel({ tv }: { tv: TvStateApi }) {
  const { snapshot, run } = tv;
  const [confirmForget, setConfirmForget] = useState(false);

  const rows: Array<[string, string]> = [
    ["Connection state", snapshot.state],
    ["Status", snapshot.statusMessage],
    ["Host", snapshot.host ?? "–"],
    ["Transport", snapshot.transport ?? "–"],
    ["Model", snapshot.modelName ?? "unknown"],
    ["Firmware", snapshot.firmwareVersion ?? "unknown"],
    ["Paired", snapshot.paired ? "yes" : "no"],
    ["MAC (for Wake-on-LAN)", snapshot.mac ?? "not learned yet"],
    ["Pointer socket", snapshot.pointerSocketReady ? "open" : "closed"],
    ["TV keyboard focus", snapshot.keyboardFocus === null ? "unknown" : String(snapshot.keyboardFocus)],
    ["Power state", snapshot.powerState ?? "unknown"],
    ["Foreground app", snapshot.foregroundAppId ?? "–"],
    ["Reconnect attempts", String(snapshot.reconnectAttempt)],
    ["Last command", snapshot.lastCommand ?? "–"],
    ["Last error", snapshot.lastError ?? "–"],
  ];

  return (
    <div className="panel-grid">
      <section className="card card-wide">
        <h2>Diagnostics</h2>
        <table className="diag">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card-wide">
        <h2>Capabilities detected on this TV</h2>
        {Object.keys(snapshot.capabilities).length === 0 ? (
          <p className="muted">Nothing probed yet — capabilities are learned as commands are used.</p>
        ) : (
          <div className="row wrap">
            {Object.entries(snapshot.capabilities).map(([key, state]) => (
              <span key={key} className={`pill ${state === "supported" ? "pill-ok" : state === "unsupported" ? "pill-warn" : "pill-muted"}`}>
                {key}: {state}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card card-wide">
        <h2>Report a problem</h2>
        <p className="hint">
          Copies a summary of versions, connection state and detected capabilities. It deliberately leaves out
          your TV's address, MAC and snippets, so it is safe to paste into an issue.
        </p>
        <button
          className="btn"
          onClick={async () => {
            const report = await window.tvApi.getDiagnostics();
            await navigator.clipboard.writeText(report);
            tv.setToast("Diagnostics copied to the clipboard");
          }}
        >
          Copy diagnostics
        </button>
      </section>

      <section className="card card-wide">
        <h2>Recovery</h2>
        <div className="row wrap">
          <button className="btn" onClick={() => void run(() => window.tvApi.disconnect())}>
            Disconnect
          </button>
          <button
            className="btn"
            onClick={() => void run(() => window.tvApi.connect({ host: snapshot.host ?? tv.settings.host, mac: tv.settings.mac }))}
          >
            Reconnect
          </button>
          {!confirmForget ? (
            <button className="btn btn-danger" onClick={() => setConfirmForget(true)}>
              Forget pairing…
            </button>
          ) : (
            <>
              <span className="muted">Delete the stored key, certificate and MAC for this TV?</span>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  setConfirmForget(false);
                  await run(() => window.tvApi.forgetPairing(), "Pairing forgotten");
                }}
              >
                Yes, forget
              </button>
              <button className="btn" onClick={() => setConfirmForget(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
