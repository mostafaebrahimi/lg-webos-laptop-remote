import path from "node:path";
import type LGTV from "lgtv2";
import {
  MediaAction,
  RemoteButton,
  TvApp,
  TvCommand,
  TvInput,
} from "@shared/types";
import { loadLgtv } from "../../lgtvLoader";
import { PointerSocketManager } from "../../PointerSocketManager";
import { COMMANDS, SSAP } from "../../commandRegistry";
import { CaptureManager } from "../../CaptureManager";
import { isUnsupportedError, sanitiseError } from "../../../util/errors";
import type { DriverConfig, DriverDescriptor, DriverEvents, TvDriver } from "../types";

export const WEBOS_DESCRIPTOR: DriverDescriptor = {
  id: "webos",
  name: "LG (webOS)",
  summary: "LG smart TVs from 2014 onwards, over the SSAP protocol on ports 3001/3000.",
  pairingHint: "Accept the “Connect to this device?” prompt shown on the television.",
  setupHint:
    "Enable LG Connect Apps (older models) and, for power-on, Mobile TV On / Turn on via Wi-Fi under General → Devices → TV Management.",
  ssdpSearchTarget: "urn:lge-com:service:webos-second-screen:1",
  implemented: true,
  features: {
    pointer: true,
    textInput: true,
    textFocusReporting: true,
    apps: true,
    inputs: true,
    channels: true,
    media: true,
    volumeLevel: true,
    screenPower: true,
    capture: true,
    wakeOnLan: true,
    appDeepLinks: true,
  },
};

/** LG webOS, spoken over SSAP by the lgtv2 library. */
export class WebOsDriver implements TvDriver {
  readonly descriptor = WEBOS_DESCRIPTOR;

  private tv: LGTV | null = null;
  private pointer: PointerSocketManager | null = null;
  private events: DriverEvents | null = null;
  private host: string | null = null;

  get connected(): boolean {
    return this.tv?.connected ?? false;
  }

  async connect(config: DriverConfig, events: DriverEvents): Promise<void> {
    this.events = events;

    // A retry on the same host reuses the existing client so the stored key,
    // learned MAC and port-fallback state survive.
    if (this.tv && this.host === config.host) {
      this.tv.connect();
      return;
    }

    await this.disconnect();
    const LGTVClass = await loadLgtv();
    const keyFile = path.join(config.stateDir, `keyfile-${sanitiseHost(config.host)}`);

    const tv = new LGTVClass({
      host: config.host,
      verifyCert: "lg",
      keyFile,
      timeout: 15_000,
      // Reconnection is driven by the connection manager, with backoff.
      reconnect: false,
      mac: config.mac?.trim() || undefined,
    });

    this.tv = tv;
    this.host = config.host;
    this.pointer = new PointerSocketManager(
      tv,
      (ready) => events.capabilityChanged("pointerSocket", ready),
      (error) => events.error(error),
    );

    tv.on("connecting", (url: string) => events.connecting(url));
    tv.on("prompt", () => events.pairingRequired());
    tv.on("mac", (macs: { wired?: string; wifi?: string }) => {
      const mac = macs.wired ?? macs.wifi;
      if (mac) events.macDiscovered(mac);
    });
    tv.on("close", () => {
      this.pointer?.reset();
      events.closed();
    });
    tv.on("error", (error: unknown) => events.error(error));
    tv.on("connect", () => {
      events.connected();
      void this.afterConnect();
    });

    tv.connect();
  }

  async disconnect(): Promise<void> {
    this.pointer?.dispose();
    this.pointer = null;
    const tv = this.tv;
    this.tv = null;
    this.host = null;
    if (tv) {
      try {
        tv.removeAllListeners();
        await tv.disconnect();
      } catch {
        /* socket already gone */
      }
    }
  }

  // --------------------------------------------------------- subscriptions

  private async afterConnect(): Promise<void> {
    const tv = this.tv;
    const events = this.events;
    if (!tv || !events) return;

    tv.subscribe(SSAP.getVolume, (error, response) => {
      if (error || !response) return;
      const volume = typeof response.volume === "number" ? response.volume : response.volumeStatus?.volume;
      const muted = typeof response.muted === "boolean" ? response.muted : response.volumeStatus?.muteStatus;
      events.volumeChanged(typeof volume === "number" ? volume : null, typeof muted === "boolean" ? muted : null);
    });

    tv.subscribe(SSAP.foregroundApp, (error, response) => {
      if (error || !response) return;
      events.foregroundAppChanged(response.appId ?? null);
    });

    tv.subscribe(SSAP.registerRemoteKeyboard, (error, response) => {
      if (error) {
        events.capabilityChanged("ime-focus", false);
        events.textFocusChanged(null);
        return;
      }
      events.capabilityChanged("ime-focus", true);
      // The TV omits currentWidget entirely while nothing is focused.
      const focus = response?.currentWidget?.focus;
      events.textFocusChanged(typeof focus === "boolean" ? focus : null);
    });

    try {
      tv.subscribePowerState((error, result) => {
        if (error || !result) return;
        events.capabilityChanged("powerState", true);
        events.powerStateChanged(result.state);
      });
    } catch {
      events.capabilityChanged("powerState", false);
    }

    void this.readDeviceInfo();
    // The pointer socket carries the D-pad, Home, Back and OK, so open it eagerly.
    void this.pointer?.acquire().catch((error) => events.error(error));
  }

  private async readDeviceInfo(): Promise<void> {
    const tv = this.tv;
    const events = this.events;
    if (!tv || !events) return;
    const info: { modelName?: string; firmwareVersion?: string } = {};
    try {
      const system = await tv.request<{ modelName?: string }>(SSAP.systemInfo);
      if (system?.modelName) info.modelName = system.modelName;
    } catch {
      /* optional */
    }
    try {
      const sw = await tv.request<{ major_ver?: string; minor_ver?: string; product_name?: string }>(SSAP.swInfo);
      const version = [sw?.major_ver, sw?.minor_ver].filter(Boolean).join(".");
      if (version) info.firmwareVersion = version;
      if (!info.modelName && sw?.product_name) info.modelName = sw.product_name;
    } catch {
      /* optional */
    }
    if (Object.keys(info).length > 0) events.deviceInfo(info);
  }

  // -------------------------------------------------------------- commands

  async runCommand(command: TvCommand): Promise<void> {
    if (command.kind === "button") {
      this.requirePointer().button(command.button);
      return;
    }
    if (command.kind === "click" || command.kind === "ok") {
      // "ok" is resolved by the manager into a button or a click.
      this.requirePointer().click();
      return;
    }
    const descriptor = COMMANDS[command.kind];
    const call = descriptor?.ssap?.(command);
    if (!call) throw new Error(`${descriptor?.label ?? command.kind} is not available on this TV.`);
    await this.request(call.uri, call.payload, descriptor.capability);
  }

  async media(action: MediaAction): Promise<void> {
    await this.runCommand({ kind: "media", action });
  }

  async launchAppWithTarget(appId: string, contentTarget?: string): Promise<void> {
    await this.runCommand({ kind: "launchApp", appId, contentTarget });
  }

  pointerMove(dx: number, dy: number, dragging: boolean): void {
    this.pointer?.move(dx, dy, dragging);
  }

  pointerClick(): void {
    this.pointer?.click();
  }

  pointerScroll(dx: number, dy: number): void {
    this.pointer?.scroll(dx, dy);
  }

  pointerButton(button: RemoteButton): void {
    this.pointer?.button(button);
  }

  // ------------------------------------------------------------ text input

  async insertText(text: string, replace: boolean): Promise<void> {
    await this.request(SSAP.insertText, { text, replace: replace ? 1 : 0 }, "ime");
  }

  async deleteCharacters(count: number): Promise<void> {
    await this.request(SSAP.deleteCharacters, { count }, "ime");
  }

  async sendEnter(): Promise<void> {
    await this.request(SSAP.sendEnterKey, undefined, "ime");
  }

  // ------------------------------------------------------- apps and inputs

  async listApps(): Promise<TvApp[]> {
    const response = await this.request<{ launchPoints?: any[] }>(SSAP.listApps, undefined, "apps");
    const points = Array.isArray(response?.launchPoints) ? response.launchPoints : [];
    return points
      .map((point) => ({
        id: String(point.id ?? ""),
        title: String(point.title ?? point.id ?? "Unknown"),
        // A URL here; the manager inlines it, because the TV serves icons over
        // https with a self-signed certificate the renderer will not accept.
        icon: pickIcon(point),
        bgColor: typeof point.bgColor === "string" ? point.bgColor : undefined,
        systemApp: Boolean(point.systemApp),
      }))
      .filter((app) => app.id.length > 0)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async listInputs(): Promise<TvInput[]> {
    const response = await this.request<{ devices?: any[] }>(SSAP.listInputs, undefined, "inputs");
    const devices = Array.isArray(response?.devices) ? response.devices : [];
    return devices
      .map((device) => ({
        id: String(device.id ?? ""),
        label: String(device.label ?? device.id ?? "Input"),
        connected: Boolean(device.connected),
        appId: typeof device.appId === "string" ? device.appId : undefined,
        icon: typeof device.icon === "string" && device.icon ? device.icon : undefined,
      }))
      .filter((input) => input.id.length > 0)
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.label.localeCompare(b.label));
  }

  // ---------------------------------------------------------------- screen

  async captureScreen(): Promise<Buffer> {
    const response = await this.request<{ imageUri?: string }>(SSAP.oneShot, undefined, "capture");
    if (!response?.imageUri) throw new Error("The TV did not return a capture image.");
    return CaptureManager.download(response.imageUri);
  }

  async wake(mac?: string): Promise<void> {
    const LGTVClass = await loadLgtv();
    if (this.tv) {
      await this.tv.wake(mac || undefined);
      return;
    }
    if (!mac) throw new Error("No MAC address known yet. Pair once while the TV is on, or enter it in Settings.");
    await (LGTVClass as unknown as { wake(mac: string): Promise<void> }).wake(mac);
  }

  // -------------------------------------------------------------- plumbing

  private requirePointer(): PointerSocketManager {
    if (!this.pointer || !this.connected) throw new Error("Not connected to a TV.");
    return this.pointer;
  }

  private async request<T = any>(
    uri: string,
    payload: Record<string, unknown> | undefined,
    capability: string,
  ): Promise<T> {
    const tv = this.tv;
    if (!tv || !tv.connected) throw new Error("Not connected to a TV.");
    try {
      const result = payload ? await tv.request<T>(uri, payload) : await tv.request<T>(uri);
      this.events?.capabilityChanged(capability, true);
      return result;
    } catch (error) {
      if (isUnsupportedError(error)) this.events?.capabilityChanged(capability, false);
      throw new Error(sanitiseError(error).message);
    }
  }
}

function pickIcon(point: Record<string, unknown>): string | undefined {
  for (const key of ["icon", "largeIcon", "mediumLargeIcon"]) {
    const value = point[key];
    if (typeof value === "string" && value.startsWith("http")) return value;
  }
  return undefined;
}

function sanitiseHost(host: string): string {
  return host.replace(/[^a-zA-Z0-9._-]/g, "_");
}
