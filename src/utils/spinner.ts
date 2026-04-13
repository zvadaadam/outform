import type { ExtractLogger } from "./log";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  stop(finalMessage?: string): void;
  update(message: string): void;
}

function noopSpinner(): Spinner {
  return {
    stop() {},
    update() {},
  };
}

export function spin(message: string, logger?: ExtractLogger): Spinner {
  const activeLogger = logger;

  if (!activeLogger) {
    process.stderr.write(`  → ${message}\n`);
    return {
      stop() {},
      update(msg: string) {
        process.stderr.write(`  → ${msg}\n`);
      },
    };
  }

  if (!activeLogger.raw || !activeLogger.progress) {
    return noopSpinner();
  }

  if (!activeLogger.isTTY) {
    activeLogger.progress(message);
    return {
      stop() {},
      update(msg: string) {
        activeLogger.progress?.(msg);
      },
    };
  }

  let current = message;
  let frameIndex = 0;

  const write = () => {
    const frame = frames[frameIndex % frames.length]!;
    activeLogger.raw?.(`\r  ${frame} ${current}`);
    frameIndex++;
  };

  write();
  const interval = setInterval(write, 80);

  return {
    stop(finalMessage?: string) {
      clearInterval(interval);
      const msg = finalMessage ?? current;
      activeLogger.raw?.(`\r  ✓ ${msg}\x1b[K\n`);
    },
    update(msg: string) {
      current = msg;
    },
  };
}
