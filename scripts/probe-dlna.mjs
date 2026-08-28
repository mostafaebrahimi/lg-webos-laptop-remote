/** Which actions and formats does the TV's renderer accept? */
import http from "node:http";

const host = "192.168.1.220";
const base = `http://${host}:2017`;

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, { timeout: 6000 }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(b)); }).on("error", reject);
});

const soap = (controlUrl, service, action, body = "") =>
  new Promise((resolve, reject) => {
    const payload = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}">${body}</u:${action}></s:Body></s:Envelope>`;
    const url = new URL(controlUrl, base);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
        headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPACTION: `"${service}#${action}"`, "Content-Length": Buffer.byteLength(payload) } },
      (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b })); },
    );
    req.on("error", reject); req.write(payload); req.end();
  });

const desc = await get(`${base}/`);
const avControl = /<serviceType>urn:schemas-upnp-org:service:AVTransport:1<\/serviceType>[\s\S]*?<SCPDURL>([^<]+)<\/SCPDURL>/.exec(desc)?.[1];
const cmControl = /<serviceType>urn:schemas-upnp-org:service:ConnectionManager:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/.exec(desc)?.[1];

if (avControl) {
  const scpd = await get(new URL(avControl, base).href);
  const actions = [...scpd.matchAll(/<name>([A-Za-z]+)<\/name>\s*<argumentList>/g)].map((m) => m[1]);
  console.log("AVTransport actions:", actions.join(", ") || "(none parsed)");
}

if (cmControl) {
  const res = await soap(cmControl, "urn:schemas-upnp-org:service:ConnectionManager:1", "GetProtocolInfo");
  const sink = /<Sink>([\s\S]*?)<\/Sink>/.exec(res.body)?.[1] ?? "";
  const mimes = [...new Set(sink.split(",").map((x) => x.split(":")[2]).filter(Boolean))];
  console.log("\nHTTP status:", res.status, "· formats accepted:", mimes.length);
  console.log("video:", mimes.filter((m) => m.startsWith("video/")).join(" "));
  console.log("audio:", mimes.filter((m) => m.startsWith("audio/")).slice(0, 14).join(" "));
  console.log("image:", mimes.filter((m) => m.startsWith("image/")).join(" "));
}
