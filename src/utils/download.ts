import { spin } from "./spinner";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";

export async function downloadFile(
  url: string,
  destination: string,
  opts: { label: string; executable?: boolean; sha256?: string },
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });

  const spinner = spin(`Downloading ${opts.label}...`);

  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15 * 60_000) }).catch(
    (error: unknown) => {
      spinner.stop(`Failed to download ${opts.label}`);
      throw new Error(`Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
    },
  );

  if (!response.ok || !response.body) {
    spinner.stop(`Failed to download ${opts.label}`);
    throw new Error(`Download failed (${response.status} ${response.statusText}): ${url}`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  let lastReported = 0;
  const hash = createHash("sha256");

  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      hash.update(chunk);
      if (total > 0) {
        const percent = Math.floor((received / total) * 100);
        if (percent >= lastReported + 20 && percent < 100) {
          lastReported = percent;
          spinner.update(`Downloading ${opts.label}... ${percent}%`);
        }
      }
      callback(null, chunk);
    },
  });

  const partial = `${destination}.${randomUUID()}.download`;

  try {
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      progress,
      createWriteStream(partial, { mode: opts.executable ? 0o755 : 0o644 }),
    );

    if (total > 0 && received !== total) {
      throw new Error(`Incomplete download: got ${received} of ${total} bytes from ${url}`);
    }

    if (opts.sha256 && hash.digest("hex") !== opts.sha256) {
      throw new Error(`Checksum mismatch for ${opts.label}; download was not installed`);
    }

    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {});
    spinner.stop(`Failed to download ${opts.label}`);
    throw error;
  }

  spinner.stop(`Downloaded ${opts.label}`);
}
