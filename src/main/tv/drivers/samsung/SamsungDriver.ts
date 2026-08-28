import type { DriverDescriptor } from "../types";

/**
 * Placeholder descriptor for Samsung Tizen televisions.
 *
 * Samsung speaks a different protocol: a WebSocket on port 8001/8002 with a
 * base64 token handshake, `ms.remote.control` key events (`KEY_UP`, `KEY_ENTER`
 * and friends) and `ms.channel.emit` for app launches. Nothing in the layers
 * above this folder is LG-specific, so adding it means implementing `TvDriver`
 * here and registering the driver — see CONTRIBUTING.md.
 */
export const SAMSUNG_DESCRIPTOR: DriverDescriptor = {
  id: "samsung",
  name: "Samsung (Tizen)",
  summary: "Samsung smart TVs from 2016 onwards, over the Tizen remote WebSocket on port 8002.",
  pairingHint: "Allow the device in the prompt shown on the television.",
  setupHint: "Enable Settings → General → External Device Manager → Device Connect Manager.",
  ssdpSearchTarget: "urn:samsung.com:device:RemoteControlReceiver:1",
  implemented: false,
  features: {
    pointer: false,
    textInput: true,
    textFocusReporting: false,
    apps: true,
    inputs: false,
    channels: true,
    media: true,
    volumeLevel: false,
    screenPower: false,
    capture: false,
    wakeOnLan: true,
    appDeepLinks: true,
  },
};
