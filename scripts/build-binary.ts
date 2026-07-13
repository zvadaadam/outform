import { mkdir } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, resolve } from "node:path";

const targets = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-arm64",
  "bun-linux-x64",
  "bun-linux-x64-musl",
  "bun-windows-x64",
] as const;

type CompileTarget = (typeof targets)[number];

function currentTarget(): CompileTarget {
  const key = `${platform()}-${arch()}`;
  const targetByPlatform: Record<string, CompileTarget> = {
    "darwin-arm64": "bun-darwin-arm64",
    "darwin-x64": "bun-darwin-x64",
    "linux-arm64": "bun-linux-arm64",
    "linux-x64": "bun-linux-x64",
    "win32-x64": "bun-windows-x64",
  };
  const target = targetByPlatform[key];
  if (!target) throw new Error(`Unsupported build platform: ${key}`);
  return target;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const requestedTarget = argument("--target") ?? currentTarget();
if (!targets.includes(requestedTarget as CompileTarget)) {
  throw new Error(
    `Unsupported target "${requestedTarget}". Use one of: ${targets.join(", ")}`,
  );
}

const target = requestedTarget as CompileTarget;
const defaultName = `outform-${target.replace(/^bun-/, "")}${
  target.startsWith("bun-windows") ? ".exe" : ""
}`;
const outfile = resolve(argument("--outfile") ?? `artifacts/${defaultName}`);
await mkdir(dirname(outfile), { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve("src/bin.ts")],
  compile: {
    target,
    outfile,
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  minify: true,
  sourcemap: "linked",
  bytecode: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(outfile);
