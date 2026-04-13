import { describe, expect, test } from "bun:test";
import { friendlyFetchError } from "../../src/utils/fetch-error";

describe("friendlyFetchError", () => {
  const url = "https://example.com/page";

  test("timeout error", () => {
    const e = new Error("The operation was aborted");
    e.name = "TimeoutError";
    expect(friendlyFetchError(url, e)).toContain("timed out");
  });

  test("abort error message", () => {
    const e = new Error("signal was aborted");
    expect(friendlyFetchError(url, e)).toContain("timed out");
  });

  test("DNS resolution failure", () => {
    const e = new Error("Was there a typo in the url or port?");
    expect(friendlyFetchError(url, e)).toContain("Could not resolve hostname");
  });

  test("ENOTFOUND error", () => {
    const e = new Error("getaddrinfo ENOTFOUND example.com");
    expect(friendlyFetchError(url, e)).toContain("Could not resolve hostname");
  });

  test("connection refused", () => {
    const e = new Error("Unable to connect");
    expect(friendlyFetchError(url, e)).toContain("Connection refused");
  });

  test("ECONNREFUSED error", () => {
    const e = new Error("connect ECONNREFUSED 127.0.0.1:443");
    expect(friendlyFetchError(url, e)).toContain("Connection refused");
  });

  test("TLS/SSL error", () => {
    const e = new Error("CERT_HAS_EXPIRED");
    expect(friendlyFetchError(url, e)).toContain("TLS/SSL error");
  });

  test("unknown error uses context in message", () => {
    const e = new Error("something weird");
    const msg = friendlyFetchError(url, e, "download PDF from");
    expect(msg).toBe("Failed to download PDF from https://example.com/page: something weird");
  });

  test("unknown error defaults to 'fetch'", () => {
    const e = new Error("something weird");
    const msg = friendlyFetchError(url, e);
    expect(msg).toBe("Failed to fetch https://example.com/page: something weird");
  });

  test("empty error message", () => {
    const e = new Error("");
    const msg = friendlyFetchError(url, e);
    expect(msg).toContain("network error");
  });
});
