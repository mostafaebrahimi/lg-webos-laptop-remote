import os from "node:os"; import path from "node:path"; import LGTV from "lgtv2";
const host = process.argv[2] ?? "192.168.1.220";
const tv = new LGTV({ host, verifyCert: "lg", keyFile: path.join(os.homedir(), ".config", "lg-webos-laptop-remote", "pairing", `keyfile-${host}`), timeout: 15000, reconnect: false });
tv.on("connect", async () => {
  const r = await tv.request("ssap://com.webos.applicationManager/listLaunchPoints");
  for (const p of r.launchPoints) console.log(p.id.padEnd(42), p.title);
  await tv.disconnect(); process.exit(0);
});
tv.on("error", e => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(1), 30000);
