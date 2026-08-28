const SHORTCUTS: Array<[string, string]> = [
  ["↑ ↓ ← →", "D-pad navigation"],
  ["Enter", "OK (select focused item)"],
  ["Esc", "Back"],
  ["H", "Home"],
  ["+ / −", "Volume up / down"],
  ["Page Up / Page Down", "Channel up / down"],
  ["P / K / X", "Play / Pause / Stop"],
  ["[ / ]", "Rewind / Fast-forward"],
  ["F2", "Type on the TV / back to remote"],
];

export default function ShortcutHelp({ enabled }: { enabled: boolean }) {
  return (
    <section className={`card shortcuts ${enabled ? "" : "shortcuts-off"}`}>
      <h2>
        Laptop keyboard
        {!enabled && <span className="pill pill-muted">inactive</span>}
      </h2>
      <dl>
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys}>
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">
        Shortcuts pause automatically while you type in any field in this window — including the “Type to TV” bar
        above, which mirrors your keystrokes to the focused TV field as you type.
      </p>
    </section>
  );
}
