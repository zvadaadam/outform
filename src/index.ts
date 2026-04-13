#!/usr/bin/env bun

export * from "./api";
export {
  probeEnvironment,
  getDoctorReport,
  formatDoctorReport,
  type DoctorReport,
} from "./utils/deps";
export {
  getSetupPlan,
  formatSetupPlan,
  getSetupTargets,
  runSetup,
  type SetupPlan,
} from "./setup";
export {
  createStderrLogger,
  stderrLogger,
  silentLogger,
  type ExtractLogger,
} from "./utils/log";
export {
  ExtractorError,
  type ExtractorErrorCode,
  type ExtractorIssue,
} from "./errors";

if (import.meta.main) {
  const { run } = await import("./cli");
  await run(process.argv.slice(2));
}
