import { useEffect, useRef, useState } from "react";
import type { OskLayoutInfo } from "@shared/types";
import type { TvStateApi } from "../hooks/useTvState";
import { useTvTyping, type TypingRoute } from "../hooks/useTvTyping";
import { codePointLength, diffForTv } from "../lib/liveTypeDiff";

/** Keystrokes are coalesced for this long before one request goes to the TV. */
const FLUSH_MS = 60;

/**
 * The one place text is typed on the TV. It chooses the route itself — a focused
 * webOS field, an app's own on-screen keyboard, or a YouTube deep link — and
 * says which one it is using. Nothing else in the app sends text.
 */
export default function LiveTypeBar({ tv }: { tv: TvStateApi }) {
  const { snapshot, connected, settings, saveSettings } = tv;
  const [override, setOverride] = useState<TypingRoute | "auto">("auto");
  const { route, plan, send } = useTvTyping(tv, override);

  const [value, setValue] = useState("");
  const [active, setActive] = useState(false);
  const [layouts, setLayouts] = useState<OskLayoutInfo[]>([]);
  const [verify, setVerify] = useState<{ dataUrl: string; matched: boolean | null; readText?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sent = useRef("");
  const composing = useRef(false);
  const timer = useRef<number | null>(null);
  const reportedError = useRef(false);
  const previousFocus = useRef<boolean | null>(null);

  useEffect(() => {
    void window.tvApi.oskLayouts().then(setLayouts);
  }, []);

  /** Live streaming only makes sense on the IME route. */
  const flush = (next: string) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!connected || composing.current || !plan.live) return;

    const { deletions, insertion } = diffForTv(sent.current, next);
    if (deletions === 0 && insertion.length === 0) return;
    sent.current = next;

    const report = (result: { ok: boolean; error?: string }) => {
      if (result.ok || reportedError.current) return;
      reportedError.current = true;
      tv.setToast(result.error ?? "The TV rejected the text.");
    };
    if (deletions > 0) void window.tvApi.deleteCharacters(deletions).then(report);
    if (insertion.length > 0) void window.tvApi.insertText(insertion).then(report);
  };

  const schedule = (next: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(next), FLUSH_MS);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!connected) {
      sent.current = "";
      setValue("");
    }
    reportedError.current = false;
  }, [connected]);

  /**
   * The TV tells us when one of its own text widgets takes focus. That is the
   * moment the laptop keyboard should type instead of driving the remote, so
   * this field grabs focus by itself. Escape hands the keyboard back.
   */
  useEffect(() => {
    const focused = snapshot.keyboardFocus;
    if (focused === previousFocus.current) return;
    previousFocus.current = focused;

    if (focused === true && connected) {
      sent.current = "";
      setValue("");
      inputRef.current?.focus();
    } else if (focused === false && document.activeElement === inputRef.current) {
      inputRef.current?.blur();
    }
  }, [snapshot.keyboardFocus, connected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "F2") return;
      event.preventDefault();
      if (document.activeElement === inputRef.current) inputRef.current?.blur();
      else inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const reset = () => {
    sent.current = "";
    setValue("");
    reportedError.current = false;
  };

  const submit = async () => {
    if (!value.trim()) return;
    if (plan.live) {
      flush(value);
      await window.tvApi.sendEnter();
      reset();
      return;
    }

    const typed = value;
    const result = await send(typed, { submit: false });
    reset();

    // Typing on an app's own keyboard is the fragile path: show what landed.
    if (result?.ok && plan.route === "osk") {
      const check = await window.tvApi.oskVerify(typed);
      if (check.ok) setVerify(check.value);
    }
  };

  const activeLayout = layouts.find((layout) => layout.id === settings.oskLayoutId);
  const busy = snapshot.oskTyping;
  const percent = busy && snapshot.oskTotal > 0 ? Math.round((snapshot.oskTyped / snapshot.oskTotal) * 100) : 0;

  return (
    <div className={`livebar ${active ? "livebar-active" : ""}`}>
      <span className={`live-dot ${active && connected ? "live-dot-on" : ""}`} aria-hidden />
      <span className={`mode-tag ${active ? "mode-tag-typing" : ""}`}>{active ? "TYPING" : "REMOTE"}</span>

      <input
        ref={inputRef}
        className="live-input"
        dir="auto"
        value={value}
        disabled={!connected || busy}
        placeholder={
          !connected
            ? "Connect to type on the TV"
            : busy
              ? `Typing on the TV keyboard… ${snapshot.oskTyped}/${snapshot.oskTotal}`
              : plan.live
                ? "Type on the TV — every keystroke goes straight to the focused field (Enter submits, Esc leaves)"
                : "Type here and press Enter — the app keyboard is driven for you"
        }
        spellCheck={false}
        onFocus={() => setActive(true)}
        onBlur={() => {
          setActive(false);
          flush(value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const next = event.currentTarget.value;
          setValue(next);
          flush(next);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          if (!composing.current) schedule(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            inputRef.current?.blur();
          }
        }}
      />

      <select
        className="route-select"
        value={override}
        title={plan.explanation}
        onChange={(event) => setOverride(event.target.value as TypingRoute | "auto")}
      >
        <option value="auto">Auto · {plan.label}</option>
        <option value="ime">TV text field</option>
        <option value="osk">App keyboard</option>
        <option value="youtube">YouTube search</option>
      </select>

      {route === "osk" && (
        <>
          <select
            className="route-select"
            value={settings.oskLayoutId}
            disabled={busy}
            title="Which on-screen keyboard is showing"
            onChange={(event) => void saveSettings({ oskLayoutId: event.target.value })}
          >
            {layouts.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </select>

          {(activeLayout?.layers.length ?? 0) > 1 && (
            <select
              className="route-select"
              value={settings.oskLayer}
              disabled={busy}
              title="Which page the TV keyboard is showing right now. The TV does not report this, so set it to match what you see."
              onChange={(event) => void saveSettings({ oskLayer: event.target.value })}
            >
              <option value="auto">page: auto</option>
              {activeLayout?.layers.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  page: {layer.label}
                </option>
              ))}
            </select>
          )}
        </>
      )}

      {busy ? (
        <button className="btn btn-small btn-danger" onClick={() => window.tvApi.oskCancel()}>
          Stop
        </button>
      ) : (
        <>
          <button
            className="btn btn-small"
            disabled={!connected}
            title={plan.live ? "Delete what you typed from the TV field" : "Clear this box"}
            onClick={() => {
              if (plan.live) {
                const length = codePointLength(sent.current);
                if (length > 0) void window.tvApi.deleteCharacters(length);
              }
              reset();
            }}
          >
            Clear
          </button>
          <button className="btn btn-small" disabled={!connected || !value.trim()} onClick={() => void submit()}>
            Send
          </button>
        </>
      )}

      {busy && (
        <div className="livebar-progress">
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
      )}

      {verify && (
        <div className="verify-pop" onClick={() => setVerify(null)}>
          <div className="verify-head">
            {verify.matched === true && <span className="pill pill-ok">text confirmed on the TV</span>}
            {verify.matched === false && <span className="pill pill-warn">could not read it back — check the screen</span>}
            {verify.matched === null && <span className="pill pill-muted">here is what the TV shows</span>}
            <span className="muted">click to dismiss</span>
          </div>
          <img src={verify.dataUrl} alt="TV screen after typing" />
        </div>
      )}
    </div>
  );
}
