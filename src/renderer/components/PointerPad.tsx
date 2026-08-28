import { useCallback, useEffect, useRef, useState } from "react";
import type { TvStateApi } from "../hooks/useTvState";
import { usePointerPad } from "../hooks/usePointerPad";

/**
 * Trackpad surface driving the TV's magic-remote cursor. Uses the Pointer Lock
 * API so the laptop cursor never runs into the window edge; movement is relative
 * (`movementX`/`movementY`), which is all the webOS protocol carries.
 */
export default function PointerPad({ tv }: { tv: TvStateApi }) {
  const { settings, saveSettings, connected } = tv;
  const padRef = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(false);
  const movedWhileDown = useRef(false);
  const downAt = useRef(0);

  const pad = usePointerPad({
    sensitivity: settings.pointerSensitivity,
    scrollSensitivity: settings.scrollSensitivity,
    invertScrollY: settings.invertScrollY,
    enabled: connected,
  });

  // Pointer lock ends on Escape, on window blur, or when the user clicks away.
  useEffect(() => {
    const onChange = () => {
      const active = document.pointerLockElement === padRef.current;
      setLocked(active);
      if (!active) {
        pad.setDragging(false);
        pad.reset();
      }
    };
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, [pad]);

  useEffect(() => {
    if (!connected && document.pointerLockElement === padRef.current) document.exitPointerLock();
  }, [connected]);

  // When the TV opens a text field the keyboard matters more than the cursor.
  useEffect(() => {
    if (tv.snapshot.keyboardFocus === true && document.pointerLockElement === padRef.current) {
      document.exitPointerLock();
    }
  }, [tv.snapshot.keyboardFocus]);

  const capture = useCallback(() => {
    if (!connected) return;
    padRef.current?.requestPointerLock();
  }, [connected]);

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!locked) return;
    if (event.movementX !== 0 || event.movementY !== 0) movedWhileDown.current = true;
    pad.addMove(event.movementX, event.movementY);
  };

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!locked) {
      capture();
      return;
    }
    event.preventDefault();
    if (event.button === 2) {
      // No native right-click exists on webOS; Back is the useful equivalent.
      void tv.run(() => window.tvApi.command({ kind: "button", button: "BACK" }));
      return;
    }
    if (event.button !== 0) return;
    movedWhileDown.current = false;
    downAt.current = Date.now();
    pad.setDragging(true);
  };

  const onMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!locked || event.button !== 0) return;
    event.preventDefault();
    pad.setDragging(false);
    // A press with no movement is a click, not a drag.
    if (!movedWhileDown.current && Date.now() - downAt.current < 600) window.tvApi.pointerClick();
  };

  return (
    <section className="card pointer-card">
      <div className="pointer-head">
        <h2>
          Pointer
          <span className={`pill ${locked ? "pill-ok" : "pill-muted"}`}>{locked ? "capturing" : "idle"}</span>
        </h2>
        <div className="pointer-actions">
          <button className="btn btn-small" disabled={!connected} onClick={capture}>
            {locked ? "Capturing…" : "Capture mouse"}
          </button>
          <button className="btn btn-small" disabled={!locked} onClick={() => document.exitPointerLock()}>
            Release
          </button>
          <button className="btn btn-small" disabled={!connected} onClick={() => window.tvApi.pointerClick()}>
            Click
          </button>
        </div>
      </div>

      <div
        ref={padRef}
        className={`pad ${locked ? "pad-locked" : ""} ${connected ? "" : "pad-disabled"}`}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onWheel={(event) => pad.addScroll(event.deltaX, event.deltaY)}
        onContextMenu={(event) => event.preventDefault()}
        role="application"
        aria-label="TV trackpad"
      >
        {connected ? (
          locked ? (
            <>
              <strong>Move the mouse to move the TV cursor</strong>
              <span className="muted">Left click selects · right click goes Back · wheel scrolls · Esc releases</span>
            </>
          ) : (
            <>
              <strong>Click here to take over the TV cursor</strong>
              <span className="muted">Your mouse then drives the TV until you press Esc</span>
            </>
          )
        ) : (
          <span className="muted">Connect to use the pointer</span>
        )}
      </div>

      <div className="pad-settings">
        <label className="field-inline">
          Speed
          <input
            type="range"
            min={0.25}
            max={3}
            step={0.25}
            value={settings.pointerSensitivity}
            onChange={(event) => void saveSettings({ pointerSensitivity: Number(event.target.value) })}
          />
          <span className="muted">{settings.pointerSensitivity.toFixed(2)}×</span>
        </label>
        <label className="field-inline">
          Scroll
          <input
            type="range"
            min={0.25}
            max={3}
            step={0.25}
            value={settings.scrollSensitivity}
            onChange={(event) => void saveSettings({ scrollSensitivity: Number(event.target.value) })}
          />
          <span className="muted">{settings.scrollSensitivity.toFixed(2)}×</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.invertScrollY}
            onChange={(event) => void saveSettings({ invertScrollY: event.target.checked })}
          />
          Invert scroll
        </label>
      </div>

      <p className="hint">
        Point at a text field and click it — the TV opens its keyboard and the bar above types into it. Movement is
        relative, so the cursor may start somewhere unexpected.
      </p>
    </section>
  );
}
