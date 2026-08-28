import { useEffect, useState } from "react";
import type { OskLayoutInfo } from "@shared/types";
import type { TvStateApi } from "../hooks/useTvState";
import { useTvTyping } from "../hooks/useTvTyping";

/**
 * Everything about typing except the input itself: the input lives in the bar at
 * the top of the window and is the only place text is entered.
 */
export default function TextInputPanel({ tv }: { tv: TvStateApi }) {
  const { snapshot, settings, saveSettings, run, connected } = tv;
  const { plan } = useTvTyping(tv);
  const [layouts, setLayouts] = useState<OskLayoutInfo[]>([]);
  const [deleteCount, setDeleteCount] = useState(1);
  const [draft, setDraft] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState(false);
  const [secretsOk, setSecretsOk] = useState<boolean | null>(null);
  const [knownPages, setKnownPages] = useState<string[]>([]);

  useEffect(() => {
    void window.tvApi.oskLayouts().then(setLayouts);
    void window.tvApi.secretsAvailable().then(setSecretsOk);
  }, []);

  const activeLayout = layouts.find((layout) => layout.id === settings.oskLayoutId);
  const activeLayers = activeLayout?.layers ?? [];

  useEffect(() => {
    void window.tvApi.oskKnownPages(settings.oskLayoutId).then((result) => {
      if (result.ok) setKnownPages(result.value);
    });
  }, [settings.oskLayoutId, snapshot.lastCommand]);

  const focusState =
    snapshot.keyboardFocus === true ? "focused" : snapshot.keyboardFocus === false ? "not focused" : "unknown";

  return (
    <div className="panel-grid">
      {/* Where text is going right now, and why. */}
      <section className="card card-wide route-banner">
        <div className={`route-active route-${plan.route}`}>
          <span className="route-label">{plan.label}</span>
          <span className="route-why">{plan.explanation}</span>
        </div>
        <div className="route-meta">
          <span className={`pill ${snapshot.keyboardFocus === true ? "pill-ok" : snapshot.keyboardFocus === false ? "pill-warn" : "pill-muted"}`}>
            TV field: {focusState}
          </span>
          <span className="pill pill-muted">app: {snapshot.foregroundAppId ?? "–"}</span>
          <span className="muted">Type in the bar at the top — it is the only text input, and it routes itself.</span>
        </div>
      </section>

      <section className="card">
        <h2>How each route works</h2>
        <dl className="route-defs">
          <div>
            <dt>TV text field</dt>
            <dd>A webOS input has focus. Keystrokes stream as you type, Persian and other Unicode included.</dd>
          </div>
          <div>
            <dt>App keyboard</dt>
            <dd>
              YouTube and its Google sign-in draw their own keyboard. Text sent normally is accepted by the TV and
              then discarded, so the grid is walked with the D-pad instead.
            </dd>
          </div>
          <div>
            <dt>YouTube search</dt>
            <dd>Sent as a launch deep link, the only reliable way into YouTube's search.</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <h2>Quick keys</h2>
        <p className="hint">These use the TV's own text service, so they only affect a focused webOS field.</p>
        <div className="btn-row">
          <button className="btn" disabled={!connected} onClick={() => void run(() => window.tvApi.sendEnter())}>
            Enter
          </button>
          <button
            className="btn"
            disabled={!connected}
            onClick={() => void run(() => window.tvApi.deleteCharacters(deleteCount))}
          >
            Backspace
          </button>
          <label className="field-inline compact">
            ×
            <input
              className="num-input"
              type="number"
              min={1}
              max={500}
              value={deleteCount}
              onChange={(event) => setDeleteCount(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>
          App keyboard settings
          {activeLayers.length > 1 && knownPages.length === activeLayers.length && (
            <span className="pill pill-ok">pages learned</span>
          )}
        </h2>

        <label className="field">
          Which keyboard is on screen
          <select
            value={settings.oskLayoutId}
            onChange={(event) => void saveSettings({ oskLayoutId: event.target.value })}
          >
            {layouts.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </select>
        </label>
        {activeLayout && <p className="hint">{activeLayout.where}</p>}

        <label className="field">
          Which page of it
          <select value={settings.oskLayer} onChange={(event) => void saveSettings({ oskLayer: event.target.value })}>
            <option value="auto">detect automatically</option>
            {activeLayers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Key delay — {settings.oskDelayMs} ms
          <input
            type="range"
            min={80}
            max={400}
            step={10}
            value={settings.oskDelayMs}
            onChange={(event) => void saveSettings({ oskDelayMs: Number(event.target.value) })}
          />
        </label>

        <h3>Teach it the pages</h3>
        <p className="hint">
          The TV never reports which page is showing. Open each page on the TV and press its button once — after
          that the app recognises the page from a screen capture and picks it for you.
        </p>
        <div className="btn-row">
          {activeLayers.map((layer) => (
            <button
              key={layer.id}
              className={`btn btn-small ${knownPages.includes(layer.id) ? "btn-active" : ""}`}
              disabled={!connected}
              onClick={() => void learnPage(layer.id)}
            >
              {knownPages.includes(layer.id) ? "✓ " : ""}Learn “{layer.label}”
            </button>
          ))}
          <button className="btn btn-small" disabled={!connected} onClick={() => void detectPage()}>
            What is showing?
          </button>
        </div>
      </section>

      <section className="card card-wide">
        <h2>
          Snippets
          {secretsOk === false && <span className="pill pill-warn">no keyring — secrets unavailable</span>}
        </h2>
        <p className="hint">
          For what you retype on a TV constantly. Marked secret, the text is encrypted through your system keyring,
          never written in the clear and never sent to this window — it is typed from the background process.
        </p>

        <div className="snippet-form">
          <input
            value={label}
            placeholder="Name, e.g. “Gmail address”"
            onChange={(event) => setLabel(event.target.value)}
          />
          <input
            value={draft}
            dir="auto"
            type={secret ? "password" : "text"}
            placeholder="Text to type on the TV"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addSnippet();
            }}
          />
          <label className="check" title={secretsOk === false ? "No system keyring is available" : undefined}>
            <input
              type="checkbox"
              checked={secret}
              disabled={secretsOk === false}
              onChange={(event) => setSecret(event.target.checked)}
            />
            Secret
          </label>
          <button className="btn" disabled={!label.trim() || !draft.trim()} onClick={() => void addSnippet()}>
            Add
          </button>
        </div>

        {settings.snippets.length === 0 ? (
          <p className="muted empty-note">No snippets yet.</p>
        ) : (
          <ul className="snippet-list">
            {settings.snippets.map((snippet) => (
              <li key={snippet.id}>
                <button
                  className="snippet-send"
                  disabled={!connected || snapshot.oskTyping}
                  title={snippet.secret ? "Secret — stored encrypted" : snippet.value}
                  onClick={() => void sendSnippet(snippet)}
                >
                  <span className="snippet-name">
                    {snippet.secret && <span className="lock">🔒</span>}
                    {snippet.label}
                  </span>
                  <span className="muted snippet-preview">
                    {snippet.secret ? "••••••••" : (snippet.value ?? "")}
                  </span>
                </button>
                <button
                  className="snippet-remove"
                  title="Delete snippet"
                  onClick={() => void run(() => window.tvApi.removeSnippet(snippet.id))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  async function learnPage(layer: string) {
    const result = await run(() => window.tvApi.oskLearnPage(settings.oskLayoutId, layer), `Learned the “${layer}” page`);
    if (result.ok) {
      const known = await window.tvApi.oskKnownPages(settings.oskLayoutId);
      if (known.ok) setKnownPages(known.value);
    }
  }

  async function detectPage() {
    const result = await run(() => window.tvApi.oskDetectPage(settings.oskLayoutId));
    if (!result.ok) return;
    const match = result.value;
    tv.setToast(
      !match
        ? "No page learned yet for this keyboard — press “Learn” once for each page."
        : match.confident
          ? `That is the “${match.layer}” page.`
          : `Closest match is “${match.layer}”, but not clearly enough to rely on. Learn the pages again.`,
    );
  }

  async function addSnippet() {
    if (!label.trim() || !draft.trim()) return;
    const result = await run(() => window.tvApi.addSnippet(label.trim(), draft, secret), "Snippet saved");
    if (result.ok) {
      setLabel("");
      setDraft("");
    }
  }

  /** The value stays in the main process; only the route is sent from here. */
  async function sendSnippet(snippet: { id: string }) {
    await run(
      () =>
        window.tvApi.sendSnippet({
          id: snippet.id,
          route: plan.route,
          layoutId: settings.oskLayoutId,
          delayMs: settings.oskDelayMs,
          startLayer: settings.oskLayer,
        }),
      "Snippet sent",
    );
  }
}
