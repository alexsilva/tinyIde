import {
  CapabilityRegistry,
  CommandRegistry,
  EventBus,
  ModulePluginHost,
  PluginManager,
} from "@tinyide/core";
import type {
  LanguageProvider,
  PluginManifest,
  PluginRecord,
  TextDiagnostic,
} from "@tinyide/plugin-api";
import "./styles.css";

const PLATFORM_VERSION = "0.4.0";
const PLUGIN_STORAGE_KEY = "tinyide.installedPlugins.v2";
const LEGACY_PLUGIN_STORAGE_KEY = "tinyide.installedPlugins";

interface BrowserWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface BrowserFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserWritable>;
}

interface BrowserDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
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
  readonly handle: BrowserEntryHandle;
  readonly path: string;
  children?: WorkspaceEntry[];
}

interface OpenDocument {
  name: string;
  handle?: BrowserFileHandle;
  path?: string;
  content: string;
  savedContent: string;
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

type SidebarView = "explorer" | "plugins";

interface AppState {
  sidebarVisible: boolean;
  panelVisible: boolean;
  fileMenuOpen: boolean;
  sidebarView: SidebarView;
  workspaceName: string | undefined;
  workspaceEntries: WorkspaceEntry[];
  expandedDirectories: Set<string>;
  activeDocument: OpenDocument | undefined;
  diagnostics: TextDiagnostic[];
  languageActionRunning: boolean;
  availablePlugins: PluginCatalogEntry[];
  pluginCatalogLoading: boolean;
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
  panelVisible: true,
  fileMenuOpen: false,
  sidebarView: "explorer",
  workspaceName: undefined,
  workspaceEntries: [],
  expandedDirectories: new Set<string>(),
  activeDocument: undefined,
  diagnostics: [],
  languageActionRunning: false,
  availablePlugins: [],
  pluginCatalogLoading: false,
  logs: ["tinyIde core initialized", `platform version ${PLATFORM_VERSION}`],
  notice: undefined,
  error: undefined,
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function languageProviderFor(document: OpenDocument | undefined): LanguageProvider | undefined {
  if (!document) return undefined;
  const lowerName = document.name.toLowerCase();
  return capabilities
    .getAll<LanguageProvider>("language.provider")
    .find((provider) => provider.extensions.some((extension) => lowerName.endsWith(extension)));
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
}

function showNotice(message: string): void {
  state.notice = message;
  state.error = undefined;
  render();
}

function showError(error: unknown): void {
  state.error = error instanceof Error ? error.message : String(error);
  state.notice = undefined;
  render();
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
      const installed = await plugins.install(stored.manifest);
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
  state.workspaceName = handle.name;
  state.workspaceEntries = await readDirectory(handle);
  state.expandedDirectories.clear();
  state.activeDocument = undefined;
  state.sidebarVisible = true;
  state.sidebarView = "explorer";
  await events.emit("workspace.opened", { name: handle.name });
  showNotice(`Pasta '${handle.name}' aberta.`);
}

function newFile(): void {
  state.fileMenuOpen = false;
  state.workspaceName = state.workspaceName ?? "Arquivos locais";
  state.activeDocument = {
    name: "sem-titulo.txt",
    content: "",
    savedContent: "",
  };
  state.diagnostics = [];
  render();
  requestAnimationFrame(() => appRoot.querySelector<HTMLTextAreaElement>("[data-editor]")?.focus());
}

async function openFileHandle(handle: BrowserFileHandle, path?: string): Promise<void> {
  const file = await handle.getFile();
  const content = await file.text();
  state.activeDocument = path
    ? { name: file.name, handle, path, content, savedContent: content }
    : { name: file.name, handle, content, savedContent: content };
  state.diagnostics = [];
  state.workspaceName = state.workspaceName ?? "Arquivo avulso";
  await events.emit("file.opened", { name: file.name });
  log(`file.opened: ${file.name}`);
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
    state.activeDocument = { name: file.name, content, savedContent: content };
    state.workspaceName = "Arquivo avulso";
    await events.emit("file.opened", { name: file.name });
    log(`file.opened: ${file.name}`);
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
    return;
  }

  if (!entry.children) {
    entry.children = await readDirectory(entry.handle as BrowserDirectoryHandle, entry.path);
  }
  state.expandedDirectories.add(rawPath);
  render();
}

async function openWorkspaceFile(rawPath: unknown): Promise<void> {
  if (typeof rawPath !== "string") throw new Error("Caminho de arquivo inválido.");
  const entry = findWorkspaceEntry(state.workspaceEntries, rawPath);
  if (!entry || entry.kind !== "file") throw new Error(`Arquivo não encontrado: ${rawPath}`);
  await openFileHandle(entry.handle as BrowserFileHandle, entry.path);
}

async function saveToHandle(document: OpenDocument, handle: BrowserFileHandle): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(document.content);
  } finally {
    await writable.close();
  }
  document.handle = handle;
  document.name = handle.name;
  document.savedContent = document.content;
  await events.emit("file.saved", { name: document.name });
  showNotice(`'${document.name}' salvo.`);
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
}

const documentObject = document;

async function saveFile(forceSaveAs = false): Promise<void> {
  state.fileMenuOpen = false;
  const active = state.activeDocument;
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
  showNotice(`Plugin '${installed.manifest.name}' instalado e ativado.`);
}

function renderTreeEntries(entries: WorkspaceEntry[], depth = 0): string {
  return entries
    .map((entry) => {
      const active = state.activeDocument?.path === entry.path ? " is-active" : "";
      const padding = 8 + depth * 16;

      if (entry.kind === "directory") {
        const expanded = state.expandedDirectories.has(entry.path);
        const children = expanded
          ? `<div class="tree-children">${entry.children?.length ? renderTreeEntries(entry.children, depth + 1) : '<div class="tree-empty">Pasta vazia</div>'}</div>`
          : "";
        return `<div class="tree-node"><button class="tree-entry tree-entry--directory" type="button" data-command="workspace.toggleDirectory" data-entry-path="${escapeHtml(entry.path)}" style="padding-left:${padding}px"><span class="tree-chevron">${expanded ? "▾" : "▸"}</span><span class="tree-entry__icon">D</span><span>${escapeHtml(entry.name)}</span></button>${children}</div>`;
      }

      return `<button class="tree-entry${active}" type="button" data-command="file.openWorkspace" data-entry-path="${escapeHtml(entry.path)}" style="padding-left:${padding + 16}px"><span class="tree-entry__icon">F</span><span>${escapeHtml(entry.name)}</span></button>`;
    })
    .join("");
}

function renderWorkspaceEntries(): string {
  const actions = `<div class="explorer-actions"><button data-command="file.new">Novo arquivo</button><button data-command="file.openPicker">Abrir arquivo</button><button data-command="workspace.open">Abrir pasta</button></div>`;
  if (!state.workspaceName) {
    return `${actions}<div class="empty-state"><p>Nenhum arquivo ou pasta aberto.</p></div>`;
  }
  const entries = renderTreeEntries(state.workspaceEntries);
  return `${actions}<div class="workspace-title">${escapeHtml(state.workspaceName)}</div><div class="tree">${entries || '<p class="muted">Nenhum item listado.</p>'}</div>`;
}

function pluginActions(plugin: PluginRecord): string {
  const active = plugin.state === "active" || plugin.state === "enabled";
  const action = active ? "plugin.disable" : "plugin.enable";
  const label = active ? "Desabilitar" : "Habilitar";
  return `<div class="plugin-actions"><button data-command="${action}" data-plugin-id="${escapeHtml(plugin.manifest.id)}">${label}</button><button data-command="plugin.uninstall" data-plugin-id="${escapeHtml(plugin.manifest.id)}">Remover</button></div>`;
}

function renderPlugins(): string {
  const installedCards = plugins.list().map((plugin) => `<article class="plugin-card"><div class="plugin-card__heading"><strong>${escapeHtml(plugin.manifest.name)}</strong><span class="state-badge">${escapeHtml(plugin.state)}</span></div><p>${escapeHtml(plugin.manifest.description ?? "Sem descrição.")}</p><small>${escapeHtml(plugin.manifest.id)} · ${escapeHtml(plugin.manifest.version)}</small>${pluginActions(plugin)}</article>`).join("");
  const availableCards = state.availablePlugins
    .filter((entry) => !plugins.get(entry.manifest.id))
    .map((entry) => `<article class="plugin-card"><div class="plugin-card__heading"><strong>${escapeHtml(entry.manifest.name)}</strong><span class="state-badge">disponível</span></div><p>${escapeHtml(entry.manifest.description ?? "Sem descrição.")}</p><small>${escapeHtml(entry.manifest.id)} · ${escapeHtml(entry.manifest.version)}</small><div class="plugin-actions"><button class="primary-button" data-command="plugin.installFromUrl" data-plugin-url="${escapeHtml(entry.manifestUrl)}">Instalar</button></div></article>`)
    .join("");

  return `<form class="plugin-install" data-form="plugin-install"><label for="plugin-url">Manifesto remoto</label><div class="input-row"><input id="plugin-url" name="url" type="url" placeholder="https://registry.example/plugin.json" required /><button class="primary-button" type="submit">Instalar</button></div></form><div class="plugin-section"><h3>Instalados</h3><div class="plugin-list">${installedCards || '<div class="empty-state"><p>Nenhum plugin instalado.</p></div>'}</div></div><div class="plugin-section"><h3>Disponíveis</h3><div class="plugin-list">${state.pluginCatalogLoading ? '<p class="muted">Carregando catálogo...</p>' : availableCards || '<p class="muted">Nenhum plugin disponível.</p>'}</div></div>`;
}

function renderSidebar(): string {
  const title = state.sidebarView === "explorer" ? "EXPLORER" : "PLUGINS";
  const content = state.sidebarView === "explorer" ? renderWorkspaceEntries() : renderPlugins();
  return `<aside class="sidebar ${state.sidebarVisible ? "" : "is-hidden"}"><header class="sidebar__header">${title}</header><div class="sidebar__content">${content}</div></aside>`;
}

function renderWelcome(): string {
  return `<div class="welcome-screen"><h1>tinyIde</h1><p>Crie ou abra um arquivo para começar.</p><div class="welcome-actions"><button class="primary-button" data-command="file.new">Novo arquivo</button><button class="primary-button" data-command="file.openPicker">Abrir arquivo</button><button data-command="workspace.open">Abrir pasta</button></div><small>Atalhos: Ctrl+N, Ctrl+O, Ctrl+S e Ctrl+Shift+S</small></div>`;
}

function renderEditor(): string {
  const active = state.activeDocument;
  if (!active) return renderWelcome();
  const dirty = active.content !== active.savedContent;
  const provider = languageProviderFor(active);
  const languageActions = provider
    ? `<button data-command="language.lint" ${state.languageActionRunning ? "disabled" : ""}>Lint</button><button class="primary-button" data-command="language.run" ${state.languageActionRunning ? "disabled" : ""}>Executar</button>`
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
  return `<div class="code-editor"><div class="editor-toolbar"><span>${dirty ? "● " : ""}${escapeHtml(active.name)}${provider ? ` · ${escapeHtml(provider.name)}` : ""}</span><div>${languageActions}<button data-command="file.saveAs">Salvar como</button><button class="primary-button" data-command="file.save">Salvar</button></div></div>${diagnostics}${editorSurface}</div>`;
}

async function lintActiveDocument(): Promise<void> {
  const active = state.activeDocument;
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
  }
}

async function runActiveDocument(): Promise<void> {
  const active = state.activeDocument;
  const provider = languageProviderFor(active);
  if (!active || !provider) throw new Error("Nenhum provider de linguagem disponível para este arquivo.");
  state.languageActionRunning = true;
  state.panelVisible = true;
  render();
  try {
    const result = await provider.run(active.content, active.name);
    const header = `[${provider.name}] ${active.name} exited with ${result.exitCode} in ${result.durationMs.toFixed(0)}ms`;
    state.logs = [...state.logs, header, result.stdout || "", result.stderr || ""].filter(Boolean).slice(-100);
    render();
  } finally {
    state.languageActionRunning = false;
    render();
  }
}

function renderFileMenu(): string {
  if (!state.fileMenuOpen) return "";
  return `<div class="file-menu" role="menu"><button data-command="file.new">Novo arquivo <span>Ctrl+N</span></button><button data-command="file.openPicker">Abrir arquivo <span>Ctrl+O</span></button><button data-command="workspace.open">Abrir pasta</button><hr /><button data-command="file.save">Salvar <span>Ctrl+S</span></button><button data-command="file.saveAs">Salvar como <span>Ctrl+Shift+S</span></button></div>`;
}

function renderNotice(): string {
  if (!state.notice && !state.error) return "";
  return `<div class="toast toast--${state.error ? "error" : "notice"}">${escapeHtml(state.error ?? state.notice ?? "")}</div>`;
}

function render(): void {
  const active = state.activeDocument;
  const dirty = active ? active.content !== active.savedContent : false;
  appRoot.innerHTML = `<div class="ide-shell"><header class="titlebar"><div class="brand">tinyIde</div><nav class="menu" aria-label="Menu principal"><div class="menu-item"><button data-command="menu.file.toggle">Arquivo</button>${renderFileMenu()}</div><button data-command="file.save">Salvar</button><button data-command="panel.toggle">Painel</button></nav><div class="titlebar__center">${escapeHtml(state.workspaceName ?? active?.name ?? "Sem workspace")}</div><div class="version">v${PLATFORM_VERSION}</div></header><main class="workbench ${state.sidebarVisible ? "" : "workbench--sidebar-hidden"}"><nav class="activitybar" aria-label="Atividades"><button class="activity-button ${state.sidebarView === "explorer" ? "is-active" : ""}" data-command="view.explorer">EX</button><button class="activity-button ${state.sidebarView === "plugins" ? "is-active" : ""}" data-command="view.plugins">PL</button><div class="activitybar__spacer"></div><button class="activity-button" data-command="panel.toggle">PN</button></nav>${renderSidebar()}<section class="editor-area"><div class="editor-tabs"><button class="editor-tab is-active"><span>TXT</span>${escapeHtml(active?.name ?? "Bem-vindo")}${dirty ? " ●" : ""}</button></div>${renderEditor()}<section class="bottom-panel ${state.panelVisible ? "" : "is-hidden"}"><header class="panel-tabs"><button class="is-active">SAÍDA</button><button>PROBLEMAS <span class="counter">0</span></button></header><pre class="output">${state.logs.map(escapeHtml).join("\n")}</pre></section></section></main><footer class="statusbar"><button data-command="file.openPicker">${escapeHtml(state.workspaceName ?? "Abrir arquivo")}</button><span>${plugins.list().length} plugin(s)</span><span class="statusbar__spacer"></span><span>${dirty ? "Alterações não salvas" : "Salvo"}</span><span>UTF-8</span><span>Texto</span></footer>${renderNotice()}</div>`;
  bindInteractions();
}

function bindInteractions(): void {
  appRoot.querySelectorAll<HTMLElement>("[data-command]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const command = element.dataset.command;
      if (!command) return;
      const argument = element.dataset.pluginUrl ?? element.dataset.pluginId ?? element.dataset.entryPath;
      void commands.execute(command, argument).catch(showError);
    });
  });
  appRoot.querySelector<HTMLTextAreaElement>("[data-editor]")?.addEventListener("input", (event) => {
    if (!state.activeDocument) return;
    state.activeDocument.content = (event.currentTarget as HTMLTextAreaElement).value;
    render();
    requestAnimationFrame(() => {
      const editor = appRoot.querySelector<HTMLTextAreaElement>("[data-editor]");
      if (editor) {
        editor.focus();
        editor.selectionStart = editor.selectionEnd = editor.value.length;
      }
    });
  });
  const editor = appRoot.querySelector<HTMLTextAreaElement>("[data-editor]");
  const syntaxLayer = appRoot.querySelector<HTMLElement>("[data-syntax-layer]");
  editor?.addEventListener("scroll", () => {
    if (!syntaxLayer) return;
    syntaxLayer.scrollTop = editor.scrollTop;
    syntaxLayer.scrollLeft = editor.scrollLeft;
  });
  appRoot.querySelectorAll<HTMLElement>("[data-diagnostic-line]").forEach((element) => {
    element.addEventListener("click", () => {
      const line = Number(element.dataset.diagnosticLine ?? "1");
      const textarea = appRoot.querySelector<HTMLTextAreaElement>("[data-editor]");
      if (!textarea || !state.activeDocument) return;
      const lines = state.activeDocument.content.split("\n");
      const offset = lines.slice(0, Math.max(0, line - 1)).reduce((total, value) => total + value.length + 1, 0);
      textarea.focus();
      textarea.setSelectionRange(offset, offset);
    });
  });
  appRoot.querySelector<HTMLFormElement>('[data-form="plugin-install"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = new FormData(event.currentTarget as HTMLFormElement).get("url");
    void commands.execute("plugin.installFromUrl", url).catch(showError);
  });
}

commands.register("menu.file.toggle", () => {
  state.fileMenuOpen = !state.fileMenuOpen;
  render();
});
commands.register("file.new", newFile);
commands.register("file.openPicker", openFileFromPicker);
commands.register("workspace.open", openWorkspace);
commands.register("workspace.toggleDirectory", toggleWorkspaceDirectory);
commands.register("file.openWorkspace", openWorkspaceFile);
commands.register("file.save", () => saveFile(false));
commands.register("file.saveAs", () => saveFile(true));
commands.register("language.lint", lintActiveDocument);
commands.register("language.run", runActiveDocument);
commands.register("view.explorer", () => { state.sidebarView = "explorer"; state.sidebarVisible = true; render(); });
commands.register("view.plugins", () => {
  state.sidebarView = "plugins";
  state.sidebarVisible = true;
  render();
  if (!state.availablePlugins.length && !state.pluginCatalogLoading) {
    void loadPluginCatalog();
  }
});
commands.register("sidebar.toggle", () => { state.sidebarVisible = !state.sidebarVisible; render(); });
commands.register("panel.toggle", () => { state.panelVisible = !state.panelVisible; render(); });
commands.register("plugin.installFromUrl", async (rawUrl: unknown) => {
  if (typeof rawUrl !== "string") throw new Error("Plugin URL must be a string.");
  await installPluginFromUrl(rawUrl);
});
commands.register("plugin.enable", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const plugin = await plugins.enable(rawId);
  await plugins.activate(rawId, { commands, events, capabilities, subscriptions: [] });
  persistPlugins();
  showNotice(`Plugin '${plugin.manifest.name}' habilitado.`);
});
commands.register("plugin.disable", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const plugin = await plugins.disable(rawId); persistPlugins(); showNotice(`Plugin '${plugin.manifest.name}' desabilitado.`);
});
commands.register("plugin.uninstall", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const pluginName = plugins.get(rawId)?.manifest.name ?? rawId;
  await plugins.uninstall(rawId);
  pluginSourceUrls.delete(rawId);
  persistPlugins();
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
  if (event.ctrlKey && event.key.toLowerCase() === "b") {
    event.preventDefault(); void commands.execute("sidebar.toggle");
  }
});
window.addEventListener("click", () => {
  if (state.fileMenuOpen) { state.fileMenuOpen = false; render(); }
});

render();

declare global {
  interface Window {
    tinyIde: {
      readonly commands: CommandRegistry;
      readonly events: EventBus;
      readonly capabilities: CapabilityRegistry;
      readonly plugins: PluginManager;
      installPlugin(manifestUrl: string): Promise<void>;
    };
  }
}

window.tinyIde = {
  commands,
  events,
  capabilities,
  plugins,
  installPlugin: installPluginFromUrl,
};

void restorePlugins()
  .then(render)
  .catch(showError);
