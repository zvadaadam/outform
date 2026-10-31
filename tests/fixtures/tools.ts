import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { toolPath, recordManagedTool, managedToolTarget } from "../../src/utils/process";
import assets from "../../src/utils/tool-assets.json";

const versions: Record<string, string> = {
  "yt-dlp": assets.youtube.version,
  deno: `deno ${assets.deno.version.slice(1)}`,
  ffmpeg: "ffmpeg version 6.1.1",
  ffprobe: "ffprobe version 6.1.1",
  "whisper-cli": "usage: whisper-cli --model --file --output-json --output-file",
};

export async function createManagedTools(commands = Object.keys(versions), scripts: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "outform-managed-fixture-"));
  const env = { ...process.env, OUTFORM_TOOLS_DIR: root };
  for (const command of commands) {
    const path = toolPath(command, env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, scripts[command] ?? `#!/bin/sh\nprintf '%s\\n' '${versions[command]}'\n`, { mode: 0o755 });
  }
  if (commands.includes("whisper-cli") && process.platform === "linux") {
    const files = (assets.whisper.linux.files as Record<string, string[]>)[process.arch] ?? [];
    for (const file of files.filter((file) => file !== "whisper-cli")) {
      await writeFile(join(dirname(toolPath("whisper-cli", env)), file), "test library");
    }
  }
  const original = process.env.OUTFORM_TOOLS_DIR;
  process.env.OUTFORM_TOOLS_DIR = root;
  try {
    for (const target of new Set(commands.map(managedToolTarget))) if (target) await recordManagedTool(target);
  } finally {
    if (original === undefined) delete process.env.OUTFORM_TOOLS_DIR;
    else process.env.OUTFORM_TOOLS_DIR = original;
  }
  const model = join(root, "custom-model.bin");
  await writeFile(model, "explicit test model");
  return {
    root,
    env: { OUTFORM_TOOLS_DIR: root, WHISPER_MODEL: model },
    path: (command: string) => toolPath(command, env),
  };
}
