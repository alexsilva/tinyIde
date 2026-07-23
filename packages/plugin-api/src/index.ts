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

export interface PluginBackendRequestOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export interface PluginBackendApi {
  request<Response = unknown>(
    path: string,
    options?: PluginBackendRequestOptions,
  ): Promise<Response>;
}

export interface PluginContext {
  readonly backend: PluginBackendApi;
  readonly commands: CommandRegistryApi;
  readonly events: EventBusApi;
  readonly extensions: PluginExtensionApi;
  readonly workbench: WorkbenchApi;
  readonly subscriptions: Disposable[];
}

export interface PluginExtensionApi {
  registerLanguageProvider(provider: LanguageProvider): Disposable;
  registerResourceIconProvider(provider: ResourceIconProvider): Disposable;
  registerResourceDecorationProvider(provider: ResourceDecorationProvider): Disposable;
  registerExecutionEnvironmentProvider(provider: ExecutionEnvironmentProvider): Disposable;
  registerExecutionProfileContributionProvider(provider: ExecutionProfileContributionProvider): Disposable;
  registerScriptExecution(contribution: ScriptExecutionContribution): Disposable;
  registerResourceContextMenuProvider(provider: ResourceContextMenuProvider): Disposable;
  registerInteractiveSessionHook(provider: InteractiveSessionHookProvider): Disposable;
  registerInteractiveSessionProvider(provider: InteractiveSessionProvider): Disposable;
  getInteractiveSessionHooks(): readonly InteractiveSessionHookProvider[];
  registerPluginSettingsProvider(provider: PluginSettingsProvider): Disposable;
  registerWorkbenchSidebarHook(hook: WorkbenchSidebarHook): Disposable;
  registerWorkbenchPanelHook(hook: WorkbenchPanelHook): Disposable;
  registerWorkbenchToolWindowHook(hook: WorkbenchToolWindowHook): Disposable;
  registerTextEditorLineDecorationProvider(provider: TextEditorLineDecorationProvider): Disposable;
  registerWorkbenchResourceEditorProvider(provider: WorkbenchResourceEditorProvider): Disposable;
}

export interface PluginModule {
  init(context: PluginContext): void | Promise<void>;
  activate?(): void | Promise<void>;
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

export interface LanguageLintRule {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly defaultEnabled: boolean;
}

export interface LanguageLintSettings {
  readonly enabledRuleIds: readonly string[];
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
  readonly workspaceRoot?: string;
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
  readonly lintRules?: readonly LanguageLintRule[];
  highlight(source: string): readonly SyntaxToken[];
  lint(
    source: string,
    fileName: string,
    settings?: LanguageLintSettings,
  ): Promise<readonly TextDiagnostic[]>;
}

export const LANGUAGE_PROVIDER_CAPABILITY = "language.provider";

export interface ScriptExecutionContribution {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  readonly executable?: string;
  readonly arguments?: readonly string[];
}

export const SCRIPT_EXECUTION_CAPABILITY = "execution.script";

export interface ResourceContext {
  readonly kind: "file" | "directory";
  readonly name: string;
  readonly path: string;
  readonly workspaceName?: string;
  readonly workspaceRoot?: string;
  /** True when the file is currently modified in an open editor buffer. */
  readonly isDirty?: boolean;
}

export interface ResourceIcon {
  readonly id: string;
  readonly label: string;
  readonly foreground?: string;
  readonly background?: string;
  readonly title?: string;
}

export interface ResourceIconProvider {
  readonly id: string;
  provideIcon(resource: ResourceContext): ResourceIcon | undefined;
}

export const RESOURCE_ICON_CAPABILITY = "resource.icon";

export interface ResourceDecoration {
  /** CSS color applied to the resource label. */
  readonly foreground?: string;
  readonly badge?: string;
  readonly tooltip?: string;
  readonly priority?: number;
}

export interface ResourceDecorationProvider {
  readonly id: string;
  readonly pluginId: string;
  provideDecoration(
    resource: ResourceContext,
  ): Promise<ResourceDecoration | undefined> | ResourceDecoration | undefined;
  onDidChange?(listener: (paths?: readonly string[]) => void): Disposable;
}

export const RESOURCE_DECORATION_CAPABILITY = "resource.decoration";

export type ResourceContextMenuIcon = "file" | "folder" | "play" | "copy" | "terminal" | "save" | "close" | "diff";

export type ResourceContextMenuAction = "runScript";

export interface ResourceContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly command?: string;
  readonly action?: ResourceContextMenuAction;
  readonly group?: string;
  readonly order?: number;
  readonly icon?: ResourceContextMenuIcon;
  readonly enabled?: boolean;
}

export interface ResourceContextMenuProvider {
  readonly id: string;
  provideItems(
    resource: ResourceContext,
  ): Promise<readonly ResourceContextMenuItem[]> | readonly ResourceContextMenuItem[];
}

export const RESOURCE_CONTEXT_MENU_CAPABILITY = "resource.contextMenu";

export type PluginSettingValue = boolean | string | number;

export type PluginSettingValues = Readonly<Record<string, PluginSettingValue>>;

export type PluginSettingsMap = Readonly<Record<string, PluginSettingValues>>;

export interface PluginBooleanSettingDefinition {
  readonly id: string;
  readonly type: "boolean";
  readonly label: string;
  readonly description?: string;
  readonly defaultValue: boolean;
}

export type PluginSettingDefinition = PluginBooleanSettingDefinition;

export interface PluginSettingsProvider {
  readonly id: string;
  readonly pluginId: string;
  readonly title: string;
  readonly description?: string;
  readonly settings: readonly PluginSettingDefinition[];
}

export const PLUGIN_SETTINGS_CAPABILITY = "plugin.settings";

export interface WorkbenchStateSnapshot {
  readonly workspaceName: string;
  readonly workspaceRoot?: string;
  readonly activeSidebarId: string;
  readonly sidebarVisible: boolean;
  readonly activePanelId: string;
  readonly panelVisible: boolean;
  readonly activeToolWindowId?: string;
  readonly toolWindowVisible: boolean;
  readonly selectedExecutionEnvironmentId?: string;
  readonly pluginSettings: PluginSettingsMap;
}

export interface WorkbenchStateApi {
  snapshot(): WorkbenchStateSnapshot;
  subscribe(listener: (snapshot: WorkbenchStateSnapshot) => void): Disposable;
}

export interface WorkbenchPanelMountContext {
  readonly container: HTMLElement;
  readonly state: WorkbenchStateApi;
}

export type WorkbenchActivityIcon =
  | "box"
  | "files"
  | "history"
  | "source-control"
  | "terminal";

export interface WorkbenchSidebarMountContext extends WorkbenchPanelMountContext {
  close(): void;
}

export interface WorkbenchSidebarContribution {
  readonly id: string;
  readonly pluginId: string;
  readonly label: string;
  readonly icon?: WorkbenchActivityIcon;
  readonly order?: number;
  mount(context: WorkbenchSidebarMountContext): void | Disposable | Promise<void | Disposable>;
}

export interface WorkbenchSidebarHook {
  readonly id: string;
  readonly pluginId: string;
  contribute(): readonly WorkbenchSidebarContribution[];
}

export const WORKBENCH_SIDEBAR_HOOK = "workbench.sidebar.hook";

export interface WorkbenchTabContribution {
  readonly id: string;
  readonly label: string;
  readonly closable?: boolean;
  readonly order?: number;
  onSelect(): void;
  onClose?(): void | Promise<void>;
}

export interface WorkbenchTabApi {
  register(tab: WorkbenchTabContribution): Disposable;
  select(id: string): void;
  activeId(): string | undefined;
}

export interface WorkbenchPanelContribution {
  readonly id: string;
  readonly pluginId: string;
  readonly label: string;
  readonly order?: number;
  mount(context: WorkbenchPanelMountContext): void | Disposable | Promise<void | Disposable>;
}

export interface WorkbenchPanelTabContribution {
  readonly id: string;
  readonly label: string;
  readonly order?: number;
  mount(context: WorkbenchPanelMountContext): void | Disposable | Promise<void | Disposable>;
}

export interface WorkbenchPanelTabGroupContribution {
  readonly id: string;
  readonly pluginId: string;
  readonly label: string;
  readonly order?: number;
  readonly tabs: readonly WorkbenchPanelTabContribution[];
}

export type WorkbenchPanelHookContribution =
  | WorkbenchPanelContribution
  | WorkbenchPanelTabGroupContribution;

export interface WorkbenchPanelHook {
  readonly id: string;
  readonly pluginId: string;
  contribute(): readonly WorkbenchPanelHookContribution[];
}

export const WORKBENCH_PANEL_HOOK = "workbench.panel.hook";

export interface WorkbenchToolWindowContribution {
  readonly id: string;
  readonly pluginId: string;
  readonly label: string;
  readonly icon?: WorkbenchActivityIcon;
  readonly order?: number;
  mount(context: WorkbenchToolWindowMountContext): void | Disposable | Promise<void | Disposable>;
}

export interface WorkbenchToolWindowViewContribution {
  readonly id: string;
  readonly label: string;
  readonly order?: number;
  mount(context: WorkbenchPanelMountContext): void | Disposable | Promise<void | Disposable>;
}

export interface WorkbenchToolWindowGroupContribution {
  readonly id: string;
  readonly pluginId: string;
  readonly label: string;
  readonly icon?: WorkbenchActivityIcon;
  readonly order?: number;
  readonly views: readonly WorkbenchToolWindowViewContribution[];
}

export type WorkbenchToolWindowHookContribution =
  | WorkbenchToolWindowContribution
  | WorkbenchToolWindowGroupContribution;

export interface WorkbenchToolWindowMountContext extends WorkbenchPanelMountContext {
  readonly headerContainer: HTMLElement;
  readonly tabs: WorkbenchTabApi;
  close(): void;
}

export interface WorkbenchToolWindowHook {
  readonly id: string;
  readonly pluginId: string;
  contribute(): readonly WorkbenchToolWindowHookContribution[];
}

export const WORKBENCH_TOOL_WINDOW_HOOK = "workbench.toolWindow.hook";

export type WorkbenchDialogSize = "medium" | "large" | "full";

export interface WorkbenchDialogMountContext {
  readonly container: HTMLElement;
  close(): void;
}

export interface WorkbenchDialogContribution {
  readonly id: string;
  readonly pluginId: string;
  readonly title: string;
  readonly description?: string;
  readonly size?: WorkbenchDialogSize;
  mount(context: WorkbenchDialogMountContext): void | Disposable | Promise<void | Disposable>;
}

export interface WorkbenchDialogApi {
  open(dialog: WorkbenchDialogContribution): Disposable;
}

export interface WorkbenchTextHighlightRequest {
  readonly fileName: string;
  readonly source: string;
}

export interface WorkbenchTextHighlightResult {
  readonly languageId?: string;
  readonly tokens: readonly SyntaxToken[];
}

export interface WorkbenchTextApi {
  highlight(request: WorkbenchTextHighlightRequest): WorkbenchTextHighlightResult;
}

export interface WorkbenchTextEditorReplaceContentRequest {
  readonly documentId: string;
  readonly content: string;
  readonly selectionStart?: number;
  readonly selectionEnd?: number;
}

export interface WorkbenchTextEditorSaveRequest {
  readonly documentId: string;
}

export interface WorkbenchTextEditorApi {
  replaceContent(request: WorkbenchTextEditorReplaceContentRequest): Promise<void>;
  save(request: WorkbenchTextEditorSaveRequest): Promise<void>;
}

export interface WorkbenchApi {
  readonly dialogs: WorkbenchDialogApi;
  readonly editor: WorkbenchTextEditorApi;
  readonly text: WorkbenchTextApi;
  openSidebar(id: string): void;
  openToolWindow(id: string): void;
}

export type WorkbenchResourceKind = "text" | "image" | "binary";

export interface WorkbenchResourceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
  readonly workspaceRoot?: string;
  readonly mediaType: string;
  readonly size: number;
  readonly kind: WorkbenchResourceKind;
}

export interface WorkbenchResourceEditorMountContext {
  readonly container: HTMLElement;
  readonly resource: WorkbenchResourceDescriptor;
  read(): Promise<Blob>;
}

export interface WorkbenchResourceEditorProvider {
  readonly id: string;
  readonly pluginId: string;
  readonly priority?: number;
  canOpen(resource: WorkbenchResourceDescriptor): boolean;
  mount(
    context: WorkbenchResourceEditorMountContext,
  ): void | Disposable | Promise<void | Disposable>;
}

export const WORKBENCH_RESOURCE_EDITOR_CAPABILITY = "workbench.resourceEditor";

export type TextEditorLineDecorationKind =
  | "added"
  | "modified"
  | "deleted"
  | "information"
  | "warning"
  | "error";

export interface TextEditorDocumentSnapshot {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
  readonly workspaceRoot?: string;
  readonly content: string;
  readonly isDirty?: boolean;
}

export type TextEditorDocumentChangeReason = "edit" | "undo" | "redo";

export interface TextEditorDocumentChangedEvent {
  readonly document: TextEditorDocumentSnapshot;
  readonly previousContent: string;
  readonly reason: TextEditorDocumentChangeReason;
  readonly isDirty: boolean;
}

export interface TextEditorDocumentSavedEvent {
  readonly document: TextEditorDocumentSnapshot;
}

export const TEXT_EDITOR_DOCUMENT_CHANGED_EVENT = "textEditor.document.changed";
export const TEXT_EDITOR_DOCUMENT_SAVED_EVENT = "textEditor.document.saved";

export interface TextEditorLineDecoration {
  /** One-based line number in the current document. */
  readonly line: number;
  readonly kind: TextEditorLineDecorationKind;
  readonly label?: string;
  readonly tooltip?: string;
  readonly change?: TextEditorLineChangePreview;
  readonly actions?: readonly TextEditorLineDecorationAction[];
  /** Number of removed lines represented by a deletion marker at this line. */
  readonly deletedLineCount?: number;
}

export interface TextEditorLineDecorationAction {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly title?: string;
  readonly closeOnRun?: boolean;
}

export interface TextEditorLineDecorationActionContext {
  readonly document: TextEditorDocumentSnapshot;
  readonly decoration: TextEditorLineDecoration;
  readonly action: TextEditorLineDecorationAction;
}

export interface TextEditorLineSnapshot {
  readonly line: number;
  readonly content: string;
}

export interface TextEditorLineChangePreview {
  readonly before: readonly TextEditorLineSnapshot[];
  readonly after: readonly TextEditorLineSnapshot[];
}

export interface TextEditorLineDecorationProvider {
  readonly id: string;
  readonly pluginId: string;
  provideDecorations(
    document: TextEditorDocumentSnapshot,
  ): Promise<readonly TextEditorLineDecoration[]> | readonly TextEditorLineDecoration[];
  onDidChange?(listener: () => void): Disposable;
}

export const TEXT_EDITOR_LINE_DECORATION_CAPABILITY = "textEditor.lineDecoration";

export interface WorkbenchExtensionApi {
  registerPanelHook(hook: WorkbenchPanelHook): Disposable;
}

export interface TerminalSessionInfo {
  readonly id: string;
  readonly status: "running" | "exited";
  readonly workspaceRoot: string;
  readonly shell: string;
  readonly platform: string;
}

export interface TerminalSessionOutput {
  readonly id: string;
  readonly data: string;
  readonly offset: number;
  readonly status: "running" | "exited";
  readonly exitCode?: number;
}

export interface TerminalSessionCreateOptions {
  readonly cols?: number;
  readonly rows?: number;
  readonly environmentVariables?: Readonly<Record<string, string>>;
  readonly unsetEnvironmentVariables?: readonly string[];
  readonly prependPathEntries?: readonly string[];
  readonly promptPrefix?: string;
}

export interface TerminalSessionHookContext {
  readonly workspaceRoot?: string;
  readonly selectedEnvironmentId?: string;
  readonly settings: PluginSettingValues;
}

export interface TerminalSessionIndicator {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface TerminalSessionHookContribution {
  readonly environmentVariables?: Readonly<Record<string, string>>;
  readonly unsetEnvironmentVariables?: readonly string[];
  readonly prependPathEntries?: readonly string[];
  readonly promptPrefix?: string;
  readonly indicators?: readonly TerminalSessionIndicator[];
}

export interface TerminalSessionHookProvider {
  readonly id: string;
  readonly pluginId: string;
  prepare(
    context: TerminalSessionHookContext,
  ): Promise<TerminalSessionHookContribution | undefined> | TerminalSessionHookContribution | undefined;
}

export interface TerminalProvider {
  readonly id: string;
  readonly label: string;
  create(options?: TerminalSessionCreateOptions): Promise<TerminalSessionInfo>;
  read(sessionId: string, offset?: number): Promise<TerminalSessionOutput>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string): Promise<void>;
}

export const TERMINAL_PROVIDER_CAPABILITY = "terminal.provider";
export const TERMINAL_SESSION_HOOK_CAPABILITY = "terminal.session.hook";

/** Generic interactive byte-stream session rendered by a workbench host. */
export type InteractiveSessionInfo = TerminalSessionInfo;
export type InteractiveSessionOutput = TerminalSessionOutput;
export type InteractiveSessionCreateOptions = TerminalSessionCreateOptions;
export type InteractiveSessionIndicator = TerminalSessionIndicator;
export type InteractiveSessionHookContext = TerminalSessionHookContext;
export type InteractiveSessionHookContribution = TerminalSessionHookContribution;
export type InteractiveSessionHookProvider = TerminalSessionHookProvider;
export type InteractiveSessionProvider = TerminalProvider;

export const INTERACTIVE_SESSION_PROVIDER_CAPABILITY = "interactive.session";
export const INTERACTIVE_SESSION_HOOK_CAPABILITY = "interactive.session.hook";

export interface InteractiveSessionExtensionApi {
  registerProvider(provider: InteractiveSessionProvider): Disposable;
  hooks(): readonly InteractiveSessionHookProvider[];
}

export type ExecutionEnvironmentType = string;

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

export interface ExecutionEnvironmentCreateRequest {
  readonly name: string;
  readonly baseExecutable: string;
  readonly path?: string;
}

export interface ExecutionEnvironmentAddExecutableRequest {
  readonly name: string;
  readonly executable: string;
}

export interface ExecutionEnvironmentImportRequest {
  readonly name?: string;
  readonly path: string;
}

export interface ExecutionEnvironmentUpdateRequest {
  readonly name: string;
  readonly path?: string;
  readonly executable?: string;
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
  create(request: ExecutionEnvironmentCreateRequest): Promise<ExecutionEnvironment>;
  addExecutable(request: ExecutionEnvironmentAddExecutableRequest): Promise<ExecutionEnvironment>;
  importEnvironment(request: ExecutionEnvironmentImportRequest): Promise<ExecutionEnvironment>;
  update?(environmentId: string, request: ExecutionEnvironmentUpdateRequest): Promise<ExecutionEnvironment>;
  browse?(request?: ExecutionEnvironmentBrowseRequest): Promise<ExecutionEnvironmentDirectoryListing>;
  validateExecutable?(path: string): Promise<{ readonly executable: string; readonly version?: string }>;
  remove(environmentId: string): Promise<void>;
  installDependencies(environmentId: string, dependencies: readonly string[]): Promise<ExecutionEnvironment>;
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
