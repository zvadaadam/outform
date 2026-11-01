import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertAudio } from "../src/api";
import { spawn, waitForResult } from "../src/utils/process";

const directory = await mkdtemp(join(tmpdir(), "outform-audio-smoke-"));
try {
  const input = join(directory, "source.m4a");
  const generated = await waitForResult(
    spawn(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", input]),
  );
  assert.equal(generated.exitCode, 0, generated.stderr);
  const result = await convertAudio(input, { directory, maxBytes: 1_000_000, maxDuration: 10, timeoutMs: 30_000 });
  assert.deepEqual(result.issues, []);
  const asset = result.json.media[0]!;
  assert(asset.file);
  const bytes = await readFile(asset.file);
  assert.equal(asset.artifact?.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(asset.artifact?.bytes, bytes.length);
  assert.equal(asset.artifact?.contentType, "audio/mpeg");
  assert.equal(asset.artifact?.verification, "decode");
  const decoded = await waitForResult(spawn(["ffmpeg", "-v", "error", "-xerror", "-i", asset.file, "-f", "null", "-"]));
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  const cli = await waitForResult(spawn(["node", "dist/bin.js", "audio", input, "--output", directory, "--json"]));
  assert.equal(cli.exitCode, 0, cli.stderr);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.media[0].artifact.verification, "decode");
  assert.deepEqual(cliResult.issues, []);
  const controller = new AbortController();
  const running = spawn(["ffmpeg", "-v", "error", "-re", "-f", "lavfi", "-i", "sine=duration=30", "-f", "null", "-"], {
    signal: controller.signal,
  });
  const stop = setTimeout(() => controller.abort(), 250);
  try {
    assert.notEqual((await waitForResult(running)).exitCode, 0);
  } finally {
    clearTimeout(stop);
  }
  process.stderr.write(`MP3 conversion passed (${bytes.length} verified bytes)\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
