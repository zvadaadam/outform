export * from "./api";
export {
  probeEnvironment,
  getDoctorReport,
  formatDoctorReport,
  findWhisperModel,
  installHintsFor,
  type DoctorReport,
} from "./utils/deps";
export {
  getInstallPlan,
  getInstallPlans,
  formatInstallPlan,
  formatInstallPlans,
  getInstallTargets,
  getInstallTargetLabels,
  runInstall,
  runInstallAll,
  getSetupPlan,
  getSetupPlans,
  formatSetupPlan,
  formatSetupPlans,
  getSetupTargets,
  getSetupTargetLabels,
  runSetup,
  runSetupAll,
  type InstallPlan,
  type InstallStep,
  type SetupPlan,
  type SetupStep,
} from "./setup";
export { createStderrLogger, stderrLogger, silentLogger, type ExtractLogger } from "./utils/log";
export { OutformError, type OutformErrorCode, type OutformIssue } from "./errors";
