import { lookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const privateV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  privateV4.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const specialV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  specialV6.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return !privateV4.check(address, "ipv4");
  return isIP(address) === 6 && globalV6.check(address, "ipv6") && !specialV6.check(address, "ipv6");
}

const blocked = () =>
  new Error("The media URL points to a private or reserved network address. Only public media servers are allowed.");

/** GET a public media resource, validating DNS at connection time and every redirect. */
export async function publicFetch(
  input: string | URL,
  options: { headers?: Record<string, string>; signal: AbortSignal },
): Promise<Response> {
  let url = new URL(input);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Media URLs must use HTTP(S) without embedded credentials.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(hostname) && !isPublicAddress(hostname)) throw blocked();
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await new Promise<import("node:dns").LookupAddress[]>((resolve, reject) => {
          const aborted = () => reject(options.signal.reason);
          options.signal.throwIfAborted();
          options.signal.addEventListener("abort", aborted, { once: true });
          lookup(hostname, { all: true }, (error, found) => {
            options.signal.removeEventListener("abort", aborted);
            if (error) reject(error);
            else resolve(found);
          });
        });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw blocked();
    options.signal.throwIfAborted();
    const address = addresses.find((item) => item.family === 4) ?? addresses[0]!;
    const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
      // Connect to the checked IP, retaining the original HTTP host and TLS identity.
      // An IP literal prevents a second DNS lookup in both Node and standalone Bun.
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        {
          hostname: address.address,
          family: address.family,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: url.pathname + url.search,
          servername: isIP(hostname) ? undefined : hostname,
          headers: { ...options.headers, Host: url.host, "Accept-Encoding": "identity" },
          signal: options.signal,
        },
        resolve,
      );
      request.on("error", reject);
      request.end();
    });
    const status = response.statusCode ?? 502;
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.destroy();
      url = new URL(response.headers.location, url);
      continue;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers))
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const encoding = headers.get("content-encoding");
    const decoder =
      encoding === "gzip"
        ? createGunzip()
        : encoding === "br"
          ? createBrotliDecompress()
          : encoding === "deflate"
            ? createInflate()
            : null;
    if (decoder) {
      response.on("error", (error) => decoder.destroy(error));
      decoder.on("close", () => response.destroy());
      headers.delete("content-encoding");
      headers.delete("content-length");
    }
    if ([204, 205, 304].includes(status)) {
      response.destroy();
      return new Response(null, { status, headers });
    }
    return new Response(Readable.toWeb(decoder ? response.pipe(decoder) : response) as ReadableStream<Uint8Array>, {
      status,
      headers,
    });
  }
  throw new Error("The media server redirected too many times. Retry the original post URL later.");
}
