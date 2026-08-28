/**
 * End-to-end test: drives the real renderer over the Chrome DevTools Protocol.
 * Launch the app with --remote-debugging-port=9222 first.
 */
import WebSocket from "ws";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.on("open", resolve));

let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

/** Evaluate an expression in the renderer and return its value. */
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails.exception?.description ?? "eval failed"));
  }
  return response.result?.result?.value;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Runtime.enable");

// ---------------------------------------------------------------- bridge
const api = await evaluate(`return Object.keys(window.tvApi).sort();`);
check("preload bridge exposes the API", Array.isArray(api) && api.length > 20, `${api?.length} methods`);
check(
  "no raw ipcRenderer leaked to the renderer",
  await evaluate(`return typeof window.require === "undefined" && typeof window.ipcRenderer === "undefined";`),
);

// ---------------------------------------------------------------- connect
await evaluate(`return window.tvApi.connect({ host: "192.168.1.220", driverId: "webos" });`);
for (let i = 0; i < 30; i++) {
  const state = await evaluate(`const s = await window.tvApi.getSnapshot(); return s.state;`);
  if (state === "connected") break;
  await wait(1000);
}
const snapshot = await evaluate(`return await window.tvApi.getSnapshot();`);
check("connects to the TV", snapshot.state === "connected", `${snapshot.state} · ${snapshot.modelName ?? "?"}`);
check("reports the driver in use", snapshot.driverId === "webos", snapshot.driverName);
check("pointer socket opens", snapshot.pointerSocketReady === true);

// ------------------------------------------------------------ tv commands
const volumeResult = await evaluate(`return await window.tvApi.command({ kind: "volumeDown" });`);
check("volume command accepted", volumeResult.ok === true, volumeResult.error ?? "");

const badCommand = await evaluate(`return await window.tvApi.command({ kind: "definitelyNotACommand" });`);
check("unknown command rejected by validation", badCommand.ok === false, badCommand.error);

const badVolume = await evaluate(`return await window.tvApi.command({ kind: "setVolume", volume: 900 });`);
check("out-of-range volume rejected", badVolume.ok === false, badVolume.error);

// ------------------------------------------------------------------ apps
const apps = await evaluate(`return await window.tvApi.listApps();`);
check("app list loads", apps.ok && apps.value.length > 0, `${apps.value?.length} apps`);
check(
  "app icons are inlined as data URLs",
  apps.ok && apps.value.every((app) => !app.icon || app.icon.startsWith("data:image/")),
  `${apps.value?.filter((a) => a.icon).length} icons`,
);

const inputs = await evaluate(`return await window.tvApi.listInputs();`);
check("input list loads", inputs.ok && inputs.value.length > 0, `${inputs.value?.length} inputs`);

// --------------------------------------------------------------- capture
const capture = await evaluate(`return await window.tvApi.captureScreen();`);
check("screen capture works", capture.ok && capture.value.dataUrl.startsWith("data:image/jpeg"), `${capture.value?.bytes} bytes`);

// -------------------------------------------------------------- discovery
const found = await evaluate(`return await window.tvApi.discover();`);
check("SSDP discovery finds the TV", found.ok && found.value.some((tv) => tv.host === "192.168.1.220"), JSON.stringify(found.value?.map((t) => t.host)));

// ------------------------------------------------------------- tv types
const types = await evaluate(`return await window.tvApi.listTvTypes();`);
check("driver registry exposed", types.length >= 2, types.map((t) => `${t.id}:${t.implemented}`).join(" "));

// ------------------------------------------------------------- snippets
const secretsOk = await evaluate(`return await window.tvApi.secretsAvailable();`);
check("keyring availability reported", typeof secretsOk === "boolean", String(secretsOk));

const added = await evaluate(`return await window.tvApi.addSnippet("E2E secret", "hunter2-e2e", ${secretsOk});`);
check("snippet saved", added.ok === true, added.error ?? "");
const snippetId = added.value?.id;
if (secretsOk) {
  check("secret snippet value never reaches the renderer", added.value?.value === undefined);
  const settingsNow = await evaluate(`return await window.tvApi.getSettings();`);
  const stored = settingsNow.snippets.find((s) => s.id === snippetId);
  check("secret snippet stored without its text", stored && stored.secret === true && stored.value === undefined);
}

// --------------------------------------------------------- keyboard pages
const layouts = await evaluate(`return await window.tvApi.oskLayouts();`);
check("keyboard layouts exposed", layouts.length >= 2, layouts.map((l) => l.id).join(", "));
check(
  "google layout has both pages",
  layouts.find((l) => l.id === "google-signin")?.layers?.length === 2,
);

const learn = await evaluate(`return await window.tvApi.oskLearnPage("e2e-test", "letters");`);
check("page learning stores a fingerprint", learn.ok === true, learn.error ?? "");
const known = await evaluate(`return await window.tvApi.oskKnownPages("e2e-test");`);
check("learned page is remembered", known.ok && known.value.includes("letters"), JSON.stringify(known.value));
const detected = await evaluate(`return await window.tvApi.oskDetectPage("e2e-test");`);
check("page detection returns a match", detected.ok && detected.value?.layer === "letters", JSON.stringify(detected.value));

// ------------------------------------------------------------------ scenes
const scene = { id: "e2e-scene", name: "E2E", steps: [{ kind: "volumeUp" }, { kind: "volumeDown" }] };
const sceneRun = await evaluate(`return await window.tvApi.runScene(${JSON.stringify(scene)});`);
check("scene runs its steps", sceneRun.ok === true, sceneRun.error ?? "");

const badScene = await evaluate(
  `return await window.tvApi.runScene({ id: "x", name: "x", steps: [{ kind: "evil" }] });`,
);
check("scene with an invalid step rejected", badScene.ok === false, badScene.error);

// ------------------------------------------------------------- sleep timer
const timerOn = await evaluate(`return await window.tvApi.setSleepTimer(30);`);
const timerSnapshot = await evaluate(`return await window.tvApi.getSnapshot();`);
check("sleep timer schedules", timerOn.ok && typeof timerSnapshot.sleepTimerAt === "number");
await evaluate(`return await window.tvApi.setSleepTimer(0);`);
const cleared = await evaluate(`return (await window.tvApi.getSnapshot()).sleepTimerAt;`);
check("sleep timer cancels", cleared === null);

// ------------------------------------------------------------ diagnostics
const diagnostics = await evaluate(`return await window.tvApi.getDiagnostics();`);
check("diagnostics report generated", typeof diagnostics === "string" && diagnostics.includes("driver webos"));
check(
  "diagnostics exclude the TV address",
  !diagnostics.includes("192.168.1.220"),
);

// -------------------------------------------------------------- shortcuts
const shortcuts = await evaluate(`return await window.tvApi.setGlobalShortcuts(true);`);
check("global shortcuts register", shortcuts.ok && shortcuts.value.registered.length > 0, shortcuts.value?.registered.join(", "));
await evaluate(`return await window.tvApi.setGlobalShortcuts(false);`);

// ------------------------------------------------------------------- UI
const tabs = await evaluate(`return [...document.querySelectorAll(".tab")].map((t) => t.textContent);`);
check("all tabs render", tabs.length === 7, tabs.join(" / "));

// ------------------------------------------------------------------ stream
const streamStatus = await evaluate(`return await window.tvApi.getStreamStatus();`);
check("stream starts idle with no socket open", streamStatus.phase === "idle" && streamStatus.serving === false);
const badSeek = await evaluate(`return await window.tvApi.streamSeek(-5);`);
check("negative seek rejected", badSeek.ok === false, badSeek.error);
const badFile = await evaluate(`return await window.tvApi.analyseMedia("/nope/missing.mkv");`);
check("missing file reported, not crashed", badFile.ok === false, badFile.error?.slice(0, 60));

await evaluate(`
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", ctrlKey: true, bubbles: true }));
  return true;
`);
await wait(400);
const paletteOpen = await evaluate(`return document.querySelector(".palette") !== null;`);
check("command palette opens on Ctrl+K", paletteOpen === true);

const paletteItems = await evaluate(`
  const input = document.querySelector(".palette-input");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "mute");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return [...document.querySelectorAll(".palette-item")].map((i) => i.textContent);
`);
check("palette filters actions", paletteItems.some((i) => i.toLowerCase().includes("mute")), paletteItems.slice(0, 3).join(" | "));

await evaluate(`
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", ctrlKey: true, bubbles: true }));
  return true;
`);
await wait(300);
check("palette closes again", (await evaluate(`return document.querySelector(".palette") === null;`)) === true);

// cleanup
if (snippetId) await evaluate(`return await window.tvApi.removeSnippet(${JSON.stringify(snippetId)});`);
await evaluate(`return await window.tvApi.updateSettings({ scenes: [] });`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log("FAILURES:\n" + failed.map((f) => `  - ${f.name}: ${f.detail}`).join("\n"));
ws.close();
process.exit(failed.length ? 1 : 0);
