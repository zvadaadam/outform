import { OutformError, setupFailedIssue } from "./errors";
import type { SetupTarget } from "./utils/deps";
import {
  defaultWhisperModelPath,
  findWhisperModel,
  hasCommand,
  manualInstallHintsFor,
  WHISPER_MODEL_URL,
} from "./utils/deps";
import { downloadFile } from "./utils/download";
import { log, logError, logProgress, logSuccess } from "./utils/log";
import { fileExists, spawn } from "./utils/process";
import { access, constants, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

export type SetupStep =
  | { kind: "command"; command: string[] }
  | { kind: "download"; url: string; destination: string; executable: boolean; label: string };

export type InstallStep = SetupStep;

interface SetupConfig {
  target: SetupTarget;
  name: string;
  command: string;
  purpose: string;
  resolveSteps(): Promise<SetupStep[] | null>;
}

export interface SetupPlan {
  target: SetupTarget;
  name: string;
  command: string;
  purpose: string;
  installed: boolean;
  autoInstallCommand: string[] | null;
  steps: SetupStep[] | null;
  manualHints: string[];
}

export type InstallPlan = SetupPlan;

export function ytDlpAssetName(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "linux") {
    if (arch === "x64") return "yt-dlp_linux";
    if (arch === "arm64") return "yt-dlp_linux_aarch64";
    return null;
  }
  if (platform === "darwin") return "yt-dlp_macos";
  return null;
}

async function isWritableDir(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveInstallDir(): Promise<string> {
  if (await isWritableDir("/usr/local/bin")) return "/usr/local/bin";
  return join(homedir(), ".local", "bin");
}

function isOnPath(dir: string): boolean {
  const pathValue = Object.entries(process.env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  return pathValue.split(delimiter).some((entry) => entry && resolve(entry) === resolve(dir));
}

const SETUP_CONFIGS: Record<SetupTarget, SetupConfig> = {
  youtube: {
    target: "youtube",
    name: "yt-dlp",
    command: "yt-dlp",
    purpose: "Enable YouTube extraction",
    async resolveSteps() {
      if (await hasCommand("yt-dlp")) return [];
      if (await hasCommand("brew")) {
        return [{ kind: "command", command: ["brew", "install", "yt-dlp"] }];
      }
      const asset = ytDlpAssetName(process.platform, process.arch);
      if (!asset) return null;
      const installDir = await resolveInstallDir();
      return [
        {
          kind: "download",
          url: `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`,
          destination: join(installDir, "yt-dlp"),
          executable: true,
          label: "yt-dlp standalone binary",
        },
      ];
    },
  },
  whisper: {
    target: "whisper",
    name: "whisper.cpp",
    command: "whisper-cli",
    purpose: "Enable audio transcription fallback for YouTube",
    async resolveSteps() {
      const steps: SetupStep[] = [];
      const hasBinary = (await hasCommand("whisper-cli")) || (await hasCommand("whisper-cpp"));

      if (!hasBinary) {
        if (!(await hasCommand("brew"))) return null;
        steps.push({ kind: "command", command: ["brew", "install", "whisper-cpp"] });
      }

      if (!(await findWhisperModel())) {
        steps.push({
          kind: "download",
          url: WHISPER_MODEL_URL,
          destination: defaultWhisperModelPath(),
          executable: false,
          label: "whisper base.en model (142 MB)",
        });
      }

      return steps;
    },
  },
  ffmpeg: {
    target: "ffmpeg",
    name: "ffmpeg",
    command: "ffmpeg",
    purpose: "Enable audio extraction for whisper transcription",
    async resolveSteps() {
      if (await hasCommand("ffmpeg")) return [];
      if (await hasCommand("brew")) {
        return [{ kind: "command", command: ["brew", "install", "ffmpeg"] }];
      }
      if (process.platform === "linux" && process.getuid?.() === 0 && (await hasCommand("apt-get"))) {
        return [
          { kind: "command", command: ["apt-get", "update"] },
          { kind: "command", command: ["apt-get", "install", "-y", "ffmpeg"] },
        ];
      }
      return null;
    },
  },
  claude: {
    target: "claude",
    name: "claude CLI",
    command: "claude",
    purpose: "Enable AI summaries via Claude CLI",
    async resolveSteps() {
      if (await hasCommand("claude")) return [];
      if (!(await hasCommand("npm"))) return null;
      return [{ kind: "command", command: ["npm", "install", "-g", "@anthropic-ai/claude-code"] }];
    },
  },
  codex: {
    target: "codex",
    name: "codex CLI",
    command: "codex",
    purpose: "Enable AI summaries via Codex CLI",
    async resolveSteps() {
      if (await hasCommand("codex")) return [];
      if (!(await hasCommand("npm"))) return null;
      return [{ kind: "command", command: ["npm", "install", "-g", "@openai/codex"] }];
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

export function describeSetupStep(step: SetupStep): string {
  if (step.kind === "command") return step.command.join(" ");
  return `download ${step.label}: ${step.url} → ${step.destination}`;
}

export async function getSetupPlan(target: SetupTarget): Promise<SetupPlan> {
  const config = SETUP_CONFIGS[target];
  const steps = await config.resolveSteps();
  const installed = steps !== null && steps.length === 0;
  const onlyStep = steps && steps.length === 1 ? steps[0] : null;

  return {
    target: config.target,
    name: config.name,
    command: config.command,
    purpose: config.purpose,
    installed,
    autoInstallCommand: onlyStep && onlyStep.kind === "command" ? onlyStep.command : null,
    steps,
    manualHints: manualInstallHintsFor(target),
  };
}

export function formatSetupPlan(plan: SetupPlan): string {
  const lines: string[] = [];

  lines.push(`outform install ${plan.target}`);
  lines.push("");
  lines.push(`  Purpose: ${plan.purpose}`);
  lines.push(`  Tool: ${plan.name}`);
  lines.push(`  Status: ${plan.installed ? "already installed" : "missing"}`);
  lines.push("");

  if (plan.installed) {
    lines.push(`  ${plan.name} is already installed and ready.`);
    return lines.join("\n");
  }

  if (plan.steps && plan.steps.length > 0) {
    if (plan.steps.length === 1) {
      lines.push(`  Automatic install: ${describeSetupStep(plan.steps[0]!)}`);
    } else {
      lines.push("  Automatic install:");
      for (const step of plan.steps) {
        lines.push(`    - ${describeSetupStep(step)}`);
      }
    }
    lines.push(`  Run \`outform install ${plan.target}\` to install it automatically.`);
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

  lines.push("outform install");
  lines.push("");
  lines.push("  Installs every supported optional tool:");
  lines.push("");

  for (const plan of plans) {
    const status = plan.installed ? "already installed" : "missing";
    const install =
      plan.steps && plan.steps.length > 0 ? plan.steps.map(describeSetupStep).join(", ") : plan.manualHints.join(" | ");

    lines.push(`  - ${plan.name}: ${status}`);
    lines.push(`    ${plan.purpose}`);
    lines.push(`    Install: ${install}`);
  }

  lines.push("");
  lines.push("  Run `outform install` to install everything.");

  return lines.join("\n");
}

async function runSetupStep(plan: SetupPlan, step: SetupStep): Promise<void> {
  if (step.kind === "command") {
    logProgress(`Running: ${step.command.join(" ")}`);

    const proc = spawn(step.command, {
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new OutformError(
        setupFailedIssue({
          target: plan.target,
          name: plan.name,
          manualHints: plan.manualHints,
        }),
      );
    }
    return;
  }

  try {
    await downloadFile(step.url, step.destination, { label: step.label, executable: step.executable });
  } catch (error) {
    throw new OutformError(
      setupFailedIssue({
        target: plan.target,
        name: plan.name,
        manualHints: plan.manualHints,
        message: `${plan.name} install failed: ${error instanceof Error ? error.message : String(error)}. Try one of: ${plan.manualHints.join(" | ")}`,
      }),
      { cause: error },
    );
  }
}

export async function runSetup(target: SetupTarget): Promise<void> {
  const plan = await getSetupPlan(target);

  if (plan.installed) {
    logSuccess(`${plan.name} is already installed.`);
    return;
  }

  if (!plan.steps || plan.steps.length === 0) {
    throw new OutformError(
      setupFailedIssue({
        target: plan.target,
        name: plan.name,
        manualHints: plan.manualHints,
        message: `Automatic install is not available for ${plan.name} on this machine. Try one of: ${plan.manualHints.join(" | ")}`,
      }),
    );
  }

  for (const step of plan.steps) {
    await runSetupStep(plan, step);
  }

  const remaining = await SETUP_CONFIGS[target].resolveSteps();
  if (remaining !== null && remaining.length === 0) {
    logSuccess(`${plan.name} is installed and ready.`);
    await warnAboutMissingCompanions(target);
    return;
  }

  const offPathBinaries = (
    await Promise.all(
      plan.steps
        .filter((step): step is Extract<SetupStep, { kind: "download" }> => step.kind === "download" && step.executable)
        .map(async (step) =>
          (await fileExists(step.destination)) && !isOnPath(dirname(step.destination)) ? step : null,
        ),
    )
  ).filter((step): step is Extract<SetupStep, { kind: "download" }> => step !== null);

  if (offPathBinaries.length > 0) {
    for (const step of offPathBinaries) {
      log(`  Installed to ${step.destination}, which is not on your PATH.`);
      log(`  Add it to your shell profile: export PATH="${dirname(step.destination)}:$PATH"`);
    }
    logSuccess(`${plan.name} is installed — PATH update required (see above).`);
    return;
  }

  throw new OutformError(
    setupFailedIssue({
      target: plan.target,
      name: plan.name,
      manualHints: plan.manualHints,
    }),
  );
}

async function warnAboutMissingCompanions(target: SetupTarget): Promise<void> {
  if (target !== "whisper") return;
  if (!(await hasCommand("ffmpeg"))) {
    logProgress("Note: audio transcription also needs ffmpeg — run `outform install ffmpeg`.");
  }
}

export async function runSetupAll(): Promise<void> {
  const failures: string[] = [];
  for (const target of getSetupTargets()) {
    try {
      await runSetup(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${target}: ${message}`);
      logError(message);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Could not install ${failures.length} optional tool${failures.length === 1 ? "" : "s"}. See the instructions above.`,
    );
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
