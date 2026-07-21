export { CapabilityRegistry } from "./capability-registry";
export {
  formatCommandLineArguments,
  parseCommandLineArguments,
} from "./command-line-arguments";
export { CommandRegistry } from "./command-registry";
export { EventBus } from "./event-bus";
export {
  ExecutionProfileManager,
  expandExecutionVariables,
  resolveExecutionProfile,
} from "./execution-profile-manager";
export { ModulePluginHost } from "./module-plugin-host";
export type { ModulePluginHostOptions } from "./module-plugin-host";
export { InvalidPluginManifestError, validatePluginManifest } from "./plugin-manifest";
export { PluginManager } from "./plugin-manager";
export type { PluginManagerOptions } from "./plugin-manager";
export { parseVersion, satisfiesVersion } from "./version";

export { inferWorkspaceRoot } from "./workspace-root";
export type { WorkspaceRootResolutionInput } from "./workspace-root";
