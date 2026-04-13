import { log } from "./log";

interface Dependency {
  name: string;
  command: string;
  required: boolean;
  installHint: string;
}

const DEPENDENCIES: Dependency[] = [
  {
    name: "yt-dlp",
    command: "yt-dlp",
    required: false,
    installHint: "brew install yt-dlp",
  },
  {
    name: "whisper.cpp",
    command: "whisper-cpp",
    required: false,
    installHint: "brew install whisper-cpp",
  },
  {
    name: "claude CLI",
    command: "claude",
    required: false,
    installHint: "npm install -g @anthropic-ai/claude-code",
  },
  {
    name: "codex CLI",
    command: "codex",
    required: false,
    installHint: "npm install -g @openai/codex",
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
  log("Dependency check:\n");

  const maxName = Math.max(...DEPENDENCIES.map((d) => d.name.length));

  for (const dep of DEPENDENCIES) {
    const found = await which(dep.command);
    const status = found ? "✓" : "✗";
    const label = dep.name.padEnd(maxName + 2);
    const hint = found ? "" : `  (install: ${dep.installHint})`;
    log(`  ${status} ${label}${hint}`);
  }

  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

  log("");
  log(
    `  ${hasAnthropicKey ? "✓" : "✗"} ANTHROPIC_API_KEY  ${hasAnthropicKey ? "" : " (set env var for direct API access)"}`,
  );
  log(
    `  ${hasOpenAIKey ? "✓" : "✗"} OPENAI_API_KEY    ${hasOpenAIKey ? "" : " (set env var for OpenAI access)"}`,
  );
  log("");
}

export async function hasCommand(cmd: string): Promise<boolean> {
  return which(cmd);
}
