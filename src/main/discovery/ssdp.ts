import dgram from "node:dgram";
import type { DiscoveredTv } from "@shared/types";
import { listDrivers } from "../tv/drivers/registry";

const MULTICAST_ADDRESS = "239.255.255.250";
const MULTICAST_PORT = 1900;

/**
 * Find televisions on the LAN with an SSDP M-SEARCH, one search target per
 * driver that declares one. Discovery is best effort: VLANs, firewalls and Wi-Fi
 * client isolation all block it, which is why manual entry always stays.
 */
export function discoverTvs(timeoutMs = 4000): Promise<DiscoveredTv[]> {
  const targets = listDrivers()
    .filter((driver) => driver.ssdpSearchTarget)
    .map((driver) => ({ id: driver.id, name: driver.name, st: driver.ssdpSearchTarget as string }));

  if (targets.length === 0) return Promise.resolve([]);

  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredTv>();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve([...found.values()]);
    };

    socket.on("error", finish);

    socket.on("message", (message, remote) => {
      const text = message.toString("utf8");
      const st = header(text, "ST") ?? header(text, "NT") ?? "";
      const match = targets.find((target) => st.includes(target.st));
      if (!match) return;

      const server = header(text, "SERVER");
      if (!found.has(remote.address)) {
        found.set(remote.address, {
          host: remote.address,
          name: match.name,
          driverId: match.id,
          detail: server,
        });
      }
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* not fatal */
      }
      for (const target of targets) {
        const payload = Buffer.from(
          [
            "M-SEARCH * HTTP/1.1",
            `HOST: ${MULTICAST_ADDRESS}:${MULTICAST_PORT}`,
            'MAN: "ssdp:discover"',
            "MX: 2",
            `ST: ${target.st}`,
            "",
            "",
          ].join("\r\n"),
        );
        // Two probes: UDP discovery packets are routinely dropped.
        socket.send(payload, MULTICAST_PORT, MULTICAST_ADDRESS);
        setTimeout(() => {
          if (!settled) socket.send(payload, MULTICAST_PORT, MULTICAST_ADDRESS);
        }, 700);
      }
      setTimeout(finish, timeoutMs);
    });
  });
}

export function header(message: string, name: string): string | undefined {
  const match = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(message);
  return match ? match[1].trim() : undefined;
}
