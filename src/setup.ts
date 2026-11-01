import { OutformError, setupFailedIssue, type OutformIssue } from "./errors";
import {
  defaultWhisperModelPath,
  findWhisperModel,
  hasCommand,
  manualInstallHintsFor,
  WHISPER_MODEL_URL,
  WHISPER_MODEL_SHA256,
  type SetupTarget,
} from "./utils/deps";
import { downloadFile } from "./utils/download";
import { logError, logProgress, logSuccess } from "./utils/log";
import {
  spawn,
  toolPath,
  waitForResult,
  managedToolTarget,
  recordManagedTool,
  verifyWhisperExecutable,
} from "./utils/process";
import assets from "./utils/tool-assets.json";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile, symlink, realpath } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { unzipSync } from "fflate";

export type SetupStep =
  | { kind: "command"; command: string[] }
  | { kind: "download"; url: string; destination: string; executable: boolean; label: string; sha256?: string }
  | { kind: "zip"; url: string; destination: string; label: string; sha256: string; files: string[] }
  | { kind: "tar"; url: string; destination: string; label: string; sha256: string; directory: string; files: string[] }
  | { kind: "homebrew-whisper"; brew: string; destination: string }
  | { kind: "linux-whisper-runtime" };
export type InstallStep = SetupStep;

interface SetupConfig {
  target: SetupTarget;
  name: string;
  command: string;
  purpose: string;
  dependencies?: SetupTarget[];
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
export interface SetupResult {
  target: SetupTarget;
  status: "ready" | "failed";
  issue?: OutformIssue;
}
export interface SetupReport {
  ready: boolean;
  results: SetupResult[];
}

export const EXTRACTION_TARGETS: SetupTarget[] = ["youtube", "whisper"];

export function ytDlpAssetName(platform: NodeJS.Platform, arch: string, musl = false): string | null {
  if (platform === "linux") {
    const prefix = musl ? "yt-dlp_musllinux" : "yt-dlp_linux";
    if (arch === "x64") return prefix;
    if (arch === "arm64") return `${prefix}_aarch64`;
  }
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) return "yt-dlp_macos";
  if (platform === "win32") {
    if (arch === "x64") return "yt-dlp.exe";
    if (arch === "arm64") return "yt-dlp_arm64.exe";
  }
  return null;
}

function isMusl(): boolean {
  if (process.platform !== "linux") return false;
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return !report?.header?.glibcVersionRuntime;
}

function binaryDownload(tool: "youtube" | "ffmpeg", asset: string, command: string): SetupStep | null {
  const release = assets[tool];
  const sha256 = (release.sha256 as Record<string, string>)[asset];
  return sha256
    ? {
        kind: "download",
        url: release.baseUrl + asset,
        destination: toolPath(command),
        executable: true,
        label: `${command} ${release.version}`,
        sha256,
      }
    : null;
}

const SETUP_CONFIGS: Record<SetupTarget, SetupConfig> = {
  youtube: {
    target: "youtube",
    name: "yt-dlp",
    command: "yt-dlp",
    purpose: "Enable YouTube extraction",
    dependencies: ["deno"],
    async resolveSteps() {
      if (await hasCommand("yt-dlp")) return [];
      const asset = ytDlpAssetName(process.platform, process.arch, isMusl());
      const step = asset && binaryDownload("youtube", asset, "yt-dlp");
      return step ? [step] : null;
    },
  },
  whisper: {
    target: "whisper",
    name: "whisper.cpp",
    command: "whisper-cli",
    purpose: "Enable audio transcription fallback for YouTube",
    dependencies: ["ffmpeg"],
    async resolveSteps() {
      const steps: SetupStep[] = [];
      if (process.env.WHISPER_MODEL && !(await findWhisperModel())) {
        throw new Error("WHISPER_MODEL must point to a nonempty model file; unset it to install outform's model.");
      }
      if (!(await hasCommand("whisper-cli"))) {
        if (process.platform === "win32" && process.arch === "x64") {
          steps.push({
            kind: "zip",
            url: assets.whisper.baseUrl + "whisper-bin-x64.zip",
            sha256: assets.whisper.sha256["whisper-bin-x64.zip"],
            destination: dirname(toolPath("whisper-cli")),
            label: `whisper.cpp ${assets.whisper.version}`,
            files: ["whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll"],
          });
        } else if (process.platform === "darwin") {
          const brew = await findHomebrew();
          if (!brew) return null;
          steps.push({ kind: "homebrew-whisper", brew, destination: toolPath("whisper-cli") });
        } else if (process.platform === "linux" && !isMusl()) {
          const release = assets.whisper.linux;
          const asset = `whisper-bin-ubuntu-${process.arch}.tar.gz`;
          const sha256 = (release.sha256 as Record<string, string>)[asset];
          const files = (release.files as Record<string, string[]>)[process.arch];
          if (!sha256 || !files || !(await hasCommand("tar"))) return null;
          steps.push(
            {
              kind: "tar",
              url: release.baseUrl + asset,
              sha256,
              destination: dirname(toolPath("whisper-cli")),
              label: `whisper.cpp ${release.version}`,
              directory: `whisper-bin-ubuntu-${process.arch}`,
              files,
            },
            { kind: "linux-whisper-runtime" },
          );
        } else return null;
      }
      if (!(await findWhisperModel())) {
        steps.push({
          kind: "download",
          url: WHISPER_MODEL_URL,
          destination: defaultWhisperModelPath(),
          executable: false,
          label: "whisper base.en model (148 MB)",
          sha256: WHISPER_MODEL_SHA256,
        });
      }
      return steps;
    },
  },
  ffmpeg: {
    target: "ffmpeg",
    name: "ffmpeg",
    command: "ffmpeg",
    purpose: "Enable audio conversion and probing",
    async resolveSteps() {
      const steps: SetupStep[] = [];
      for (const command of ["ffmpeg", "ffprobe"]) {
        if (await hasCommand(command)) continue;
        const step = binaryDownload("ffmpeg", `${command}-${process.platform}-${process.arch}`, command);
        if (!step) return null;
        steps.push(step);
      }
      return steps;
    },
  },
  deno: {
    target: "deno",
    name: "Deno",
    command: "deno",
    purpose: "Enable YouTube JavaScript challenges",
    async resolveSteps() {
      if (await hasCommand("deno")) return [];
      // Official Deno builds require glibc on Linux.
      if (isMusl()) return null;
      const arch = ({ x64: "x86_64", arm64: "aarch64" } as Record<string, string>)[process.arch];
      const platform = (
        { darwin: "apple-darwin", linux: "unknown-linux-gnu", win32: "pc-windows-msvc" } as Record<string, string>
      )[process.platform];
      const asset = `deno-${arch}-${platform}.zip`;
      const sha256 = (assets.deno.sha256 as Record<string, string>)[asset];
      return sha256
        ? [
            {
              kind: "zip",
              url: assets.deno.baseUrl + asset,
              sha256,
              destination: dirname(toolPath("deno")),
              label: `Deno ${assets.deno.version}`,
              files: [basename(toolPath("deno"))],
            },
          ]
        : null;
    },
  },
  claude: {
    target: "claude",
    name: "claude CLI",
    command: "claude",
    purpose: "Enable AI chapter generation via Claude CLI",
    async resolveSteps() {
      if (await hasCommand("claude")) return [];
      return (await hasCommand("npm"))
        ? [{ kind: "command", command: ["npm", "install", "-g", "@anthropic-ai/claude-code"] }]
        : null;
    },
  },
  codex: {
    target: "codex",
    name: "codex CLI",
    command: "codex",
    purpose: "Enable AI chapter generation via Codex CLI",
    async resolveSteps() {
      if (await hasCommand("codex")) return [];
      return (await hasCommand("npm"))
        ? [{ kind: "command", command: ["npm", "install", "-g", "@openai/codex"] }]
        : null;
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
  return Object.hasOwn(SETUP_CONFIGS, value);
}

function expandTargets(targets: SetupTarget[]): SetupTarget[] {
  const result = new Set<SetupTarget>();
  function visit(target: SetupTarget) {
    for (const dependency of SETUP_CONFIGS[target].dependencies ?? []) visit(dependency);
    result.add(target);
  }
  targets.forEach(visit);
  return [...result];
}

export function describeSetupStep(step: SetupStep): string {
  if (step.kind === "command") return step.command.join(" ");
  if (step.kind === "homebrew-whisper")
    return `use compatible Homebrew whisper.cpp or install with ${step.brew} install --force-bottle whisper.cpp → ${step.destination}`;
  if (step.kind === "linux-whisper-runtime")
    return "verify Whisper runtime; if missing, install libgomp1 / libstdc++6 with apt when running as root";
  return `download ${step.label}: ${step.url} → ${step.destination}`;
}

async function directPlan(target: SetupTarget): Promise<SetupPlan> {
  const config = SETUP_CONFIGS[target];
  const steps = await config.resolveSteps();
  const only = steps?.length === 1 ? steps[0] : null;
  return {
    target,
    name: config.name,
    command: config.command,
    purpose: config.purpose,
    installed: steps !== null && steps.length === 0,
    autoInstallCommand: only?.kind === "command" ? only.command : null,
    steps,
    manualHints: manualInstallHintsFor(target),
  };
}

export async function getSetupPlan(target: SetupTarget): Promise<SetupPlan> {
  const plans = await getSetupPlans([target]);
  const own = plans.find((plan) => plan.target === target)!;
  const steps = plans.some((plan) => plan.steps === null) ? null : plans.flatMap((plan) => plan.steps!);
  return {
    ...own,
    installed: plans.every((plan) => plan.installed),
    steps,
    autoInstallCommand: steps?.length === 1 && steps[0]?.kind === "command" ? steps[0].command : null,
    manualHints: [...new Set(plans.filter((plan) => !plan.installed).flatMap((plan) => plan.manualHints))],
  };
}

export function getSetupPlans(targets = getSetupTargets()): Promise<SetupPlan[]> {
  return Promise.all(expandTargets(targets).map(directPlan));
}

export function formatSetupPlan(plan: SetupPlan): string {
  const lines = [
    `outform install ${plan.target}`,
    "",
    `  Purpose: ${plan.purpose}`,
    `  Tool: ${plan.name}`,
    `  Status: ${plan.installed ? "already installed" : "missing"}`,
    "",
  ];
  if (plan.installed) return [...lines, `  ${plan.name} is already installed and ready.`].join("\n");
  if (plan.steps?.length) {
    if (plan.steps.length === 1) lines.push(`  Automatic install: ${describeSetupStep(plan.steps[0]!)}`);
    else lines.push("  Automatic install:", ...plan.steps.map((step) => `    - ${describeSetupStep(step)}`));
  }
  lines.push("  Manual install options:", ...plan.manualHints.map((hint) => `    - ${hint}`));
  return lines.join("\n");
}

export function formatSetupPlans(plans: SetupPlan[]): string {
  return [
    "outform install — setup plan",
    "",
    ...plans.map(formatSetupPlan),
    "",
    "Run `outform install` to prepare extraction; `outform install all` also installs AI CLIs.",
  ].join("\n");
}

async function runCommand(command: string[]): Promise<void> {
  logProgress(`Running: ${command.join(" ")}`);
  const proc = spawn(command, { stdout: "stderr", stderr: "inherit" });
  if ((await proc.exited) !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}

async function installZip(step: Extract<SetupStep, { kind: "zip" }>): Promise<void> {
  await mkdir(step.destination, { recursive: true });
  const dir = await mkdtemp(join(step.destination, ".install-"));
  try {
    const archive = join(dir, "tool.zip");
    await downloadFile(step.url, archive, step);
    const files = unzipSync(await readFile(archive), { filter: (file) => step.files.includes(basename(file.name)) });
    for (const expected of step.files) {
      if (!Object.keys(files).some((name) => basename(name) === expected))
        throw new Error(`Missing ${expected} in archive`);
    }
    await mkdir(step.destination, { recursive: true });
    // Flatten only explicitly allowed filenames. Publish the executable last, after its libraries.
    for (const [name, data] of Object.entries(files).sort(
      ([a], [b]) => Number(basename(a) === step.files[0]) - Number(basename(b) === step.files[0]),
    )) {
      const staged = join(dir, basename(name));
      await writeFile(staged, data, { mode: 0o755 });
      await rename(staged, join(step.destination, basename(name)));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function findHomebrew(): Promise<string | null> {
  for (const command of ["brew", "/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) {
    if (await hasCommand(command)) return command;
  }
  return null;
}

export function compatibleWhisperVersion(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:_\d+)?$/);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  const minimum = assets.whisper.homebrew.minimumVersion.split(".").map(Number);
  if (actual[0] !== minimum[0]) return false;
  return actual[1]! > minimum[1]! || (actual[1] === minimum[1] && actual[2]! >= minimum[2]!);
}

async function homebrewWhisper(step: Extract<SetupStep, { kind: "homebrew-whisper" }>): Promise<void> {
  const formula = assets.whisper.homebrew.formula;
  const installed = await waitForResult(spawn([step.brew, "list", "--versions", formula]));
  let versions = installed.stdout.trim().split(/\s+/).slice(1);
  if (installed.exitCode !== 0 || !versions.some(compatibleWhisperVersion)) {
    await runCommand([step.brew, "install", "--force-bottle", formula]);
    const result = await waitForResult(spawn([step.brew, "list", "--versions", formula]));
    versions = result.exitCode === 0 ? result.stdout.trim().split(/\s+/).slice(1) : [];
  }
  if (!versions.some(compatibleWhisperVersion)) {
    throw new Error(
      `Homebrew whisper.cpp must be >= ${assets.whisper.homebrew.minimumVersion} and < 2.0.0; run brew upgrade whisper.cpp`,
    );
  }
  const prefix = await waitForResult(spawn([step.brew, "--prefix", formula]));
  if (prefix.exitCode !== 0 || !prefix.stdout.trim()) throw new Error("Could not locate Homebrew whisper.cpp");
  const executable = join(prefix.stdout.trim(), "bin", "whisper-cli");
  if (!(await hasCommand(executable))) throw new Error(`Homebrew whisper-cli is missing: ${executable}`);
  const linkedVersion = basename(dirname(dirname(await realpath(executable))));
  if (!compatibleWhisperVersion(linkedVersion)) {
    throw new Error(
      `Linked Homebrew whisper.cpp ${linkedVersion} is unsupported; expected >= ${assets.whisper.homebrew.minimumVersion} and < 2.0.0`,
    );
  }
  await mkdir(dirname(step.destination), { recursive: true });
  const dir = await mkdtemp(join(dirname(step.destination), ".link-"));
  try {
    const staged = join(dir, "whisper-cli");
    await symlink(executable, staged);
    await rename(staged, step.destination);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function installTar(step: Extract<SetupStep, { kind: "tar" }>): Promise<void> {
  await mkdir(step.destination, { recursive: true });
  const dir = await mkdtemp(join(step.destination, ".install-"));
  try {
    const archive = join(dir, "tool.tar.gz");
    await downloadFile(step.url, archive, step);
    await runCommand(["tar", "-xzf", archive, "-C", dir, ...step.files.map((file) => `${step.directory}/${file}`)]);
    // Read every required file before publishing, dereferencing the pinned archive's library symlinks.
    const files = await Promise.all(
      step.files.map(async (file) => ({ file, data: await readFile(join(dir, step.directory, file)) })),
    );
    for (const { file, data } of files.sort(
      (a, b) => Number(a.file === "whisper-cli") - Number(b.file === "whisper-cli"),
    )) {
      const staged = join(dir, file);
      await writeFile(staged, data, { mode: 0o755 });
      await rename(staged, join(step.destination, file));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ensureWhisperRuntime(): Promise<void> {
  try {
    await verifyWhisperExecutable();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/libgomp\.so|libstdc\+\+\.so/.test(message)) throw error;
    if (process.getuid?.() === 0 && (await hasCommand("apt-get"))) {
      await runCommand(["apt-get", "update"]);
      await runCommand(["apt-get", "install", "-y", "--no-install-recommends", "libgomp1", "libstdc++6"]);
      await verifyWhisperExecutable();
      return;
    }
    throw new Error(
      "Whisper needs the OpenMP and C++ runtimes. On Debian/Ubuntu run: sudo apt-get update && sudo apt-get install -y libgomp1 libstdc++6",
    );
  }
}

async function runSetupStep(step: SetupStep): Promise<void> {
  if (step.kind === "command") return runCommand(step.command);
  if (step.kind === "zip") return installZip(step);
  if (step.kind === "tar") return installTar(step);
  if (step.kind === "homebrew-whisper") return homebrewWhisper(step);
  if (step.kind === "linux-whisper-runtime") return ensureWhisperRuntime();
  await downloadFile(step.url, step.destination, step);
}

async function verifyTool(target: SetupTarget): Promise<void> {
  if (target === "whisper") {
    logProgress(
      process.platform === "darwin"
        ? "Checking Whisper; Metal startup may take a minute or two..."
        : "Checking Whisper runtime...",
    );
    return verifyWhisperExecutable();
  }
  const config = SETUP_CONFIGS[target];
  const command = config.command;
  const commands = target === "ffmpeg" ? ["ffmpeg", "ffprobe"] : [command];
  for (const name of commands) {
    const flag = target === "ffmpeg" ? "-version" : "--version";
    const proc = spawn([name, flag]);
    const timer = setTimeout(() => proc.kill(), 15_000);
    try {
      const result = await waitForResult(proc);
      if (result.exitCode !== 0) throw new Error(`${name} could not run: ${result.stderr.trim()}`);
      const output = result.stdout + "\n" + result.stderr;
      if (target === "youtube" && result.stdout.trim() !== assets.youtube.version) {
        throw new Error(`yt-dlp must be ${assets.youtube.version}; got ${result.stdout.trim() || "no version"}`);
      }
      if (target === "deno" && output.match(/^deno (\d+\.\d+\.\d+)/m)?.[1] !== assets.deno.version.slice(1)) {
        throw new Error(`Deno must be ${assets.deno.version}; got ${output.trim().split("\n")[0] || "no version"}`);
      }
      if (target === "ffmpeg" && Number(output.match(/^(?:ffmpeg|ffprobe) version n?(\d+)\./m)?.[1] ?? 0) < 6) {
        throw new Error(`${name} did not report a supported version (6 or later)`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function installTargets(targets: SetupTarget[] = EXTRACTION_TARGETS): Promise<SetupReport> {
  const results: SetupResult[] = [];
  for (const target of expandTargets(targets)) {
    const config = SETUP_CONFIGS[target];
    try {
      const plan = await directPlan(target);
      if (plan.steps === null)
        throw new Error(`Automatic install is unavailable on this machine. ${plan.manualHints.join(" | ")}`);
      for (const step of plan.steps) await runSetupStep(step);
      await verifyTool(target);
      const managedTarget = managedToolTarget(config.command);
      if (managedTarget) await recordManagedTool(managedTarget);
      if (!(await directPlan(target)).installed) throw new Error("Setup finished but required files are still missing");
      results.push({ target, status: "ready" });
      logSuccess(`${config.name} is ${plan.installed ? "already installed" : "installed"} and ready.`);
    } catch (error) {
      const issue = setupFailedIssue({
        target,
        name: config.name,
        manualHints: manualInstallHintsFor(target),
        message: `${config.name}: ${error instanceof Error ? error.message : String(error)}. Rerun \`outform install\` after fixing this.`,
      });
      results.push({ target, status: "failed", issue });
      logError(issue.message);
    }
  }
  return { ready: results.every((result) => result.status === "ready"), results };
}

export async function runSetup(target: SetupTarget): Promise<void> {
  const report = await installTargets([target]);
  const failure = report.results.find((result) => result.issue);
  if (failure?.issue) throw new OutformError(failure.issue);
}
export async function runSetupAll(): Promise<void> {
  const report = await installTargets(getSetupTargets());
  const failure = report.results.find((result) => result.issue);
  if (failure?.issue) throw new OutformError(failure.issue);
}

export const getInstallTargets = getSetupTargets;
export const getInstallTargetLabels = getSetupTargetLabels;
export const getInstallPlan = getSetupPlan;
export const getInstallPlans = getSetupPlans;
export const formatInstallPlan = formatSetupPlan;
export const formatInstallPlans = formatSetupPlans;
export const runInstall = runSetup;
export const runInstallAll = runSetupAll;
