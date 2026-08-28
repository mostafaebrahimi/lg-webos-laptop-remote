import { useEffect, useState } from "react";
import type { StreamStatus } from "@shared/types";
import type { TvStateApi } from "../hooks/useTvState";

const PLAN_LABEL: Record<string, string> = {
  direct: "Plays as-is",
  remux: "Needs repackaging",
  transcode: "Needs re-encoding",
};

/** Play a file from this computer on the television. */
export default function StreamPanel({ tv }: { tv: TvStateApi }) {
  const { connected, run } = tv;
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    void window.tvApi.getStreamStatus().then(setStatus);
    return window.tvApi.onStreamChanged(setStatus);
  }, []);

  const media = status?.media ?? null;
  const phase = status?.phase ?? "idle";
  const busy = phase === "preparing" || phase === "starting" || phase === "analysing";
  const active = phase === "playing" || phase === "paused";
  const duration = status?.durationSeconds ?? media?.durationSeconds ?? null;
  const position = scrub ?? status?.positionSeconds ?? 0;

  return (
    <div className="panel-grid">
      <section className="card card-wide">
        <h2>
          Play a file on the TV
          {status?.serving && (
            <span className="pill pill-warn" title="This app is serving the file to your TV over the local network">
              sharing to TV
            </span>
          )}
          {status?.rendererName && <span className="pill pill-muted">{status.rendererName}</span>}
        </h2>

        <div className="btn-row">
          <button
            className="btn btn-primary"
            disabled={!connected || busy}
            onClick={async () => {
              const result = await run(() => window.tvApi.pickMedia());
              if (result.ok && result.value) setScrub(null);
            }}
          >
            Choose a file…
          </button>
          {media && !active && (
            <button
              className="btn"
              disabled={!connected || busy}
              onClick={() => void run(() => window.tvApi.streamStart(media.path), "Sent to the TV")}
            >
              {media.plan === "direct" ? "Play on TV" : media.plan === "remux" ? "Repackage and play" : "Re-encode and play"}
            </button>
          )}
          {active && (
            <>
              <button
                className="btn"
                onClick={() =>
                  void run(() => (phase === "playing" ? window.tvApi.streamPause() : window.tvApi.streamResume()))
                }
              >
                {phase === "playing" ? "Pause" : "Resume"}
              </button>
              <button className="btn btn-danger" onClick={() => void run(() => window.tvApi.streamStop())}>
                Stop
              </button>
            </>
          )}
          {busy && (
            <button className="btn btn-danger" onClick={() => void run(() => window.tvApi.streamStop())}>
              Cancel
            </button>
          )}
        </div>

        <p className={`hint ${phase === "error" ? "hint-error" : ""}`}>{status?.message ?? "Nothing playing"}</p>

        {phase === "preparing" && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${Math.round((status?.prepareRatio ?? 0) * 100)}%` }} />
          </div>
        )}

        {active && (
          <div className="transport-bar">
            <span className="time">{formatTime(position)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration ?? 1))}
              value={Math.floor(position)}
              onChange={(event) => setScrub(Number(event.target.value))}
              onMouseUp={() => {
                if (scrub !== null) void run(() => window.tvApi.streamSeek(scrub));
                setScrub(null);
              }}
            />
            <span className="time">{duration ? formatTime(duration) : "–"}</span>
          </div>
        )}
      </section>

      {media && (
        <section className="card card-wide">
          <h2>
            {media.name}
            <span className={`pill ${media.plan === "direct" ? "pill-ok" : "pill-warn"}`}>{PLAN_LABEL[media.plan]}</span>
          </h2>
          <table className="diag">
            <tbody>
              <tr>
                <th>Container</th>
                <td>{media.container}</td>
              </tr>
              <tr>
                <th>Video</th>
                <td>
                  {media.videoCodec ?? "none"}
                  {media.width && media.height ? ` · ${media.width}×${media.height}` : ""}
                </td>
              </tr>
              <tr>
                <th>Audio</th>
                <td>{media.audioCodec ?? "none"}</td>
              </tr>
              <tr>
                <th>Length</th>
                <td>{media.durationSeconds ? formatTime(media.durationSeconds) : "unknown"}</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">{media.reason}</p>
        </section>
      )}

      <section className="card card-wide">
        <h2>How this works</h2>
        <p className="hint">
          The file stays on this computer. The app serves it to the television and tells the TV to fetch it, so the
          TV does the decoding — no quality is lost for formats it already understands, and your laptop does almost
          no work.
        </p>
        <p className="hint">
          This is the only time the app opens a network port. It listens only on the network card facing the TV,
          answers only the TV's own address, serves exactly the one file behind a random unguessable address, and
          shuts down the moment playback stops. The <strong>sharing to TV</strong> badge above is lit whenever that
          port is open.
        </p>
        <p className="hint">
          The first time you send something, the TV asks <em>“The external device is requesting TV control”</em> —
          accept it with the remote, or with the D-pad on the Remote tab. It only asks once.
        </p>
      </section>
    </div>
  );
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
