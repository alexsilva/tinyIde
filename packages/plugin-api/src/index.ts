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

export interface LanguageProvider {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  highlight(source: string): readonly SyntaxToken[];
  lint(source: string, fileName: string): Promise<readonly TextDiagnostic[]>;
  run?(source: string, fileName: string): Promise<ScriptExecutionResult>;
}

export const LANGUAGE_PROVIDER_CAPABILITY = "language.provider";

export interface ExecutionEnvironment {
  readonly id: string;
  readonly name: string;
  readonly status: "ready" | "creating" | "error";
  readonly executable?: string;
  readonly path?: string;
  readonly managed?: boolean;
  readonly version?: string;
  readonly packages?: readonly string[];
  readonly error?: string;
}

export interface EnvironmentCreateRequest {
  readonly name: string;
  readonly path?: string;
}

export interface EnvironmentImportRequest {
  readonly path: string;
  readonly name?: string;
}

export interface EnvironmentDirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly isEnvironment: boolean;
}

export interface EnvironmentDirectoryListing {
  readonly path: string;
  readonly parentPath?: string;
  readonly isEnvironment: boolean;
  readonly entries: readonly EnvironmentDirectoryEntry[];
}

export interface EnvironmentExecutionRequest {
  readonly source: string;
  readonly fileName: string;
  readonly args?: readonly string[];
}

export interface ExecutionEnvironmentProvider {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  list(): Promise<readonly ExecutionEnvironment[]>;
  create(request: EnvironmentCreateRequest): Promise<ExecutionEnvironment>;
  importExisting(request: EnvironmentImportRequest): Promise<ExecutionEnvironment>;
  browseDirectories?(path?: string): Promise<EnvironmentDirectoryListing>;
  remove(environmentId: string): Promise<void>;
  installPackages(environmentId: string, packages: readonly string[]): Promise<ExecutionEnvironment>;
  run(
    environmentId: string,
    request: EnvironmentExecutionRequest,
  ): Promise<ScriptExecutionResult>;
}

export const EXECUTION_ENVIRONMENT_CAPABILITY = "execution.environment";

export interface PluginHost {
  activate(plugin: PluginRecord, context: PluginContext): Promise<void>;
  deactivate(plugin: PluginRecord): Promise<void>;
}
