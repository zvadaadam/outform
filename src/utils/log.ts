export interface ExtractLogger {
  log?(message: string): void;
  progress?(message: string): void;
  error?(message: string): void;
  success?(message: string): void;
  raw?(chunk: string): void;
  isTTY?: boolean;
}

export function createStderrLogger(
  stream: Pick<NodeJS.WriteStream, "write" | "isTTY"> = process.stderr,
): ExtractLogger {
  return {
    isTTY: stream.isTTY,
    raw(chunk: string) {
      stream.write(chunk);
    },
    log(message: string) {
      stream.write(`${message}\n`);
    },
    progress(message: string) {
      stream.write(`  → ${message}\n`);
    },
    error(message: string) {
      stream.write(`✗ ${message}\n`);
    },
    success(message: string) {
      stream.write(`✓ ${message}\n`);
    },
  };
}

export const stderrLogger = createStderrLogger();
export const silentLogger: ExtractLogger = { isTTY: false };

function emit(
  logger: ExtractLogger | undefined,
  method: keyof ExtractLogger,
  fallback: (message: string) => void,
  message: string,
): void {
  if (logger) {
    const handler = logger[method];
    if (typeof handler === "function") {
      handler(message);
    }
    return;
  }

  fallback(message);
}

export function log(message: string, logger?: ExtractLogger): void {
  emit(logger, "log", (value) => stderrLogger.log?.(value), message);
}

export function logProgress(message: string, logger?: ExtractLogger): void {
  emit(logger, "progress", (value) => stderrLogger.progress?.(value), message);
}

export function logError(message: string, logger?: ExtractLogger): void {
  emit(logger, "error", (value) => stderrLogger.error?.(value), message);
}

export function logSuccess(message: string, logger?: ExtractLogger): void {
  emit(logger, "success", (value) => stderrLogger.success?.(value), message);
}
