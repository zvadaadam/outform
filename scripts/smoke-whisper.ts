import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findWhisperModel } from "../src/utils/deps";
import { downloadFile } from "../src/utils/download";
import { spawn, waitForResult } from "../src/utils/process";
import { parseWhisperSegments } from "../src/utils/vtt";

const model = await findWhisperModel();
assert(model, "Run outform install whisper before the transcription smoke test");
const directory = await mkdtemp(join(tmpdir(), "outform-whisper-smoke-"));
try {
  const audio = join(directory, "jfk.wav");
  await downloadFile("https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.2/samples/jfk.wav", audio, {
    executable: false,
    label: "Whisper speech fixture",
    sha256: "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e",
  });
  const output = join(directory, "transcript");
  const proc = spawn(["whisper-cli", "-m", model, "-f", audio, "--output-json", "--output-file", output, "-t", "2"]);
  const timeout = setTimeout(() => proc.kill(), 180_000);
  try {
    const result = await waitForResult(proc);
    assert.equal(result.exitCode, 0, result.stderr);
  } finally {
    clearTimeout(timeout);
  }
  const segments = parseWhisperSegments(JSON.parse(await readFile(`${output}.json`, "utf8")));
  assert(segments.length > 0, "Whisper returned no timed segments");
  assert.match(segments.map((segment) => segment.text).join(" "), /ask not what your country can do for you/i);
  for (const segment of segments) {
    assert(Number.isFinite(segment.startTime) && segment.startTime >= 0);
    assert(Number.isFinite(segment.endTime) && segment.endTime > segment.startTime);
  }
  process.stderr.write(`Whisper transcription passed (${segments.length} timed segments)\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
