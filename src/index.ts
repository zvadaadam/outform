export * from "./api";
export {
  probeEnvironment,
  getDoctorReport,
  formatDoctorReport,
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
