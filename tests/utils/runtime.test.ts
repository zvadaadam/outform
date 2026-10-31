import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile, readlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync, strToU8 } from "fflate";
import assets from "../../src/utils/tool-assets.json";
import { findWhisperModel, hasCommand } from "../../src/utils/deps";
import {
  hasManagedTool,
  managedToolDirectory,
  recordManagedTool,
  spawn,
  toolPath,
  waitForResult,
} from "../../src/utils/process";
import { getSetupPlans, installTargets } from "../../src/setup";

// These executable fixtures exercise Unix process resolution; Windows binaries are covered by setup CI.
describe.skipIf(process.platform === "win32")("owned extraction runtimes", () => {
  let root: string;
  let host: string;
  const original = { ...process.env };
  let fetchSpy: ReturnType<typeof spyOn> | undefined;
  const hashes = { ...assets.deno.sha256 };

  async function executable(path: string, body: string) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "outform-owned-"));
    host = join(root, "host");
    await mkdir(host);
    process.env.OUTFORM_TOOLS_DIR = join(root, "managed");
    process.env.PATH = host;
    delete process.env.WHISPER_MODEL;
  });

  afterEach(async () => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    Object.assign(assets.deno.sha256, hashes);
    for (const name of ["OUTFORM_TOOLS_DIR", "PATH", "WHISPER_MODEL"]) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    await rm(root, { recursive: true, force: true });
  });

  test("ignores host tools in both probing and execution", async () => {
    await executable(join(host, "deno"), 'echo "deno 1.0.0"');
    expect(await hasCommand("deno")).toBe(false);
    expect(await spawn(["deno", "--version"]).exited).not.toBe(0);
    const plans = await getSetupPlans(["deno"]);
    expect(plans[0]?.installed).toBe(false);
    expect(plans[0]?.steps?.[0]?.kind).toBe("zip");
    expect(await readFile(join(host, "deno"), "utf8")).toContain("deno 1.0.0");
  });

  test("requires a receipt, selects owned executable, and detects changed bytes", async () => {
    await executable(join(host, "deno"), 'echo "host tool"');
    await executable(toolPath("deno"), 'echo "deno 2.9.8"');
    expect(await hasCommand("deno")).toBe(false);
    await recordManagedTool("deno");
    expect(await hasCommand("deno")).toBe(true);
    expect((await waitForResult(spawn(["deno", "--version"]))).stdout.trim()).toBe("deno 2.9.8");
    await executable(toolPath("deno"), 'echo "corrupt"');
    expect(await hasCommand("deno")).toBe(false);
    expect((await getSetupPlans(["deno"]))[0]?.installed).toBe(false);
  });

  test("rejects outdated provenance even if the executable remains runnable", async () => {
    await executable(toolPath("deno"), 'echo "deno 2.9.8"');
    await recordManagedTool("deno");
    const path = join(managedToolDirectory("deno"), "receipt.json");
    const receipt = JSON.parse(await readFile(path, "utf8"));
    receipt.version = "v1.0.0";
    await writeFile(path, JSON.stringify(receipt));
    expect(await hasManagedTool("deno")).toBe(false);
    expect((await getSetupPlans(["deno"]))[0]?.steps?.[0]?.kind).toBe("zip");
  });

  async function stubDownload(version: string) {
    const plan = (await getSetupPlans(["deno"]))[0];
    const step = plan?.steps?.[0];
    if (step?.kind !== "zip") throw new Error("Expected a Deno archive plan");
    const fixture = zipSync({ [basename(toolPath("deno"))]: strToU8(`#!/bin/sh\necho "deno ${version}"\n`) });
    const name = basename(new URL(step.url).pathname);
    (assets.deno.sha256 as Record<string, string>)[name] = createHash("sha256").update(fixture).digest("hex");
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => new Response(fixture));
  }

  test("repairs a corrupt owned tool and reuses the repaired installation on rerun", async () => {
    await executable(join(host, "deno"), 'echo "host remains untouched"');
    await executable(toolPath("deno"), 'echo "deno 2.9.8"');
    await recordManagedTool("deno");
    await writeFile(toolPath("deno"), "incomplete download");
    await stubDownload("2.9.8");
    expect((await installTargets(["deno"])).ready).toBe(true);
    expect(await hasManagedTool("deno")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await installTargets(["deno"])).ready).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readFile(join(host, "deno"), "utf8")).toContain("host remains untouched");
  });

  test("does not record readiness for a downloaded executable reporting the wrong version", async () => {
    await stubDownload("1.0.0");
    const report = await installTargets(["deno"]);
    expect(report.ready).toBe(false);
    expect(report.results[0]?.issue?.message).toContain("Deno must be v2.9.8");
    expect(await hasManagedTool("deno")).toBe(false);
  });

  test("model overrides must be explicit and valid; legacy home models are ignored", async () => {
    const model = join(root, "custom.bin");
    process.env.WHISPER_MODEL = model;
    expect(await findWhisperModel()).toBeNull();
    await writeFile(model, "custom model");
    expect(await findWhisperModel()).toBe(model);
    await writeFile(model, "");
    expect(await findWhisperModel()).toBeNull();
    delete process.env.WHISPER_MODEL;
    expect(await findWhisperModel()).toBeNull();
  });
  async function readyAudioDependencies() {
    await executable(toolPath("ffmpeg"), 'echo "ffmpeg version 6.1.1"');
    await executable(toolPath("ffprobe"), 'echo "ffprobe version 6.1.1"');
    await recordManagedTool("ffmpeg");
    process.env.WHISPER_MODEL = join(root, "model.bin");
    await writeFile(process.env.WHISPER_MODEL, "explicit test model");
  }

  test.skipIf(process.platform !== "darwin")(
    "adopts Homebrew Whisper and revalidates changed executables",
    async () => {
      await readyAudioDependencies();
      const prefix = join(root, "Cellar", "whisper.cpp", "1.9.4");
      const binary = join(prefix, "bin", "whisper-cli");
      const help = 'echo "usage: whisper-cli --model --file --output-json --output-file"';
      await executable(binary, help);
      await executable(
        join(host, "brew"),
        `case "$1" in
      list) echo "whisper.cpp 1.9.4" ;;
      --prefix) echo '${prefix}' ;;
      *) exit 99 ;;
    esac`,
      );
      expect((await installTargets(["whisper"])).ready).toBe(true);
      expect(await readlink(toolPath("whisper-cli"))).toBe(binary);
      expect(await hasCommand("whisper-cli")).toBe(true);
      expect((await getSetupPlans(["whisper"])).every((plan) => plan.installed)).toBe(true);
      await executable(binary, help + "\n# Homebrew upgraded this executable");
      expect(await hasCommand("whisper-cli")).toBe(false);
      expect((await installTargets(["whisper"])).ready).toBe(true);
      await executable(binary, 'echo "usage: incompatible CLI"');
      const report = await installTargets(["whisper"]);
      expect(report.ready).toBe(false);
      expect(report.results.find((result) => result.target === "whisper")?.issue?.message).toContain(
        "required model, audio, and JSON",
      );
      expect(await hasCommand("whisper-cli")).toBe(false);
    },
  );

  test.skipIf(process.platform !== "darwin")(
    "rejects an unsupported linked Homebrew version even when an older keg exists",
    async () => {
      await readyAudioDependencies();
      const prefix = join(root, "Cellar", "whisper.cpp", "2.0.0");
      await executable(
        join(prefix, "bin", "whisper-cli"),
        'echo "usage: whisper-cli --model --file --output-json --output-file"',
      );
      await executable(
        join(host, "brew"),
        `case "$1" in
      list) echo "whisper.cpp 1.9.4 2.0.0" ;;
      --prefix) echo '${prefix}' ;;
      *) exit 99 ;;
    esac`,
      );
      const report = await installTargets(["whisper"]);
      expect(report.ready).toBe(false);
      expect(report.results.find((result) => result.target === "whisper")?.issue?.message).toContain(
        "Linked Homebrew whisper.cpp 2.0.0 is unsupported",
      );
      expect(await hasCommand("whisper-cli")).toBe(false);
    },
  );

  test.skipIf(process.platform !== "linux")(
    "tracks bundled Whisper libraries and runtime startup in readiness",
    async () => {
      const files = (assets.whisper.linux.files as Record<string, string[]>)[process.arch]!;
      await executable(toolPath("whisper-cli"), 'echo "usage: whisper-cli --model --file --output-json --output-file"');
      for (const file of files.filter((file) => file !== "whisper-cli")) {
        await writeFile(join(dirname(toolPath("whisper-cli")), file), "library fixture");
      }
      await recordManagedTool("whisper");
      expect(await hasCommand("whisper-cli")).toBe(true);
      const library = join(dirname(toolPath("whisper-cli")), "libggml.so");
      await writeFile(library, "damaged library");
      expect(await hasCommand("whisper-cli")).toBe(false);
      await recordManagedTool("whisper");
      await executable(toolPath("whisper-cli"), 'echo "libgomp.so.1: cannot open shared object file" >&2; exit 127');
      await recordManagedTool("whisper");
      expect(await hasCommand("whisper-cli")).toBe(false);
    },
  );
  test.skipIf(process.platform !== "darwin")("requests a Homebrew bottle when Whisper is not installed", async () => {
    await readyAudioDependencies();
    const prefix = join(root, "Cellar", "whisper.cpp", "1.9.4");
    const marker = join(root, "bottle-installed");
    await executable(
      join(prefix, "bin", "whisper-cli"),
      'echo "usage: whisper-cli --model --file --output-json --output-file"',
    );
    await executable(
      join(host, "brew"),
      `case "$1" in
      list) if [ -f '${marker}' ]; then echo "whisper.cpp 1.9.4"; else exit 1; fi ;;
      install) [ "$2" = '--force-bottle' ] && [ "$3" = 'whisper.cpp' ] && : > '${marker}' ;;
      --prefix) echo '${prefix}' ;;
      *) exit 99 ;;
    esac`,
    );
    expect((await installTargets(["whisper"])).ready).toBe(true);
    expect(await readFile(marker, "utf8")).toBe("");
    expect(await hasCommand("whisper-cli")).toBe(true);
  });
});
