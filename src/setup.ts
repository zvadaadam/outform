import { ExtractorError, setupFailedIssue } from "./errors";
import type { SetupTarget } from "./utils/deps";
import { hasCommand } from "./utils/deps";
import { logProgress, logSuccess } from "./utils/log";
import { spawn } from "./utils/process";

interface SetupConfig {
  target: SetupTarget;
  name: string;
  command: string;
  purpose: string;
  manualHints: string[];
  resolveAutoCommand(): Promise<string[] | null>;
}

export interface SetupPlan {
  target: SetupTarget;
  name: string;
  command: string;
  purpose: string;
  installed: boolean;
  autoInstallCommand: string[] | null;
  manualHints: string[];
}

export type InstallPlan = SetupPlan;

const SETUP_CONFIGS: Record<SetupTarget, SetupConfig> = {
  youtube: {
    target: "youtube",
    name: "yt-dlp",
    command: "yt-dlp",
    purpose: "Enable YouTube extraction",
    manualHints: ["brew install yt-dlp", "pip install yt-dlp"],
    async resolveAutoCommand() {
      if (await hasCommand("brew")) {
        return ["brew", "install", "yt-dlp"];
      }
      return null;
    },
  },
  whisper: {
    target: "whisper",
    name: "whisper.cpp",
    command: "whisper-cli",
    purpose: "Enable audio transcription fallback for YouTube",
    manualHints: ["brew install whisper-cpp"],
    async resolveAutoCommand() {
      if (await hasCommand("brew")) {
        return ["brew", "install", "whisper-cpp"];
      }
      return null;
    },
  },
  claude: {
    target: "claude",
    name: "claude CLI",
    command: "claude",
    purpose: "Enable AI summaries via Claude CLI",
    manualHints: ["npm install -g @anthropic-ai/claude-code"],
    async resolveAutoCommand() {
      if (await hasCommand("npm")) {
        return ["npm", "install", "-g", "@anthropic-ai/claude-code"];
      }
      return null;
    },
  },
  codex: {
    target: "codex",
    name: "codex CLI",
    command: "codex",
    purpose: "Enable AI summaries via Codex CLI",
    manualHints: ["npm install -g @openai/codex"],
    async resolveAutoCommand() {
      if (await hasCommand("npm")) {
        return ["npm", "install", "-g", "@openai/codex"];
      }
      return null;
    },
  },
};

export function getSetupTargets(): SetupTarget[] {
  return Object.keys(SETUP_CONFIGS) as SetupTarget[];
}

export function getSetupTargetLabels(): string[] {
  return [...getSetupTargets(), "all"];
}

export function isSetupTarget(value: string): value is SetupTarget {
  return value in SETUP_CONFIGS;
}

export async function getSetupPlan(target: SetupTarget): Promise<SetupPlan> {
  const config = SETUP_CONFIGS[target];
  const installed = await hasCommand(config.command);

  return {
    target: config.target,
    name: config.name,
    command: config.command,
    purpose: config.purpose,
    installed,
    autoInstallCommand: installed ? null : await config.resolveAutoCommand(),
    manualHints: config.manualHints,
  };
}

export function formatSetupPlan(plan: SetupPlan): string {
  const lines: string[] = [];

  lines.push(`extractor install ${plan.target}`);
  lines.push("");
  lines.push(`  Purpose: ${plan.purpose}`);
  lines.push(`  Tool: ${plan.name}`);
  lines.push(`  Status: ${plan.installed ? "already installed" : "missing"}`);
  lines.push("");

  if (plan.installed) {
    lines.push(`  ${plan.name} is already installed and ready.`);
    return lines.join("\n");
  }

  if (plan.autoInstallCommand) {
    lines.push(`  Automatic install: ${plan.autoInstallCommand.join(" ")}`);
    lines.push(`  Run \`extractor install ${plan.target}\` to install it automatically.`);
    lines.push("");
  }

  lines.push("  Manual install options:");
  for (const hint of plan.manualHints) {
    lines.push(`    - ${hint}`);
  }

  return lines.join("\n");
}

export async function getSetupPlans(): Promise<SetupPlan[]> {
  return Promise.all(getSetupTargets().map((target) => getSetupPlan(target)));
}

export function formatSetupPlans(plans: SetupPlan[]): string {
  const lines: string[] = [];

  lines.push("extractor install all");
  lines.push("");
  lines.push("  Installs every supported optional tool:");
  lines.push("");

  for (const plan of plans) {
    const status = plan.installed ? "already installed" : "missing";
    const install = plan.autoInstallCommand
      ? plan.autoInstallCommand.join(" ")
      : plan.manualHints.join(" | ");

    lines.push(`  - ${plan.name}: ${status}`);
    lines.push(`    ${plan.purpose}`);
    lines.push(`    Install: ${install}`);
  }

  lines.push("");
  lines.push("  Run `extractor install all` to install everything.");

  return lines.join("\n");
}

export async function runSetup(target: SetupTarget): Promise<void> {
  const plan = await getSetupPlan(target);

  if (plan.installed) {
    logSuccess(`${plan.name} is already installed.`);
    return;
  }

  if (!plan.autoInstallCommand) {
    throw new ExtractorError(
      setupFailedIssue({
        target: plan.target,
        name: plan.name,
        manualHints: plan.manualHints,
        message: `Automatic install is not available for ${plan.name} on this machine. Try one of: ${plan.manualHints.join(" | ")}`,
      }),
    );
  }

  logProgress(`Running: ${plan.autoInstallCommand.join(" ")}`);

  const proc = spawn(plan.autoInstallCommand, {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new ExtractorError(
      setupFailedIssue({
        target: plan.target,
        name: plan.name,
        manualHints: plan.manualHints,
      }),
    );
  }

  logSuccess(`${plan.name} is installed and ready.`);
}

export async function runSetupAll(): Promise<void> {
  for (const target of getSetupTargets()) {
    await runSetup(target);
  }
}

export const getInstallTargets = getSetupTargets;
export const getInstallTargetLabels = getSetupTargetLabels;
export const getInstallPlan = getSetupPlan;
export const getInstallPlans = getSetupPlans;
export const formatInstallPlan = formatSetupPlan;
export const formatInstallPlans = formatSetupPlans;
export const runInstall = runSetup;
export const runInstallAll = runSetupAll;
