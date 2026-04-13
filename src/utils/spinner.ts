const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  stop(finalMessage?: string): void;
  update(message: string): void;
}

export function spin(message: string): Spinner {
  if (!process.stderr.isTTY) {
    process.stderr.write(`  → ${message}\n`);
    return {
      stop() {},
      update(msg: string) {
        process.stderr.write(`  → ${msg}\n`);
      },
    };
  }

  let current = message;
  let frameIndex = 0;

  const write = () => {
    const frame = frames[frameIndex % frames.length]!;
    process.stderr.write(`\r  ${frame} ${current}`);
    frameIndex++;
  };

  write();
  const interval = setInterval(write, 80);

  return {
    stop(finalMessage?: string) {
      clearInterval(interval);
      const msg = finalMessage ?? current;
      process.stderr.write(`\r  ✓ ${msg}\x1b[K\n`);
    },
    update(msg: string) {
      current = msg;
    },
  };
}
