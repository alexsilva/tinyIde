import {
  CapabilityRegistry,
  CommandRegistry,
  EventBus,
  ModulePluginHost,
  PluginManager,
} from "@tinyide/core";
import type {
  RuntimeDirectoryListing,
  RuntimeExecutionRequest,
  Runtime,
  RuntimeManager,
  RuntimeProvider,
  LanguageProvider,
  PluginManifest,
  PluginRecord,
  TextDiagnostic,
} from "@tinyide/plugin-api";
import {
  readApplicationSnapshot,
  writeApplicationSnapshot,
} from "./session-store";
import "./styles.css";

const PLATFORM_VERSION = "0.4.0";
const PLUGIN_STORAGE_KEY = "tinyide.installedPlugins.v2";
const LEGACY_PLUGIN_STORAGE_KEY = "tinyide.installedPlugins";
const LAYOUT_STORAGE_KEY = "tinyide.layout.v1";
const RUN_PROFILE_STORAGE_KEY = "tinyide.pythonRunProfile.v1";
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
  readonly openedRuntimeIds: string[];
  readonly selectedRuntimeId?: string;
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

function parseArgumentLine(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) result.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (quote) throw new Error("Argumentos contêm aspas não fechadas.");
  if (escaped) current += "\\";
  if (current) result.push(current);
  return result;
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

type SidebarView = "explorer" | "plugins" | "runtimes";
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
  runtimes: Runtime[];
  openedRuntimeIds: Set<string>;
  selectedRuntimeId: string | undefined;
  runtimeBusy: boolean;
  runtimeForm: "create" | "import" | "packages" | "run" | undefined;
  runtimeBrowser: RuntimeDirectoryListing | undefined;
  runtimeBrowserLoading: boolean;
  runtimeBrowserOpen: boolean;
  runtimeSelectedPath: string | undefined;
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

const pluginHost = new ModulePluginHost({
  loadModule(plugin) {
    const sourceUrl = pluginSourceUrls.get(plugin.manifest.id);
    if (!sourceUrl) throw new Error(`Plugin source URL not found: ${plugin.manifest.id}`);
    return import(/* @vite-ignore */ sourceUrl);
  },
});
const plugins = new PluginManager({ platformVersion: PLATFORM_VERSION, events, host: pluginHost });

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
  runtimes: [],
  openedRuntimeIds: new Set<string>(),
  selectedRuntimeId: undefined,
  runtimeBusy: false,
  runtimeForm: undefined,
  runtimeBrowser: undefined,
  runtimeBrowserLoading: false,
  runtimeBrowserOpen: false,
  runtimeSelectedPath: undefined,
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
    openedRuntimeIds: [...state.openedRuntimeIds],
    ...(state.selectedRuntimeId ? { selectedRuntimeId: state.selectedRuntimeId } : {}),
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
    if (stored.sidebarView === "explorer" || stored.sidebarView === "plugins" || stored.sidebarView === "runtimes") {
      state.sidebarView = stored.sidebarView;
    } else if (stored.sidebarView === "environments") {
      state.sidebarView = "runtimes";
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
    const restoredRuntimeIds = stored.openedRuntimeIds ?? stored.openedEnvironmentIds;
    if (Array.isArray(restoredRuntimeIds)) {
      restoredRuntimeIds
        .filter((id): id is string => typeof id === "string")
        .forEach((id) => state.openedRuntimeIds.add(id));
    }
    const selectedRuntimeId = stored.selectedRuntimeId ?? stored.selectedEnvironmentId;
    if (typeof selectedRuntimeId === "string") state.selectedRuntimeId = selectedRuntimeId;
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
    await refreshRuntimes();
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

function runtimeProvider(): RuntimeProvider | undefined {
  return capabilities.getAll<RuntimeProvider>("runtime.provider")[0];
}

function runtimeManager(): RuntimeManager | undefined {
  return capabilities.getAll<RuntimeManager>("runtime.manager")[0];
}

function runtimeProviderForExecution(
  document: OpenDocument | undefined,
): RuntimeProvider | undefined {
  if (!document) return undefined;
  const lowerName = document.name.toLowerCase();
  return capabilities
    .getAll<RuntimeProvider>("runtime.provider")
    .find((provider) => provider.extensions.some((extension) => lowerName.endsWith(extension)));
}

async function refreshRuntimes(): Promise<void> {
  const provider = runtimeProvider();
  if (!provider) {
    state.runtimes = [];
    state.openedRuntimeIds.clear();
    state.selectedRuntimeId = undefined;
    state.runtimeForm = undefined;
    state.runtimeBrowser = undefined;
    state.runtimeBrowserOpen = false;
    state.runtimeSelectedPath = undefined;
    if (state.sidebarView === "runtimes") {
      state.sidebarView = "explorer";
    }
    render();
    persistSession();
    return;
  }

  state.runtimes = [...(await provider.list())];
  const existingIds = new Set(state.runtimes.map((environment) => environment.id));
  state.openedRuntimeIds = existingIds;
  if (state.selectedRuntimeId && !existingIds.has(state.selectedRuntimeId)) state.selectedRuntimeId = undefined;
  if (!state.selectedRuntimeId) state.selectedRuntimeId = state.runtimes[0]?.id;
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
  await refreshRuntimes();
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
  await refreshRuntimes();
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

function renderRuntimes(): string {
  const provider = runtimeProvider();
  const manager = runtimeManager();
  if (!provider) {
    return `<div class="empty-state"><p>Nenhum gerenciador de runtime instalado.</p>${renderButton("Abrir plugins", "plugin", { command: "view.plugins", size: "small" })}</div>`;
  }

  const cards = state.runtimes
    .map((runtime) => {
      const active = state.selectedRuntimeId === runtime.id;
      const runtimeData = { "environment-id": runtime.id };
      const selectAction = renderButton(active ? "Selecionado" : "Selecionar", active ? "check" : "environment", {
        command: "runtime.select",
        size: "small",
        variant: active ? "primary" : "default",
        disabled: active,
        data: runtimeData,
      });
      const packageAction = manager?.installPackages && runtime.managed !== false
        ? renderButton("Pacotes", "package", { command: "runtime.packagesFor", size: "small", data: runtimeData })
        : "";
      const removeAction = manager?.remove && runtime.managed
        ? renderButton("Remover", "trash", { command: "runtime.removeById", size: "small", variant: "danger", data: runtimeData })
        : "";
      const runtimeKind = runtime.managed ? "Ambiente gerenciado" : runtime.path ? "Interpretador registrado" : "Interpretador do sistema";
      return `<article class="environment-card${active ? " is-active" : ""}"><div><strong>${escapeHtml(runtime.name)}</strong><span>${escapeHtml(runtimeKind)}${runtime.version ? ` · ${escapeHtml(runtime.version)}` : ""}</span><small>${escapeHtml(runtime.executable ?? runtime.id)}</small></div><div class="environment-card__actions">${selectAction}${packageAction}${removeAction}</div></article>`;
    })
    .join("");

  const createForm = state.runtimeForm === "create"
    ? `<form class="environment-manager__form environment-manager__form--stacked" data-form="environment-create"><strong>Criar novo ambiente</strong><label>Nome<input name="name" value=".venv" aria-label="Nome do ambiente" /></label><label>Local opcional<input name="path" placeholder="Vazio usa .tinyide/runtimes/python/.venv" aria-label="Local do novo ambiente" /></label><small>O diretório informado não pode existir. O Python será criado com python -m venv.</small><div class="form-actions">${renderButton("Criar", "environment", { type: "submit", size: "small", variant: "primary", title: "Criar ambiente" })}${renderButton("Cancelar", "close", { command: "environment.form.cancel", size: "small" })}</div></form>`
    : "";
  const importForm = state.runtimeForm === "import"
    ? `<form class="environment-manager__form environment-manager__form--stacked" data-form="environment-import"><strong>Abrir ambiente existente</strong><label>Diretório do ambiente<div class="environment-path-picker"><input name="path" readonly value="${escapeHtml(state.runtimeSelectedPath ?? "")}" placeholder="Nenhum diretório selecionado" aria-label="Caminho do ambiente existente" />${renderButton("Selecionar", "folderOpen", { command: "environment.browser.open", size: "small", title: "Selecionar diretório" })}</div></label><label>Nome opcional<input name="name" placeholder="Usa o nome da pasta" aria-label="Nome do ambiente existente" /></label><small>Escolha a pasta raiz do ambiente virtual, onde ficam pyvenv.cfg e bin/python ou Scripts/python.exe.</small><div class="form-actions">${renderButton("Adicionar", "download", { type: "submit", size: "small", variant: "primary", title: "Adicionar ambiente", disabled: !state.runtimeSelectedPath })}${renderButton("Cancelar", "close", { command: "environment.form.cancel", size: "small" })}</div></form>`
    : "";
  const packagesForm = state.runtimeForm === "packages"
    ? `<form class="environment-manager__form" data-form="environment-packages"><input name="packages" placeholder="django requests" aria-label="Pacotes" />${renderButton("Instalar", "download", { type: "submit", size: "small", variant: "primary" })}${renderButton("Cancelar", "close", { command: "environment.form.cancel", size: "small" })}</form>`
    : "";

  const runForm = state.runtimeForm === "run"
    ? `<form class="environment-manager__form environment-manager__form--stacked run-profile-form" data-form="environment-run-profile"><strong>Perfil de execução</strong><label>Nome<input name="profileName" value="${escapeHtml(state.runProfile.name)}" /></label><label>Tipo<select name="mode"><option value="source" ${state.runProfile.mode === "source" ? "selected" : ""}>Arquivo aberto</option><option value="script" ${state.runProfile.mode === "script" ? "selected" : ""}>Script</option><option value="module" ${state.runProfile.mode === "module" ? "selected" : ""}>Módulo Python</option></select></label><label>Alvo<input name="target" value="${escapeHtml(state.runProfile.target)}" placeholder="src/main.py ou pacote.modulo" /></label><label>Diretório de trabalho<input name="workingDirectory" value="${escapeHtml(state.runProfile.workingDirectory)}" placeholder="Vazio usa a raiz do projeto" /></label><label>Argumentos<input name="arguments" value="${escapeHtml(state.runProfile.arguments)}" placeholder="--port 8000 --debug" /></label><label>Variáveis de ambiente<textarea name="environmentVariables" rows="5" placeholder="DJANGO_SETTINGS_MODULE=config.settings\nDEBUG=1">${escapeHtml(state.runProfile.environmentVariables)}</textarea></label><small>O runtime selecionado fornece o interpretador. Caminhos relativos são resolvidos a partir do projeto aberto.</small><div class="form-actions">${renderButton("Salvar perfil", "save", { type: "submit", size: "small", variant: "primary" })}${renderButton("Cancelar", "close", { command: "environment.form.cancel", size: "small" })}</div></form>`
    : "";

  const createAction = manager?.create ? renderButton("Criar venv", "environment", { command: "runtime.create", size: "small", variant: "primary", title: "Criar ambiente virtual" }) : "";
  const importAction = manager?.importExisting ? renderButton("Adicionar", "folderOpen", { command: "runtime.import", size: "small", title: "Adicionar interpretador ou ambiente existente" }) : "";
  return `<div class="environment-manager"><div class="environment-manager__toolbar">${renderButton("Atualizar", "refresh", { command: "runtime.refresh", size: "small" })}${createAction}${importAction}${renderButton("Perfil", "saveAs", { command: "runtime.runProfile", size: "small", title: "Configurar perfil de execução" })}</div>${createForm}${importForm}${packagesForm}${runForm}<div class="environment-list">${cards || '<div class="empty-state"><p>Nenhum runtime Python encontrado.</p></div>'}</div></div>`;
}

function renderEnvironmentBrowserModal(): string {
  if (!state.runtimeBrowserOpen) return "";
  const browser = state.runtimeBrowser;
  const entries = browser?.entries
    .map((entry) => `<button type="button" class="environment-browser__entry${entry.isRuntime ? " is-environment" : ""}" data-command="environment.browse" data-browser-path="${escapeHtml(entry.path)}"><span class="environment-browser__icon">${renderIcon(entry.isRuntime ? "environment" : "folder")}</span><strong>${escapeHtml(entry.name)}</strong>${entry.isRuntime ? "<small>Runtime Python</small>" : ""}</button>`)
    .join("") ?? "";
  const content = state.runtimeBrowserLoading
    ? `<div class="environment-browser-modal__loading">Carregando diretórios...</div>`
    : browser
      ? `<div class="environment-browser__path">${renderButton("Pasta pai", "folderOpen", { command: "environment.browse", size: "small", disabled: !browser.parentPath, data: { "browser-path": browser.parentPath ?? browser.path } })}<code>${escapeHtml(browser.path)}</code></div>${browser.isRuntime ? `<div class="environment-browser__selected"><div><strong>Runtime Python válido</strong><small>${escapeHtml(browser.path)}</small></div>${renderButton("Selecionar", "check", { command: "environment.choosePath", size: "small", variant: "primary", title: "Selecionar este diretório", data: { "browser-path": browser.path } })}</div>` : `<p class="muted">Navegue até um interpretador ou ambiente Python reconhecido.</p>`}<div class="environment-browser__entries">${entries || '<p class="muted">Nenhuma subpasta.</p>'}</div>`
      : `<div class="environment-browser-modal__loading">Nenhum diretório carregado.</div>`;
  return `<div class="modal-backdrop" role="presentation"><section class="environment-browser-modal" role="dialog" aria-modal="true" aria-labelledby="environment-browser-title"><header><div><h2 id="environment-browser-title">Selecionar diretório do ambiente</h2><p>Escolha a pasta que contém o ambiente virtual Python.</p></div>${renderButton("Fechar", "close", { command: "environment.browser.close", iconOnly: true })}</header><div class="environment-browser-modal__content">${content}</div><footer>${renderButton("Cancelar", "close", { command: "environment.browser.close", size: "small" })}</footer></section></div>`;
}

function renderSidebar(): string {
  const title = state.sidebarView === "explorer" ? "EXPLORER" : state.sidebarView === "plugins" ? "PLUGINS" : "RUNTIMES";
  const content = state.sidebarView === "explorer" ? renderWorkspaceEntries() : state.sidebarView === "plugins" ? renderPlugins() : renderRuntimes();
  return `<aside id="sidebar-panel" class="sidebar ${state.sidebarVisible ? "" : "is-hidden"}"><header class="sidebar__header">${title}</header><div class="sidebar__content">${content}</div></aside>`;
}

function renderWelcome(): string {
  return `<div class="welcome-screen"><h1>tinyIde</h1><p>Crie ou abra um arquivo para começar.</p><div class="welcome-actions">${renderButton("Novo arquivo", "fileAdd", { command: "file.new", variant: "primary" })}${renderButton("Abrir arquivo", "file", { command: "file.openPicker" })}${renderButton("Abrir pasta", "folderOpen", { command: "workspace.open" })}</div><small>Atalhos: Ctrl+N, Ctrl+O, Ctrl+S e Ctrl+Shift+S</small></div>`;
}

function renderEditorRuntimeControls(active: OpenDocument): string {
  const provider = runtimeProviderForExecution(active);
  if (!provider) return "";

  const options = state.runtimes
    .map((runtime) => `<option value="${escapeHtml(runtime.id)}" ${runtime.id === state.selectedRuntimeId ? "selected" : ""}>${escapeHtml(runtime.name)}${runtime.version ? ` · ${escapeHtml(runtime.version)}` : ""}</option>`)
    .join("");
  const selected = state.runtimes.find((runtime) => runtime.id === state.selectedRuntimeId);
  const canRun = Boolean(state.selectedRuntimeId) && !state.runtimeBusy;
  const runTitle = selected
    ? `Executar ${active.name} com ${selected.name}`
    : `Selecione um runtime para executar ${active.name}`;

  return `<div class="editor-runtime-controls"><select data-environment-select aria-label="Runtime selecionado" title="${escapeHtml(selected?.executable ?? selected?.name ?? "Selecionar runtime")}" ${state.runtimeBusy ? "disabled" : ""}><option value="" ${state.selectedRuntimeId ? "" : "selected"}>${options ? "Selecionar runtime" : "Sem runtime"}</option>${options}</select>${renderButton(state.runtimeBusy ? "Executando" : "Executar", "play", { command: "execution.run", size: "small", variant: "primary", disabled: !canRun, title: runTitle, className: "editor-run-button" })}</div>`;
}

function renderEditor(): string {
  const active = activeDocument();
  if (!active) return renderWelcome();
  const dirty = active.content !== active.savedContent;
  const provider = languageProviderFor(active);
  const runtimeControls = renderEditorRuntimeControls(active);
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
  return `<div class="code-editor"><div class="editor-toolbar"><span class="editor-toolbar__document">${dirty ? "● " : ""}${escapeHtml(active.name)}${provider ? ` · ${escapeHtml(provider.name)}` : ""}</span><div class="editor-toolbar__actions">${runtimeControls}${languageActions}${renderButton("Salvar como", "saveAs", { command: "file.saveAs", iconOnly: true })}${renderButton("Salvar", "save", { command: "file.save", iconOnly: true, variant: "primary" })}</div></div>${diagnostics}${editorSurface}</div>`;
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

async function createRuntime(): Promise<void> {
  const manager = runtimeManager();
  if (!manager?.create) throw new Error("O gerenciador de runtimes não permite criar ambientes.");
  state.sidebarView = "runtimes";
  state.sidebarVisible = true;
  state.runtimeForm = "create";
  render();
}

async function submitRuntime(name: string): Promise<void> {
  const manager = runtimeManager();
  if (!manager?.create) throw new Error("O gerenciador de runtimes não permite criar ambientes.");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Informe o nome do ambiente.");
  state.runtimeBusy = true;
  state.notice = `Criando ambiente '${normalizedName}'...`;
  state.error = undefined;
  render();
  try {
    const form = appRoot.querySelector<HTMLFormElement>('[data-form="environment-create"]');
    const pathValue = form ? new FormData(form).get("path") : undefined;
    const path = typeof pathValue === "string" && pathValue.trim() ? pathValue.trim() : undefined;
    const runtime = await manager.create({
      name: normalizedName,
      ...(path ? { path } : {}),
    });
    await refreshRuntimes();
    state.selectedRuntimeId = runtime.id;
    state.runtimeForm = undefined;
    showNotice(`Runtime '${runtime.name}' criado.`);
    persistSession();
  } finally {
    state.runtimeBusy = false;
    render();
    persistSession();
  }
}

async function importRuntime(path: string, name: string): Promise<void> {
  const manager = runtimeManager();
  if (!manager?.importExisting) throw new Error("O gerenciador de runtimes não permite adicionar interpretadores.");
  const normalizedPath = path.trim();
  if (!normalizedPath) throw new Error("Informe o caminho do ambiente existente.");
  state.runtimeBusy = true;
  state.notice = `Validando ambiente em '${normalizedPath}'...`;
  state.error = undefined;
  render();
  try {
    const normalizedName = name.trim();
    const runtime = await manager.importExisting({
      path: normalizedPath,
      ...(normalizedName ? { name: normalizedName } : {}),
    });
    await refreshRuntimes();
    state.selectedRuntimeId = runtime.id;
    state.runtimeForm = undefined;
    state.runtimeBrowser = undefined;
    state.runtimeBrowserOpen = false;
    state.runtimeSelectedPath = undefined;
    showNotice(`Runtime '${runtime.name}' adicionado.`);
    persistSession();
  } finally {
    state.runtimeBusy = false;
    render();
  }
}

async function browseEnvironmentDirectory(rawPath?: unknown): Promise<void> {
  const manager = runtimeManager();
  if (!manager?.browseDirectories) throw new Error("O gerenciador não oferece navegação de diretórios.");
  state.runtimeBrowserOpen = true;
  state.runtimeBrowserLoading = true;
  render();
  try {
    state.runtimeBrowser = await manager.browseDirectories(typeof rawPath === "string" ? rawPath : undefined);
  } finally {
    state.runtimeBrowserLoading = false;
    render();
  }
}

function chooseEnvironmentPath(rawPath: unknown): void {
  if (typeof rawPath !== "string") throw new Error("Caminho inválido.");
  state.runtimeSelectedPath = rawPath;
  state.runtimeBrowserOpen = false;
  render();
}

async function installEnvironmentPackages(): Promise<void> {
  const manager = runtimeManager();
  if (!manager?.installPackages) throw new Error("O runtime selecionado não permite gerenciar pacotes.");
  if (!state.selectedRuntimeId) throw new Error("Selecione um runtime.");
  state.runtimeForm = "packages";
  render();
}

async function submitEnvironmentPackages(value: string): Promise<void> {
  const manager = runtimeManager();
  const runtimeId = state.selectedRuntimeId;
  if (!manager?.installPackages || !runtimeId) throw new Error("Selecione um runtime com suporte a pacotes.");
  if (!value.trim()) throw new Error("Informe ao menos um pacote.");
  const packages = value.trim().split(/\s+/);
  state.runtimeBusy = true;
  state.notice = `Instalando ${packages.join(", ")}...`;
  state.error = undefined;
  render();
  try {
    await manager.installPackages(runtimeId, packages);
    await refreshRuntimes();
    state.runtimeForm = undefined;
    showNotice("Pacotes instalados no runtime selecionado.");
    persistSession();
  } finally {
    state.runtimeBusy = false;
    render();
  }
}

async function removeSelectedEnvironment(): Promise<void> {
  const manager = runtimeManager();
  const runtimeId = state.selectedRuntimeId;
  if (!manager?.remove || !runtimeId) throw new Error("Selecione um runtime gerenciado.");
  const runtime = state.runtimes.find((candidate) => candidate.id === runtimeId);
  state.runtimeBusy = true;
  state.notice = `Removendo runtime '${runtime?.name ?? runtimeId}'...`;
  state.error = undefined;
  render();
  try {
    await manager.remove(runtimeId);
    state.selectedRuntimeId = undefined;
    await refreshRuntimes();
    showNotice(`Runtime '${runtime?.name ?? runtimeId}' removido.`);
    persistSession();
  } finally {
    state.runtimeBusy = false;
    render();
  }
}

function selectEnvironment(rawId: unknown): void {
  if (typeof rawId !== "string" || !state.runtimes.some((runtime) => runtime.id === rawId)) throw new Error("Runtime inválido.");
  state.selectedRuntimeId = rawId;
  render();
  persistSession();
}

function packagesForEnvironment(rawId: unknown): void {
  if (typeof rawId !== "string") throw new Error("Runtime inválido.");
  state.selectedRuntimeId = rawId;
  state.runtimeForm = "packages";
  state.sidebarView = "runtimes";
  state.sidebarVisible = true;
  render();
  persistSession();
}

async function removeEnvironmentById(rawId: unknown): Promise<void> {
  if (typeof rawId !== "string") throw new Error("Runtime inválido.");
  state.selectedRuntimeId = rawId;
  await removeSelectedEnvironment();
}

async function runWithSelectedRuntime(): Promise<void> {
  const active = activeDocument();
  const provider = runtimeProviderForExecution(active);
  const runtimeId = state.selectedRuntimeId;
  if (!active || !provider) throw new Error("Nenhum runtime disponível para este arquivo.");
  if (!runtimeId) throw new Error("Selecione um runtime antes de executar.");

  const runtime = state.runtimes.find((candidate) => candidate.id === runtimeId);
  state.runtimeBusy = true;
  state.panelVisible = true;
  state.notice = `Executando '${active.name}' em ${runtime?.name ?? runtimeId}...`;
  state.error = undefined;
  state.logs = [`[${provider.name}] Executando ${active.name} em ${runtime?.name ?? runtimeId}...`];
  render();

  try {
    const profile = state.runProfile;
    const commonRequest = {
      args: parseArgumentLine(profile.arguments),
      environmentVariables: parseEnvironmentVariables(profile.environmentVariables),
      ...(profile.workingDirectory.trim()
        ? { workingDirectory: profile.workingDirectory.trim() }
        : {}),
    };
    const request: RuntimeExecutionRequest = profile.mode === "module"
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
    const result = await provider.run(runtimeId, request);
    state.logs = [
      `[${provider.name} · ${runtime?.name ?? runtimeId}] ${active.name} exited with ${result.exitCode} in ${result.durationMs.toFixed(0)}ms`,
      result.stdout,
      result.stderr,
    ].filter(Boolean);
    if (result.exitCode === 0) {
      state.notice = `'${active.name}' executado no runtime '${runtime?.name ?? runtimeId}'.`;
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
    state.runtimeBusy = false;
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
  const environmentActivity = runtimeProvider()
    ? renderActivityButton("view.runtimes", "environment", "Runtimes", state.sidebarView === "runtimes")
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
      ${renderEnvironmentBrowserModal()}
    </div>
  `;
  bindInteractions();
  syncLayoutToViewport();
}

function bindInteractions(): void {
  appRoot.querySelectorAll<HTMLElement>("[data-command]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const command = element.dataset.command;
      if (!command) return;
      const argument = element.dataset.pluginUrl ?? element.dataset.pluginId ?? element.dataset.environmentId ?? element.dataset.browserPath ?? element.dataset.entryPath ?? element.dataset.filePath;
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
    persistSession();
    render();
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
    state.selectedRuntimeId = value || undefined;
    state.runtimeForm = undefined;
    render();
    persistSession();
  });
  appRoot.querySelector<HTMLFormElement>('[data-form="environment-create"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget as HTMLFormElement).get("name");
    void submitRuntime(typeof name === "string" ? name : "").catch(showError);
  });
  appRoot.querySelector<HTMLFormElement>('[data-form="environment-import"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const path = formData.get("path");
    const name = formData.get("name");
    void importRuntime(
      typeof path === "string" ? path : "",
      typeof name === "string" ? name : "",
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
    parseArgumentLine(profile.arguments);
    parseEnvironmentVariables(profile.environmentVariables);
    state.runProfile = profile;
    localStorage.setItem(RUN_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    state.runtimeForm = undefined;
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
commands.register("runtime.refresh", refreshRuntimes);
commands.register("runtime.create", createRuntime);
commands.register("runtime.import", async () => {
  state.sidebarView = "runtimes";
  state.sidebarVisible = true;
  state.runtimeForm = "import";
  state.runtimeBrowser = undefined;
  state.runtimeBrowserOpen = false;
  state.runtimeSelectedPath = undefined;
  render();
});
commands.register("environment.browser.open", () => browseEnvironmentDirectory());
commands.register("environment.browser.close", () => { state.runtimeBrowserOpen = false; render(); });
commands.register("environment.browse", browseEnvironmentDirectory);
commands.register("environment.choosePath", chooseEnvironmentPath);
commands.register("runtime.packages", installEnvironmentPackages);
commands.register("runtime.remove", removeSelectedEnvironment);
commands.register("runtime.select", selectEnvironment);
commands.register("runtime.packagesFor", packagesForEnvironment);
commands.register("runtime.removeById", removeEnvironmentById);
commands.register("runtime.runProfile", () => {
  state.sidebarView = "runtimes";
  state.sidebarVisible = true;
  state.runtimeForm = "run";
  render();
});
commands.register("environment.form.cancel", () => {
  state.runtimeForm = undefined;
  state.runtimeBrowser = undefined;
  state.runtimeBrowserOpen = false;
  state.runtimeSelectedPath = undefined;
  render();
});
commands.register("execution.run", runWithSelectedRuntime);
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
commands.register("view.runtimes", async () => {
  if (!runtimeProvider()) throw new Error("Nenhum plugin de ambiente está ativo.");
  state.sidebarView = "runtimes";
  state.sidebarVisible = true;
  await refreshRuntimes();
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
  await refreshRuntimes();
  showNotice(`Plugin '${plugin.manifest.name}' habilitado.`);
});
commands.register("plugin.disable", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const plugin = await plugins.disable(rawId);
  persistPlugins();
  await refreshRuntimes();
  showNotice(`Plugin '${plugin.manifest.name}' desabilitado.`);
});
commands.register("plugin.uninstall", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const pluginName = plugins.get(rawId)?.manifest.name ?? rawId;
  await plugins.uninstall(rawId);
  pluginSourceUrls.delete(rawId);
  persistPlugins();
  await refreshRuntimes();
  showNotice(`Plugin '${pluginName}' removido.`);
});

events.on<{ name: string }>("workspace.opened", ({ name }) => log(`workspace.opened: ${name}`));
events.on<{ name: string }>("file.opened", ({ name }) => log(`file.opened: ${name}`));
events.on<{ name: string }>("file.saved", ({ name }) => log(`file.saved: ${name}`));
events.on<PluginRecord>("plugin.installed", (plugin) => log(`plugin.installed: ${plugin.manifest.id}@${plugin.manifest.version}`));

capabilities.register("core.commands", commands);
capabilities.register("core.events", events);
capabilities.register("core.plugins", plugins);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.runtimeBrowserOpen) {
    event.preventDefault();
    state.runtimeBrowserOpen = false;
    render();
    return;
  }
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
