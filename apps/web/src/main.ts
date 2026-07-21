import {
  CapabilityRegistry,
  CommandRegistry,
  ExecutionProfileManager,
  EventBus,
  ModulePluginHost,
  PluginManager,
  formatCommandLineArguments,
  inferWorkspaceRoot,
  parseCommandLineArguments,
  resolveExecutionProfile,
} from "@tinyide/core";
import type {
  ExecutionProfile,
  ExecutionProfileStep,
  ExecutionProfileContributionProvider,
  ExecutionProfileExecutableOption,
  ExecutionProfileVariableContribution,
  ExecutionEnvironmentRunRequest,
  ExecutionEnvironment,
  ExecutionEnvironmentProvider,
  LanguageProvider,
  ProcessExecutionRequest,
  PluginManifest,
  PluginRecord,
  ScriptExecutionResult,
  TextDiagnostic,
} from "@tinyide/plugin-api";
import {
  readApplicationSnapshot,
  writeApplicationSnapshot,
} from "./session-store";
import {
  FileBrowserController,
  type FileBrowserEntry,
  type FileBrowserSource,
} from "./file-browser";
import "./styles.css";

const PLATFORM_VERSION = "0.4.0";
const PLUGIN_STORAGE_KEY = "tinyide.installedPlugins.v2";
const LEGACY_PLUGIN_STORAGE_KEY = "tinyide.installedPlugins";
const LAYOUT_STORAGE_KEY = "tinyide.layout.v1";
const RUN_PROFILE_STORAGE_KEY = "tinyide.pythonRunProfile.v1";
const EXECUTION_PROFILES_STORAGE_KEY = "tinyide.executionProfiles.v2";
const LEGACY_EXECUTION_PROFILES_STORAGE_KEY = "tinyide.executionProfiles.v1";
const ENVIRONMENT_BROWSER_STORAGE_KEY = "tinyide.environmentBrowser.v1";
const SESSION_STORAGE_KEY = "tinyide.session.v2";
const LEGACY_SESSION_STORAGE_KEY = "tinyide.session.v1";
const DEFAULT_SIDEBAR_WIDTH = 280;
const DEFAULT_PANEL_HEIGHT = 190;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 720;
const MIN_PANEL_HEIGHT = 96;
const MAX_PANEL_HEIGHT = 640;

interface StoredLayout {
  readonly sidebarWidth?: number;
  readonly panelHeight?: number;
}

interface StoredEnvironmentBrowserPaths {
  readonly directory?: string;
  readonly file?: string;
}

interface StoredExecutionProfiles {
  readonly profiles: readonly ExecutionProfile[];
  readonly selectedProfileId?: string;
}

interface LegacyExecutionProfileStep extends Omit<ExecutionProfileStep, "command" | "parameters"> {
  readonly command?: string;
  readonly parameters?: readonly string[];
  readonly arguments?: readonly string[];
}

interface LegacyExecutionProfile extends Omit<ExecutionProfile, "environment" | "steps"> {
  readonly environment: ExecutionProfile["environment"] | { readonly mode: "selected" };
  readonly steps: readonly LegacyExecutionProfileStep[];
}

interface HostProcessSnapshot extends ScriptExecutionResult {
  readonly id: string;
  readonly status: "running" | "exited";
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly signal?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

function readEnvironmentBrowserPaths(): StoredEnvironmentBrowserPaths {
  try {
    const parsed = JSON.parse(localStorage.getItem(ENVIRONMENT_BROWSER_STORAGE_KEY) ?? "{}") as StoredEnvironmentBrowserPaths;
    return {
      ...(typeof parsed.directory === "string" && parsed.directory ? { directory: parsed.directory } : {}),
      ...(typeof parsed.file === "string" && parsed.file ? { file: parsed.file } : {}),
    };
  } catch {
    return {};
  }
}

function rememberEnvironmentBrowserPath(mode: "directory" | "file", path: string | undefined): void {
  const stored = readEnvironmentBrowserPaths();
  const next = { ...stored, ...(path ? { [mode]: path } : {}) };
  if (!path) delete next[mode];
  localStorage.setItem(ENVIRONMENT_BROWSER_STORAGE_KEY, JSON.stringify(next));
}

interface StoredSession {
  readonly version: 2;
  readonly savedAt: string;
  readonly openDocumentKeys: string[];
  readonly activeFilePath?: string;
  readonly sidebarView: SidebarView;
  readonly sidebarVisible: boolean;
  readonly sidebarWidth: number;
  readonly panelVisible: boolean;
  readonly panelHeight: number;
  readonly workspaceName?: string;
  readonly expandedDirectories: string[];
  readonly openedEnvironmentIds: string[];
  readonly selectedEnvironmentId?: string;
  readonly workspaceHandleStored: boolean;
  readonly runProfile: RunProfile;
  readonly plugins: Array<{ readonly id: string; readonly enabled: boolean }>;
}

interface StoredWorkspaceEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly path: string;
  readonly children?: StoredWorkspaceEntry[];
}

interface StoredDocumentSnapshot {
  readonly name: string;
  readonly path?: string;
  readonly content: string;
  readonly savedContent: string;
  readonly handle?: BrowserFileHandle;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

interface StoredApplicationSnapshot {
  readonly version: 1;
  readonly savedAt: string;
  readonly workspaceName?: string;
  readonly workspaceHandle?: BrowserDirectoryHandle;
  readonly workspaceEntries: StoredWorkspaceEntry[];
  readonly documents: StoredDocumentSnapshot[];
  readonly diagnostics: TextDiagnostic[];
  readonly logs: string[];
}

interface RunProfile {
  readonly name: string;
  readonly mode: "source" | "script" | "module";
  readonly target: string;
  readonly workingDirectory: string;
  readonly arguments: string;
  readonly environmentVariables: string;
}

function parseEnvironmentVariables(value: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Variável de ambiente inválida: ${line}`);
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Nome de variável inválido: ${name}`);
    variables[name] = line.slice(separator + 1);
  }
  return variables;
}

function readRunProfile(): RunProfile {
  try {
    const parsed = JSON.parse(localStorage.getItem(RUN_PROFILE_STORAGE_KEY) ?? "{}") as Partial<RunProfile>;
    return {
      name: parsed.name ?? "Execução atual",
      mode: parsed.mode === "script" || parsed.mode === "module" ? parsed.mode : "source",
      target: parsed.target ?? "",
      workingDirectory: parsed.workingDirectory ?? "",
      arguments: parsed.arguments ?? "",
      environmentVariables: parsed.environmentVariables ?? "",
    };
  } catch {
    return { name: "Execução atual", mode: "source", target: "", workingDirectory: "", arguments: "", environmentVariables: "" };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function readStoredLayout(): Required<StoredLayout> {
  try {
    const rawValue = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!rawValue) {
      return {
        sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
        panelHeight: DEFAULT_PANEL_HEIGHT,
      };
    }

    const parsed = JSON.parse(rawValue) as StoredLayout;
    return {
      sidebarWidth: clamp(
        Number(parsed.sidebarWidth) || DEFAULT_SIDEBAR_WIDTH,
        MIN_SIDEBAR_WIDTH,
        MAX_SIDEBAR_WIDTH,
      ),
      panelHeight: clamp(
        Number(parsed.panelHeight) || DEFAULT_PANEL_HEIGHT,
        MIN_PANEL_HEIGHT,
        MAX_PANEL_HEIGHT,
      ),
    };
  } catch {
    return {
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      panelHeight: DEFAULT_PANEL_HEIGHT,
    };
  }
}

const initialLayout = readStoredLayout();

interface BrowserWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface BrowserHandlePermissionDescriptor {
  readonly mode?: "read" | "readwrite";
}

interface BrowserHandle {
  readonly name: string;
  queryPermission?(descriptor?: BrowserHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: BrowserHandlePermissionDescriptor): Promise<PermissionState>;
}

interface BrowserFileHandle extends BrowserHandle {
  readonly kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserWritable>;
}

interface BrowserDirectoryHandle extends BrowserHandle {
  readonly kind: "directory";
  values(): AsyncIterable<BrowserEntryHandle>;
}

type BrowserEntryHandle = BrowserFileHandle | BrowserDirectoryHandle;

interface FilePickerWindow extends Window {
  showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>;
  showOpenFilePicker?: () => Promise<BrowserFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<BrowserFileHandle>;
}

interface WorkspaceEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly handle?: BrowserEntryHandle;
  readonly path: string;
  children?: WorkspaceEntry[];
}

interface OpenDocument {
  name: string;
  handle?: BrowserFileHandle;
  path?: string;
  content: string;
  savedContent: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  scrollLeft: number;
}

interface StoredPlugin {
  readonly manifest: PluginManifest;
  readonly sourceUrl: string;
  readonly enabled: boolean;
}

interface PluginCatalogEntry {
  readonly manifest: PluginManifest;
  readonly manifestUrl: string;
}

type SidebarView = "explorer" | "plugins" | "environments";
type WorkspaceAccess = "granted" | "prompt" | "denied" | "unavailable";

interface AppState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  panelVisible: boolean;
  panelHeight: number;
  fileMenuOpen: boolean;
  sidebarView: SidebarView;
  workspaceName: string | undefined;
  workspaceHandle: BrowserDirectoryHandle | undefined;
  workspaceAccess: WorkspaceAccess;
  workspaceEntries: WorkspaceEntry[];
  expandedDirectories: Set<string>;
  openFiles: OpenDocument[];
  activeFilePath: string | undefined;
  diagnostics: TextDiagnostic[];
  languageActionRunning: boolean;
  availablePlugins: PluginCatalogEntry[];
  pluginCatalogLoading: boolean;
  environments: ExecutionEnvironment[];
  openedEnvironmentIds: Set<string>;
  selectedEnvironmentId: string | undefined;
  environmentBusy: boolean;
  environmentForm: "createVenv" | "addVenv" | "addProcess" | "packages" | "run" | undefined;
  environmentSelectedPath: string | undefined;
  executionProfilesOpen: boolean;
  executionProfileEditingId: string | undefined;
  executionProfileRemovalId: string | undefined;
  executionProfileExecutableOptions: ExecutionProfileExecutableOption[];
  executionProfileVariables: ExecutionProfileVariableContribution[];
  executionProfileContributionsLoading: boolean;
  executionBusy: boolean;
  activeProcessId: string | undefined;
  runProfile: RunProfile;
  logs: string[];
  notice: string | undefined;
  error: string | undefined;
}

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Application root was not found.");
const appRoot = root;

const events = new EventBus();
const commands = new CommandRegistry();
const capabilities = new CapabilityRegistry();
const pluginSourceUrls = new Map<string, string>();
let executionProfiles = new ExecutionProfileManager();
let executionProfileDraft: ExecutionProfile | undefined;
let fileBrowser!: FileBrowserController;

const pluginHost = new ModulePluginHost({
  loadModule(plugin) {
    const sourceUrl = pluginSourceUrls.get(plugin.manifest.id);
    if (!sourceUrl) throw new Error(`Plugin source URL not found: ${plugin.manifest.id}`);
    return import(/* @vite-ignore */ sourceUrl);
  },
});
const plugins = new PluginManager({ platformVersion: PLATFORM_VERSION, events, host: pluginHost });

fileBrowser = new FileBrowserController(() => render());

const state: AppState = {
  sidebarVisible: true,
  sidebarWidth: initialLayout.sidebarWidth,
  panelVisible: true,
  panelHeight: initialLayout.panelHeight,
  fileMenuOpen: false,
  sidebarView: "explorer",
  workspaceName: undefined,
  workspaceHandle: undefined,
  workspaceAccess: "unavailable",
  workspaceEntries: [],
  expandedDirectories: new Set<string>(),
  openFiles: [],
  activeFilePath: undefined,
  diagnostics: [],
  languageActionRunning: false,
  availablePlugins: [],
  pluginCatalogLoading: false,
  environments: [],
  openedEnvironmentIds: new Set<string>(),
  selectedEnvironmentId: undefined,
  environmentBusy: false,
  environmentForm: undefined,
  environmentSelectedPath: undefined,
  executionProfilesOpen: false,
  executionProfileEditingId: undefined,
  executionProfileRemovalId: undefined,
  executionProfileExecutableOptions: [],
  executionProfileVariables: [],
  executionProfileContributionsLoading: false,
  executionBusy: false,
  activeProcessId: undefined,
  runProfile: readRunProfile(),
  logs: ["tinyIde core initialized", `platform version ${PLATFORM_VERSION}`],
  notice: undefined,
  error: undefined,
};

function activeDocument(): OpenDocument | undefined {
  if (!state.activeFilePath || !state.openFiles.length) return undefined;
  return state.openFiles.find((document) => documentKey(document) === state.activeFilePath);
}

function documentKey(document: Pick<OpenDocument, "name" | "path">): string {
  return document.path ?? document.name;
}

function executionProfileStorageKey(): string {
  return `${EXECUTION_PROFILES_STORAGE_KEY}:${state.workspaceName ?? "global"}`;
}

function loadExecutionProfiles(): void {
  try {
    const current = localStorage.getItem(executionProfileStorageKey());
    const legacy = current
      ? undefined
      : localStorage.getItem(`${LEGACY_EXECUTION_PROFILES_STORAGE_KEY}:${state.workspaceName ?? "global"}`);
    const migratedFromLegacy = !current && Boolean(legacy);
    const parsed = JSON.parse(current ?? legacy ?? "{}") as Partial<StoredExecutionProfiles>;
    const profiles = Array.isArray(parsed.profiles)
      ? (parsed.profiles as readonly LegacyExecutionProfile[]).map((profile) => ({
          ...profile,
          environment: profile.environment.mode === "selected"
            ? { mode: "none" as const }
            : profile.environment,
          steps: profile.steps.map((step) => {
            const {
              arguments: legacyArguments,
              command,
              parameters,
              ...rest
            } = step;
            return {
              ...rest,
              command: typeof command === "string"
                ? command
                : Array.isArray(legacyArguments) && typeof legacyArguments[0] === "string"
                  ? legacyArguments[0]
                  : "",
              parameters: Array.isArray(parameters)
                ? migratedFromLegacy
                  ? parameters.flatMap((parameter) => parseCommandLineArguments(parameter))
                  : [...parameters]
                : Array.isArray(legacyArguments)
                  ? migratedFromLegacy
                    ? legacyArguments.slice(1).flatMap((parameter) => parseCommandLineArguments(parameter))
                    : legacyArguments.slice(1)
                  : [],
            };
          }),
        }))
      : [];
    executionProfiles = new ExecutionProfileManager(
      profiles,
      typeof parsed.selectedProfileId === "string" ? parsed.selectedProfileId : undefined,
    );
    if (migratedFromLegacy) persistExecutionProfiles();
  } catch {
    executionProfiles = new ExecutionProfileManager();
  }
}

function persistExecutionProfiles(): void {
  const selectedProfileId = executionProfiles.selectedId();
  const stored: StoredExecutionProfiles = {
    profiles: executionProfiles.list(),
    ...(selectedProfileId ? { selectedProfileId } : {}),
  };
  localStorage.setItem(executionProfileStorageKey(), JSON.stringify(stored));
}

function executionProfileContributionContext() {
  const active = activeDocument();
  return {
    ...(state.workspaceName ? { workspaceName: state.workspaceName } : {}),
    ...(active?.name ? { activeFileName: active.name } : {}),
    ...(active?.path ? { activeFilePath: active.path } : {}),
  };
}

async function refreshExecutionProfileContributions(): Promise<void> {
  state.executionProfileContributionsLoading = true;
  try {
    const providers = capabilities.getAll<ExecutionProfileContributionProvider>("execution.profile.contribution");
    const context = executionProfileContributionContext();
    const executableGroups = await Promise.all(
      providers.map(async (provider) => provider.executableOptions ? provider.executableOptions(context) : []),
    );
    const variableGroups = await Promise.all(
      providers.map(async (provider) => provider.variables ? provider.variables(context) : []),
    );
    state.executionProfileExecutableOptions = executableGroups.flat();
    state.executionProfileVariables = variableGroups.flat();
  } finally {
    state.executionProfileContributionsLoading = false;
  }
}

function serializeWorkspaceEntries(entries: WorkspaceEntry[]): StoredWorkspaceEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    path: entry.path,
    ...(entry.children ? { children: serializeWorkspaceEntries(entry.children) } : {}),
  }));
}

function deserializeWorkspaceEntries(entries: StoredWorkspaceEntry[]): WorkspaceEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    path: entry.path,
    ...(entry.children ? { children: deserializeWorkspaceEntries(entry.children) } : {}),
  }));
}

function buildSessionSummary(): StoredSession {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    openDocumentKeys: state.openFiles.map(documentKey),
    ...(state.activeFilePath ? { activeFilePath: state.activeFilePath } : {}),
    sidebarView: state.sidebarView,
    sidebarVisible: state.sidebarVisible,
    sidebarWidth: state.sidebarWidth,
    panelVisible: state.panelVisible,
    panelHeight: state.panelHeight,
    ...(state.workspaceName ? { workspaceName: state.workspaceName } : {}),
    expandedDirectories: [...state.expandedDirectories],
    openedEnvironmentIds: [...state.openedEnvironmentIds],
    ...(state.selectedEnvironmentId ? { selectedEnvironmentId: state.selectedEnvironmentId } : {}),
    workspaceHandleStored: Boolean(state.workspaceHandle),
    runProfile: state.runProfile,
    plugins: plugins.list().map((plugin) => ({
      id: plugin.manifest.id,
      enabled: plugin.state === "active" || plugin.state === "enabled",
    })),
  };
}

function buildApplicationSnapshot(includeHandles = true): StoredApplicationSnapshot {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    ...(state.workspaceName ? { workspaceName: state.workspaceName } : {}),
    ...(includeHandles && state.workspaceHandle ? { workspaceHandle: state.workspaceHandle } : {}),
    workspaceEntries: serializeWorkspaceEntries(state.workspaceEntries),
    documents: state.openFiles.map((document) => ({
      name: document.name,
      ...(document.path ? { path: document.path } : {}),
      content: document.content,
      savedContent: document.savedContent,
      ...(includeHandles && document.handle ? { handle: document.handle } : {}),
      selectionStart: document.selectionStart,
      selectionEnd: document.selectionEnd,
      scrollTop: document.scrollTop,
      scrollLeft: document.scrollLeft,
    })),
    diagnostics: state.diagnostics,
    logs: state.logs,
  };
}

let applicationRestoreInProgress = false;
let snapshotTimeout: ReturnType<typeof setTimeout> | undefined;

async function persistApplicationSnapshotNow(): Promise<void> {
  if (applicationRestoreInProgress) return;
  try {
    await writeApplicationSnapshot(buildApplicationSnapshot(true));
  } catch (error) {
    console.warn("Unable to persist file-system handles; saving a content-only snapshot.", error);
    await writeApplicationSnapshot(buildApplicationSnapshot(false));
  }
}

function scheduleApplicationSnapshot(delay = 200): void {
  if (applicationRestoreInProgress) return;
  if (snapshotTimeout) clearTimeout(snapshotTimeout);
  snapshotTimeout = setTimeout(() => {
    snapshotTimeout = undefined;
    void persistApplicationSnapshotNow().catch((error) => {
      console.error("Unable to persist the tinyIde application snapshot.", error);
    });
  }, delay);
}

function flushApplicationSnapshot(): void {
  if (snapshotTimeout) {
    clearTimeout(snapshotTimeout);
    snapshotTimeout = undefined;
  }
  void persistApplicationSnapshotNow().catch((error) => {
    console.error("Unable to flush the tinyIde application snapshot.", error);
  });
}

function persistSession(): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(buildSessionSummary()));
  localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  scheduleApplicationSnapshot();
}

function restoreSession(): void {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY) ?? localStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Partial<StoredSession> & {
      readonly openFilePaths?: string[];
      readonly openedEnvironmentIds?: string[];
      readonly selectedEnvironmentId?: string;
      readonly sidebarView?: SidebarView | "environments";
    };
    if (stored.sidebarView === "explorer" || stored.sidebarView === "plugins" || stored.sidebarView === "environments") {
      state.sidebarView = stored.sidebarView;
    } else if (stored.sidebarView === "runtimes") {
      state.sidebarView = "environments";
    }
    if (typeof stored.sidebarVisible === "boolean") state.sidebarVisible = stored.sidebarVisible;
    if (typeof stored.sidebarWidth === "number") state.sidebarWidth = clamp(stored.sidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    if (typeof stored.panelVisible === "boolean") state.panelVisible = stored.panelVisible;
    if (typeof stored.panelHeight === "number") state.panelHeight = clamp(stored.panelHeight, MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT);
    if (typeof stored.workspaceName === "string") state.workspaceName = stored.workspaceName;
    if (Array.isArray(stored.expandedDirectories)) {
      stored.expandedDirectories
        .filter((path): path is string => typeof path === "string")
        .forEach((path) => state.expandedDirectories.add(path));
    }
    if (typeof stored.activeFilePath === "string") state.activeFilePath = stored.activeFilePath;
    const restoredEnvironmentIds = stored.openedEnvironmentIds;
    if (Array.isArray(restoredEnvironmentIds)) {
      restoredEnvironmentIds
        .filter((id): id is string => typeof id === "string")
        .forEach((id) => state.openedEnvironmentIds.add(id));
    }
    const selectedEnvironmentId = stored.selectedEnvironmentId;
    if (typeof selectedEnvironmentId === "string") state.selectedEnvironmentId = selectedEnvironmentId;
    if (stored.runProfile && typeof stored.runProfile === "object") state.runProfile = stored.runProfile;
    if (stored.workspaceHandleStored && state.workspaceName) state.workspaceAccess = "prompt";
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

async function workspacePermission(
  handle: BrowserDirectoryHandle,
  request: boolean,
): Promise<WorkspaceAccess> {
  const permissionMethod = request ? handle.requestPermission : handle.queryPermission;
  if (!permissionMethod) return "granted";
  try {
    return await permissionMethod.call(handle, { mode: "readwrite" });
  } catch {
    return request ? "denied" : "prompt";
  }
}

async function hydrateExpandedDirectories(): Promise<void> {
  const expandedPaths = [...state.expandedDirectories].sort(
    (left, right) => left.split("/").length - right.split("/").length,
  );
  for (const path of expandedPaths) {
    const entry = findWorkspaceEntry(state.workspaceEntries, path);
    if (!entry || entry.kind !== "directory" || !entry.handle) {
      state.expandedDirectories.delete(path);
      continue;
    }
    entry.children = await readDirectory(entry.handle as BrowserDirectoryHandle, entry.path);
  }
}

async function restoreApplicationState(): Promise<void> {
  const snapshot = await readApplicationSnapshot<StoredApplicationSnapshot>();
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.documents)) return;

  state.workspaceName = snapshot.workspaceName ?? state.workspaceName;
  state.workspaceHandle = snapshot.workspaceHandle;
  state.workspaceEntries = Array.isArray(snapshot.workspaceEntries)
    ? deserializeWorkspaceEntries(snapshot.workspaceEntries)
    : [];
  state.openFiles = snapshot.documents.map((document) => ({
    name: document.name,
    ...(document.path ? { path: document.path } : {}),
    ...(document.handle ? { handle: document.handle } : {}),
    content: document.content,
    savedContent: document.savedContent,
    selectionStart: Number(document.selectionStart) || 0,
    selectionEnd: Number(document.selectionEnd) || 0,
    scrollTop: Number(document.scrollTop) || 0,
    scrollLeft: Number(document.scrollLeft) || 0,
  }));
  if (Array.isArray(snapshot.diagnostics)) state.diagnostics = snapshot.diagnostics;
  if (Array.isArray(snapshot.logs) && snapshot.logs.every((line) => typeof line === "string")) {
    state.logs = snapshot.logs;
  }

  if (state.workspaceHandle) {
    state.workspaceAccess = await workspacePermission(state.workspaceHandle, false);
    if (state.workspaceAccess === "granted") {
      state.workspaceName = state.workspaceHandle.name;
      state.workspaceEntries = await readDirectory(state.workspaceHandle);
      await hydrateExpandedDirectories();
    }
  } else {
    state.workspaceAccess = state.workspaceName ? "unavailable" : "granted";
  }

  if (!state.activeFilePath || !state.openFiles.some((document) => documentKey(document) === state.activeFilePath)) {
    state.activeFilePath = state.openFiles[0] ? documentKey(state.openFiles[0]) : undefined;
  }
}

async function initializeApplication(): Promise<void> {
  applicationRestoreInProgress = true;
  try {
    await Promise.all([
      restorePlugins(),
      restoreApplicationState(),
    ]);
    loadExecutionProfiles();
    await refreshEnvironments();
    if (state.sidebarView === "plugins") await loadPluginCatalog();
  } finally {
    applicationRestoreInProgress = false;
    render();
    persistSession();
  }
}

function closeFile(rawPath: unknown): void {
  const filePath = typeof rawPath === "string" ? rawPath : state.activeFilePath;
  if (!filePath) return;
  const index = state.openFiles.findIndex((doc) => (doc.path ?? doc.name) === filePath);
  if (index === -1) return;
  state.openFiles.splice(index, 1);
  if (state.activeFilePath === filePath) {
    if (state.openFiles.length > 0) {
      const nextIndex = Math.min(index, state.openFiles.length - 1);
      const nextDoc = state.openFiles[nextIndex];
      if (!nextDoc) {
        state.activeFilePath = undefined;
      } else {
        state.activeFilePath = nextDoc.path ?? nextDoc.name;
      }
    } else {
      state.activeFilePath = undefined;
    }
  }
  state.diagnostics = [];
  render();
  persistSession();
}

function activateFile(rawPath: unknown): void {
  if (typeof rawPath !== "string") return;
  state.activeFilePath = rawPath;
  state.diagnostics = [];
  render();
  persistSession();
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

type IconName =
  | "alert"
  | "check"
  | "chevronDown"
  | "chevronRight"
  | "close"
  | "code"
  | "download"
  | "environment"
  | "file"
  | "fileAdd"
  | "folder"
  | "folderOpen"
  | "lint"
  | "menu"
  | "package"
  | "panel"
  | "play"
  | "plugin"
  | "power"
  | "refresh"
  | "search"
  | "save"
  | "saveAs"
  | "terminal"
  | "trash"
  | "upload";

const ICON_MARKUP: Record<IconName, string> = {
  alert: '<path d="M12 3 2.8 19a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L12 3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="m6 6 12 12"/><path d="M18 6 6 18"/>',
  code: '<path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  environment: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="m4.93 4.93 2.12 2.12"/><path d="m16.95 16.95 2.12 2.12"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.93 19.07 2.12-2.12"/><path d="m16.95 7.05 2.12-2.12"/>',
  file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
  fileAdd: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/><path d="M12 11v6"/><path d="M9 14h6"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
  folderOpen: '<path d="M3 7h7l2 2h9l-2 10H5z"/><path d="M3 7v12"/>',
  lint: '<path d="M4 5h10"/><path d="M4 10h7"/><path d="M4 15h5"/><path d="m14 15 2 2 4-5"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  package: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 7 9 5 9-5"/><path d="M3 7v10l9 5 9-5V7"/><path d="M12 12v10"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  plugin: '<path d="M8 3v4"/><path d="M16 3v4"/><path d="M5 7h14v4a7 7 0 0 1-14 0z"/><path d="M12 18v3"/>',
  power: '<path d="M12 2v10"/><path d="M6.3 5.7a8 8 0 1 0 11.4 0"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.5-2.3L20 8"/><path d="M17.9 16a7 7 0 0 1-11.5 2.3L4 16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  save: '<path d="M4 3h14l2 2v16H4z"/><path d="M8 3v6h8V3"/><path d="M8 21v-7h8v7"/>',
  saveAs: '<path d="M4 3h12l4 4v5"/><path d="M8 3v6h7V3"/><path d="M8 21v-7h5"/><path d="m15 18 4-4 2 2-4 4-3 1z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
};

function renderIcon(name: IconName): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_MARKUP[name]}</svg>`;
}

function renderButtonLabel(name: IconName, label: string): string {
  return `${renderIcon(name)}<span class="button-label">${escapeHtml(label)}</span>`;
}

type ButtonVariant = "default" | "primary" | "danger" | "ghost";
type ButtonSize = "small" | "medium" | "icon";

interface ButtonOptions {
  readonly command?: string;
  readonly type?: "button" | "submit";
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly iconOnly?: boolean;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly className?: string;
  readonly data?: Readonly<Record<string, string | undefined>>;
}

function renderButton(
  label: string,
  iconName: IconName,
  options: ButtonOptions = {},
): string {
  const variant = options.variant ?? "default";
  const size = options.iconOnly ? "icon" : (options.size ?? "medium");
  const classes = [
    "ui-button",
    `ui-button--${variant}`,
    `ui-button--${size}`,
    options.className,
  ]
    .filter(Boolean)
    .join(" ");
  const dataAttributes = Object.entries(options.data ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
    .join(" ");
  const commandAttribute = options.command
    ? `data-command="${escapeHtml(options.command)}"`
    : "";
  const title = options.title ?? label;
  const accessibilityAttributes = options.iconOnly
    ? `aria-label="${escapeHtml(label)}" title="${escapeHtml(title)}"`
    : options.title
      ? `title="${escapeHtml(title)}"`
      : "";
  const content = options.iconOnly
    ? `${renderIcon(iconName)}<span class="sr-only">${escapeHtml(label)}</span>`
    : renderButtonLabel(iconName, label);

  return `<button class="${classes}" type="${options.type ?? "button"}" ${commandAttribute} ${dataAttributes} ${accessibilityAttributes} ${options.disabled ? "disabled" : ""}>${content}</button>`;
}



function renderActivityButton(
  command: string,
  iconName: IconName,
  label: string,
  active: boolean,
): string {
  return `<button class="activity-button${active ? " is-active" : ""}" type="button" data-command="${escapeHtml(command)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${renderIcon(iconName)}<span class="sr-only">${escapeHtml(label)}</span></button>`;
}

type ResizeTarget = "sidebar" | "panel";

function viewportWidth(): number {
  return Math.max(0, appRoot.clientWidth || window.innerWidth);
}

function viewportHeight(): number {
  return Math.max(0, appRoot.clientHeight || window.innerHeight);
}

function sidebarMinimumWidth(): number {
  const width = viewportWidth();
  if (width <= 420) return 96;
  if (width <= 620) return 120;
  if (width <= 760) return 150;
  return MIN_SIDEBAR_WIDTH;
}

function sidebarMaximumWidth(): number {
  const width = viewportWidth();
  const activityWidth = width <= 760 ? 42 : 48;
  const editorReserve = width <= 420 ? 120 : width <= 620 ? 180 : 280;
  const availableWidth = width - activityWidth - 5 - editorReserve;
  const minimum = sidebarMinimumWidth();
  return Math.max(
    minimum,
    Math.min(MAX_SIDEBAR_WIDTH, availableWidth),
  );
}

function panelMaximumHeight(): number {
  const editorArea = appRoot.querySelector<HTMLElement>(".editor-area");
  const availableHeight = (editorArea?.clientHeight || viewportHeight()) - 36 - 96;
  return Math.max(
    MIN_PANEL_HEIGHT,
    Math.min(MAX_PANEL_HEIGHT, availableHeight),
  );
}

function resizeBounds(target: ResizeTarget): { minimum: number; maximum: number } {
  return target === "sidebar"
    ? { minimum: sidebarMinimumWidth(), maximum: sidebarMaximumWidth() }
    : { minimum: MIN_PANEL_HEIGHT, maximum: panelMaximumHeight() };
}

function syncLayoutToViewport(): void {
  const shell = appRoot.querySelector<HTMLElement>(".ide-shell");
  if (!shell) return;

  const sidebarBounds = resizeBounds("sidebar");
  const panelBounds = resizeBounds("panel");
  const sidebarWidth = Math.round(clamp(state.sidebarWidth, sidebarBounds.minimum, sidebarBounds.maximum));
  const panelHeight = Math.round(clamp(state.panelHeight, panelBounds.minimum, panelBounds.maximum));

  shell.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  shell.style.setProperty("--panel-height", `${panelHeight}px`);
  shell.style.setProperty("--viewport-width", `${viewportWidth()}px`);
  shell.style.setProperty("--viewport-height", `${viewportHeight()}px`);

  const sidebarSeparator = appRoot.querySelector<HTMLElement>('[data-resize="sidebar"]');
  sidebarSeparator?.setAttribute("aria-valuemin", String(sidebarBounds.minimum));
  sidebarSeparator?.setAttribute("aria-valuemax", String(sidebarBounds.maximum));
  sidebarSeparator?.setAttribute("aria-valuenow", String(sidebarWidth));

  const panelSeparator = appRoot.querySelector<HTMLElement>('[data-resize="panel"]');
  panelSeparator?.setAttribute("aria-valuemax", String(panelBounds.maximum));
  panelSeparator?.setAttribute("aria-valuenow", String(panelHeight));
}

function resizeValue(target: ResizeTarget): number {
  return target === "sidebar" ? state.sidebarWidth : state.panelHeight;
}

function persistLayout(): void {
  const layout: StoredLayout = {
    sidebarWidth: state.sidebarWidth,
    panelHeight: state.panelHeight,
  };
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  persistSession();
}

function applyResizeValue(target: ResizeTarget, requestedValue: number): void {
  const { minimum, maximum } = resizeBounds(target);
  const value = Math.round(clamp(requestedValue, minimum, maximum));

  if (target === "sidebar") {
    state.sidebarWidth = value;
  } else {
    state.panelHeight = value;
  }

  const shell = appRoot.querySelector<HTMLElement>(".ide-shell");
  shell?.style.setProperty(
    target === "sidebar" ? "--sidebar-width" : "--panel-height",
    `${value}px`,
  );

  const separator = appRoot.querySelector<HTMLElement>(`[data-resize="${target}"]`);
  separator?.setAttribute("aria-valuenow", String(value));
  separator?.setAttribute("aria-valuemax", String(maximum));
}

function beginResize(event: PointerEvent, target: ResizeTarget): void {
  if (event.button !== 0) return;
  event.preventDefault();

  const separator = event.currentTarget as HTMLElement;
  const startingPointer = target === "sidebar" ? event.clientX : event.clientY;
  const startingValue = resizeValue(target);
  const cursorClass = target === "sidebar" ? "is-resizing-sidebar" : "is-resizing-panel";
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    separator.removeEventListener("pointermove", move);
    separator.classList.remove("is-dragging");
    document.body.classList.remove(cursorClass);
    persistLayout();
  };

  const move = (moveEvent: PointerEvent): void => {
    const currentPointer = target === "sidebar" ? moveEvent.clientX : moveEvent.clientY;
    const delta = currentPointer - startingPointer;
    applyResizeValue(
      target,
      target === "sidebar" ? startingValue + delta : startingValue - delta,
    );
  };

  separator.classList.add("is-dragging");
  document.body.classList.add(cursorClass);
  separator.setPointerCapture(event.pointerId);
  separator.addEventListener("pointermove", move);
  separator.addEventListener("pointerup", finish, { once: true });
  separator.addEventListener("pointercancel", finish, { once: true });
  separator.addEventListener("lostpointercapture", finish, { once: true });
}

function resizeWithKeyboard(event: KeyboardEvent, target: ResizeTarget): void {
  const { minimum, maximum } = resizeBounds(target);
  const step = event.shiftKey ? 48 : 16;
  let nextValue: number | undefined;

  if (event.key === "Home") nextValue = minimum;
  if (event.key === "End") nextValue = maximum;

  if (target === "sidebar") {
    if (event.key === "ArrowLeft") nextValue = state.sidebarWidth - step;
    if (event.key === "ArrowRight") nextValue = state.sidebarWidth + step;
  } else {
    if (event.key === "ArrowUp") nextValue = state.panelHeight + step;
    if (event.key === "ArrowDown") nextValue = state.panelHeight - step;
  }

  if (nextValue === undefined) return;
  event.preventDefault();
  applyResizeValue(target, nextValue);
  persistLayout();
}

function resetResize(target: ResizeTarget): void {
  applyResizeValue(
    target,
    target === "sidebar" ? DEFAULT_SIDEBAR_WIDTH : DEFAULT_PANEL_HEIGHT,
  );
  persistLayout();
}

function languageProviderFor(document: OpenDocument | undefined): LanguageProvider | undefined {
  if (!document) return undefined;
  const lowerName = document.name.toLowerCase();
  return capabilities
    .getAll<LanguageProvider>("language.provider")
    .find((provider) => provider.extensions.some((extension) => lowerName.endsWith(extension)));
}

function executionEnvironmentProvider(): ExecutionEnvironmentProvider | undefined {
  return capabilities.getAll<ExecutionEnvironmentProvider>("execution.environment")[0];
}

function executionEnvironmentProviderForExecution(
  document: OpenDocument | undefined,
): ExecutionEnvironmentProvider | undefined {
  if (!document) return undefined;
  const lowerName = document.name.toLowerCase();
  return capabilities
    .getAll<ExecutionEnvironmentProvider>("execution.environment")
    .find((provider) => provider.extensions.some((extension) => lowerName.endsWith(extension)));
}

async function refreshEnvironments(): Promise<void> {
  const provider = executionEnvironmentProvider();
  if (!provider) {
    state.environments = [];
    state.openedEnvironmentIds.clear();
    state.selectedEnvironmentId = undefined;
    state.environmentForm = undefined;
    state.environmentSelectedPath = undefined;
    if (state.sidebarView === "environments") {
      state.sidebarView = "explorer";
    }
    render();
    persistSession();
    return;
  }

  state.environments = [...(await provider.list())];
  const existingIds = new Set(state.environments.map((environment) => environment.id));
  state.openedEnvironmentIds = existingIds;
  if (state.selectedEnvironmentId && !existingIds.has(state.selectedEnvironmentId)) state.selectedEnvironmentId = undefined;
  if (!state.selectedEnvironmentId) state.selectedEnvironmentId = state.environments[0]?.id;
  render();
  persistSession();
}

function renderHighlightedSource(source: string, provider: LanguageProvider): string {
  const tokens = [...provider.highlight(source)].sort((left, right) => left.start - right.start);
  let cursor = 0;
  let output = "";

  for (const token of tokens) {
    if (token.start < cursor || token.start < 0 || token.end > source.length) continue;
    output += escapeHtml(source.slice(cursor, token.start));
    output += `<span class="syntax-${token.scope}">${escapeHtml(source.slice(token.start, token.end))}</span>`;
    cursor = token.end;
  }

  return `${output}${escapeHtml(source.slice(cursor))}\n`;
}

function log(message: string): void {
  const timestamp = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
  state.logs = [...state.logs, `[${timestamp}] ${message}`].slice(-100);
  render();
  scheduleApplicationSnapshot();
}

let noticeTimeout: ReturnType<typeof setTimeout> | undefined;

function showNotice(message: string): void {
  state.notice = message;
  state.error = undefined;
  render();
  if (noticeTimeout) clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => {
    if (state.notice === message) {
      state.notice = undefined;
      render();
    }
  }, 5000);
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  state.error = message;
  state.notice = undefined;
  render();
  if (noticeTimeout) clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => {
    if (state.error === message) {
      state.error = undefined;
      render();
    }
  }, 8000);
}

function persistPlugins(): void {
  const stored: StoredPlugin[] = plugins
    .list()
    .map((plugin) => {
      const sourceUrl = pluginSourceUrls.get(plugin.manifest.id);
      if (!sourceUrl) return undefined;
      return {
        manifest: plugin.manifest,
        sourceUrl,
        enabled: plugin.state === "active" || plugin.state === "enabled",
      };
    })
    .filter((plugin): plugin is StoredPlugin => plugin !== undefined);

  localStorage.setItem(
    PLUGIN_STORAGE_KEY,
    JSON.stringify(stored),
  );
  persistSession();
}

async function restorePlugins(): Promise<void> {
  localStorage.removeItem(LEGACY_PLUGIN_STORAGE_KEY);
  const rawValue = localStorage.getItem(PLUGIN_STORAGE_KEY);
  if (!rawValue) return;
  try {
    const storedPlugins = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(storedPlugins)) throw new Error("Stored plugin metadata is invalid.");

    for (const stored of storedPlugins as StoredPlugin[]) {
      if (!stored || typeof stored.sourceUrl !== "string" || typeof stored.enabled !== "boolean") {
        throw new Error("Stored plugin entry is invalid.");
      }
      const migratedManifest: PluginManifest = stored.manifest.category
        ? stored.manifest
        : {
            ...stored.manifest,
            category: Array.isArray(stored.manifest.contributes?.languages) ? "language" : "tool",
          };
      const installed = await plugins.install(migratedManifest);
      pluginSourceUrls.set(installed.manifest.id, stored.sourceUrl);
      if (stored.enabled) {
        await plugins.enable(installed.manifest.id);
        await plugins.activate(installed.manifest.id, {
          commands,
          events,
          capabilities,
          subscriptions: [],
        });
      }
    }
  } catch (error) {
    localStorage.removeItem(PLUGIN_STORAGE_KEY);
    showError(error);
  }
}

async function loadPluginCatalog(): Promise<void> {
  state.pluginCatalogLoading = true;
  render();

  try {
    const response = await fetch("/dev-plugins/index.json", { cache: "no-store" });
    if (!response.ok) {
      state.availablePlugins = [];
      return;
    }

    const catalog = (await response.json()) as { plugins?: Array<{ manifestUrl?: unknown }> };
    const manifestUrls = (catalog.plugins ?? [])
      .map((entry) => entry.manifestUrl)
      .filter((url): url is string => typeof url === "string");

    const entries = await Promise.all(
      manifestUrls.map(async (manifestUrl): Promise<PluginCatalogEntry | undefined> => {
        const absoluteManifestUrl = new URL(manifestUrl, window.location.href).href;
        const manifestResponse = await fetch(absoluteManifestUrl, { cache: "no-store" });
        if (!manifestResponse.ok) return undefined;
        return {
          manifest: (await manifestResponse.json()) as PluginManifest,
          manifestUrl: absoluteManifestUrl,
        };
      }),
    );
    state.availablePlugins = entries.filter(
      (entry): entry is PluginCatalogEntry => entry !== undefined,
    );
  } catch {
    state.availablePlugins = [];
  } finally {
    state.pluginCatalogLoading = false;
    render();
  }
}

async function readDirectory(
  handle: BrowserDirectoryHandle,
  parentPath = "",
): Promise<WorkspaceEntry[]> {
  const entries: WorkspaceEntry[] = [];
  for await (const entry of handle.values()) {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    entries.push({ name: entry.name, kind: entry.kind, handle: entry, path });
  }
  return entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

async function openWorkspace(): Promise<void> {
  state.fileMenuOpen = false;
  const pickerWindow = window as FilePickerWindow;
  if (!pickerWindow.showDirectoryPicker) {
    throw new Error("Este navegador não oferece seleção de pasta. Use 'Abrir arquivo'.");
  }
  const handle = await pickerWindow.showDirectoryPicker();
  state.workspaceHandle = handle;
  state.workspaceAccess = "granted";
  state.workspaceName = handle.name;
  state.workspaceEntries = await readDirectory(handle);
  state.expandedDirectories.clear();
  state.openFiles = [];
  state.activeFilePath = undefined;
  state.sidebarVisible = true;
  state.sidebarView = "explorer";
  loadExecutionProfiles();
  await events.emit("workspace.opened", { name: handle.name });
  showNotice(`Pasta '${handle.name}' aberta.`);
  persistSession();
}

async function reconnectWorkspace(): Promise<void> {
  if (!state.workspaceHandle) {
    await openWorkspace();
    return;
  }

  const permission = await workspacePermission(state.workspaceHandle, true);
  state.workspaceAccess = permission;
  if (permission !== "granted") {
    persistSession();
    throw new Error("Acesso à pasta não foi concedido.");
  }

  state.workspaceName = state.workspaceHandle.name;
  loadExecutionProfiles();
  state.workspaceEntries = await readDirectory(state.workspaceHandle);
  await hydrateExpandedDirectories();
  await events.emit("workspace.opened", { name: state.workspaceHandle.name });
  showNotice(`Acesso à pasta '${state.workspaceHandle.name}' restaurado.`);
  persistSession();
}

function newFile(): void {
  state.fileMenuOpen = false;
  state.workspaceName = state.workspaceName ?? "Arquivos locais";
  const doc: OpenDocument = {
    name: "sem-titulo.txt",
    content: "",
    savedContent: "",
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
  };
  const docKey = doc.path ?? doc.name;
  const existing = state.openFiles.findIndex((d) => (d.path ?? d.name) === docKey);
  if (existing !== -1) {
    state.openFiles[existing] = doc;
  } else {
    state.openFiles = [...state.openFiles, doc];
  }
  state.activeFilePath = docKey;
  state.diagnostics = [];
  render();
  persistSession();
  requestAnimationFrame(() => appRoot.querySelector<HTMLTextAreaElement>("[data-editor]")?.focus());
}

async function openFileHandle(handle: BrowserFileHandle, path?: string): Promise<void> {
  const file = await handle.getFile();
  const content = await file.text();
  const doc: OpenDocument = path
    ? {
        name: file.name,
        handle,
        path,
        content,
        savedContent: content,
        selectionStart: 0,
        selectionEnd: 0,
        scrollTop: 0,
        scrollLeft: 0,
      }
    : {
        name: file.name,
        handle,
        content,
        savedContent: content,
        selectionStart: 0,
        selectionEnd: 0,
        scrollTop: 0,
        scrollLeft: 0,
      };
  const docKey = doc.path ?? doc.name;
  const existing = state.openFiles.findIndex((d) => (d.path ?? d.name) === docKey);
  if (existing !== -1) {
    state.openFiles[existing] = doc;
  } else {
    state.openFiles = [...state.openFiles, doc];
  }
  state.activeFilePath = docKey;
  state.diagnostics = [];
  state.workspaceName = state.workspaceName ?? "Arquivo avulso";
  await events.emit("file.opened", { name: file.name });
  log(`file.opened: ${file.name}`);
  await refreshEnvironments();
  persistSession();
}

async function openFileFromPicker(): Promise<void> {
  state.fileMenuOpen = false;
  const pickerWindow = window as FilePickerWindow;
  if (pickerWindow.showOpenFilePicker) {
    const [handle] = await pickerWindow.showOpenFilePicker();
    if (handle) await openFileHandle(handle);
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "text/*,.md,.json,.js,.ts,.tsx,.jsx,.css,.html,.py,.yml,.yaml,.toml,.ini,.cfg,.xml,.sql,.sh";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const content = await file.text();
    const doc: OpenDocument = {
      name: file.name,
      content,
      savedContent: content,
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      scrollLeft: 0,
    };
    const docKey = doc.path ?? doc.name;
    const existing = state.openFiles.findIndex((d) => (d.path ?? d.name) === docKey);
    if (existing !== -1) {
      state.openFiles[existing] = doc;
    } else {
      state.openFiles = [...state.openFiles, doc];
    }
    state.activeFilePath = docKey;
    state.workspaceName = "Arquivo avulso";
    await events.emit("file.opened", { name: file.name });
    log(`file.opened: ${file.name}`);
    persistSession();
  });
  input.click();
}

function findWorkspaceEntry(
  entries: WorkspaceEntry[],
  path: string,
): WorkspaceEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.children) {
      const nested = findWorkspaceEntry(entry.children, path);
      if (nested) return nested;
    }
  }
  return undefined;
}

async function toggleWorkspaceDirectory(rawPath: unknown): Promise<void> {
  if (typeof rawPath !== "string") throw new Error("Caminho de pasta inválido.");
  const entry = findWorkspaceEntry(state.workspaceEntries, rawPath);
  if (!entry || entry.kind !== "directory") {
    throw new Error(`Pasta não encontrada: ${rawPath}`);
  }

  if (state.expandedDirectories.has(rawPath)) {
    state.expandedDirectories.delete(rawPath);
    render();
    persistSession();
    return;
  }

  if (!entry.children) {
    if (!entry.handle) throw new Error("Restaure o acesso à pasta antes de expandir este diretório.");
    entry.children = await readDirectory(entry.handle as BrowserDirectoryHandle, entry.path);
  }
  state.expandedDirectories.add(rawPath);
  render();
  persistSession();
}

async function openWorkspaceFile(rawPath: unknown): Promise<void> {
  if (typeof rawPath !== "string") throw new Error("Caminho de arquivo inválido.");
  const entry = findWorkspaceEntry(state.workspaceEntries, rawPath);
  if (!entry || entry.kind !== "file") throw new Error(`Arquivo não encontrado: ${rawPath}`);
  if (!entry.handle) throw new Error("Restaure o acesso à pasta antes de abrir este arquivo.");
  await openFileHandle(entry.handle as BrowserFileHandle, entry.path);
}

async function saveToHandle(document: OpenDocument, handle: BrowserFileHandle): Promise<void> {
  const previousKey = documentKey(document);
  const writable = await handle.createWritable();
  try {
    await writable.write(document.content);
  } finally {
    await writable.close();
  }
  document.handle = handle;
  document.name = handle.name;
  document.savedContent = document.content;
  if (state.activeFilePath === previousKey) state.activeFilePath = documentKey(document);
  await events.emit("file.saved", { name: document.name });
  showNotice(`'${document.name}' salvo.`);
  persistSession();
}

function downloadDocument(document: OpenDocument): void {
  const blob = new Blob([document.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = documentObject.createElement("a");
  anchor.href = url;
  anchor.download = document.name;
  anchor.click();
  URL.revokeObjectURL(url);
  document.savedContent = document.content;
  void events.emit("file.saved", { name: document.name });
  showNotice(`Download de '${document.name}' iniciado.`);
  persistSession();
}

const documentObject = document;

async function saveFile(forceSaveAs = false): Promise<void> {
  state.fileMenuOpen = false;
  const active = activeDocument();
  if (!active) throw new Error("Nenhum arquivo aberto.");
  const pickerWindow = window as FilePickerWindow;

  if (!forceSaveAs && active.handle) {
    await saveToHandle(active, active.handle);
    return;
  }

  if (pickerWindow.showSaveFilePicker) {
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName: active.name,
      types: [{ description: "Arquivo de texto", accept: { "text/plain": [".txt", ".md", ".json", ".js", ".ts", ".py"] } }],
    });
    await saveToHandle(active, handle);
    return;
  }

  downloadDocument(active);
}

async function installPluginFromUrl(url: string): Promise<void> {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) throw new Error("Informe a URL de um manifesto de plugin.");
  const manifestUrl = new URL(normalizedUrl, window.location.href).href;
  const response = await fetch(manifestUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Manifest request failed with status ${response.status}.`);
  const installed = await plugins.install((await response.json()) as unknown);
  const declaredEntrypoint = installed.manifest.entrypoints?.frontend;

  if (!declaredEntrypoint) {
    await plugins.uninstall(installed.manifest.id);
    throw new Error(`Plugin '${installed.manifest.name}' não declara entrypoint frontend.`);
  }

  const sourceUrl = new URL(declaredEntrypoint, manifestUrl).href;
  pluginSourceUrls.set(installed.manifest.id, sourceUrl);

  try {
    await plugins.enable(installed.manifest.id);
    await plugins.activate(installed.manifest.id, {
      commands,
      events,
      capabilities,
      subscriptions: [],
    });
  } catch (error) {
    pluginSourceUrls.delete(installed.manifest.id);
    await plugins.uninstall(installed.manifest.id);
    throw error;
  }

  persistPlugins();
  await refreshEnvironments();
  showNotice(`Plugin '${installed.manifest.name}' instalado e ativado.`);
}

function renderTreeEntries(entries: WorkspaceEntry[], depth = 0): string {
  return entries
    .map((entry) => {
      const activeDoc = activeDocument();
      const active = activeDoc?.path === entry.path ? " is-active" : "";
      const padding = 8 + depth * 16;

      if (entry.kind === "directory") {
        const expanded = state.expandedDirectories.has(entry.path);
        const children = expanded
          ? `<div class="tree-children">${entry.children?.length ? renderTreeEntries(entry.children, depth + 1) : '<div class="tree-empty">Pasta vazia</div>'}</div>`
          : "";
        return `<div class="tree-node"><button class="tree-entry tree-entry--directory" type="button" data-command="workspace.toggleDirectory" data-entry-path="${escapeHtml(entry.path)}" style="padding-left:${padding}px"><span class="tree-chevron">${renderIcon(expanded ? "chevronDown" : "chevronRight")}</span><span class="tree-entry__icon">${renderIcon(expanded ? "folderOpen" : "folder")}</span><span class="tree-entry__label">${escapeHtml(entry.name)}</span></button>${children}</div>`;
      }

      return `<button class="tree-entry${active}" type="button" data-command="file.openWorkspace" data-entry-path="${escapeHtml(entry.path)}" style="padding-left:${padding + 16}px"><span class="tree-entry__icon">${renderIcon("file")}</span><span class="tree-entry__label">${escapeHtml(entry.name)}</span></button>`;
    })
    .join("");
}

function renderWorkspaceEntries(): string {
  const restoreAccess = state.workspaceName && state.workspaceAccess !== "granted"
    ? renderButton(state.workspaceHandle ? "Restaurar" : "Reabrir", "refresh", {
        command: "workspace.reconnect",
        size: "small",
        variant: "primary",
        title: state.workspaceHandle ? "Restaurar acesso à pasta lembrada" : "Selecionar novamente a pasta lembrada",
      })
    : "";
  const actions = `<div class="explorer-actions">${renderButton("Novo", "fileAdd", { command: "file.new", size: "small", title: "Novo arquivo" })}${renderButton("Arquivo", "file", { command: "file.openPicker", size: "small", title: "Abrir arquivo" })}${renderButton("Pasta", "folderOpen", { command: "workspace.open", size: "small", title: "Abrir pasta" })}${restoreAccess}</div>`;
  if (!state.workspaceName) {
    return `${actions}<div class="empty-state"><p>Nenhum arquivo ou pasta aberto.</p></div>`;
  }
  const entries = renderTreeEntries(state.workspaceEntries);
  return `${actions}<div class="workspace-title">${escapeHtml(state.workspaceName)}</div><div class="tree">${entries || '<p class="muted">Nenhum item listado.</p>'}</div>`;
}

function pluginActions(plugin: PluginRecord): string {
  const active = plugin.state === "active" || plugin.state === "enabled";
  const toggleClass = active ? "toggle-switch is-active" : "toggle-switch";
  const toggleLabel = active ? "Ativo" : "Inativo";
  const toggleCommand = active ? "plugin.disable" : "plugin.enable";
  return `<div class="plugin-card__toggle"><div class="plugin-toggle"><span style="font-size:12px;color:#9ca3b0">${toggleLabel}</span><button class="${toggleClass}" type="button" data-command="${toggleCommand}" data-plugin-id="${escapeHtml(plugin.manifest.id)}" aria-label="${active ? "Desativar" : "Ativar"} plugin"><span class="toggle-switch__handle"></span></button></div>${renderButton("Remover", "trash", { command: "plugin.uninstall", size: "small", variant: "danger", data: { "plugin-id": plugin.manifest.id } })}</div>`;
}

function renderPlugins(): string {
  const renderCard = (plugin: PluginRecord): string => {
    const active = plugin.state === "active" || plugin.state === "enabled";
    const badgeClass = active ? "state-badge state-badge--active" : "state-badge state-badge--disabled";
    const badgeText = active ? "Ativo" : "Inativo";
    return `<article class="plugin-card"><div class="plugin-card__heading"><strong>${escapeHtml(plugin.manifest.name)}</strong><span class="${badgeClass}">${badgeText}</span></div><p>${escapeHtml(plugin.manifest.description ?? "Sem descrição.")}</p><small>${escapeHtml(plugin.manifest.id)} · v${escapeHtml(plugin.manifest.version)}</small>${pluginActions(plugin)}</article>`;
  };
  const renderAvailableCard = (entry: PluginCatalogEntry): string => `<article class="plugin-card"><div class="plugin-card__heading"><strong>${escapeHtml(entry.manifest.name)}</strong><span class="state-badge state-badge--available">Disponível</span></div><p>${escapeHtml(entry.manifest.description ?? "Sem descrição.")}</p><small>${escapeHtml(entry.manifest.id)} · v${escapeHtml(entry.manifest.version)}</small><div class="plugin-card__toggle">${renderButton("Instalar", "download", { command: "plugin.installFromUrl", size: "small", variant: "primary", data: { "plugin-url": entry.manifestUrl } })}</div></article>`;
  const installed = plugins.list();
  const available = state.availablePlugins.filter((entry) => !plugins.get(entry.manifest.id));
  const installedLanguages = installed.filter((plugin) => plugin.manifest.category === "language").map(renderCard).join("");
  const installedTools = installed.filter((plugin) => plugin.manifest.category === "tool").map(renderCard).join("");
  const availableLanguages = available.filter((entry) => entry.manifest.category === "language").map(renderAvailableCard).join("");
  const availableTools = available.filter((entry) => entry.manifest.category === "tool").map(renderAvailableCard).join("");

  const header = `<div class="plugin-manager__header"><h2 style="margin:0;font-size:16px;color:#e8eaed">Gerenciador de Plugins</h2><p style="margin:4px 0 0;font-size:12px;color:#9ca3b0">${installed.length} instalado(s) · ${available.length} disponível(is)</p></div>`;
  const installForm = `<form class="plugin-install" data-form="plugin-install"><label for="plugin-url" style="font-size:12px;color:#9ca3b0;margin-bottom:4px">Instalar de URL</label><div class="input-row"><input id="plugin-url" name="url" type="url" placeholder="https://registry.example/plugin.json" required />${renderButton("Instalar", "download", { type: "submit", size: "small", variant: "primary" })}</div></form>`;
  return `${header}${installForm}<div class="plugin-section"><h3 style="font-size:13px;color:#e8eaed;margin:16px 0 8px">Linguagens</h3><div class="plugin-list">${installedLanguages}${state.pluginCatalogLoading ? '<p class="muted">Carregando...</p>' : availableLanguages}${!installedLanguages && !availableLanguages ? '<p class="muted">Nenhum plugin de linguagem.</p>' : ""}</div></div><div class="plugin-section"><h3 style="font-size:13px;color:#e8eaed;margin:16px 0 8px">Ferramentas</h3><div class="plugin-list">${installedTools}${state.pluginCatalogLoading ? '<p class="muted">Carregando...</p>' : availableTools}${!installedTools && !availableTools ? '<p class="muted">Nenhum plugin de ferramenta.</p>' : ""}</div></div>`;
}

function renderEnvironments(): string {
  const provider = executionEnvironmentProvider();
  if (!provider) {
    return `<div class="empty-state"><p>Nenhum gerenciador de ambientes instalado.</p>${renderButton("Abrir plugins", "plugin", { command: "view.plugins", size: "small" })}</div>`;
  }

  const cards = state.environments
    .map((environment) => {
      const active = state.selectedEnvironmentId === environment.id;
      const environmentData = { "environment-id": environment.id };
      const selectAction = renderButton(active ? "Selecionado" : "Selecionar", active ? "check" : "environment", {
        command: "environment.select",
        size: "small",
        variant: active ? "primary" : "default",
        disabled: active,
        data: environmentData,
      });
      const packageAction = environment.type === "venv"
        ? renderButton("Pacotes", "package", { command: "environment.packagesFor", size: "small", data: environmentData })
        : "";
      const removeAction = renderButton("Remover", "trash", { command: "environment.removeById", size: "small", variant: "danger", data: environmentData });
      const environmentKind = environment.type === "venv" ? "Ambiente virtual" : "Executável Python";
      return `<article class="environment-card${active ? " is-active" : ""}"><div><strong>${escapeHtml(environment.name)}</strong><span>${escapeHtml(environmentKind)}${environment.version ? ` · ${escapeHtml(environment.version)}` : ""}</span><small>${escapeHtml(environment.executable ?? environment.id)}</small></div><div class="environment-card__actions">${selectAction}${packageAction}${removeAction}</div></article>`;
    })
    .join("");

  const sourceEnvironmentOptions = state.environments
    .filter((environment) => environment.status === "ready" && Boolean(environment.executable))
    .map((environment) => `<option value="${escapeHtml(environment.executable ?? "")}">${escapeHtml(environment.name)}${environment.version ? ` · ${escapeHtml(environment.version)}` : ""}</option>`)
    .join("");
  const createVenvForm = state.environmentForm === "createVenv"
    ? `<form class="environment-manager__form environment-manager__form--stacked" data-form="environment-create-venv"><div class="environment-form__heading"><strong>Criar ambiente virtual</strong><small>Crie um novo venv usando um Python já cadastrado.</small></div><label>Nome do ambiente<input name="name" value=".venv" aria-label="Nome do ambiente" /></label><label>Python de origem<select name="pythonExecutable" aria-label="Python de origem" ${sourceEnvironmentOptions ? "" : "disabled"}>${sourceEnvironmentOptions || '<option value="">Cadastre um Python primeiro</option>'}</select></label><label>Diretório de destino <span class="optional-label">opcional</span><input name="path" placeholder="Padrão: .tinyide/environments/python/.venv" aria-label="Diretório do novo ambiente" /></label><small>O diretório de destino não pode existir. O venv será criado com o Python selecionado.</small><div class="form-actions">${renderButton("Criar ambiente", "environment", { type: "submit", size: "small", variant: "primary", title: "Criar ambiente virtual", disabled: !sourceEnvironmentOptions || state.environmentBusy })}${renderButton("Cancelar", "close", { command: "environment.form.cancel", size: "small" })}</div></form>`
    : "";
  const addVenvForm = state.environmentForm === "addVenv"
    ? `<form class="environment-manager__form environment-manager__form--stacked" data-form="environment-add-venv"><div class="environment-form__heading"><strong>Adicionar venv existente</strong><small>Registre um ambiente virtual que já existe no disco.</small></div><label>Pasta do venv<div class="environment-path-picker"><input name="path" readonly value="${escapeHtml(state.environmentSelectedPath ?? "")}" placeholder="Nenhuma pasta selecionada" aria-label="Caminho do ambiente existente" />${renderButton("Procurar", "folderOpen", { command: "environment.browser.open", size: "small", title: "Selecionar pasta do venv" })}</div></label><label>Nome de exibição <span class="optional-label">opcional</span><input name="name" placeholder="Padrão: nome da pasta" aria-label="Nome do ambiente existente" /></label><small>A pasta precisa conter <code>pyvenv.cfg</code> e o executável Python interno.</small><div class="form-actions">${renderButton("Adicionar venv", "download", { type: "submit", size: "small", variant: "primary", title: "Adicionar ambiente virtual", disabled: !state.environmentSelectedPath || state.environmentBusy })}${renderButton("Cancelar", "close", { command: "environment.form.cancel", size: "small" })}</div></form>`
    : "";
  const addProcessForm = state.environmentForm === "addProcess"
    ? `<form class="environment-manager__form environment-manager__form--stacked" data-form="environment-add-process"><div class="environment-form__heading"><strong>Adicionar Python</strong><small>Escolha um executável Python instalado no computador.</small></div><label>Nome de exibição<input name="name" placeholder="Ex.: Python 3.12 do sistema" aria-label="Nome do executável" /></label><label>Executável Python<div class="environment-path-picker"><input name="executable" readonly value="${escapeHtml(state.environmentSelectedPath ?? "")}" placeholder="Nenhum executável selecionado" aria-label="Caminho do executável" />${renderButton("Procurar", "file", { command: "environment.browser.openFile", size: "small", title: "Selecionar executável Python" })}</div></label><small>O arquivo selecionado será validado executando <code>--version</code>.</small><div class="form-actions">${renderButton("Adicionar Python", "download", { type: "submit", size: "small", variant: "primary", title: "Adicionar Python", disabled: !state.environmentSelectedPath || state.environmentBusy })}${renderButton("Cancelar", "close", { command: "environment.form.cancel", size: "small" })}</div></form>`
    : "";
  const packagesForm = state.environmentForm === "packages"
    ? `<form class="environment-manager__form" data-form="environment-packages"><input name="packages" placeholder="django requests" aria-label="Pacotes" />${renderButton("Instalar", "download", { type: "submit", size: "small", variant: "primary" })}${renderButton("Cancelar", "close", { command: "environment.form.cancel", size: "small" })}</form>`
    : "";

  const runForm = state.environmentForm === "run"
    ? `<form class="environment-manager__form environment-manager__form--stacked run-profile-form" data-form="environment-run-profile"><strong>Perfil de execução</strong><label>Nome<input name="profileName" value="${escapeHtml(state.runProfile.name)}" /></label><label>Tipo<select name="mode"><option value="source" ${state.runProfile.mode === "source" ? "selected" : ""}>Arquivo aberto</option><option value="script" ${state.runProfile.mode === "script" ? "selected" : ""}>Script</option><option value="module" ${state.runProfile.mode === "module" ? "selected" : ""}>Módulo Python</option></select></label><label>Alvo<input name="target" value="${escapeHtml(state.runProfile.target)}" placeholder="src/main.py ou pacote.modulo" /></label><label>Diretório de trabalho<input name="workingDirectory" value="${escapeHtml(state.runProfile.workingDirectory)}" placeholder="Vazio usa a raiz do projeto" /></label><label>Argumentos<input name="arguments" value="${escapeHtml(state.runProfile.arguments)}" placeholder="--port 8000 --debug" /></label><label>Variáveis de ambiente<textarea name="environmentVariables" rows="5" placeholder="DJANGO_SETTINGS_MODULE=config.settings\nDEBUG=1">${escapeHtml(state.runProfile.environmentVariables)}</textarea></label><small>O ambiente selecionado fornece o interpretador. Caminhos relativos são resolvidos a partir do projeto aberto.</small><div class="form-actions">${renderButton("Salvar perfil", "save", { type: "submit", size: "small", variant: "primary" })}${renderButton("Cancelar", "close", { command: "environment.form.cancel", size: "small" })}</div></form>`
    : "";

  const createAction = renderButton("Criar venv", "environment", { command: "environment.createVenv", size: "small", variant: "primary", title: "Criar um novo ambiente virtual" });
  const addVenvAction = renderButton("Adicionar venv", "folderOpen", { command: "environment.addVenv", size: "small", title: "Adicionar um ambiente virtual existente" });
  const addProcessAction = renderButton("Adicionar Python", "terminal", { command: "environment.addProcess", size: "small", title: "Adicionar um executável Python" });
  const emptyState = `<div class="empty-state environment-empty-state"><strong>Comece adicionando um Python</strong><p>Depois você poderá usá-lo diretamente ou criar um venv para o projeto.</p>${renderButton("Adicionar Python", "terminal", { command: "environment.addProcess", size: "small", variant: "primary" })}</div>`;
  return `<div class="environment-manager"><div class="environment-manager__intro"><div><strong>Ambientes Python</strong><p>Cadastre interpretadores e ambientes virtuais disponíveis para o workspace.</p></div>${renderButton("Atualizar", "refresh", { command: "environment.refresh", size: "small", iconOnly: true, title: "Atualizar ambientes" })}</div><div class="environment-manager__toolbar">${addProcessAction}${addVenvAction}${createAction}</div>${createVenvForm}${addVenvForm}${addProcessForm}${packagesForm}${runForm}<div class="environment-list">${cards || emptyState}</div></div>`;
}

function emptyExecutionProfile(): ExecutionProfile {
  return {
    id: `profile-${Date.now().toString(36)}`,
    name: "Novo perfil",
    environment: { mode: "none" },
    saveBeforeRun: true,
    steps: [
      {
        id: "step-1",
        name: "Executar",
        executable: "",
        command: "",
        parameters: [],
        workingDirectory: "\${workspaceRoot}",
      },
    ],
  };
}

function executionProfileFromForm(form: HTMLFormElement): ExecutionProfile {
  const data = new FormData(form);
  const environmentSelect = form.elements.namedItem("environmentId") as HTMLSelectElement | null;
  const environmentId = String(environmentSelect?.value ?? "").trim();
  const environment = environmentId
    ? { mode: "fixed" as const, environmentId }
    : { mode: "none" as const };
  const workingDirectoryMode = String(data.get("workingDirectoryMode") ?? "workspace");
  const workingDirectory = workingDirectoryMode === "custom"
    ? String(data.get("customWorkingDirectory") ?? "").trim()
    : "${workspaceRoot}";

  return {
    id: String(data.get("id") ?? "").trim(),
    name: String(data.get("name") ?? "").trim(),
    environment,
    saveBeforeRun: data.get("saveBeforeRun") === "on",
    steps: [{
      id: "step-1",
      name: String(data.get("stepName") ?? "Executar").trim(),
      executable: String(data.get("executable") ?? "").trim(),
      command: String(data.get("command") ?? "").trim(),
      parameters: parseCommandLineArguments(String(data.get("parameters") ?? "")),
      ...(workingDirectory ? { workingDirectory } : {}),
      environmentVariables: parseEnvironmentVariables(String(data.get("environmentVariables") ?? "")),
      continueOnError: data.get("continueOnError") === "on",
    }],
  };
}

function captureExecutionProfileDraft(): ExecutionProfile | undefined {
  const form = appRoot.querySelector<HTMLFormElement>('[data-form="execution-profile"]');
  if (!form) return executionProfileDraft;
  executionProfileDraft = executionProfileFromForm(form);
  return executionProfileDraft;
}

function environmentExecutableDisplay(option: ExecutionProfileExecutableOption | undefined): string {
  if (!option) return "";
  const parts = option.description?.split(" · ").filter(Boolean) ?? [];
  return parts.at(-1) ?? option.label;
}

function updateExecutionProfilePreview(form: HTMLFormElement): void {
  const executableDisplay = form.querySelector<HTMLInputElement>("[data-profile-executable-display]");
  const command = form.elements.namedItem("command") as HTMLInputElement | null;
  const parameters = form.elements.namedItem("parameters") as HTMLTextAreaElement | null;
  const preview = form.querySelector<HTMLInputElement>("[data-profile-command-preview]");
  if (!preview) return;

  let parsedParameters: string[] = [];
  try {
    parsedParameters = parseCommandLineArguments(parameters?.value ?? "");
  } catch {
    const rawParameters = parameters?.value.trim();
    if (rawParameters) parsedParameters = [rawParameters];
  }

  preview.value = [
    executableDisplay?.value.trim() || "executável",
    command?.value.trim() ?? "",
    ...parsedParameters,
  ].filter(Boolean).join(" ");
}


function renderSharedFileBrowserModal(): string {
  const snapshot = fileBrowser.snapshot();
  const options = snapshot.options;
  if (!snapshot.open || !options) return "";
  const listing = snapshot.listing;
  const visiblePaths = new Set(snapshot.visibleEntries.map((entry) => entry.path));
  const entries = (listing?.entries ?? []).map((entry) =>
    `<button type="button" class="file-browser__entry${snapshot.selectedPath === entry.path ? " is-selected" : ""}${entry.disabled ? " is-disabled" : ""}" data-command="fileBrowser.activate" data-file-browser-entry data-browser-name="${escapeHtml(entry.name.toLocaleLowerCase())}" data-browser-path="${escapeHtml(entry.path)}" ${visiblePaths.has(entry.path) ? "" : "hidden"} ${entry.disabled ? "disabled" : ""}><span class="file-browser__icon">${renderIcon(entry.icon)}</span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.detail)}</small></button>`,
  ).join("");
  const selection = snapshot.selectedPath
    ? `<div class="file-browser__selection"><span>${renderIcon(options.selectionIcon)}</span><div><strong>${escapeHtml(options.selectionTitle)}</strong><small>${escapeHtml(snapshot.selectedPath)}</small></div></div>`
    : `<div class="file-browser__selection is-empty"><span>${renderIcon(options.selectionIcon)}</span><div><strong>${escapeHtml(options.emptySelectionTitle)}</strong><small>${escapeHtml(options.emptySelectionDescription)}</small></div></div>`;
  const content = snapshot.loading
    ? `<div class="file-browser-modal__loading">Carregando diretórios...</div>`
    : `<div class="file-browser__controls"><div class="file-browser__search"><span>${renderIcon("search")}</span><input type="search" data-file-browser-filter value="${escapeHtml(snapshot.filter)}" placeholder="Filtrar nesta pasta"/><button type="button" data-command="fileBrowser.clearFilter" aria-label="Limpar filtro" ${snapshot.filter ? "" : "disabled"}>${renderIcon("close")}</button></div><span class="file-browser__result-count" data-file-browser-result-count>${snapshot.visibleEntries.length} ${snapshot.visibleEntries.length === 1 ? "item" : "itens"}</span>${snapshot.allowHiddenToggle ? `<label class="file-browser__hidden-toggle"><input type="checkbox" data-file-browser-hidden ${snapshot.includeHidden ? "checked" : ""}/> Mostrar ocultos</label>` : ""}</div><div class="file-browser__path">${renderButton("Pasta pai", "folderOpen", { command: "fileBrowser.parent", size: "small", disabled: !listing?.parentPath })}<code>${escapeHtml(listing?.path || state.workspaceName || "Workspace")}</code></div>${selection}<div class="file-browser__entries">${entries}<p class="muted file-browser__empty" data-file-browser-empty ${snapshot.visibleEntries.length ? "hidden" : ""}>Nenhum item corresponde ao filtro.</p></div>`;
  return `<div class="modal-backdrop file-browser-backdrop" role="presentation"><section class="file-browser-modal" role="dialog" aria-modal="true"><header><div><h2>${escapeHtml(options.title)}</h2><p>${escapeHtml(options.description)}</p></div>${renderButton("Fechar", "close", { command: "fileBrowser.close", iconOnly: true })}</header><div class="file-browser-modal__content">${content}</div><footer>${renderButton("Cancelar", "close", { command: "fileBrowser.close", size: "small" })}${renderButton(options.confirmLabel, "check", { command: "fileBrowser.confirm", size: "small", variant: "primary", disabled: !snapshot.selectedPath })}</footer></section></div>`;
}

function updateFileBrowserFilter(filter: string): void {
  fileBrowser.setFilter(filter);
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  let visibleCount = 0;
  appRoot.querySelectorAll<HTMLElement>("[data-file-browser-entry]").forEach((entry) => {
    const visible = !normalizedFilter || (entry.dataset.browserName ?? "").includes(normalizedFilter);
    entry.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  const resultCount = appRoot.querySelector<HTMLElement>("[data-file-browser-result-count]");
  if (resultCount) resultCount.textContent = `${visibleCount} ${visibleCount === 1 ? "item" : "itens"}`;
  const empty = appRoot.querySelector<HTMLElement>("[data-file-browser-empty]");
  if (empty) empty.hidden = visibleCount > 0;
  const clearButton = appRoot.querySelector<HTMLButtonElement>('[data-command="fileBrowser.clearFilter"]');
  if (clearButton) clearButton.disabled = !filter;
}

async function openProfileCommandFileBrowser(): Promise<void> {
  captureExecutionProfileDraft();
  if (!state.workspaceHandle) await openWorkspace();
  const rootHandle = state.workspaceHandle;
  if (!rootHandle) throw new Error("Abra uma pasta antes de selecionar arquivos.");
  const handles = new Map<string, BrowserDirectoryHandle>([["", rootHandle]]);
  const source: FileBrowserSource = {
    async load(request) {
      const path = request.path ?? "";
      const handle = handles.get(path);
      if (!handle) throw new Error(`Pasta não encontrada: ${path}`);
      const entries = (await readDirectory(handle, path)).filter(
        (entry) => request.includeHidden || !entry.name.startsWith("."),
      );
      const mapped = entries.map<FileBrowserEntry>((entry) => {
        if (entry.kind === "directory" && entry.handle) handles.set(entry.path, entry.handle as BrowserDirectoryHandle);
        return { name: entry.name, path: entry.path, kind: entry.kind, action: entry.kind === "directory" ? "navigate" : "select", detail: entry.kind === "directory" ? "Pasta" : "Arquivo", icon: entry.kind === "directory" ? "folder" : "file" };
      });
      const parentPath = path ? path.split("/").slice(0, -1).join("/") : undefined;
      return { path, ...(parentPath !== undefined ? { parentPath } : {}), entries: mapped };
    },
  };
  await fileBrowser.open({ title: "Selecionar arquivo", description: "Selecione um arquivo para preencher o campo Comando.", confirmLabel: "Usar arquivo", selectionTitle: "Arquivo selecionado", emptySelectionTitle: "Nenhum arquivo selecionado", emptySelectionDescription: "Escolha um arquivo na lista.", selectionIcon: "file", source, allowHiddenToggle: true, onConfirm(path) { const input = appRoot.querySelector<HTMLInputElement>('[data-form="execution-profile"] input[name="command"]'); if (!input) throw new Error("O campo Comando não está disponível."); input.value = path; input.dispatchEvent(new Event("input", { bubbles: true })); } });
}

async function openEnvironmentFileBrowser(mode: "directory" | "file"): Promise<void> {
  const provider = executionEnvironmentProvider();
  const browse = provider?.browse;
  if (!provider || !browse) throw new Error("O gerenciador não oferece navegação de arquivos.");
  const source: FileBrowserSource = {
    async load(request) {
      const listing = await browse({ ...(request.path ? { path: request.path } : {}), mode, includeHidden: request.includeHidden, filter: "" });
      return { path: listing.path, ...(listing.parentPath ? { parentPath: listing.parentPath } : {}), entries: listing.entries.map<FileBrowserEntry>((entry) => { const selectable = mode === "file" ? entry.kind === "file" && entry.executable : entry.kind === "directory" && entry.isEnvironment; return { name: entry.name, path: entry.path, kind: entry.kind, action: selectable ? "select" : entry.kind === "directory" ? "navigate" : "select", detail: entry.kind === "file" ? (entry.executable ? "Executável" : "Arquivo") : entry.isEnvironment ? "Venv válido" : "Diretório", icon: entry.kind === "directory" ? (entry.isEnvironment ? "environment" : "folder") : "file", disabled: entry.kind === "file" && !selectable }; }), };
    },
  };
  const initialPath = readEnvironmentBrowserPaths()[mode];
  await fileBrowser.open({ title: mode === "file" ? "Selecionar executável Python" : "Selecionar diretório do ambiente", description: mode === "file" ? "Navegue até o executável, selecione-o e confirme." : "Navegue até a raiz de um ambiente virtual válido.", confirmLabel: mode === "file" ? "Usar este Python" : "Usar este venv", selectionTitle: mode === "file" ? "Python selecionado" : "Venv selecionado", emptySelectionTitle: "Nenhuma seleção", emptySelectionDescription: mode === "file" ? "Escolha um executável Python." : "Escolha a raiz de um venv válido.", selectionIcon: mode === "file" ? "file" : "environment", source, ...(initialPath ? { initialPath } : {}), allowHiddenToggle: true, onConfirm: async (path) => { if (mode === "file") { if (!provider.validatePythonExecutable) throw new Error("O gerenciador não valida executáveis Python."); await provider.validatePythonExecutable(path); } state.environmentSelectedPath = path; rememberEnvironmentBrowserPath(mode, fileBrowser.snapshot().listing?.path); } });
}

function renderExecutionProfilesModal(): string {
  if (!state.executionProfilesOpen) return "";
  const profiles = executionProfiles.list();
  const editing = state.executionProfileEditingId
    ? executionProfiles.get(state.executionProfileEditingId)
    : undefined;
  const profile = executionProfileDraft ?? editing ?? emptyExecutionProfile();
  const step = profile.steps[0] ?? emptyExecutionProfile().steps[0]!;
  const selectedId = executionProfiles.selectedId();
  const environmentExecutableOptions = state.executionProfileExecutableOptions
    .filter((option): option is ExecutionProfileExecutableOption & { readonly environmentId: string } => Boolean(option.environmentId));
  const environmentsById = new Map<string, ExecutionProfileExecutableOption & { readonly environmentId: string }>();
  environmentExecutableOptions.forEach((option) => {
    if (!environmentsById.has(option.environmentId)) environmentsById.set(option.environmentId, option);
  });
  const currentEnvironmentId = profile.environment.mode === "fixed"
    ? profile.environment.environmentId
    : "";
  const selectedEnvironmentOption = currentEnvironmentId
    ? environmentsById.get(currentEnvironmentId)
    : undefined;
  const missingEnvironmentOption = currentEnvironmentId && !selectedEnvironmentOption
    ? `<option value="${escapeHtml(currentEnvironmentId)}" selected>Ambiente indisponível — ${escapeHtml(currentEnvironmentId)}</option>`
    : "";
  const environmentOptions = [...environmentsById.values()]
    .map((option) => {
      const version = option.description?.split(" · ")[0];
      return `<option value="${escapeHtml(option.environmentId)}" ${option.environmentId === currentEnvironmentId ? "selected" : ""}>${escapeHtml(option.label)}${version ? ` — ${escapeHtml(version)}` : ""}</option>`;
    })
    .join("");
  const selectedEnvironmentDescription = selectedEnvironmentOption?.description ?? "O perfil executará sem ambiente vinculado.";
  const environmentExecutable = environmentExecutableDisplay(selectedEnvironmentOption);
  const executableValue = currentEnvironmentId ? "${environmentExecutable}" : step.executable;
  const executableDisplay = currentEnvironmentId ? environmentExecutable : step.executable === "${environmentExecutable}" ? "" : step.executable;
  const commandValue = step.command;
  const commandParameters = step.parameters;
  const commandParametersText = formatCommandLineArguments(commandParameters);
  const workingDirectoryMode = !step.workingDirectory || step.workingDirectory === "${workspaceRoot}"
    ? "workspace"
    : "custom";
  const customWorkingDirectory = workingDirectoryMode === "custom" ? step.workingDirectory ?? "" : "";
  const contributedExecutables = state.executionProfileExecutableOptions
    .filter((option) => !option.environmentId)
    .map((option) => `<button type="button" class="execution-profile-source" data-command="execution.profile.useExecutable" data-profile-executable="${escapeHtml(option.value)}"><span>${renderIcon("terminal")}</span><span><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}</span></button>`)
    .join("");
  const cards = profiles.map((candidate) => {
    const selected = candidate.id === selectedId;
    return `<article class="execution-profile-card${selected ? " is-active" : ""}">${renderButton("Remover perfil", "close", { command: "execution.profile.remove.request", iconOnly: true, className: "execution-profile-card__remove", title: `Remover ${candidate.name}`, data: { "profile-id": candidate.id } })}<div class="execution-profile-card__summary"><span class="execution-profile-card__icon">${renderIcon(selected ? "play" : "terminal")}</span><div><strong>${escapeHtml(candidate.name)}</strong><small>${candidate.steps.length} etapa(s) · ${candidate.environment.mode === "none" ? "sem ambiente" : "ambiente fixo"}</small></div></div><div class="execution-profile-card__actions">${renderButton(selected ? "Ativo" : "Usar", selected ? "check" : "play", { command: "execution.profile.select", size: "small", disabled: selected, data: { "profile-id": candidate.id } })}${renderButton("Editar", "saveAs", { command: "execution.profile.edit", size: "small", data: { "profile-id": candidate.id } })}</div></article>`;
  }).join("");
  const previewExecutable = executableDisplay || "executável";
  const preview = [previewExecutable, commandValue, ...commandParameters].filter(Boolean).join(" ");

  return `<div class="modal-backdrop execution-profiles-backdrop" role="presentation"><section class="execution-profiles-modal" role="dialog" aria-modal="true" aria-labelledby="execution-profiles-title"><header><div class="execution-profiles-modal__heading"><span class="execution-profiles-modal__heading-icon">${renderIcon("play")}</span><div><span class="execution-profiles-modal__eyebrow">EXECUÇÃO</span><h2 id="execution-profiles-title">Perfis de execução</h2><p>Configure comandos reutilizáveis para este workspace.</p></div></div><div class="execution-profiles-modal__workspace"><small>Workspace atual</small><strong>${escapeHtml(state.workspaceName ?? "Global")}</strong></div>${renderButton("Fechar", "close", { command: "execution.profiles.close", iconOnly: true })}</header><div class="execution-profiles-modal__content"><aside><div class="execution-profile-sidebar__heading"><div><strong>Perfis</strong><small>Configurações salvas</small></div><span>${profiles.length}</span></div><div class="execution-profile-list">${cards || '<div class="execution-profile-empty"><strong>Nenhum perfil</strong><small>Crie o primeiro perfil para executar seu projeto.</small></div>'}</div><div class="execution-profile-sidebar__footer">${renderButton("Novo perfil", "fileAdd", { command: "execution.profile.new", size: "small", variant: "primary" })}</div></aside><form data-form="execution-profile" class="execution-profile-form"><input type="hidden" name="id" value="${escapeHtml(profile.id)}"/><input type="hidden" name="executable" value="${escapeHtml(executableValue)}"/><div class="execution-profile-form__body"><section class="execution-profile-identity"><div class="execution-profile-section-heading"><span>${renderIcon("saveAs")}</span><div><strong>Identificação</strong><small>Defina como este perfil será reconhecido e qual ambiente utilizará.</small></div></div><div class="execution-profile-identity__fields"><label>Nome do perfil<input name="name" value="${escapeHtml(profile.name)}" required /></label><label class="execution-profile-environment-field">Ambiente<select name="environmentId" ${state.executionProfileContributionsLoading ? "disabled" : ""}><option value="">Nenhum ambiente</option>${missingEnvironmentOption}${environmentOptions}</select><small data-profile-environment-description>${escapeHtml(selectedEnvironmentDescription)}</small></label></div></section><section class="execution-profile-command-panel"><div class="execution-profile-command-panel__heading"><div><span class="execution-profile-command-panel__icon">${renderIcon("terminal")}</span><div><strong>Comando</strong><small>Configure o executável, o comando e seus parâmetros.</small></div></div></div>${state.executionProfileContributionsLoading ? '<p class="muted">Carregando ferramentas...</p>' : contributedExecutables ? `<div class="execution-profile-sources">${contributedExecutables}</div>` : ""}<label>Executável<div class="execution-profile-field-action"><input data-profile-executable-display value="${escapeHtml(executableDisplay)}" placeholder="Selecione um ambiente ou informe o executável" ${currentEnvironmentId ? "readonly" : ""}/></div><small>${currentEnvironmentId ? "Fornecido pelo ambiente selecionado." : "Informe um caminho ou escolha uma ferramenta fornecida por plugin."}</small></label><label>Comando<div class="execution-profile-field-action"><input name="command" value="${escapeHtml(commandValue)}" placeholder="Digite um comando ou selecione um script" autocomplete="off"/>${renderButton("Selecionar arquivo", "folderOpen", { command: "execution.profile.pickCommandFile", size: "small", className: "execution-profile-command-picker" })}</div><small>Texto livre. Selecionar um arquivo apenas preenche este campo.</small></label><label>Parâmetros <small>sintaxe de linha de comando</small><textarea name="parameters" rows="6" placeholder="runserver localhost:9092">${escapeHtml(commandParametersText)}</textarea><small>Espaços separam argumentos. Use aspas para preservar valores com espaços.</small></label></section><details class="execution-profile-advanced"><summary><span class="execution-profile-advanced__icon">${renderIcon("environment")}</span><div><strong>Contexto e opções</strong><small>Diretório, variáveis e comportamento da execução.</small></div><span class="execution-profile-advanced__chevron">›</span></summary><div class="execution-profile-advanced__content"><div class="execution-profile-advanced__grid"><label>Diretório de trabalho<select name="workingDirectoryMode"><option value="workspace" ${workingDirectoryMode === "workspace" ? "selected" : ""}>Raiz do workspace</option><option value="custom" ${workingDirectoryMode === "custom" ? "selected" : ""}>Caminho personalizado</option></select></label><label data-profile-custom-working-directory ${workingDirectoryMode === "custom" ? "" : "hidden"}>Caminho personalizado<input name="customWorkingDirectory" value="${escapeHtml(customWorkingDirectory)}" placeholder="/caminho/do/projeto"/></label></div><label>Variáveis de ambiente <small>CHAVE=valor</small><textarea name="environmentVariables" rows="3">${escapeHtml(Object.entries(step.environmentVariables ?? {}).map(([name, value]) => `${name}=${value}`).join("\n"))}</textarea></label><div class="execution-profile-options"><label class="execution-profile-option"><input type="checkbox" name="saveBeforeRun" ${profile.saveBeforeRun !== false ? "checked" : ""}/><span><strong>Salvar antes de executar</strong><small>Persiste alterações abertas antes de iniciar o processo.</small></span></label><label class="execution-profile-option"><input type="checkbox" name="continueOnError" ${step.continueOnError ? "checked" : ""}/><span><strong>Continuar após falha</strong><small>Permite seguir para próximas etapas quando houver erro.</small></span></label></div></div></details></div><input type="hidden" name="stepName" value="${escapeHtml(step.name)}"/><div class="execution-profile-footer"><div class="execution-profile-preview"><span>${renderIcon("terminal")}</span><small>Prévia do comando</small><input data-profile-command-preview value="${escapeHtml(preview)}" disabled aria-label="Prévia do comando"/></div><div class="form-actions">${renderButton("Cancelar", "close", { command: "execution.profiles.close" })}${renderButton("Salvar perfil", "save", { type: "submit", variant: "primary" })}</div></div></form></div></section></div>`;
}

function renderExecutionProfileRemovalModal(): string {
  const profileId = state.executionProfileRemovalId;
  if (!profileId) return "";
  const profile = executionProfiles.get(profileId);
  if (!profile) return "";

  return `<div class="modal-backdrop execution-profile-confirmation-backdrop" role="presentation"><section class="execution-profile-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="execution-profile-removal-title" aria-describedby="execution-profile-removal-description"><div class="execution-profile-confirmation__icon">${renderIcon("trash")}</div><div class="execution-profile-confirmation__content"><span class="execution-profile-confirmation__eyebrow">CONFIRMAÇÃO</span><h2 id="execution-profile-removal-title">Remover perfil?</h2><p id="execution-profile-removal-description">O perfil <strong>${escapeHtml(profile.name)}</strong> será removido permanentemente deste workspace.</p></div><div class="execution-profile-confirmation__actions">${renderButton("Cancelar", "close", { command: "execution.profile.remove.cancel" })}${renderButton("Remover perfil", "trash", { command: "execution.profile.remove.confirm", variant: "danger", data: { "profile-id": profile.id } })}</div></section></div>`;
}


function renderSidebar(): string {
  const title = state.sidebarView === "explorer" ? "EXPLORER" : state.sidebarView === "plugins" ? "PLUGINS" : "AMBIENTES";
  const content = state.sidebarView === "explorer" ? renderWorkspaceEntries() : state.sidebarView === "plugins" ? renderPlugins() : renderEnvironments();
  return `<aside id="sidebar-panel" class="sidebar ${state.sidebarVisible ? "" : "is-hidden"}"><header class="sidebar__header">${title}</header><div class="sidebar__content">${content}</div></aside>`;
}

function renderWelcome(): string {
  return `<div class="welcome-screen"><h1>tinyIde</h1><p>Crie ou abra um arquivo para começar.</p><div class="welcome-actions">${renderButton("Novo arquivo", "fileAdd", { command: "file.new", variant: "primary" })}${renderButton("Abrir arquivo", "file", { command: "file.openPicker" })}${renderButton("Abrir pasta", "folderOpen", { command: "workspace.open" })}</div><small>Atalhos: Ctrl+N, Ctrl+O, Ctrl+S e Ctrl+Shift+S</small></div>`;
}

function renderExecutionProfileControls(): string {
  const profiles = executionProfiles.list();
  const selectedId = executionProfiles.selectedId();
  const options = profiles
    .map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === selectedId ? "selected" : ""}>${escapeHtml(profile.name)}</option>`)
    .join("");
  return `<div class="editor-profile-controls"><select data-execution-profile-select aria-label="Perfil de execução" ${state.executionBusy ? "disabled" : ""}><option value="">${profiles.length ? "Selecionar perfil" : "Sem perfis"}</option>${options}</select>${renderButton("Perfis", "saveAs", { command: "execution.profiles.open", size: "small", title: "Gerenciar perfis de execução" })}${state.executionBusy ? renderButton("Parar", "close", { command: "execution.stop", size: "small", variant: "danger" }) : renderButton("Executar", "play", { command: "execution.profile.run", size: "small", variant: "primary", disabled: !selectedId })}</div>`;
}

function renderEditor(): string {
  const active = activeDocument();
  if (!active) return renderWelcome();
  const dirty = active.content !== active.savedContent;
  const provider = languageProviderFor(active);
  const profileControls = renderExecutionProfileControls();
  const languageActions = provider
    ? renderButton("Lint", "lint", { command: "language.lint", size: "small", disabled: state.languageActionRunning })
    : "";
  const diagnostics = state.diagnostics.length
    ? `<div class="diagnostics">${state.diagnostics
        .map(
          (diagnostic) =>
            `<button data-diagnostic-line="${diagnostic.line}"><strong>${diagnostic.severity}</strong> ${diagnostic.line}:${diagnostic.column} ${escapeHtml(diagnostic.message)}</button>`,
        )
        .join("")}</div>`
    : "";
  const editorSurface = provider
    ? `<div class="highlight-editor"><pre class="syntax-layer" data-syntax-layer>${renderHighlightedSource(active.content, provider)}</pre><textarea class="code-input code-input--highlighted" data-editor spellcheck="false" aria-label="Editor de ${escapeHtml(active.name)}">${escapeHtml(active.content)}</textarea></div>`
    : `<textarea class="code-input" data-editor spellcheck="false" aria-label="Editor de ${escapeHtml(active.name)}">${escapeHtml(active.content)}</textarea>`;
  return `<div class="code-editor"><div class="editor-toolbar"><span class="editor-toolbar__document">${dirty ? "● " : ""}${escapeHtml(active.name)}${provider ? ` · ${escapeHtml(provider.name)}` : ""}</span><div class="editor-toolbar__actions">${profileControls}${languageActions}${renderButton("Salvar como", "saveAs", { command: "file.saveAs", iconOnly: true })}${renderButton("Salvar", "save", { command: "file.save", iconOnly: true, variant: "primary" })}</div></div>${diagnostics}${editorSurface}</div>`;
}

async function lintActiveDocument(): Promise<void> {
  const active = activeDocument();
  const provider = languageProviderFor(active);
  if (!active || !provider) throw new Error("Nenhum provider de linguagem disponível para este arquivo.");
  state.languageActionRunning = true;
  render();
  try {
    state.diagnostics = [...(await provider.lint(active.content, active.name))];
    log(`${provider.id}.lint: ${state.diagnostics.length} diagnóstico(s)`);
  } finally {
    state.languageActionRunning = false;
    render();
    persistSession();
  }
}

async function createVenvEnvironment(): Promise<void> {
  const provider = executionEnvironmentProvider();
  if (!provider) throw new Error("Nenhum gerenciador de ambientes instalado.");
  state.sidebarView = "environments";
  state.sidebarVisible = true;
  state.environmentForm = "createVenv";
  render();
}

async function submitCreateVenv(name: string): Promise<void> {
  const provider = executionEnvironmentProvider();
  if (!provider) throw new Error("Nenhum gerenciador de ambientes instalado.");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Informe o nome do ambiente.");
  state.environmentBusy = true;
  state.notice = `Criando ambiente virtual '${normalizedName}'...`;
  state.error = undefined;
  render();
  try {
    const form = appRoot.querySelector<HTMLFormElement>('[data-form="environment-create-venv"]');
    const formData = form ? new FormData(form) : new FormData();
    const pythonExecutableValue = formData.get("pythonExecutable");
    const pythonExecutable = typeof pythonExecutableValue === "string"
      ? pythonExecutableValue.trim()
      : "";
    if (!pythonExecutable) throw new Error("Selecione o Python que será usado para criar o ambiente.");
    const pathValue = formData.get("path");
    const path = typeof pathValue === "string" && pathValue.trim() ? pathValue.trim() : undefined;
    const environment = await provider.createVenv({
      name: normalizedName,
      pythonExecutable,
      ...(path ? { path } : {}),
    });
    await refreshEnvironments();
    state.selectedEnvironmentId = environment.id;
    state.environmentForm = undefined;
    showNotice(`Ambiente '${environment.name}' criado.`);
    persistSession();
  } finally {
    state.environmentBusy = false;
    render();
    persistSession();
  }
}

async function submitAddVenv(path: string, name: string): Promise<void> {
  const provider = executionEnvironmentProvider();
  if (!provider) throw new Error("Nenhum gerenciador de ambientes instalado.");
  const normalizedPath = path.trim();
  if (!normalizedPath) throw new Error("Informe o caminho do ambiente existente.");
  state.environmentBusy = true;
  state.notice = `Validando ambiente em '${normalizedPath}'...`;
  state.error = undefined;
  render();
  try {
    const normalizedName = name.trim();
    const environment = await provider.addVenv({
      path: normalizedPath,
      ...(normalizedName ? { name: normalizedName } : {}),
    });
    await refreshEnvironments();
    state.selectedEnvironmentId = environment.id;
    state.environmentForm = undefined;
    state.environmentSelectedPath = undefined;
    showNotice(`Ambiente '${environment.name}' adicionado.`);
    persistSession();
  } finally {
    state.environmentBusy = false;
    render();
  }
}

async function submitAddProcess(name: string, executable: string): Promise<void> {
  const provider = executionEnvironmentProvider();
  if (!provider) throw new Error("Nenhum gerenciador de ambientes instalado.");
  const normalizedName = name.trim();
  const normalizedExecutable = executable.trim();
  if (!normalizedName) throw new Error("Informe o nome do executável.");
  if (!normalizedExecutable) throw new Error("Informe o caminho do executável.");
  state.environmentBusy = true;
  state.notice = `Adicionando executável '${normalizedName}'...`;
  state.error = undefined;
  render();
  try {
    const environment = await provider.addProcess({
      name: normalizedName,
      executable: normalizedExecutable,
    });
    await refreshEnvironments();
    state.selectedEnvironmentId = environment.id;
    state.environmentForm = undefined;
    showNotice(`Executável '${environment.name}' adicionado.`);
    persistSession();
  } finally {
    state.environmentBusy = false;
    render();
  }
}


async function installEnvironmentPackages(): Promise<void> {
  const provider = executionEnvironmentProvider();
  if (!provider) throw new Error("O ambiente selecionado não permite gerenciar pacotes.");
  if (!state.selectedEnvironmentId) throw new Error("Selecione um ambiente.");
  state.environmentForm = "packages";
  render();
}

async function submitEnvironmentPackages(value: string): Promise<void> {
  const provider = executionEnvironmentProvider();
  const environmentId = state.selectedEnvironmentId;
  if (!provider || !environmentId) throw new Error("Selecione um ambiente com suporte a pacotes.");
  if (!value.trim()) throw new Error("Informe ao menos um pacote.");
  const packages = value.trim().split(/\s+/);
  state.environmentBusy = true;
  state.notice = `Instalando ${packages.join(", ")}...`;
  state.error = undefined;
  render();
  try {
    await provider.installPackages(environmentId, packages);
    await refreshEnvironments();
    state.environmentForm = undefined;
    showNotice("Pacotes instalados no ambiente selecionado.");
    persistSession();
  } finally {
    state.environmentBusy = false;
    render();
  }
}

async function removeSelectedEnvironment(): Promise<void> {
  const provider = executionEnvironmentProvider();
  const environmentId = state.selectedEnvironmentId;
  if (!provider || !environmentId) throw new Error("Selecione um ambiente.");
  const environment = state.environments.find((candidate) => candidate.id === environmentId);
  state.environmentBusy = true;
  state.notice = `Removendo ambiente '${environment?.name ?? environmentId}'...`;
  state.error = undefined;
  render();
  try {
    await provider.remove(environmentId);
    state.selectedEnvironmentId = undefined;
    await refreshEnvironments();
    showNotice(`Ambiente '${environment?.name ?? environmentId}' removido.`);
    persistSession();
  } finally {
    state.environmentBusy = false;
    render();
  }
}

function selectEnvironment(rawId: unknown): void {
  if (typeof rawId !== "string" || !state.environments.some((environment) => environment.id === rawId)) throw new Error("Ambiente inválido.");
  state.selectedEnvironmentId = rawId;
  render();
  persistSession();
}

function packagesForEnvironment(rawId: unknown): void {
  if (typeof rawId !== "string") throw new Error("Ambiente inválido.");
  state.selectedEnvironmentId = rawId;
  state.environmentForm = "packages";
  state.sidebarView = "environments";
  state.sidebarVisible = true;
  render();
  persistSession();
}

async function removeEnvironmentById(rawId: unknown): Promise<void> {
  if (typeof rawId !== "string") throw new Error("Ambiente inválido.");
  state.selectedEnvironmentId = rawId;
  await removeSelectedEnvironment();
}

async function readHostContext(): Promise<{ workspaceRoot: string }> {
  const response = await fetch("/core-api/context", { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível obter o contexto de execução do host.");
  return await response.json() as { workspaceRoot: string };
}

async function startHostProcess(request: ProcessExecutionRequest): Promise<HostProcessSnapshot> {
  const response = await fetch("/core-api/execution/processes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json() as HostProcessSnapshot | { error?: string };
  if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Falha ao iniciar processo.");
  return payload as HostProcessSnapshot;
}

async function readHostProcess(id: string): Promise<HostProcessSnapshot> {
  const response = await fetch(`/core-api/execution/processes/${encodeURIComponent(id)}`, { cache: "no-store" });
  const payload = await response.json() as HostProcessSnapshot | { error?: string };
  if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Falha ao consultar processo.");
  return payload as HostProcessSnapshot;
}

async function stopExecutionProfile(): Promise<void> {
  if (!state.activeProcessId) return;
  await fetch(`/core-api/execution/processes/${encodeURIComponent(state.activeProcessId)}`, { method: "DELETE" });
}

function activeFileDirectory(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const normalized = path.replaceAll("\\", "/");
  const separator = normalized.lastIndexOf("/");
  return separator >= 0 ? normalized.slice(0, separator) || "/" : undefined;
}

async function runSelectedExecutionProfile(): Promise<void> {
  const profile = executionProfiles.selected();
  if (!profile) throw new Error("Selecione um perfil de execução.");
  const active = activeDocument();
  const environmentId = profile.environment.mode === "fixed"
    ? profile.environment.environmentId
    : undefined;
  const environment = environmentId
    ? state.environments.find((candidate) => candidate.id === environmentId)
    : undefined;
  if (profile.environment.mode !== "none" && !environment?.executable) {
    throw new Error("O perfil exige um ambiente com executável disponível.");
  }
  if (profile.saveBeforeRun && active && active.content !== active.savedContent) await saveFile(false);
  const host = await readHostContext();
  const workspaceRoot = inferWorkspaceRoot({
    workspaceName: state.workspaceName,
    pathHints: [
      ...profile.steps.flatMap((step) => [step.workingDirectory, step.command, step.executable]),
      environment?.path,
      environment?.executable,
      host.workspaceRoot,
    ],
  });
  if (!workspaceRoot) {
    throw new Error(
      `O workspace '${state.workspaceName ?? "atual"}' não está vinculado a um caminho no host. `
      + "Selecione um ambiente localizado dentro do workspace ou configure um diretório de trabalho absoluto.",
    );
  }
  const activePath = active?.path
    ? `${workspaceRoot}/${active.path.replace(/^\/+/, "")}`
    : active?.name;
  const activeDirectory = activeFileDirectory(activePath);
  const variableContext = {
    workspaceRoot,
    ...(activePath ? { activeFile: activePath } : {}),
    ...(activeDirectory ? { activeFileDirectory: activeDirectory } : {}),
    ...(active?.name ? { activeFileName: active.name } : {}),
    ...(environment?.executable ? { environmentExecutable: environment.executable } : {}),
    ...(environment?.path ? { environmentPath: environment.path } : {}),
  };
  const steps = resolveExecutionProfile(profile, variableContext);

  state.executionBusy = true;
  state.panelVisible = true;
  state.logs = [`[perfil] ${profile.name}`];
  state.error = undefined;
  render();
  try {
    for (const step of steps) {
      const workingDirectory = step.workingDirectory ?? workspaceRoot;
      state.logs = [
        ...state.logs,
        `\n[etapa] ${step.name}`,
        `[diretório] ${workingDirectory}`,
        `$ ${step.executable} ${step.arguments.join(" ")}`,
      ];
      render();
      let process = await startHostProcess({
        executable: step.executable,
        arguments: step.arguments,
        workingDirectory,
        ...(step.environmentVariables ? { environmentVariables: step.environmentVariables } : {}),
      });
      state.activeProcessId = process.id;
      while (process.status === "running") {
        await new Promise((resolve) => setTimeout(resolve, 250));
        process = await readHostProcess(process.id);
        state.logs = [
          `[perfil] ${profile.name}`,
          `[etapa] ${step.name}`,
          `[diretório] ${workingDirectory}`,
          `$ ${step.executable} ${step.arguments.join(" ")}`,
          process.stdout,
          process.stderr,
        ].filter(Boolean);
        const output = appRoot.querySelector<HTMLElement>(".output");
        if (output) output.scrollTop = output.scrollHeight;
      }
      state.activeProcessId = undefined;
      if (process.exitCode !== 0 && !step.continueOnError) {
        throw new Error(`A etapa '${step.name}' terminou com código ${process.exitCode}.`);
      }
    }
    showNotice(`Perfil '${profile.name}' concluído.`);
  } finally {
    state.executionBusy = false;
    state.activeProcessId = undefined;
    render();
  }
}

async function runWithSelectedEnvironment(): Promise<void> {
  const active = activeDocument();
  const provider = executionEnvironmentProviderForExecution(active);
  const environmentId = state.selectedEnvironmentId;
  if (!active || !provider) throw new Error("Nenhum ambiente disponível para este arquivo.");
  if (!environmentId) throw new Error("Selecione um ambiente antes de executar.");

  const environment = state.environments.find((candidate) => candidate.id === environmentId);
  state.environmentBusy = true;
  state.panelVisible = true;
  state.notice = `Executando '${active.name}' em ${environment?.name ?? environmentId}...`;
  state.error = undefined;
  state.logs = [`[${provider.name}] Executando ${active.name} em ${environment?.name ?? environmentId}...`];
  render();

  try {
    const profile = state.runProfile;
    const commonRequest = {
      args: parseCommandLineArguments(profile.arguments),
      environmentVariables: parseEnvironmentVariables(profile.environmentVariables),
      ...(profile.workingDirectory.trim()
        ? { workingDirectory: profile.workingDirectory.trim() }
        : {}),
    };
    const request: ExecutionEnvironmentRunRequest = profile.mode === "module"
      ? {
          mode: "module" as const,
          moduleName: profile.target.trim(),
          ...commonRequest,
        }
      : profile.mode === "script"
        ? {
            mode: "script" as const,
            scriptPath: profile.target.trim(),
            ...commonRequest,
          }
        : {
            mode: "source" as const,
            source: active.content,
            fileName: active.path ?? active.name,
            ...commonRequest,
          };
    const result = await provider.run(environmentId, request);
    state.logs = [
      `[${provider.name} · ${environment?.name ?? environmentId}] ${active.name} exited with ${result.exitCode} in ${result.durationMs.toFixed(0)}ms`,
      result.stdout,
      result.stderr,
    ].filter(Boolean);
    if (result.exitCode === 0) {
      state.notice = `'${active.name}' executado no ambiente '${environment?.name ?? environmentId}'.`;
      state.error = undefined;
    } else {
      state.error = `'${active.name}' terminou com código ${result.exitCode}.`;
      state.notice = undefined;
    }
    render();
    requestAnimationFrame(() => {
      const output = appRoot.querySelector<HTMLElement>(".output");
      if (output) output.scrollTop = output.scrollHeight;
    });
  } finally {
    state.environmentBusy = false;
    render();
  }
}

function renderFileMenu(): string {
  if (!state.fileMenuOpen) return "";
  return `<div class="file-menu" role="menu"><button class="file-menu__item" type="button" role="menuitem" data-command="file.new"><span class="file-menu__label">${renderIcon("fileAdd")}Novo arquivo</span><kbd>Ctrl+N</kbd></button><button class="file-menu__item" type="button" role="menuitem" data-command="file.openPicker"><span class="file-menu__label">${renderIcon("file")}Abrir arquivo</span><kbd>Ctrl+O</kbd></button><button class="file-menu__item" type="button" role="menuitem" data-command="workspace.open"><span class="file-menu__label">${renderIcon("folderOpen")}Abrir pasta</span></button><hr /><button class="file-menu__item" type="button" role="menuitem" data-command="file.save"><span class="file-menu__label">${renderIcon("save")}Salvar</span><kbd>Ctrl+S</kbd></button><button class="file-menu__item" type="button" role="menuitem" data-command="file.saveAs"><span class="file-menu__label">${renderIcon("saveAs")}Salvar como</span><kbd>Ctrl+Shift+S</kbd></button></div>`;
}

function renderNotice(): string {
  if (!state.notice && !state.error) return "";
  return `<div class="toast toast--${state.error ? "error" : "notice"}">${escapeHtml(state.error ?? state.notice ?? "")}</div>`;
}

function render(): void {
  const active = activeDocument();
  const dirty = active ? active.content !== active.savedContent : false;
  const environmentActivity = executionEnvironmentProvider()
    ? renderActivityButton("view.environments", "environment", "Ambientes", state.sidebarView === "environments")
    : "";
  const sidebarMaximum = sidebarMaximumWidth();
  const panelMaximum = panelMaximumHeight();
  const renderedSidebarWidth = Math.round(clamp(state.sidebarWidth, sidebarMinimumWidth(), sidebarMaximum));
  const renderedPanelHeight = Math.round(clamp(state.panelHeight, MIN_PANEL_HEIGHT, panelMaximum));

  appRoot.innerHTML = `
    <div
      class="ide-shell"
      style="--sidebar-width:${renderedSidebarWidth}px;--panel-height:${renderedPanelHeight}px"
    >
      <header class="titlebar">
        <div class="brand">tinyIde</div>
        <nav class="menu" aria-label="Menu principal">
          <div class="menu-item">
            ${renderButton("Arquivo", "menu", { command: "menu.file.toggle", size: "small", variant: "ghost", className: "titlebar-action" })}
            ${renderFileMenu()}
          </div>
          ${renderButton("Salvar", "save", { command: "file.save", size: "small", variant: "ghost", className: "titlebar-action" })}
          ${renderButton("Painel", "panel", { command: "panel.toggle", size: "small", variant: "ghost", className: "titlebar-action" })}
        </nav>
        <div class="titlebar__center">${escapeHtml(state.workspaceName ?? active?.name ?? "Sem workspace")}${state.openFiles.length > 1 ? ` · ${state.openFiles.filter((d) => d.content !== d.savedContent).length} não salvo(s)` : ""}</div>
        <div class="version">v${PLATFORM_VERSION}</div>
      </header>
      <main class="workbench ${state.sidebarVisible ? "" : "workbench--sidebar-hidden"}">
        <nav class="activitybar" aria-label="Atividades">
          ${renderActivityButton("view.explorer", "folderOpen", "Explorador", state.sidebarView === "explorer")}
          ${renderActivityButton("view.plugins", "plugin", "Plugins", state.sidebarView === "plugins")}
          ${environmentActivity}
          <div class="activitybar__spacer"></div>
          ${renderActivityButton("panel.toggle", "panel", "Painel inferior", false)}
        </nav>
        ${renderSidebar()}
        <div
          class="panel-resizer panel-resizer--vertical ${state.sidebarVisible ? "" : "is-hidden"}"
          data-resize="sidebar"
          role="separator"
          aria-label="Redimensionar painel lateral"
          aria-orientation="vertical"
          aria-controls="sidebar-panel"
          aria-valuemin="${MIN_SIDEBAR_WIDTH}"
          aria-valuemax="${sidebarMaximum}"
          aria-valuenow="${state.sidebarWidth}"
          tabindex="0"
          title="Arraste para redimensionar. Duplo clique restaura a largura."
        ></div>
        <section class="editor-area ${state.panelVisible ? "" : "editor-area--panel-hidden"}">
          <div class="editor-tabs">${state.openFiles.length === 0
            ? `<button class="editor-tab is-active">${renderIcon("code")}<span>Bem-vindo</span></button>`
            : state.openFiles.map((doc) => {
                const isActive = (doc.path ?? doc.name) === state.activeFilePath;
                const isDirty = doc.content !== doc.savedContent;
                const docKey = doc.path ?? doc.name;
                return `<button class="editor-tab${isActive ? " is-active" : ""}" data-command="file.activate" data-file-path="${escapeHtml(docKey)}">${renderIcon("file")}<span>${escapeHtml(doc.name)}${isDirty ? " ●" : ""}</span><span class="tab-close" data-command="file.close" data-file-path="${escapeHtml(docKey)}">${renderIcon("close")}</span></button>`;
              }).join("")}
          </div>
          ${renderEditor()}
          <div
            class="panel-resizer panel-resizer--horizontal ${state.panelVisible ? "" : "is-hidden"}"
            data-resize="panel"
            role="separator"
            aria-label="Redimensionar painel inferior"
            aria-orientation="horizontal"
            aria-controls="bottom-panel"
            aria-valuemin="${MIN_PANEL_HEIGHT}"
            aria-valuemax="${panelMaximum}"
            aria-valuenow="${state.panelHeight}"
            tabindex="0"
            title="Arraste para redimensionar. Duplo clique restaura a altura."
          ></div>
          <section id="bottom-panel" class="bottom-panel ${state.panelVisible ? "" : "is-hidden"}">
            <header class="panel-tabs">
              <button class="is-active">${renderIcon("terminal")}<span>SAÍDA</span></button>
              <button>${renderIcon("alert")}<span>PROBLEMAS</span><span class="counter">${state.diagnostics.length}</span></button>
            </header>
            <pre class="output">${state.logs.map(escapeHtml).join("\n")}</pre>
          </section>
        </section>
      </main>
      <footer class="statusbar">
        <button data-command="file.openPicker">${renderIcon("folderOpen")}<span>${escapeHtml(state.workspaceName ?? "Abrir arquivo")}</span></button>
        <span>${plugins.list().length} plugin(s)</span>
        <span class="statusbar__spacer"></span>
        <span>${dirty ? "Alterações não salvas" : "Salvo"}</span>
        <span>UTF-8</span>
        <span>Texto</span>
      </footer>
      ${renderNotice()}
      ${renderExecutionProfilesModal()}
      ${renderExecutionProfileRemovalModal()}
      ${renderSharedFileBrowserModal()}
    </div>
  `;
  bindInteractions();
  syncLayoutToViewport();
}

function bindInteractions(): void {
  appRoot.querySelector<HTMLInputElement>("[data-file-browser-filter]")?.addEventListener("input", (event) => updateFileBrowserFilter((event.currentTarget as HTMLInputElement).value));
  appRoot.querySelector<HTMLInputElement>("[data-file-browser-hidden]")?.addEventListener("change", (event) => { void fileBrowser.setIncludeHidden((event.currentTarget as HTMLInputElement).checked).catch(showError); });
  appRoot.querySelectorAll<HTMLElement>("[data-command]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const command = element.dataset.command;
      if (!command) return;
      const argument = element.dataset.pluginUrl ?? element.dataset.pluginId ?? element.dataset.profileId ?? element.dataset.profileExecutable ?? element.dataset.profileVariable ?? element.dataset.environmentId ?? element.dataset.browserPath ?? element.dataset.entryPath ?? element.dataset.filePath;
      void commands.execute(command, argument).catch(showError);
    });
  });
  appRoot.querySelectorAll<HTMLElement>("[data-resize]").forEach((separator) => {
    const target = separator.dataset.resize;
    if (target !== "sidebar" && target !== "panel") return;

    separator.addEventListener("pointerdown", (event) => {
      beginResize(event, target);
    });
    separator.addEventListener("keydown", (event) => {
      resizeWithKeyboard(event, target);
    });
    separator.addEventListener("dblclick", () => {
      resetResize(target);
    });
  });
  applyResizeValue("sidebar", state.sidebarWidth);
  applyResizeValue("panel", state.panelHeight);
  const editor = appRoot.querySelector<HTMLTextAreaElement>("[data-editor]");
  const currentDocument = activeDocument();
  if (editor && currentDocument) {
    requestAnimationFrame(() => {
      const start = Math.min(currentDocument.selectionStart, editor.value.length);
      const end = Math.min(Math.max(currentDocument.selectionEnd, start), editor.value.length);
      editor.setSelectionRange(start, end);
      editor.scrollTop = currentDocument.scrollTop;
      editor.scrollLeft = currentDocument.scrollLeft;
    });
  }
  editor?.addEventListener("input", (event) => {
    const doc = activeDocument();
    if (!doc) return;
    const input = event.currentTarget as HTMLTextAreaElement;
    doc.content = input.value;
    doc.selectionStart = input.selectionStart;
    doc.selectionEnd = input.selectionEnd;
    doc.scrollTop = input.scrollTop;
    doc.scrollLeft = input.scrollLeft;
    const provider = languageProviderFor(doc);
    if (syntaxLayer && provider) {
      syntaxLayer.innerHTML = renderHighlightedSource(doc.content, provider);
      syntaxLayer.scrollTop = input.scrollTop;
      syntaxLayer.scrollLeft = input.scrollLeft;
    }
    scheduleApplicationSnapshot(500);
  });
  const syntaxLayer = appRoot.querySelector<HTMLElement>("[data-syntax-layer]");
  editor?.addEventListener("scroll", () => {
    const doc = activeDocument();
    if (doc) {
      doc.scrollTop = editor.scrollTop;
      doc.scrollLeft = editor.scrollLeft;
      scheduleApplicationSnapshot(300);
    }
    if (!syntaxLayer) return;
    syntaxLayer.scrollTop = editor.scrollTop;
    syntaxLayer.scrollLeft = editor.scrollLeft;
  });
  editor?.addEventListener("select", () => {
    const doc = activeDocument();
    if (!doc) return;
    doc.selectionStart = editor.selectionStart;
    doc.selectionEnd = editor.selectionEnd;
    scheduleApplicationSnapshot(300);
  });
  appRoot.querySelectorAll<HTMLElement>("[data-diagnostic-line]").forEach((element) => {
    element.addEventListener("click", () => {
      const line = Number(element.dataset.diagnosticLine ?? "1");
      const textarea = appRoot.querySelector<HTMLTextAreaElement>("[data-editor]");
      const doc = activeDocument();
      if (!textarea || !doc) return;
      const lines = doc.content.split("\n");
      const offset = lines.slice(0, Math.max(0, line - 1)).reduce((total, value) => total + value.length + 1, 0);
      textarea.focus();
      textarea.setSelectionRange(offset, offset);
      doc.selectionStart = offset;
      doc.selectionEnd = offset;
      scheduleApplicationSnapshot();
    });
  });
  appRoot.querySelector<HTMLFormElement>('[data-form="plugin-install"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = new FormData(event.currentTarget as HTMLFormElement).get("url");
    void commands.execute("plugin.installFromUrl", url).catch(showError);
  });
  appRoot.querySelector<HTMLSelectElement>("[data-environment-select]")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    state.selectedEnvironmentId = value || undefined;
    state.environmentForm = undefined;
    render();
    persistSession();
  });
  appRoot.querySelector<HTMLSelectElement>("[data-execution-profile-select]")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    executionProfiles.select(value || undefined);
    persistExecutionProfiles();
    render();
  });
  appRoot.querySelector<HTMLSelectElement>('[data-form="execution-profile"] select[name="environmentId"]')
    ?.addEventListener("change", (event) => {
      const select = event.currentTarget as HTMLSelectElement;
      const form = select.form;
      const executable = form?.elements.namedItem("executable") as HTMLInputElement | null;
      const executableDisplay = form?.querySelector<HTMLInputElement>("[data-profile-executable-display]");
      const description = form?.querySelector<HTMLElement>("[data-profile-environment-description]");
      const option = state.executionProfileExecutableOptions.find(
        (candidate) => candidate.environmentId === select.value,
      );
      if (select.value && option) {
        if (executable) executable.value = option.value;
        if (executableDisplay) {
          executableDisplay.value = environmentExecutableDisplay(option);
          executableDisplay.readOnly = true;
        }
        if (description) description.textContent = option.description ?? option.label;
        if (form) {
          executionProfileDraft = executionProfileFromForm(form);
          updateExecutionProfilePreview(form);
        }
        return;
      }
      if (executable?.value === "${environmentExecutable}") executable.value = "";
      if (executableDisplay) {
        executableDisplay.value = executable?.value ?? "";
        executableDisplay.readOnly = false;
      }
      if (description) description.textContent = "O perfil executará sem ambiente vinculado.";
      if (form) {
        executionProfileDraft = executionProfileFromForm(form);
        updateExecutionProfilePreview(form);
      }
    });
  const executionProfileForm = appRoot.querySelector<HTMLFormElement>('[data-form="execution-profile"]');
  executionProfileForm?.querySelector<HTMLInputElement>("[data-profile-executable-display]")
    ?.addEventListener("input", (event) => {
      const display = event.currentTarget as HTMLInputElement;
      const executable = display.form?.elements.namedItem("executable") as HTMLInputElement | null;
      if (executable && !display.readOnly) executable.value = display.value;
      if (display.form) updateExecutionProfilePreview(display.form);
    });
  executionProfileForm?.querySelector<HTMLSelectElement>('select[name="workingDirectoryMode"]')
    ?.addEventListener("change", (event) => {
      const mode = (event.currentTarget as HTMLSelectElement).value;
      const custom = executionProfileForm.querySelector<HTMLElement>("[data-profile-custom-working-directory]");
      if (custom) custom.hidden = mode !== "custom";
    });
  executionProfileForm?.addEventListener("input", () => {
    executionProfileDraft = executionProfileFromForm(executionProfileForm);
    updateExecutionProfilePreview(executionProfileForm);
  });
  executionProfileForm?.addEventListener("change", () => {
    executionProfileDraft = executionProfileFromForm(executionProfileForm);
    updateExecutionProfilePreview(executionProfileForm);
  });
  executionProfileForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = executionProfileFromForm(event.currentTarget as HTMLFormElement);
    try {
      executionProfiles.upsert(profile);
      executionProfiles.select(profile.id);
      persistExecutionProfiles();
      executionProfileDraft = undefined;
      state.executionProfilesOpen = false;
      state.executionProfileEditingId = undefined;
      showNotice(`Perfil '${profile.name}' salvo.`);
    } catch (error) {
      showError(error);
    }
  });
  appRoot.querySelector<HTMLFormElement>('[data-form="environment-create-venv"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget as HTMLFormElement).get("name");
    void submitCreateVenv(typeof name === "string" ? name : "").catch(showError);
  });
  appRoot.querySelector<HTMLFormElement>('[data-form="environment-add-venv"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const path = formData.get("path");
    const name = formData.get("name");
    void submitAddVenv(
      typeof path === "string" ? path : "",
      typeof name === "string" ? name : "",
    ).catch(showError);
  });
  appRoot.querySelector<HTMLFormElement>('[data-form="environment-add-process"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const name = formData.get("name");
    const executable = formData.get("executable");
    void submitAddProcess(
      typeof name === "string" ? name : "",
      typeof executable === "string" ? executable : "",
    ).catch(showError);
  });
  appRoot.querySelector<HTMLFormElement>('[data-form="environment-packages"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const packages = new FormData(event.currentTarget as HTMLFormElement).get("packages");
    void submitEnvironmentPackages(typeof packages === "string" ? packages : "").catch(showError);
  });
  appRoot.querySelector<HTMLFormElement>('[data-form="environment-run-profile"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const modeValue = String(formData.get("mode") ?? "source");
    const profile: RunProfile = {
      name: String(formData.get("profileName") ?? "Execução atual").trim() || "Execução atual",
      mode: modeValue === "script" || modeValue === "module" ? modeValue : "source",
      target: String(formData.get("target") ?? "").trim(),
      workingDirectory: String(formData.get("workingDirectory") ?? "").trim(),
      arguments: String(formData.get("arguments") ?? ""),
      environmentVariables: String(formData.get("environmentVariables") ?? ""),
    };
    if (profile.mode !== "source" && !profile.target) {
      showError(new Error("Informe o script ou módulo do perfil de execução."));
      return;
    }
    parseCommandLineArguments(profile.arguments);
    parseEnvironmentVariables(profile.environmentVariables);
    state.runProfile = profile;
    localStorage.setItem(RUN_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    state.environmentForm = undefined;
    showNotice(`Perfil '${profile.name}' salvo.`);
    persistSession();
  });
}

commands.register("menu.file.toggle", () => {
  state.fileMenuOpen = !state.fileMenuOpen;
  render();
});
commands.register("file.new", newFile);
commands.register("file.openPicker", openFileFromPicker);
commands.register("workspace.open", openWorkspace);
commands.register("workspace.reconnect", reconnectWorkspace);
commands.register("workspace.toggleDirectory", toggleWorkspaceDirectory);
commands.register("file.openWorkspace", openWorkspaceFile);
commands.register("file.save", () => saveFile(false));
commands.register("file.saveAs", () => saveFile(true));
commands.register("language.lint", lintActiveDocument);
commands.register("environment.refresh", refreshEnvironments);
commands.register("environment.createVenv", createVenvEnvironment);
commands.register("environment.addVenv", async () => {
  state.sidebarView = "environments";
  state.sidebarVisible = true;
  state.environmentForm = "addVenv";
  state.environmentSelectedPath = undefined;
  render();
});
commands.register("environment.browser.open", () => openEnvironmentFileBrowser("directory"));
commands.register("environment.browser.openFile", () => openEnvironmentFileBrowser("file"));
commands.register("environment.packages", installEnvironmentPackages);
commands.register("environment.remove", removeSelectedEnvironment);
commands.register("environment.select", selectEnvironment);
commands.register("environment.packagesFor", packagesForEnvironment);
commands.register("environment.removeById", removeEnvironmentById);
commands.register("environment.runProfile", () => {
  state.sidebarView = "environments";
  state.sidebarVisible = true;
  state.environmentForm = "run";
  render();
});
commands.register("environment.form.cancel", () => {
  state.environmentForm = undefined;
  state.environmentSelectedPath = undefined;
  render();
});
commands.register("execution.profiles.open", () => {
  state.executionProfilesOpen = true;
  state.executionProfileEditingId = executionProfiles.selectedId();
  executionProfileDraft = state.executionProfileEditingId
    ? executionProfiles.get(state.executionProfileEditingId)
    : emptyExecutionProfile();
  void refreshExecutionProfileContributions().then(render).catch(showError);
  render();
});
commands.register("execution.profiles.close", () => {
  executionProfileDraft = undefined;
  state.executionProfilesOpen = false;
  state.executionProfileEditingId = undefined;
  state.executionProfileRemovalId = undefined;
  render();
});
commands.register("execution.profile.new", () => {
  state.executionProfileEditingId = undefined;
  executionProfileDraft = emptyExecutionProfile();
  render();
});
commands.register("execution.profile.edit", (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Perfil inválido.");
  const profile = executionProfiles.get(rawId);
  if (!profile) throw new Error("Perfil inválido.");
  state.executionProfileEditingId = rawId;
  executionProfileDraft = profile;
  render();
});
commands.register("execution.profile.select", (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Perfil inválido.");
  const profile = executionProfiles.get(rawId);
  if (!profile) throw new Error("Perfil inválido.");
  executionProfiles.select(rawId);
  if (state.executionProfilesOpen) {
    state.executionProfileEditingId = rawId;
    executionProfileDraft = profile;
  }
  persistExecutionProfiles();
  render();
});
commands.register("execution.profile.remove.request", (rawId: unknown) => {
  if (typeof rawId !== "string" || !executionProfiles.get(rawId)) throw new Error("Perfil inválido.");
  state.executionProfileRemovalId = rawId;
  render();
});
commands.register("execution.profile.remove.cancel", () => {
  state.executionProfileRemovalId = undefined;
  render();
});
commands.register("execution.profile.remove.confirm", (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Perfil inválido.");
  executionProfiles.remove(rawId);
  persistExecutionProfiles();
  state.executionProfileRemovalId = undefined;
  if (state.executionProfileEditingId === rawId) {
    state.executionProfileEditingId = undefined;
    executionProfileDraft = emptyExecutionProfile();
  }
  render();
});
commands.register("execution.profile.useExecutable", (rawValue: unknown) => {
  if (typeof rawValue !== "string") return;
  const form = appRoot.querySelector<HTMLFormElement>('[data-form="execution-profile"]');
  const executable = form?.elements.namedItem("executable") as HTMLInputElement | null;
  const display = form?.querySelector<HTMLInputElement>("[data-profile-executable-display]");
  if (executable) executable.value = rawValue;
  if (display) {
    display.value = rawValue;
    display.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
commands.register("fileBrowser.close", () => fileBrowser.close());
commands.register("fileBrowser.activate", (path: unknown) => typeof path === "string" ? fileBrowser.activate(path) : undefined);
commands.register("fileBrowser.parent", () => fileBrowser.navigate(fileBrowser.snapshot().listing?.parentPath));
commands.register("fileBrowser.confirm", () => fileBrowser.confirm());
commands.register("fileBrowser.clearFilter", () => {
  const input = appRoot.querySelector<HTMLInputElement>("[data-file-browser-filter]");
  if (input) input.value = "";
  updateFileBrowserFilter("");
  input?.focus();
});
commands.register("execution.profile.pickCommandFile", openProfileCommandFileBrowser);
commands.register("execution.profile.insertVariable", (rawName: unknown) => {
  if (typeof rawName !== "string") return;
  const form = appRoot.querySelector<HTMLFormElement>('[data-form="execution-profile"]');
  const active = document.activeElement;
  const target = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? active
    : form?.elements.namedItem("parameters") as HTMLTextAreaElement | null;
  if (!target) return;
  const token = `\${${rawName}}`;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  target.setRangeText(token, start, end, "end");
  target.focus();
});
commands.register("execution.profile.run", runSelectedExecutionProfile);
commands.register("execution.stop", stopExecutionProfile);
commands.register("execution.run", runWithSelectedEnvironment);
commands.register("file.close", closeFile);
commands.register("file.activate", activateFile);
commands.register("view.explorer", () => { state.sidebarView = "explorer"; state.sidebarVisible = true; render(); persistSession(); });
commands.register("view.plugins", () => {
  state.sidebarView = "plugins";
  state.sidebarVisible = true;
  render();
  if (!state.availablePlugins.length && !state.pluginCatalogLoading) {
    void loadPluginCatalog();
  }
  persistSession();
});
commands.register("view.environments", async () => {
  if (!executionEnvironmentProvider()) throw new Error("Nenhum plugin de ambiente está ativo.");
  state.sidebarView = "environments";
  state.sidebarVisible = true;
  await refreshEnvironments();
  render();
  persistSession();
});
commands.register("sidebar.toggle", () => { state.sidebarVisible = !state.sidebarVisible; render(); persistSession(); });
commands.register("panel.toggle", () => { state.panelVisible = !state.panelVisible; render(); persistSession(); });
commands.register("plugin.installFromUrl", async (rawUrl: unknown) => {
  if (typeof rawUrl !== "string") throw new Error("Plugin URL must be a string.");
  await installPluginFromUrl(rawUrl);
});
commands.register("plugin.enable", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const plugin = await plugins.enable(rawId);
  await plugins.activate(rawId, { commands, events, capabilities, subscriptions: [] });
  persistPlugins();
  await refreshEnvironments();
  showNotice(`Plugin '${plugin.manifest.name}' habilitado.`);
});
commands.register("plugin.disable", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const plugin = await plugins.disable(rawId);
  persistPlugins();
  await refreshEnvironments();
  showNotice(`Plugin '${plugin.manifest.name}' desabilitado.`);
});
commands.register("plugin.uninstall", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const pluginName = plugins.get(rawId)?.manifest.name ?? rawId;
  await plugins.uninstall(rawId);
  pluginSourceUrls.delete(rawId);
  persistPlugins();
  await refreshEnvironments();
  showNotice(`Plugin '${pluginName}' removido.`);
});

events.on<{ name: string }>("workspace.opened", ({ name }) => log(`workspace.opened: ${name}`));
events.on<{ name: string }>("file.opened", ({ name }) => log(`file.opened: ${name}`));
events.on<{ name: string }>("file.saved", ({ name }) => log(`file.saved: ${name}`));
events.on<PluginRecord>("plugin.installed", (plugin) => log(`plugin.installed: ${plugin.manifest.id}@${plugin.manifest.version}`));
events.on("execution.profile.contribution.registered", async () => {
  await refreshExecutionProfileContributions();
  if (state.executionProfilesOpen) render();
});

capabilities.register("core.commands", commands);
capabilities.register("core.events", events);
capabilities.register("core.plugins", plugins);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && fileBrowser.snapshot().open) { event.preventDefault(); fileBrowser.close(); return; }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s") {
    event.preventDefault(); void commands.execute("file.saveAs").catch(showError); return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "s") {
    event.preventDefault(); void commands.execute("file.save").catch(showError); return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "o") {
    event.preventDefault(); void commands.execute("file.openPicker").catch(showError); return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "n") {
    event.preventDefault(); void commands.execute("file.new").catch(showError); return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "w") {
    event.preventDefault(); void commands.execute("file.close").catch(showError); return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "b") {
    event.preventDefault(); void commands.execute("sidebar.toggle");
  }
});
window.addEventListener("click", () => {
  if (state.fileMenuOpen) { state.fileMenuOpen = false; render(); }
});
let viewportSyncFrame: number | undefined;
function scheduleViewportSync(): void {
  if (viewportSyncFrame !== undefined) cancelAnimationFrame(viewportSyncFrame);
  viewportSyncFrame = requestAnimationFrame(() => {
    viewportSyncFrame = undefined;
    syncLayoutToViewport();
  });
}

window.addEventListener("resize", scheduleViewportSync);
new ResizeObserver(scheduleViewportSync).observe(appRoot);

declare global {
  interface Window {
    tinyIde: {
      readonly commands: CommandRegistry;
      readonly events: EventBus;
      readonly capabilities: CapabilityRegistry;
      readonly plugins: PluginManager;
      installPlugin(manifestUrl: string): Promise<void>;
      getSessionSummary(): StoredSession;
    };
  }
}

window.tinyIde = {
  commands,
  events,
  capabilities,
  plugins,
  installPlugin: installPluginFromUrl,
  getSessionSummary: buildSessionSummary,
};

restoreSession();
render();
void initializeApplication().catch(showError);

window.addEventListener("pagehide", () => {
  persistSession();
  flushApplicationSnapshot();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  persistSession();
  flushApplicationSnapshot();
});
