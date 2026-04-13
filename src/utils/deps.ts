import { spawn } from "./process";
import { log } from "./log";

export type SetupTarget = "youtube" | "whisper" | "claude" | "codex";

interface Dependency {
  id: SetupTarget;
  name: string;
  command: string;
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
    aiSummary: CapabilityStatus;
  };
  recommendedActions: string[];
}

const TOOLS: Dependency[] = [
  {
    id: "youtube",
    name: "yt-dlp",
    command: "yt-dlp",
    installHint: "brew install yt-dlp",
    purpose: "YouTube extraction",
    setupCommand: "extractor setup youtube",
  },
  {
    id: "whisper",
    name: "whisper.cpp",
    command: "whisper-cpp",
    installHint: "brew install whisper-cpp",
    purpose: "Audio transcription fallback",
    setupCommand: "extractor setup whisper",
  },
  {
    id: "claude",
    name: "claude CLI",
    command: "claude",
    installHint: "npm i -g @anthropic-ai/claude-code",
    purpose: "AI summarization",
    setupCommand: "extractor setup claude",
  },
  {
    id: "codex",
    name: "codex CLI",
    command: "codex",
    installHint: "npm i -g @openai/codex",
    purpose: "AI summarization",
    setupCommand: "extractor setup codex",
  },
];

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

async function which(cmd: string): Promise<boolean> {
  try {
    const proc = spawn(["which", cmd], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

export async function hasCommand(cmd: string): Promise<boolean> {
  return which(cmd);
}

export async function probeEnvironment(): Promise<DoctorReport> {
  const tools = await Promise.all(
    TOOLS.map(async (dep) => ({
      ...dep,
      found: await which(dep.command),
    })),
  );

  const env = ENV_VARS.map((item) => ({
    ...item,
    found: Boolean(process.env[item.name]),
  }));

  const hasYtDlp = tools.find((tool) => tool.command === "yt-dlp")?.found ?? false;

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

  const youtube: CapabilityStatus = hasYtDlp
    ? {
        available: true,
        status: "ready",
      }
    : {
        available: false,
        status: "needs_dependency",
        requires: ["yt-dlp"],
        setupCommand: "extractor setup youtube",
      };

  const aiSummary: CapabilityStatus = providers.length > 0
    ? {
        available: true,
        status: "ready",
        providers,
      }
    : {
        available: false,
        status: "needs_provider",
        requires: [
          "claude CLI",
          "codex CLI",
          "ANTHROPIC_API_KEY",
          "OPENAI_API_KEY",
        ],
        providers: [],
      };

  const recommendedActions: string[] = [];
  if (!hasYtDlp) {
    recommendedActions.push("extractor setup youtube");
  }
  if (providers.length === 0) {
    recommendedActions.push(
      "extractor setup codex  # or extractor setup claude, or set OPENAI_API_KEY / ANTHROPIC_API_KEY",
    );
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
      aiSummary,
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

  lines.push("extractor — doctor (dependency check)");
  lines.push("");
  lines.push(`  System: ${report.platform} ${report.arch}`);
  lines.push("");

  lines.push("  Tools:");
  lines.push(
    `  ${"Status".padEnd(statusWidth)} ${"Name".padEnd(14)} ${"Purpose".padEnd(28)} Install`,
  );
  lines.push(
    `  ${"─".repeat(statusWidth)} ${"─".repeat(14)} ${"─".repeat(28)} ${"─".repeat(36)}`,
  );
  for (const tool of report.tools) {
    const status = tool.found ? "✓ found" : "✗ missing";
    lines.push(
      `  ${status.padEnd(statusWidth)} ${tool.name.padEnd(14)} ${tool.purpose.padEnd(28)} ${tool.installHint}`,
    );
  }

  lines.push("");
  lines.push("  Environment:");
  lines.push(
    `  ${"Status".padEnd(statusWidth)} ${"Variable".padEnd(18)} ${"Purpose".padEnd(22)} Setup`,
  );
  lines.push(
    `  ${"─".repeat(statusWidth)} ${"─".repeat(18)} ${"─".repeat(22)} ${"─".repeat(30)}`,
  );
  for (const item of report.env) {
    const status = item.found ? "✓ set" : "✗ unset";
    lines.push(
      `  ${status.padEnd(statusWidth)} ${item.name.padEnd(18)} ${item.purpose.padEnd(22)} ${item.hint}`,
    );
  }

  lines.push("");
  lines.push(`  ${toolCount}/${report.tools.length} tools, ${envCount}/${report.env.length} API keys configured`);
  lines.push("");
  lines.push("  Capabilities:");
  lines.push("    ✓ Web page extraction     (built-in)");
  lines.push("    ✓ PDF extraction          (built-in)");
  lines.push(
    `    ${report.capabilities.youtube.available ? "✓" : "✗"} YouTube extraction       ${report.capabilities.youtube.available ? "(ready)" : "(needs yt-dlp)"}`,
  );
  lines.push(
    `    ${report.capabilities.aiSummary.available ? "✓" : "✗"} AI summarization        ${report.capabilities.aiSummary.available ? "(ready)" : "(needs AI provider)"}`,
  );

  if (report.capabilities.aiSummary.providers && report.capabilities.aiSummary.providers.length > 0) {
    lines.push("");
    lines.push(`  AI providers: ${report.capabilities.aiSummary.providers.join(", ")}`);
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
