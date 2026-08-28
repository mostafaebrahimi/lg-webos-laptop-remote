import { useEffect, useRef, useState } from "react";
import type { TvStateApi } from "../hooks/useTvState";

const FPS_CHOICES = [1, 2, 3, 4, 5] as const;

/**
 * Live view, screenshots and recording, all built on the TV's one-shot capture
 * endpoint (`ssap://tv/executeOneShot`). webOS exposes no video recorder, so a
 * recording is a burst of captures encoded afterwards with ffmpeg.
 */
export default function ScreenPanel({ tv }: { tv: TvStateApi }) {
  const { snapshot, connected, run } = tv;
  const [image, setImage] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [fps, setFps] = useState<number>(2);
  const [busy, setBusy] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<string | null>(null);
  const inFlight = useRef(false);

  const capture = async () => {
    if (inFlight.current || !connected) return;
    inFlight.current = true;
    setBusy(true);
    const result = await window.tvApi.captureScreen();
    if (result.ok) setImage(result.value.dataUrl);
    else tv.setToast(result.error);
    setBusy(false);
    inFlight.current = false;
  };

  // Live view polls at ~1 Hz; a slow TV simply skips a tick.
  useEffect(() => {
    if (!live || !connected) return;
    void capture();
    const timer = window.setInterval(() => void capture(), 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, connected]);

  useEffect(() => {
    if (!connected) {
      setLive(false);
      setImage(null);
    }
  }, [connected]);

  return (
    <div className="panel-grid">
      <section className="card card-wide">
        <div className="row space-between">
          <h2>
            TV screen
            {snapshot.recordingActive && (
              <span className="pill pill-warn">● recording — {snapshot.recordingFrames} frames</span>
            )}
          </h2>
          <div className="row wrap">
            <button className="btn btn-primary" disabled={!connected || busy} onClick={() => void capture()}>
              {busy ? "Capturing…" : "Capture"}
            </button>
            <label className="check">
              <input type="checkbox" checked={live} disabled={!connected} onChange={(e) => setLive(e.target.checked)} />
              Live view (1 fps)
            </label>
            <button
              className="btn"
              disabled={!connected}
              onClick={async () => {
                const result = await run(() => window.tvApi.saveCapture());
                if (result.ok && result.value) setLastSaved(result.value);
              }}
            >
              Save as…
            </button>
          </div>
        </div>

        <div className="screen-frame">
          {image ? (
            <img src={image} alt="TV screen" />
          ) : (
            <p className="muted">{connected ? "Press Capture to see the TV screen." : "Connect to capture the screen."}</p>
          )}
        </div>
        {lastSaved && <p className="hint">Saved to {lastSaved}</p>}
      </section>

      <section className="card card-wide">
        <h2>Record</h2>
        <div className="row wrap">
          <label className="field-inline">
            Frame rate
            <select value={fps} onChange={(event) => setFps(Number(event.target.value))} disabled={snapshot.recordingActive}>
              {FPS_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} fps
                </option>
              ))}
            </select>
          </label>

          {!snapshot.recordingActive ? (
            <button
              className="btn btn-primary"
              disabled={!connected}
              onClick={() => void run(() => window.tvApi.startRecording(fps), "Recording started")}
            >
              Start recording
            </button>
          ) : (
            <button
              className="btn btn-danger"
              onClick={async () => {
                const result = await run(() => window.tvApi.stopRecording(fps));
                if (result.ok) {
                  const { frames, videoPath, frameDir, durationMs } = result.value;
                  setLastRecording(frameDir);
                  tv.setToast(
                    videoPath
                      ? `${frames} frames over ${Math.round(durationMs / 1000)}s encoded to ${videoPath}`
                      : `${frames} frames saved to ${frameDir} (ffmpeg not found, so no video was encoded)`,
                  );
                }
              }}
            >
              Stop recording
            </button>
          )}

          <button
            className="btn"
            disabled={!lastRecording}
            title="Turn the last recording into an animated GIF"
            onClick={async () => {
              if (!lastRecording) return;
              const result = await run(() => window.tvApi.exportGif(lastRecording, fps));
              if (result.ok) tv.setToast(`GIF written to ${result.value}`);
            }}
          >
            Export GIF
          </button>
          <button className="btn" onClick={() => void run(() => window.tvApi.openCapturesFolder("captures"))}>
            Open captures folder
          </button>
        </div>

        <p className="hint">
          webOS has no screen-recording service, so a recording is a burst of one-shot captures written as JPEG
          frames and encoded to MP4 with ffmpeg when it is installed. The TV needs roughly 150–250 ms per capture,
          so 5 fps is the practical ceiling and DRM-protected video may come back black.
        </p>
      </section>
    </div>
  );
}
