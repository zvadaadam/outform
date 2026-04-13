function isReservedInvalidHostname(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "invalid" || hostname.endsWith(".invalid");
  } catch {
    return false;
  }
}

export function friendlyFetchError(url: string, e: Error, context?: string): string {
  const msg = e.message || "";
  const what = context || "fetch";

  if (e.name === "TimeoutError" || msg.includes("abort")) {
    return `Request to ${url} timed out. Check your network connection or try again.`;
  }
  if (
    msg.includes("ENOTFOUND") ||
    msg.includes("getaddrinfo") ||
    msg.includes("typo in the url") ||
    isReservedInvalidHostname(url)
  ) {
    return `Could not resolve hostname for ${url}. Check the URL and your network connection.`;
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("Unable to connect")) {
    return `Connection refused by ${url}. The server may be down or the URL may be wrong.`;
  }
  if (msg.includes("CERT") || msg.includes("SSL") || msg.includes("TLS")) {
    return `TLS/SSL error connecting to ${url}. The site may have certificate issues.`;
  }
  return `Failed to ${what} ${url}: ${msg || "network error"}`;
}
