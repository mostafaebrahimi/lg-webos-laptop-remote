/**
 * Turn any thrown value into a short message that is safe to show in the UI.
 * Network/system error codes are mapped to actionable advice; anything else is
 * truncated so stack traces and payloads never reach the renderer.
 */
const CODE_ADVICE: Record<string, string> = {
  ECONNREFUSED:
    "The TV refused the connection. Check that LG Connect Apps is enabled and that ports 3001/3000 are reachable.",
  EHOSTUNREACH: "The TV is not reachable. It may be off, asleep, or on another network.",
  ENETUNREACH: "No route to the TV. Check that the laptop is on the same LAN (not guest Wi-Fi).",
  ETIMEDOUT: "The TV did not answer in time. It may be asleep or blocked by Wi-Fi client isolation.",
  ECONNRESET: "The TV closed the connection unexpectedly.",
  EHOSTDOWN: "The TV appears to be powered down. Use Wake to switch it on.",
  ENOTFOUND: "That hostname could not be resolved. Try the TV's IP address instead.",
  EAI_AGAIN: "DNS lookup failed. Try the TV's IP address instead.",
  CERT_HAS_EXPIRED: "The TV's certificate was rejected. Reconnect or forget the stored certificate.",
};

export interface SanitisedError {
  message: string;
  code?: string;
}

export function sanitiseError(error: unknown): SanitisedError {
  if (error === null || error === undefined) return { message: "Unknown error" };

  const err = error as { code?: unknown; errorText?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : undefined;

  if (code && CODE_ADVICE[code]) return { message: CODE_ADVICE[code], code };

  if (code === "ESSAP") {
    const text = typeof err.errorText === "string" ? err.errorText : "The TV rejected the command.";
    return { message: `TV error: ${truncate(text)}`, code };
  }

  const message = typeof err.message === "string" ? err.message : String(error);
  return { message: truncate(message), code };
}

/** True when an SSAP error means "this model does not have that service". */
export function isUnsupportedError(error: unknown): boolean {
  const err = error as { errorText?: unknown; errorCode?: unknown; message?: unknown };
  const text = String(err?.errorText ?? err?.message ?? "").toLowerCase();
  const codeValue = String(err?.errorCode ?? "");
  if (codeValue === "404" || codeValue === "403") return true;
  return (
    text.includes("service does not exist") ||
    text.includes("not supported") ||
    text.includes("unknown method") ||
    text.includes("no such service") ||
    text.includes("denied") ||
    /\b404\b|\b403\b/.test(text)
  );
}

function truncate(value: string, max = 180): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}
