export function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function logProgress(message: string): void {
  process.stderr.write(`  → ${message}\n`);
}

export function logError(message: string): void {
  process.stderr.write(`✗ ${message}\n`);
}

export function logSuccess(message: string): void {
  process.stderr.write(`✓ ${message}\n`);
}
