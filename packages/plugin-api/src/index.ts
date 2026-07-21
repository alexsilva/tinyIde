export interface Disposable {
  dispose(): void;
}

export type CommandHandler<Arguments extends unknown[] = unknown[], Result = unknown> = (
  ...args: Arguments
) => Result | Promise<Result>;

export interface CommandRegistryApi {
  register<Arguments extends unknown[], Result>(
    id: string,
    handler: CommandHandler<Arguments, Result>,
  ): Disposable;

  execute<Result = unknown>(id: string, ...args: unknown[]): Promise<Result>;
  has(id: string): boolean;
  list(): readonly string[];
}

export type EventListener<Payload> = (payload: Payload) => void | Promise<void>;

export interface EventBusApi {
  on<Payload>(event: string, listener: EventListener<Payload>): Disposable;
  emit<Payload>(event: string, payload: Payload): Promise<void>;
}

export interface CapabilityRegistryApi {
  register<Provider>(id: string, provider: Provider): Disposable;
  get<Provider>(id: string): Provider;
  tryGet<Provider>(id: string): Provider | undefined;
  getAll<Provider>(id: string): readonly Provider[];
  has(id: string): boolean;
}

export interface PluginEngineRequirement {
  readonly tinyide: string;
}

export interface PluginEntrypoints {
  readonly frontend?: string;
  readonly backend?: string;
}

export type PluginCategory = "language" | "tool";

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly version: string;
  readonly publisher: string;
  readonly category: PluginCategory;
  readonly engines: PluginEngineRequirement;
  readonly entrypoints?: PluginEntrypoints;
  readonly activationEvents?: readonly string[];
  readonly permissions?: readonly string[];
  readonly contributes?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
}

export type PluginState =
  | "discovered"
  | "installed"
  | "disabled"
  | "enabled"
  | "activating"
  | "active"
  | "deactivating"
  | "failed"
  | "uninstalled";

export interface PluginRecord {
  readonly manifest: PluginManifest;
  readonly state: PluginState;
  readonly installedAt: string;
  readonly error?: string;
}

export interface PluginContext {
  readonly commands: CommandRegistryApi;
  readonly events: EventBusApi;
  readonly capabilities: CapabilityRegistryApi;
  readonly subscriptions: Disposable[];
}

export interface PluginModule {
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export type DiagnosticSeverity = "error" | "warning" | "information";

export interface TextDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly code?: string;
}

export interface SyntaxToken {
  readonly start: number;
  readonly end: number;
  readonly scope:
    | "keyword"
    | "string"
    | "number"
    | "comment"
    | "function"
    | "class"
    | "decorator"
    | "builtin"
    | "operator";
}

export interface ScriptExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
}

export type ExecutionProfileEnvironmentBinding =
  | { readonly mode: "none" }
  | { readonly mode: "fixed"; readonly environmentId: string };

export interface ExecutionProfileStep {
  readonly id: string;
  readonly name: string;
  readonly executable: string;
  readonly command: string;
  readonly parameters: readonly string[];
  readonly workingDirectory?: string;
  readonly environmentVariables?: Readonly<Record<string, string>>;
  readonly continueOnError?: boolean;
}

export interface ExecutionProfile {
  readonly id: string;
  readonly name: string;
  readonly environment: ExecutionProfileEnvironmentBinding;
  readonly steps: readonly ExecutionProfileStep[];
  readonly saveBeforeRun?: boolean;
}

export interface ExecutionProfileVariableContext {
  readonly workspaceRoot?: string;
  readonly activeFile?: string;
  readonly activeFileDirectory?: string;
  readonly activeFileName?: string;
  readonly environmentExecutable?: string;
  readonly environmentPath?: string;
}

export interface ResolvedExecutionProfileStep {
  readonly id: string;
  readonly name: string;
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory?: string;
  readonly environmentVariables?: Readonly<Record<string, string>>;
  readonly continueOnError: boolean;
}

export interface ProcessExecutionRequest {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory?: string;
  readonly environmentVariables?: Readonly<Record<string, string>>;
}

export interface ExecutionProfileContributionContext {
  readonly workspaceName?: string;
  readonly activeFileName?: string;
  readonly activeFilePath?: string;
}

export interface ExecutionProfileExecutableOption {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly environmentId?: string;
}

export interface ExecutionProfileVariableContribution {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
}

export interface ExecutionProfilePresetContribution {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  create(context: ExecutionProfileContributionContext): ExecutionProfile;
}

export interface ExecutionProfileContributionProvider {
  readonly id: string;
  readonly name: string;
  executableOptions?(
    context: ExecutionProfileContributionContext,
  ): Promise<readonly ExecutionProfileExecutableOption[]> | readonly ExecutionProfileExecutableOption[];
  variables?(
    context: ExecutionProfileContributionContext,
  ): Promise<readonly ExecutionProfileVariableContribution[]> | readonly ExecutionProfileVariableContribution[];
  presets?(
    context: ExecutionProfileContributionContext,
  ): Promise<readonly ExecutionProfilePresetContribution[]> | readonly ExecutionProfilePresetContribution[];
}

export const EXECUTION_PROFILE_CONTRIBUTION_CAPABILITY = "execution.profile.contribution";

export interface LanguageProvider {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  highlight(source: string): readonly SyntaxToken[];
  lint(source: string, fileName: string): Promise<readonly TextDiagnostic[]>;
}

export const LANGUAGE_PROVIDER_CAPABILITY = "language.provider";

export type ExecutionEnvironmentType = "process" | "venv";

export type ExecutionEnvironmentStatus = "ready" | "creating" | "error";

export interface ExecutionEnvironment {
  readonly id: string;
  readonly name: string;
  readonly type: ExecutionEnvironmentType;
  readonly status: ExecutionEnvironmentStatus;
  readonly executable?: string;
  readonly path?: string;
  readonly version?: string;
  readonly packages?: readonly string[];
  readonly error?: string;
}

export interface ExecutionEnvironmentCreateVenvRequest {
  readonly name: string;
  readonly pythonExecutable: string;
  readonly path?: string;
}

export interface ExecutionEnvironmentAddProcessRequest {
  readonly name: string;
  readonly executable: string;
}

export interface ExecutionEnvironmentAddVenvRequest {
  readonly name?: string;
  readonly path: string;
}

export interface ExecutionEnvironmentDirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly hidden: boolean;
  readonly isEnvironment: boolean;
  readonly executable: boolean;
}

export interface ExecutionEnvironmentDirectoryListing {
  readonly path: string;
  readonly parentPath?: string;
  readonly mode: "directory" | "file";
  readonly includeHidden: boolean;
  readonly filter: string;
  readonly isEnvironment: boolean;
  readonly entries: readonly ExecutionEnvironmentDirectoryEntry[];
}

export interface ExecutionEnvironmentBrowseRequest {
  readonly path?: string;
  readonly mode?: "directory" | "file";
  readonly includeHidden?: boolean;
  readonly filter?: string;
}

export interface ExecutionEnvironmentRunRequest {
  readonly mode?: "source" | "script" | "module";
  readonly source?: string;
  readonly fileName?: string;
  readonly scriptPath?: string;
  readonly moduleName?: string;
  readonly args?: readonly string[];
  readonly workingDirectory?: string;
  readonly environmentVariables?: Readonly<Record<string, string>>;
}

export interface ExecutionEnvironmentProvider {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  list(): Promise<readonly ExecutionEnvironment[]>;
  createVenv(request: ExecutionEnvironmentCreateVenvRequest): Promise<ExecutionEnvironment>;
  addProcess(request: ExecutionEnvironmentAddProcessRequest): Promise<ExecutionEnvironment>;
  addVenv(request: ExecutionEnvironmentAddVenvRequest): Promise<ExecutionEnvironment>;
  browse?(request?: ExecutionEnvironmentBrowseRequest): Promise<ExecutionEnvironmentDirectoryListing>;
  validatePythonExecutable?(path: string): Promise<{ readonly executable: string; readonly version: string }>;
  remove(environmentId: string): Promise<void>;
  installPackages(environmentId: string, packages: readonly string[]): Promise<ExecutionEnvironment>;
  run(
    environmentId: string,
    request: ExecutionEnvironmentRunRequest,
  ): Promise<ScriptExecutionResult>;
}

export const EXECUTION_ENVIRONMENT_CAPABILITY = "execution.environment";

export interface PluginHost {
  activate(plugin: PluginRecord, context: PluginContext): Promise<void>;
  deactivate(plugin: PluginRecord): Promise<void>;
}
