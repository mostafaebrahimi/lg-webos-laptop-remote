# LG webOS Laptop Remote

## Complete implementation specification and coding-agent handoff

### Assignment

Implement a polished, local-only desktop remote-control application for LG televisions running webOS. The application must let a user control the TV from a Windows or Linux laptop using the laptop mouse, trackpad, and physical keyboard. It must include normal remote-control actions, relative pointer control, text entry, application launching, YouTube actions, volume/media controls, input switching, pairing, reconnection, and Wake-on-LAN.

Before coding, inspect the existing repository, its package manager, conventions, current dependencies, and any `AGENTS.md` or repository instructions. Preserve unrelated user changes. If there is no existing application, scaffold the project described below. Implement the feature end to end, run tests and static checks, build distributable packages where the environment permits, and document anything that can only be tested against a real TV.

Do not claim that LG webOS provides a universal PC keyboard. Implement the supported webOS mechanisms accurately and make unsupported or model-dependent behavior clear in the interface.

---

## 1. Product goal

Build a small cross-platform desktop application that can replace most everyday LG Magic Remote actions:

- Pair with an LG webOS TV on the local network.
- Reconnect automatically after the initial pairing.
- Control volume, mute, power-off, screen on/off where supported, channels, media playback, apps, and HDMI inputs.
- Use a dedicated laptop trackpad surface to move the TV cursor.
- Support pointer click, scroll, and drag.
- Map useful laptop keyboard keys to TV navigation and media actions.
- Send English, Persian, and other Unicode text to focused TV text fields.
- Send Enter and Backspace/delete-previous-character operations.
- Launch YouTube, search YouTube where supported, and open a specific YouTube URL or video ID.
- Remain local-only. No cloud service, account, analytics, telemetry, or external backend is required.

Primary target platforms:

- Windows 10/11
- Current Ubuntu and comparable Linux distributions
- macOS may work but is not required for the first release.

---

## 2. Required technical direction

Use the following architecture unless the existing repository already has an equivalent, suitable architecture:

- Electron
- TypeScript
- React with Vite for the renderer
- `lgtv2` for the webOS SSAP connection
- Electron main process owns every TV connection
- Preload script exposes a narrow, typed API through `contextBridge`
- Renderer has no direct Node.js, filesystem, WebSocket, or raw SSAP access
- `electron-store` or an equivalent local store for non-secret settings
- `electron-builder` or the repository's existing packaging system

Use a current stable Electron release whose bundled Node version satisfies the installed `lgtv2` requirement. Current `lgtv2` releases require Node 20.19+, 22.12+, or 24+.

Do not implement the primary TV connection directly in the browser renderer. Newer TVs use a self-signed secure WebSocket endpoint, and main-process ownership gives better TLS handling, key storage, reconnection, and security.

---

## 3. webOS capability model and honest limitations

### Supported through SSAP

- Volume up/down and set-volume
- Mute/unmute
- Power off
- Wake-on-LAN when enabled and a MAC address is known
- App listing and app launching
- HDMI/input listing and switching
- Home, Back, arrows, and click/OK
- Relative pointer movement
- Pointer click
- Relative scrolling
- Pointer drag using the pointer socket's `down` state
- Text insertion into a currently focused TV text widget
- Delete previous characters
- Enter/submit in a focused text widget
- Media play, pause, stop, rewind, and fast-forward
- TV notifications/toasts where supported

### Not universally supported

- Absolute mouse positioning: the protocol exposes relative `dx`/`dy`, not reliable absolute screen coordinates.
- Right-click context menus: there is no universal TV right-click. Map laptop right-click to Back by default.
- Arbitrary PC keyboard key-down/key-up events.
- Ctrl, Alt, Meta/Windows, or application-specific PC shortcuts on the TV.
- Reliable Tab/Shift+Tab behavior across TV applications.
- Forward Delete as distinct from Backspace.
- Every F-key or laptop media key.
- Text injection when the TV application does not expose/focus a webOS IME text widget.
- Identical behavior across every webOS and YouTube application version.

The UI must never imply that unsupported PC keyboard behavior is native. Label configurable emulations as shortcuts, not as raw keyboard passthrough.

If the user truly requires universal HID keyboard/mouse behavior, that is a different hardware/OS-level project using a Bluetooth/USB HID device or adapter and is outside this application's scope.

---

## 4. Suggested project structure

Adapt names to existing repository conventions, but preserve the separation of concerns:

```text
src/
  main/
    index.ts
    ipc/
      registerTvHandlers.ts
      schemas.ts
    tv/
      LgTvClient.ts
      TvConnectionManager.ts
      PointerSocketManager.ts
      KeyboardInputManager.ts
      commandRegistry.ts
      types.ts
    power/
      wakeOnLan.ts
    settings/
      SettingsRepository.ts
    shortcuts/
      GlobalShortcutManager.ts
  preload/
    index.ts
    api.d.ts
  renderer/
    App.tsx
    hooks/
      useTvState.ts
      useRemoteKeyboard.ts
      usePointerPad.ts
    components/
      ConnectionHeader.tsx
      RemoteControl.tsx
      PointerPad.tsx
      TextInputPanel.tsx
      VolumeControl.tsx
      AppLauncher.tsx
      InputSwitcher.tsx
      YouTubePanel.tsx
      SettingsDialog.tsx
      DiagnosticsPanel.tsx
    state/
      tvStore.ts
    styles/
tests/
  unit/
  integration/
  mock-ssap/
```

---

## 5. Connection, discovery, and pairing

### Required first version

1. Let the user enter a TV IP address or hostname manually.
2. Validate the value before saving it.
3. Connect using:

```ts
const tv = new LGTV({
  host,
  verifyCert: "lg",
  keyFile,
  timeout: 15_000,
  reconnect: 5_000,
});
```

4. Allow `lgtv2` to try modern `wss://<host>:3001` first and fall back to legacy `ws://<host>:3000`.
5. On the first connection, display an in-app pairing state instructing the user to accept the prompt shown on the television.
6. Store the client key in Electron's `app.getPath("userData")`, never in the renderer or browser local storage.
7. Reuse the key automatically on later connections.
8. Subscribe to connection, prompt, error, close, and reconnect events and reflect them in the UI.

### Connection state machine

Implement explicit states:

```ts
type TvConnectionState =
  | "disconnected"
  | "connecting"
  | "pairing"
  | "connected"
  | "reconnecting"
  | "sleeping"
  | "offline"
  | "error";
```

Do not represent every connection error as a pairing failure. Provide actionable messages for:

- TV not reachable
- Laptop and TV not on the same network
- Guest Wi-Fi/client isolation
- Pairing rejected or timed out
- Stored key rejected
- Ports 3001 and 3000 unavailable
- Pointer socket unavailable
- TV sleeping/offline

Use bounded exponential backoff with jitter for repeated connection failures. Do not produce an infinite rapid retry loop.

### Discovery as phase two

Optionally add SSDP discovery for `urn:lge-com:service:webos-second-screen:1`. Manual IP entry must remain available because discovery can be blocked by VLANs, firewalls, or Wi-Fi isolation.

### Multiple televisions as phase two

The data model should permit more than one saved TV, but the MVP only needs one active TV at a time. Store each pairing key and MAC separately.

---

## 6. Main TV client API

Create a typed wrapper so the rest of the application does not depend directly on `lgtv2` internals:

```ts
interface TvController {
  connect(config: TvConfig): Promise<void>;
  disconnect(): Promise<void>;
  getState(): TvSnapshot;

  volumeUp(): Promise<void>;
  volumeDown(): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setMute(muted: boolean): Promise<void>;

  sendRemoteButton(button: RemoteButton): Promise<void>;
  pointerMove(dx: number, dy: number, dragging?: boolean): void;
  pointerClick(): void;
  pointerScroll(dx: number, dy: number): void;

  insertText(text: string, replace?: boolean): Promise<void>;
  deleteCharacters(count: number): Promise<void>;
  sendEnterKey(): Promise<void>;

  media(action: MediaAction): Promise<void>;
  listApps(): Promise<TvApp[]>;
  launchApp(id: string, params?: unknown): Promise<void>;
  listInputs(): Promise<TvInput[]>;
  switchInput(inputId: string): Promise<void>;
  turnOff(): Promise<void>;
  wake(): Promise<void>;
}
```

Validate and clamp all public inputs in the main process even if the renderer already validates them.

---

## 7. Pointer and mouse implementation

### Pointer socket

Obtain the specialized pointer socket once per main TV connection:

```ts
const pointer = await tv.getSocket(
  "ssap://com.webos.service.networkinput/getPointerInputSocket",
);
```

Reuse this socket. Do not call `getPointerInputSocket` for every mouse event. Maintain a single in-flight socket-creation promise so simultaneous events cannot create duplicate pointer sockets. Recreate it only after the main connection changes or the pointer socket closes/fails.

The high-level `lgtv2` calls are:

```ts
pointer.send("move", { dx, dy, down: dragging ? 1 : 0 });
pointer.send("click");
pointer.send("scroll", { dx, dy });
pointer.send("button", { name: "HOME" });
```

The underlying pointer protocol frames are newline-delimited text ending with a blank line:

```text
type:move
dx:20
dy:-10
down:0

```

```text
type:click

```

```text
type:scroll
dx:0
dy:10

```

```text
type:button
name:HOME

```

Use the high-level library unless it is proven insufficient. Keep raw framing isolated behind the pointer manager if a fallback is required.

### Pointer-pad UI

Create a large dedicated trackpad surface. It must support:

- Move TV pointer with mouse or laptop trackpad.
- Left click/tap sends pointer click.
- Click-and-drag sends movement with `down: 1`; release sends a final movement with `down: 0`.
- Mouse wheel/two-finger scrolling sends relative scroll.
- Right click maps to Back by default and suppresses the Electron context menu inside the pad.
- Double-click sends two pointer clicks with a safe configurable interval.
- Escape releases pointer lock.
- A visible toggle enables/disables pointer capture.
- Sensitivity setting, default `1.0`, with a sensible range such as `0.25` to `3.0`.
- Optional X/Y inversion settings, especially invert-scroll-Y.

Use the Pointer Lock API inside the Electron renderer when the user activates the pad. Consume `movementX` and `movementY`; do not derive movement only from screen coordinates because the cursor otherwise stops at the window edge.

### Performance and rate limiting

- Accumulate mouse deltas in the renderer.
- Flush at most once per animation frame and no more than 60 times per second.
- Permit a lower configurable rate such as 30 Hz for slower TVs.
- Clamp each outgoing delta to a defensive range, for example `-500..500`.
- Drop zero-delta movements.
- Normalize wheel values and clamp unusually large browser/OS wheel deltas.
- Use fire-and-forget IPC for high-frequency move/scroll events rather than request/response IPC.
- Preserve the order of click/down/up events relative to queued movements.
- Do not allow an unbounded event queue when the TV or pointer socket is slow.
- On disconnect, clear queued pointer events and release pointer lock.

### Pointer limitations to expose in the UI

- Position is relative, not absolute.
- Right click is an application shortcut to Back, not a native webOS right click.
- Drag behavior may vary between TV applications; show it as supported where the target app accepts pointer drag.

---

## 8. Keyboard and text-input implementation

Implement two explicit keyboard modes because navigation keys and text entry are different webOS mechanisms.

### Mode A: Remote shortcuts

When the main remote window is focused and the user is not typing into a local form field, map physical keys to remote actions.

Recommended default mapping:

| Laptop key | TV action | Notes |
| --- | --- | --- |
| Arrow Up/Down/Left/Right | `UP`, `DOWN`, `LEFT`, `RIGHT` pointer buttons | Rate-limit repeats |
| Enter / Numpad Enter | Pointer click/OK | Use click for maximum compatibility |
| Space | Pointer click/OK | Only outside text fields |
| Escape | `BACK` | Also releases pointer lock first |
| Browser Back | `BACK` | If Electron receives it |
| Home | `HOME` | Only outside text fields |
| Backspace | `BACK` | In shortcut mode only |
| 0-9 | Corresponding remote number button | Mark model-dependent and test |
| F1/F2/F3/F4 | Red/Green/Yellow/Blue | Optional, model-dependent |
| Media Play/Pause | Play or Pause | Use media SSAP endpoints |
| Media Stop | Stop | Where Electron/OS exposes it |
| Media Next/Previous | Fast-forward/Rewind | Configurable |
| Configurable chord | Volume up/down/mute | Do not hijack normal `+`/`-` typing |

Use `event.code` for physical shortcut mapping where appropriate. Ignore keyboard events originating from input, textarea, select, or contenteditable elements unless the relevant component explicitly owns them.

Allow key repeat for arrows and volume but throttle it. Do not repeat Home, Back, Enter, app-launch, input-switch, or power actions.

Conservative pointer button names expected to work are:

- `HOME`
- `BACK`
- `UP`
- `DOWN`
- `LEFT`
- `RIGHT`

Use pointer click for OK. Other commonly reported names such as `ENTER`, `MENU`, `INFO`, `EXIT`, `RED`, `GREEN`, `YELLOW`, `BLUE`, and `0` through `9` are firmware/application dependent. Keep them behind a tested allowlist and return a visible Unsupported response rather than silently doing nothing.

Use dedicated SSAP endpoints—not pointer button guesses—for volume, channel, and media commands.

### Mode B: TV text input

Provide a text panel with:

- A multiline-safe local input box.
- A Send Text button.
- Send Enter button.
- Backspace button with optional count.
- Clear local input button.
- Paste support.
- Optional Live Typing mode, disabled by default for reliability.
- A TV Keyboard Focus indicator.
- A short hint such as: “Open a search or login field on the TV first.”

Subscribe to keyboard focus state when supported:

```ts
tv.subscribe(
  "ssap://com.webos.service.ime/registerRemoteKeyboard",
  (_error, state) => {
    // Read currentWidget?.focus and focusChanged when present.
  },
);
```

Send text using:

```ts
await tv.request("ssap://com.webos.service.ime/insertText", {
  text,
  replace: 0,
});
```

Send Backspace/delete-previous-character using:

```ts
await tv.request("ssap://com.webos.service.ime/deleteCharacters", {
  count,
});
```

Send Enter using:

```ts
await tv.request("ssap://com.webos.service.ime/sendEnterKey");
```

Requirements:

- Preserve UTF-8/Unicode without manual ASCII conversion.
- Test at minimum English, Persian (`سلام دنیا`), digits, punctuation, and a pasted multi-word string.
- Treat IME composition carefully. In Live Typing mode, do not send intermediate `compositionupdate` values; wait for `compositionend` or use committed `beforeinput`/`input` data.
- Batch pasted strings instead of sending one network request per character.
- Apply a reasonable maximum payload, such as 2,000 Unicode code points per request, and split larger content into ordered chunks.
- Serialize insert/delete/enter operations so text order is not corrupted.
- If keyboard focus is known to be false, disable Live Typing and explain that the user must focus a TV field.
- If focus state is unavailable on a model, allow manual sending but label focus as Unknown.
- Do not map local Delete to a claimed forward-delete action. The exposed operation deletes previous characters.
- In default Send-on-submit mode, local editing should not affect the TV until the user presses Send Text.

### Global shortcuts

Global OS-level shortcuts are phase two and must be opt-in. Use Electron `globalShortcut` only for user-configured, conflict-resistant chords. Never globally capture normal letters, numbers, arrows, Escape, or Backspace. Always unregister shortcuts on application exit and when the feature is disabled.

---

## 9. Standard TV controls

Implement the following commands through the main-process wrapper:

| Feature | SSAP endpoint/payload |
| --- | --- |
| Volume up | `ssap://audio/volumeUp` |
| Volume down | `ssap://audio/volumeDown` |
| Set volume | `ssap://audio/setVolume`, `{ volume: 0..100 }` |
| Mute | `ssap://audio/setMute`, `{ mute: boolean }` |
| Volume subscription | `ssap://audio/getVolume` |
| Power off | `ssap://system/turnOff` |
| Screen off/on | `ssap://com.webos.service.tvpower/power/turnOffScreen` / `turnOnScreen`, when supported |
| Power-state subscription | `ssap://com.webos.service.tvpower/power/getPowerState`, when supported |
| Play/pause/stop | `ssap://media.controls/play`, `pause`, `stop` |
| Rewind/fast-forward | `ssap://media.controls/rewind`, `fastForward` |
| List installed apps | `ssap://com.webos.applicationManager/listLaunchPoints` |
| Launch app | `ssap://com.webos.applicationManager/launch`, `{ id, params? }` |
| Current foreground app | `ssap://com.webos.applicationManager/getForegroundAppInfo` |
| List inputs | `ssap://tv/getExternalInputList` |
| Switch input | `ssap://tv/switchInput`, `{ inputId }` |
| Channel up/down | `ssap://tv/channelUp`, `channelDown` |
| Notification | `ssap://system.notifications/createToast`, `{ message }` |

Do not treat a command response as successful if `returnValue` is false or the SSAP response type is `error`. Surface a concise user-facing message and retain technical details in diagnostics.

Subscribe to volume/mute, current app, and power state where supported. Treat `404`, `403`, and model-specific application errors as capability differences rather than crashing the connection.

---

## 10. Wake-on-LAN

Power-off is an SSAP action. Power-on must use Wake-on-LAN because a powered-down TV cannot receive WebSocket commands.

Requirements:

- Let `lgtv2` learn and cache the MAC address after a successful connection where supported.
- Also allow manual MAC entry.
- Validate MAC format.
- Provide a Wake button even while the WebSocket state is offline.
- Send the Wake-on-LAN magic packet, then poll connection readiness with bounded backoff.
- Do not report Connected immediately after sending the packet.
- Explain in Settings that the TV option may be named Mobile TV On, Turn on via Wi-Fi, or Wake on LAN.
- Wired Ethernet is usually more reliable, but Wi-Fi Wake-on-LAN may work when enabled by the TV.

---

## 11. Applications, inputs, and YouTube

### App launcher

- Load launch points dynamically from the TV.
- Display app title and icon when a safe icon URL/data source is available.
- Store favorites by app ID, not only by title.
- Do not hardcode Netflix/YouTube as the only possible apps.
- Refresh the list on demand and after reconnecting.

### Input switcher

- Load the TV's external input list.
- Display friendly labels such as HDMI 1, PC, or PlayStation when supplied.
- Use returned input IDs; do not assume every TV uses exactly the same IDs.

### YouTube

Use the commonly installed YouTube app ID `youtube.leanback.v4`, but verify it against the installed app list when possible.

Implement:

```ts
// Launch YouTube
await launchApp("youtube.leanback.v4");

// Open a specific video/URL
await launchApp("youtube.leanback.v4", {
  contentTarget: videoUrlOrVParameter,
});

// Common in-app search parameter
await launchApp("youtube.leanback.v4", {
  contentTarget: `q=${encodeURIComponent(query)}`,
});
```

Depending on the endpoint wrapper, the final request may need the parameters under:

```ts
{
  id: "youtube.leanback.v4",
  params: { contentTarget: "..." },
}
```

Direct video opening is generally more dependable than direct search. Treat `q=` search routing as best-effort because YouTube application versions differ.

Fallback flow when direct search is unsupported:

1. Launch YouTube.
2. Tell the user to open/focus YouTube Search using the remote controls.
3. Detect remote-keyboard focus if available.
4. Send the query through the IME text endpoint.
5. Send Enter.

Do not implement fragile timed arrow-key automation as the only search solution.

---

## 12. Renderer layout and UX

Create a compact, keyboard-friendly desktop interface with these areas:

### Persistent header

- TV name/IP
- Connection-status dot and text
- Connect/reconnect button
- Wake button when offline
- Settings button
- Pairing instructions while pairing

### Remote tab

- Power off
- Home and Back
- D-pad with center OK
- Volume up/down, mute, and volume slider
- Channel up/down
- Play, pause, stop, rewind, and fast-forward
- Colored buttons only if enabled as experimental/model-dependent

### Pointer tab or panel

- Large trackpad area
- Clear activation state
- Mouse sensitivity
- Scroll sensitivity/inversion
- Left-click, Back/right-click, and optional drag hints
- Release Pointer button

### Keyboard tab or panel

- TV focus status: Focused, Not Focused, or Unknown
- Text area
- Send Text
- Enter
- Backspace
- Live Typing toggle
- Short help explaining the focus requirement

### Apps tab

- Favorite apps
- All installed apps
- Inputs
- YouTube query/URL field

### Diagnostics

- Model and firmware if available
- Selected WebSocket transport/port
- Main socket state
- Pointer socket state
- Keyboard focus state
- Last successful command
- Last sanitized error
- Reconnect button
- Forget Pairing button with an explicit confirmation

The main window must be fully usable with the laptop keyboard without accidentally forwarding keys while the user edits a settings or YouTube field.

---

## 13. IPC contract and security

Expose only an allowlisted API from preload. Do not expose `ipcRenderer`, arbitrary channel names, a raw `request(uri, payload)` method, filesystem access, or the `lgtv2` object.

Suggested API:

```ts
interface TvDesktopApi {
  connect(config: PublicTvConfig): Promise<Result>;
  disconnect(): Promise<Result>;
  wake(): Promise<Result>;
  command(command: AllowedTvCommand): Promise<Result>;
  pointerMove(delta: PointerMove): void;
  pointerClick(): void;
  pointerScroll(delta: PointerDelta): void;
  insertText(text: string): Promise<Result>;
  deleteCharacters(count: number): Promise<Result>;
  sendEnter(): Promise<Result>;
  listApps(): Promise<Result<TvApp[]>>;
  listInputs(): Promise<Result<TvInput[]>>;
  getSnapshot(): Promise<TvSnapshot>;
  onStateChanged(listener: (state: TvSnapshot) => void): Unsubscribe;
}
```

Security requirements:

- `contextIsolation: true`
- `nodeIntegration: false`
- Electron renderer sandbox enabled where compatible
- Keep `webSecurity` enabled
- Strict Content Security Policy
- No remote content loaded into the renderer
- No unauthenticated local HTTP server
- No LAN or internet listening socket
- Validate IPC payloads with Zod or an equivalent schema library
- Clamp volume, text length, pointer deltas, scroll deltas, and delete counts
- Keep pairing keys out of renderer state and logs
- Sanitize technical errors before showing them
- Do not expose arbitrary SSAP requests through developer tools
- Disable or carefully constrain navigation and new-window creation

---

## 14. Reliability requirements

- Use one main SSAP connection per active TV.
- Use one pointer socket per active main connection.
- Reacquire the pointer socket after reconnecting.
- Serialize text operations.
- Coalesce high-frequency pointer movement.
- Time out low-frequency commands and show a recoverable error.
- Keep UI state responsive even if the TV is offline.
- Cancel outstanding queues when switching TVs or disconnecting.
- Do not send commands using a stale socket after reconnecting.
- Mark a command Unsupported after a model returns a clear unsupported-service error; do not repeatedly spam it.
- Avoid logging repeated identical network failures.
- Persist settings atomically.
- “Forget pairing” removes only the selected TV's pairing key and cached certificate/MAC metadata after confirmation.

---

## 15. Testing requirements

### Unit tests

Cover at minimum:

- Keyboard shortcut mapping and context exclusions
- Key-repeat throttling
- Pointer delta accumulation/coalescing
- Sensitivity and inversion calculations
- Pointer clamping and queue bounds
- IPC validation
- Volume and delete-count bounds
- Unicode text chunking without splitting surrogate pairs/code points
- IME composition handling
- Connection-state transitions
- Reconnect backoff
- Capability/unsupported-command caching
- YouTube video-ID and URL normalization

### Mock SSAP integration tests

Build or reuse an in-process mock SSAP server to test:

- Registration and pairing prompt
- Stored-key reconnect
- Pairing rejection
- Request success and SSAP error responses
- Subscriptions
- Secure-port-first and legacy-port fallback behavior where practical
- Pointer-socket acquisition
- Pointer move/click/scroll frames
- Duplicate pointer-socket acquisition prevention
- Pointer recreation after reconnect
- Ordered IME insert/delete/enter calls

### Renderer/component tests

Cover:

- Connection and pairing states
- Shortcut suppression while typing locally
- Pointer-pad activation/release
- Focus-status display
- Disabled actions while offline
- Unsupported-capability messaging

### Manual real-TV acceptance matrix

Record the exact TV model, webOS version, firmware, network type, and result for:

1. Fresh pairing and prompt acceptance.
2. Closing and reopening the desktop app without another prompt.
3. Volume up/down, set-volume, mute/unmute.
4. Home, Back, arrows, and OK.
5. Pointer movement in every direction.
6. Left click.
7. Wheel/two-finger scrolling.
8. Drag in at least one TV app that supports dragging.
9. Right-click-to-Back behavior.
10. English text input.
11. Persian text input: `سلام دنیا`.
12. Paste a sentence.
13. Backspace count and Enter.
14. Behavior when no TV text field is focused.
15. App listing and launching.
16. HDMI input listing and switching.
17. YouTube launch.
18. YouTube direct video.
19. YouTube query routing and its fallback.
20. Power off and Wake-on-LAN.
21. Recovery after Wi-Fi interruption.
22. Recovery after TV reboot.
23. Pointer socket recovery after standby.

Do not mark model-dependent functions complete solely because unit tests pass. Clearly identify which items still require a real TV.

---

## 16. Packaging and documentation

Deliver:

- Complete source code
- TypeScript types
- Unit and integration tests
- Windows installer or portable build
- Linux AppImage and/or `.deb` where the environment supports packaging
- Development commands
- Production build commands
- A clear README
- Troubleshooting section
- Short compatibility/limitations section
- Manual test report template

README setup must include:

1. Put laptop and TV on the same non-guest local network.
2. Find the TV IP.
3. Enable LG Connect Apps/Mobile TV On or the equivalent setting.
4. Connect from the app.
5. Accept the first pairing prompt on the TV.
6. Open a TV text field before sending keyboard text.
7. Enable Wake-on-LAN/Mobile TV On and configure a MAC address for power-on.

Troubleshooting must include:

- Pairing prompt not appearing
- Connection blocked by guest Wi-Fi/client isolation
- Incorrect or changing DHCP address
- Modern port 3001 vs legacy port 3000
- TV off/deep sleep
- Pointer controls unavailable or stale
- Text input ignored because no text field is focused
- An application ignoring media commands
- YouTube deep-link/search differences
- Wake-on-LAN not enabled or blocked by network hardware

---

## 17. Implementation order

Complete work in this sequence:

1. Scaffold/inspect project and configure secure Electron boundaries.
2. Implement typed main-process TV wrapper.
3. Implement settings and pairing-key paths.
4. Implement connection state and pairing UI.
5. Implement standard volume/navigation/media commands.
6. Implement robust singleton pointer-socket manager.
7. Implement pointer pad, batching, click, scroll, and drag.
8. Implement remote-shortcut keyboard mode.
9. Implement TV text-input mode and focus subscription.
10. Implement apps, inputs, and YouTube.
11. Implement Wake-on-LAN.
12. Add diagnostics and recovery behavior.
13. Add tests and mock SSAP coverage.
14. Package and document the application.

Keep the application usable at the end of every stage. Do not defer connection failure handling until the end.

---

## 18. Definition of done

The task is complete when:

- A user can install/run the desktop app and configure a TV IP.
- First pairing is clearly guided and the key persists securely.
- The app reconnects without repeated prompts.
- Volume, mute, navigation, Home, Back, OK, and media actions work.
- A dedicated pointer pad provides smooth move, click, and scroll without flooding the socket.
- Drag is implemented and documented as app-dependent.
- Laptop keyboard shortcuts work only in the correct context.
- Text, including Persian Unicode, can be sent to a focused TV input.
- Enter and Backspace work through IME endpoints.
- Unsupported full-PC-keyboard behavior is not misrepresented.
- Apps and inputs are dynamically listed and can be launched/switched.
- YouTube launch and direct-video actions work; search has a documented fallback.
- Power-off and Wake-on-LAN behavior are implemented correctly.
- Security boundaries prevent the renderer from issuing arbitrary TV or filesystem commands.
- Automated tests pass.
- Linting and type checking pass.
- A production build succeeds for the available target platform(s).
- The README and manual real-TV verification checklist are complete.

---

## 19. Technical references

- Current `lgtv2` API, connection behavior, commands, and pointer socket: https://github.com/hobbyquaker/lgtv2
- LG-origin Connect SDK pointer framing for click, button, move, drag, and scroll: https://github.com/ConnectSDK/Connect-SDK-Android-Core/blob/master/src/com/connectsdk/service/webos/WebOSTVMouseSocketConnection.java
- Connect SDK keyboard input behavior: https://github.com/ConnectSDK/Connect-SDK-Windows/blob/master/Service/WebOs/WebOsTvKeyboardInput.cs
- Promise-based pointer usage example: https://github.com/Dabolus/webos-tv
- LG webOS application-launch parameter API: https://webostv.developer.lge.com/develop/references/webostvjs-webosdev

Use these references to confirm protocol details, but isolate third-party-library details behind the application's typed TV wrapper.
