import { CommandKind, TvCommand, YOUTUBE_APP_ID } from "@shared/types";

export interface SsapCall {
  uri: string;
  payload?: Record<string, unknown>;
}

export interface CommandDescriptor {
  /** Capability bucket used to remember "this model does not support it". */
  capability: string;
  /** Human label used for the "last command" diagnostics field. */
  label: string;
  /** Pointer-socket commands have no SSAP call. */
  ssap?: (command: TvCommand) => SsapCall;
}

export const SSAP = {
  volumeUp: "ssap://audio/volumeUp",
  volumeDown: "ssap://audio/volumeDown",
  setVolume: "ssap://audio/setVolume",
  setMute: "ssap://audio/setMute",
  getVolume: "ssap://audio/getVolume",
  turnOff: "ssap://system/turnOff",
  screenOff: "ssap://com.webos.service.tvpower/power/turnOffScreen",
  screenOn: "ssap://com.webos.service.tvpower/power/turnOnScreen",
  play: "ssap://media.controls/play",
  pause: "ssap://media.controls/pause",
  stop: "ssap://media.controls/stop",
  rewind: "ssap://media.controls/rewind",
  fastForward: "ssap://media.controls/fastForward",
  listApps: "ssap://com.webos.applicationManager/listLaunchPoints",
  launchApp: "ssap://com.webos.applicationManager/launch",
  foregroundApp: "ssap://com.webos.applicationManager/getForegroundAppInfo",
  listInputs: "ssap://tv/getExternalInputList",
  switchInput: "ssap://tv/switchInput",
  channelUp: "ssap://tv/channelUp",
  channelDown: "ssap://tv/channelDown",
  toast: "ssap://system.notifications/createToast",
  closeApp: "ssap://system.launcher/close",
  systemInfo: "ssap://system/getSystemInfo",
  oneShot: "ssap://tv/executeOneShot",
  swInfo: "ssap://com.webos.service.update/getCurrentSWInformation",
  insertText: "ssap://com.webos.service.ime/insertText",
  deleteCharacters: "ssap://com.webos.service.ime/deleteCharacters",
  sendEnterKey: "ssap://com.webos.service.ime/sendEnterKey",
  registerRemoteKeyboard: "ssap://com.webos.service.ime/registerRemoteKeyboard",
} as const;

const MEDIA_URIS = {
  play: SSAP.play,
  pause: SSAP.pause,
  stop: SSAP.stop,
  rewind: SSAP.rewind,
  fastForward: SSAP.fastForward,
} as const;

export const COMMANDS: Record<CommandKind, CommandDescriptor> = {
  volumeUp: { capability: "audio", label: "Volume up", ssap: () => ({ uri: SSAP.volumeUp }) },
  volumeDown: { capability: "audio", label: "Volume down", ssap: () => ({ uri: SSAP.volumeDown }) },
  setVolume: {
    capability: "audio",
    label: "Set volume",
    ssap: (c) => ({ uri: SSAP.setVolume, payload: { volume: (c as { volume: number }).volume } }),
  },
  setMute: {
    capability: "audio",
    label: "Mute",
    ssap: (c) => ({ uri: SSAP.setMute, payload: { mute: (c as { mute: boolean }).mute } }),
  },
  button: { capability: "pointer", label: "Remote button" },
  click: { capability: "pointer", label: "Pointer click" },
  ok: { capability: "pointer", label: "OK" },
  media: {
    capability: "media",
    label: "Media control",
    ssap: (c) => ({ uri: MEDIA_URIS[(c as { action: keyof typeof MEDIA_URIS }).action] }),
  },
  channelUp: { capability: "channel", label: "Channel up", ssap: () => ({ uri: SSAP.channelUp }) },
  channelDown: { capability: "channel", label: "Channel down", ssap: () => ({ uri: SSAP.channelDown }) },
  turnOff: { capability: "power", label: "Power off", ssap: () => ({ uri: SSAP.turnOff }) },
  screenOff: { capability: "screenPower", label: "Screen off", ssap: () => ({ uri: SSAP.screenOff }) },
  screenOn: { capability: "screenPower", label: "Screen on", ssap: () => ({ uri: SSAP.screenOn }) },
  launchApp: {
    capability: "apps",
    label: "Launch app",
    ssap: (c) => {
      const command = c as { appId: string; contentTarget?: string };
      const payload: Record<string, unknown> = { id: command.appId };
      if (command.contentTarget) payload.params = { contentTarget: command.contentTarget };
      return { uri: SSAP.launchApp, payload };
    },
  },
  switchInput: {
    capability: "inputs",
    label: "Switch input",
    ssap: (c) => ({ uri: SSAP.switchInput, payload: { inputId: (c as { inputId: string }).inputId } }),
  },
  closeApp: {
    capability: "apps",
    label: "Close app",
    ssap: (c) => ({ uri: SSAP.closeApp, payload: { id: (c as { appId: string }).appId } }),
  },
  toast: {
    capability: "notifications",
    label: "Toast",
    ssap: (c) => ({ uri: SSAP.toast, payload: { message: (c as { message: string }).message } }),
  },
};

export { YOUTUBE_APP_ID };
