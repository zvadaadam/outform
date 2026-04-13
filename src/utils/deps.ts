import { log } from "./log";

interface Dependency {
  name: string;
  command: string;
  installHint: string;
  purpose: string;
}

interface EnvVar {
  name: string;
  purpose: string;
  hint: string;
}

const TOOLS: Dependency[] = [
  {
    name: "yt-dlp",
    command: "yt-dlp",
    installHint: "brew install yt-dlp",
    purpose: "YouTube extraction",
  },
  {
    name: "whisper.cpp",
    command: "whisper-cpp",
    installHint: "brew install whisper-cpp",
    purpose: "Audio transcription fallback",
  },
  {
    name: "claude CLI",
    command: "claude",
    installHint: "npm i -g @anthropic-ai/claude-code",
    purpose: "AI summarization",
  },
  {
    name: "codex CLI",
    command: "codex",
    installHint: "npm i -g @openai/codex",
    purpose: "AI summarization",
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
    const proc = Bun.spawn(["which", cmd], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

export async function checkDependencies(): Promise<void> {
  log("extractor — dependency check\n");

  // Check tools
  const toolResults: { dep: Dependency; found: boolean }[] = [];
  for (const dep of TOOLS) {
    toolResults.push({ dep, found: await which(dep.command) });
  }

  // Check env vars
  const envResults: { env: EnvVar; found: boolean }[] = [];
  for (const env of ENV_VARS) {
    envResults.push({ env, found: !!process.env[env.name] });
  }

  // Print tools table
  const sc = 10;
  log("  Tools:");
  log(
    `  ${"Status".padEnd(sc)} ${"Name".padEnd(14)} ${"Purpose".padEnd(28)} Install`,
  );
  log(`  ${"─".repeat(sc)} ${"─".repeat(14)} ${"─".repeat(28)} ${"─".repeat(36)}`);
  for (const { dep, found } of toolResults) {
    const status = found ? "✓ found" : "✗ missing";
    log(
      `  ${status.padEnd(sc)} ${dep.name.padEnd(14)} ${dep.purpose.padEnd(28)} ${dep.installHint}`,
    );
  }

  // Print env vars table
  log("");
  log("  Environment:");
  log(
    `  ${"Status".padEnd(sc)} ${"Variable".padEnd(18)} ${"Purpose".padEnd(22)} Setup`,
  );
  log(`  ${"─".repeat(sc)} ${"─".repeat(18)} ${"─".repeat(22)} ${"─".repeat(30)}`);
  for (const { env, found } of envResults) {
    const status = found ? "✓ set" : "✗ unset";
    log(
      `  ${status.padEnd(sc)} ${env.name.padEnd(18)} ${env.purpose.padEnd(22)} ${env.hint}`,
    );
  }

  // Print capability summary
  const toolCount = toolResults.filter((r) => r.found).length;
  const envCount = envResults.filter((r) => r.found).length;
  const hasYtDlp = toolResults.find((r) => r.dep.command === "yt-dlp")?.found;
  const hasAi = toolResults.some(
    (r) => (r.dep.command === "claude" || r.dep.command === "codex") && r.found,
  ) || envResults.some((r) => r.found);

  log("");
  log(`  ${toolCount}/${TOOLS.length} tools, ${envCount}/${ENV_VARS.length} API keys configured`);
  log("");
  log("  Capabilities:");
  log(`    ✓ Web page extraction     (built-in)`);
  log(`    ✓ PDF extraction           (built-in)`);
  log(
    `    ${hasYtDlp ? "✓" : "✗"} YouTube extraction       ${hasYtDlp ? "(ready)" : "(needs yt-dlp)"}`,
  );
  log(
    `    ${hasAi ? "✓" : "✗"} AI summarization         ${hasAi ? "(ready)" : "(needs AI provider)"}`,
  );
  log("");
}

export async function hasCommand(cmd: string): Promise<boolean> {
  return which(cmd);
}
