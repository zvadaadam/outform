import { log } from "./log";
import { hasManagedTool, managedToolTarget, fileSha256, toolEnvironment, toolsDirectory } from "./process";
import { access, constants, stat } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join } from "node:path";

export type SetupTarget = "youtube" | "whisper" | "ffmpeg" | "deno" | "claude" | "codex";

type HintPlatform = "darwin" | "linux" | "win32";

const INSTALL_HINTS: Record<SetupTarget, Record<HintPlatform, string[]>> = {
  deno: {
    darwin: ["outform install deno", "Use macOS x64 or arm64 for the managed Deno runtime"],
    linux: ["outform install deno", "Use a glibc Linux x64 or arm64 system for the managed Deno runtime"],
    win32: ["outform install deno", "Use Windows x64 or arm64 for the managed Deno runtime"],
  },
  youtube: {
    darwin: ["outform install youtube", "Use macOS x64 or arm64 for managed YouTube extraction"],
    linux: ["outform install youtube", "Use Linux x64 or arm64 for managed YouTube extraction"],
    win32: ["outform install youtube", "Use Windows x64 or arm64 for managed YouTube extraction"],
  },
  whisper: {
    darwin: [
      "outform install whisper",
      "Install Homebrew from https://brew.sh, then brew install --force-bottle whisper.cpp (requires a compatible bottle for your macOS version and architecture)",
    ],
    linux: [
      "outform install whisper",
      "Use glibc Linux x64 or arm64 with tar; on Debian/Ubuntu install runtimes with sudo apt-get update && sudo apt-get install -y libgomp1 libstdc++6",
    ],
    win32: ["outform install whisper", "Use Windows x64 for the managed whisper.cpp binary"],
  },
  ffmpeg: {
    darwin: ["outform install ffmpeg", "Use macOS x64 or arm64 for managed ffmpeg/ffprobe"],
    linux: ["outform install ffmpeg", "Use Linux x64 or arm64 for managed ffmpeg/ffprobe"],
    win32: ["outform install ffmpeg", "Use Windows x64 for managed ffmpeg/ffprobe"],
  },
  claude: {
    darwin: ["npm install -g @anthropic-ai/claude-code"],
    linux: ["npm install -g @anthropic-ai/claude-code"],
    win32: ["npm install -g @anthropic-ai/claude-code"],
  },
  codex: {
    darwin: ["npm install -g @openai/codex"],
    linux: ["npm install -g @openai/codex"],
    win32: ["npm install -g @openai/codex"],
  },
};

function hintPlatform(platform: NodeJS.Platform): HintPlatform {
  return platform === "darwin" || platform === "win32" ? platform : "linux";
}

export function installHintsFor(target: SetupTarget, platform: NodeJS.Platform = process.platform): string[] {
  return INSTALL_HINTS[target][hintPlatform(platform)];
}

export function manualInstallHintsFor(target: SetupTarget, platform: NodeJS.Platform = process.platform): string[] {
  return installHintsFor(target, platform).filter((hint) => !hint.startsWith("outform "));
}

interface Dependency {
  id: SetupTarget;
  name: string;
  command: string;
  altCommands?: string[];
  installHint: string;
  purpose: string;
  setupCommand: string;
}

interface EnvVar {
  name: string;
  purpose: string;
  hint: string;
}

export interface ToolStatus extends Dependency {
  found: boolean;
}

export interface EnvStatus extends EnvVar {
  found: boolean;
}

export interface CapabilityStatus {
  available: boolean;
  status: "ready" | "needs_dependency" | "needs_provider";
  requires?: string[];
  setupCommand?: string;
  providers?: string[];
}

export interface DoctorReport {
  generatedAt: string;
  platform: NodeJS.Platform;
  arch: string;
  tools: ToolStatus[];
  env: EnvStatus[];
  capabilities: {
    web: {
      available: true;
      builtIn: true;
      status: "ready";
    };
    pdf: {
      available: true;
      builtIn: true;
      status: "ready";
    };
    youtube: CapabilityStatus;
    transcription: CapabilityStatus;
    aiChapters: CapabilityStatus;
  };
  recommendedActions: string[];
}

function buildTools(): Dependency[] {
  return [
    {
      id: "deno",
      name: "Deno",
      command: "deno",
      installHint: "outform install youtube",
      purpose: "YouTube JavaScript challenges",
      setupCommand: "outform install youtube",
    },
    {
      id: "youtube",
      name: "yt-dlp",
      command: "yt-dlp",
      installHint: installHintsFor("youtube")[0]!,
      purpose: "YouTube extraction",
      setupCommand: "outform install youtube",
    },
    {
      id: "whisper",
      name: "whisper.cpp",
      command: "whisper-cli",
      altCommands: ["whisper-cpp"],
      installHint: installHintsFor("whisper")[0]!,
      purpose: "Audio transcription fallback",
      setupCommand: "outform install whisper",
    },
    {
      id: "ffmpeg",
      name: "ffmpeg",
      command: "ffmpeg",
      installHint: installHintsFor("ffmpeg")[0]!,
      purpose: "Audio extraction for whisper",
      setupCommand: "outform install ffmpeg",
    },
    {
      id: "claude",
      name: "claude CLI",
      command: "claude",
      installHint: installHintsFor("claude")[0]!,
      purpose: "AI chapter generation",
      setupCommand: "outform install claude",
    },
    {
      id: "codex",
      name: "codex CLI",
      command: "codex",
      installHint: installHintsFor("codex")[0]!,
      purpose: "AI chapter generation",
      setupCommand: "outform install codex",
    },
  ];
}

const ENV_VARS: EnvVar[] = [
  {
    name: "ANTHROPIC_API_KEY",
    purpose: "Direct Anthropic API",
    hint: "export ANTHROPIC_API_KEY=sk-...",
  },
  {
    name: "OPENAI_API_KEY",
    purpose: "Direct OpenAI API",
    hint: "export OPENAI_API_KEY=sk-...",
  },
];

export async function hasCommand(cmd: string): Promise<boolean> {
  if (managedToolTarget(cmd)) return hasManagedTool(cmd);
  const pathValue = Object.entries(toolEnvironment()).find(([key]) => key.toLowerCase() === "path")?.[1];
  const pathEntries = isAbsolute(cmd) ? [""] : (pathValue ?? "").split(delimiter);
  const extensions =
    process.platform === "win32" && !extname(cmd) ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];

  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = isAbsolute(cmd) ? cmd : join(directory || ".", cmd + extension);
      try {
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        if ((await stat(candidate)).isFile()) return true;
      } catch {}
    }
  }

  return false;
}

export const WHISPER_MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin";

export const WHISPER_MODEL_SHA256 = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";

export function defaultWhisperModelPath(): string {
  return join(toolsDirectory(), "models", WHISPER_MODEL_SHA256, "ggml-base.en.bin");
}

export async function findWhisperModel(): Promise<string | null> {
  const envModel = process.env.WHISPER_MODEL;
  if (envModel) {
    try {
      const model = await stat(envModel);
      return model.isFile() && model.size > 0 ? envModel : null;
    } catch {
      return null;
    }
  }
  const path = defaultWhisperModelPath();
  try {
    return (await fileSha256(path)) === WHISPER_MODEL_SHA256 ? path : null;
  } catch {
    return null;
  }
}

export async function probeEnvironment(): Promise<DoctorReport> {
  const tools = await Promise.all(
    buildTools().map(async (dep) => {
      const commands = [dep.command, ...(dep.altCommands ?? [])];
      const results = await Promise.all(commands.map((command) => hasCommand(command)));
      return {
        ...dep,
        found: results.some(Boolean),
      };
    }),
  );

  const env = ENV_VARS.map((item) => ({
    ...item,
    found: Boolean(process.env[item.name]),
  }));

  const hasYtDlp = tools.find((tool) => tool.id === "youtube")?.found ?? false;
  const hasWhisper = tools.find((tool) => tool.id === "whisper")?.found ?? false;
  const hasFfmpeg = (tools.find((tool) => tool.id === "ffmpeg")?.found ?? false) && (await hasCommand("ffprobe"));
  const hasDeno = tools.find((tool) => tool.id === "deno")?.found ?? false;
  const whisperModel = await findWhisperModel();

  const providers: string[] = [];
  if (tools.find((tool) => tool.command === "claude")?.found) {
    providers.push("claude-cli");
  }
  if (tools.find((tool) => tool.command === "codex")?.found) {
    providers.push("codex-cli");
  }
  if (env.find((item) => item.name === "ANTHROPIC_API_KEY")?.found) {
    providers.push("anthropic-api");
  }
  if (env.find((item) => item.name === "OPENAI_API_KEY")?.found) {
    providers.push("openai-api");
  }

  const youtube: CapabilityStatus =
    hasYtDlp && hasDeno
      ? {
          available: true,
          status: "ready",
        }
      : {
          available: false,
          status: "needs_dependency",
          requires: [...(!hasYtDlp ? ["yt-dlp"] : []), ...(!hasDeno ? ["deno"] : [])],
          setupCommand: "outform install youtube",
        };

  const transcriptionMissing: string[] = [];
  if (!hasWhisper) transcriptionMissing.push("whisper.cpp");
  if (!hasFfmpeg) transcriptionMissing.push("ffmpeg / ffprobe");
  if (!whisperModel) transcriptionMissing.push("whisper model");

  const transcription: CapabilityStatus =
    transcriptionMissing.length === 0
      ? {
          available: true,
          status: "ready",
        }
      : {
          available: false,
          status: "needs_dependency",
          requires: transcriptionMissing,
          setupCommand: "outform install whisper",
        };

  const aiChapters: CapabilityStatus =
    providers.length > 0
      ? {
          available: true,
          status: "ready",
          providers,
        }
      : {
          available: false,
          status: "needs_provider",
          requires: ["claude CLI", "codex CLI", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
          providers: [],
        };

  const recommendedActions: string[] = [];
  if (!youtube.available || !transcription.available) {
    recommendedActions.push("outform install  # prepare all extraction capabilities");
  }

  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    tools,
    env,
    capabilities: {
      web: {
        available: true,
        builtIn: true,
        status: "ready",
      },
      pdf: {
        available: true,
        builtIn: true,
        status: "ready",
      },
      youtube,
      transcription,
      aiChapters,
    },
    recommendedActions,
  };
}

export const getDoctorReport = probeEnvironment;

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  const toolCount = report.tools.filter((tool) => tool.found).length;
  const envCount = report.env.filter((item) => item.found).length;
  const statusWidth = 10;

  lines.push("outform — doctor (dependency check)");
  lines.push("");
  lines.push(`  System: ${report.platform} ${report.arch}`);
  lines.push("");

  lines.push("  Tools:");
  lines.push(`  ${"Status".padEnd(statusWidth)} ${"Name".padEnd(14)} ${"Purpose".padEnd(28)} Install`);
  lines.push(`  ${"─".repeat(statusWidth)} ${"─".repeat(14)} ${"─".repeat(28)} ${"─".repeat(36)}`);
  for (const tool of report.tools) {
    const status = tool.found ? "✓ found" : "✗ missing";
    lines.push(
      `  ${status.padEnd(statusWidth)} ${tool.name.padEnd(14)} ${tool.purpose.padEnd(28)} ${tool.installHint}`,
    );
  }

  lines.push("");
  lines.push("  Environment:");
  lines.push(`  ${"Status".padEnd(statusWidth)} ${"Variable".padEnd(18)} ${"Purpose".padEnd(22)} Setup`);
  lines.push(`  ${"─".repeat(statusWidth)} ${"─".repeat(18)} ${"─".repeat(22)} ${"─".repeat(30)}`);
  for (const item of report.env) {
    const status = item.found ? "✓ set" : "✗ unset";
    lines.push(`  ${status.padEnd(statusWidth)} ${item.name.padEnd(18)} ${item.purpose.padEnd(22)} ${item.hint}`);
  }

  lines.push("");
  lines.push(`  ${toolCount}/${report.tools.length} tools, ${envCount}/${report.env.length} API keys configured`);
  lines.push("");
  lines.push("  Capabilities:");
  lines.push("    ✓ Web page extraction     (built-in)");
  lines.push("    ✓ PDF extraction          (built-in)");
  lines.push(
    `    ${report.capabilities.youtube.available ? "✓" : "✗"} YouTube extraction       ${report.capabilities.youtube.available ? "(ready)" : `(needs ${(report.capabilities.youtube.requires ?? []).join(" + ")})`}`,
  );
  lines.push(
    `    ${report.capabilities.transcription.available ? "✓" : "✗"} Audio transcription      ${report.capabilities.transcription.available ? "(ready)" : `(needs ${(report.capabilities.transcription.requires ?? []).join(" + ")})`}`,
  );
  lines.push(
    `    ${report.capabilities.aiChapters.available ? "✓" : "✗"} AI chapter generation        ${report.capabilities.aiChapters.available ? "(ready)" : "(needs AI provider)"}`,
  );

  if (report.capabilities.aiChapters.providers && report.capabilities.aiChapters.providers.length > 0) {
    lines.push("");
    lines.push(`  AI providers: ${report.capabilities.aiChapters.providers.join(", ")}`);
  }

  if (report.recommendedActions.length > 0) {
    lines.push("");
    lines.push("  Recommended:");
    for (const action of report.recommendedActions) {
      lines.push(`    - ${action}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export async function checkDependencies(): Promise<void> {
  log(formatDoctorReport(await probeEnvironment()));
}
