/**
 * Diagnostic probe: connects to the TV with the key the desktop app already
 * stored and reports what the firmware actually supports. Run with:
 *   node scripts/probe.mjs <host>
 */
import os from "node:os";
import path from "node:path";
import LGTV from "lgtv2";

const host = process.argv[2] ?? "192.168.1.220";
const keyFile = path.join(os.homedir(), ".config", "lg-webos-laptop-remote", "pairing", `keyfile-${host}`);

const tv = new LGTV({ host, verifyCert: "lg", keyFile, timeout: 15000, reconnect: false });

const line = (label, value) => console.log(`${label.padEnd(26)} ${value}`);

async function probe(label, uri, payload) {
  try {
    const result = payload ? await tv.request(uri, payload) : await tv.request(uri);
    line(label, `OK  ${JSON.stringify(result).slice(0, 260)}`);
    return result;
  } catch (error) {
    line(label, `ERR ${error.errorText ?? error.message ?? error} (code ${error.errorCode ?? error.code ?? "-"})`);
    return null;
  }
}

tv.on("prompt", () => console.log("!! TV is showing a pairing prompt - accept it on screen"));
tv.on("error", (error) => console.error("socket error:", error.message));

tv.on("connect", async () => {
  console.log(`\n=== connected to ${host} ===\n`);

  await probe("system info", "ssap://system/getSystemInfo");
  await probe("software info", "ssap://com.webos.service.update/getCurrentSWInformation");
  await probe("foreground app", "ssap://com.webos.applicationManager/getForegroundAppInfo");

  console.log("\n--- keyboard / IME ---");
  await new Promise((resolve) => {
    tv.subscribe("ssap://com.webos.service.ime/registerRemoteKeyboard", (error, state) => {
      if (error) line("registerRemoteKeyboard", `ERR ${error.message}`);
      else line("registerRemoteKeyboard", `OK  ${JSON.stringify(state).slice(0, 300)}`);
      resolve();
    });
    setTimeout(resolve, 4000);
  });

  await probe("insertText 'test'", "ssap://com.webos.service.ime/insertText", { text: "test", replace: 0 });
  await probe("deleteCharacters 4", "ssap://com.webos.service.ime/deleteCharacters", { count: 4 });
  await probe("sendEnterKey", "ssap://com.webos.service.ime/sendEnterKey");

  console.log("\n--- capture candidates ---");
  await probe("tv/executeOneShot", "ssap://tv/executeOneShot");
  await probe("capture/executeOneShot", "ssap://com.webos.service.capture/executeOneShot");
  await probe("tv/capture", "ssap://tv/capture");
  await probe("screenshot(legacy)", "ssap://com.webos.service.tv.capture/executeOneShot");

  console.log("\n--- service list ---");
  const services = await probe("api/getServiceList", "ssap://api/getServiceList");
  if (services?.services) {
    const names = services.services.map((s) => s.name).sort();
    console.log("SERVICES:", names.join(", "));
  }

  console.log("\n=== done ===");
  await tv.disconnect();
  process.exit(0);
});

setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, 45000);
