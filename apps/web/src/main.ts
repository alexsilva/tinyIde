import { CapabilityRegistry, CommandRegistry, EventBus, PluginManager } from "@tinyide/core";
import type { PluginManifest, PluginRecord } from "@tinyide/plugin-api";
import "./styles.css";

const PLATFORM_VERSION = "0.3.0";
const PLUGIN_STORAGE_KEY = "tinyide.installedPlugins";

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
}

interface OpenDocument {
  name: string;
  handle?: BrowserFileHandle;
  content: string;
  savedContent: string;
}

type SidebarView = "explorer" | "plugins";

interface AppState {
  sidebarVisible: boolean;
  panelVisible: boolean;
  fileMenuOpen: boolean;
  sidebarView: SidebarView;
  workspaceName: string | undefined;
  workspaceEntries: WorkspaceEntry[];
  activeDocument: OpenDocument | undefined;
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
const plugins = new PluginManager({ platformVersion: PLATFORM_VERSION, events });

const state: AppState = {
  sidebarVisible: true,
  panelVisible: true,
  fileMenuOpen: false,
  sidebarView: "explorer",
  workspaceName: undefined,
  workspaceEntries: [],
  activeDocument: undefined,
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
  localStorage.setItem(
    PLUGIN_STORAGE_KEY,
    JSON.stringify(plugins.list().map((plugin) => plugin.manifest)),
  );
}

async function restorePlugins(): Promise<void> {
  const rawValue = localStorage.getItem(PLUGIN_STORAGE_KEY);
  if (!rawValue) return;
  try {
    const manifests = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(manifests)) throw new Error("Stored plugin metadata is invalid.");
    for (const manifest of manifests) await plugins.install(manifest);
  } catch (error) {
    localStorage.removeItem(PLUGIN_STORAGE_KEY);
    showError(error);
  }
}

async function readDirectory(handle: BrowserDirectoryHandle): Promise<WorkspaceEntry[]> {
  const entries: WorkspaceEntry[] = [];
  for await (const entry of handle.values()) {
    entries.push({ name: entry.name, kind: entry.kind, handle: entry });
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
  render();
  requestAnimationFrame(() => appRoot.querySelector<HTMLTextAreaElement>("[data-editor]")?.focus());
}

async function openFileHandle(handle: BrowserFileHandle): Promise<void> {
  const file = await handle.getFile();
  const content = await file.text();
  state.activeDocument = { name: file.name, handle, content, savedContent: content };
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

async function openWorkspaceFile(rawName: unknown): Promise<void> {
  if (typeof rawName !== "string") throw new Error("Nome de arquivo inválido.");
  const entry = state.workspaceEntries.find((candidate) => candidate.name === rawName);
  if (!entry || entry.kind !== "file") throw new Error(`Arquivo não encontrado: ${rawName}`);
  await openFileHandle(entry.handle as BrowserFileHandle);
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
  const response = await fetch(normalizedUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Manifest request failed with status ${response.status}.`);
  const installed = await plugins.install((await response.json()) as unknown);
  persistPlugins();
  showNotice(`Plugin '${installed.manifest.name}' instalado.`);
}

function renderWorkspaceEntries(): string {
  const actions = `<div class="explorer-actions"><button data-command="file.new">Novo arquivo</button><button data-command="file.openPicker">Abrir arquivo</button><button data-command="workspace.open">Abrir pasta</button></div>`;
  if (!state.workspaceName) {
    return `${actions}<div class="empty-state"><p>Nenhum arquivo ou pasta aberto.</p></div>`;
  }
  const entries = state.workspaceEntries
    .map((entry) => {
      const active = state.activeDocument?.name === entry.name ? " is-active" : "";
      const command = entry.kind === "file" ? 'data-command="file.openWorkspace"' : "disabled";
      return `<button class="tree-entry${active}" type="button" ${command} data-file-name="${escapeHtml(entry.name)}"><span class="tree-entry__icon">${entry.kind === "directory" ? "D" : "F"}</span><span>${escapeHtml(entry.name)}</span></button>`;
    })
    .join("");
  return `${actions}<div class="workspace-title">${escapeHtml(state.workspaceName)}</div><div class="tree">${entries || '<p class="muted">Nenhum item listado.</p>'}</div>`;
}

function pluginActions(plugin: PluginRecord): string {
  const action = plugin.state === "enabled" ? "plugin.disable" : "plugin.enable";
  const label = plugin.state === "enabled" ? "Desabilitar" : "Habilitar";
  return `<div class="plugin-actions"><button data-command="${action}" data-plugin-id="${escapeHtml(plugin.manifest.id)}">${label}</button><button data-command="plugin.uninstall" data-plugin-id="${escapeHtml(plugin.manifest.id)}">Remover</button></div>`;
}

function renderPlugins(): string {
  const cards = plugins.list().map((plugin) => `<article class="plugin-card"><div class="plugin-card__heading"><strong>${escapeHtml(plugin.manifest.name)}</strong><span class="state-badge">${escapeHtml(plugin.state)}</span></div><p>${escapeHtml(plugin.manifest.description ?? "Sem descrição.")}</p><small>${escapeHtml(plugin.manifest.id)} · ${escapeHtml(plugin.manifest.version)}</small>${pluginActions(plugin)}</article>`).join("");
  return `<form class="plugin-install" data-form="plugin-install"><label for="plugin-url">Manifesto remoto</label><div class="input-row"><input id="plugin-url" name="url" type="url" placeholder="https://registry.example/plugin.json" required /><button class="primary-button" type="submit">Instalar</button></div></form><div class="plugin-list">${cards || '<div class="empty-state"><p>Nenhum plugin instalado.</p></div>'}</div>`;
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
  return `<div class="code-editor"><div class="editor-toolbar"><span>${dirty ? "● " : ""}${escapeHtml(active.name)}</span><div><button data-command="file.saveAs">Salvar como</button><button class="primary-button" data-command="file.save">Salvar</button></div></div><textarea class="code-input" data-editor spellcheck="false" aria-label="Editor de ${escapeHtml(active.name)}">${escapeHtml(active.content)}</textarea></div>`;
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
      const argument = element.dataset.pluginId ?? element.dataset.fileName;
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
commands.register("file.openWorkspace", openWorkspaceFile);
commands.register("file.save", () => saveFile(false));
commands.register("file.saveAs", () => saveFile(true));
commands.register("view.explorer", () => { state.sidebarView = "explorer"; state.sidebarVisible = true; render(); });
commands.register("view.plugins", () => { state.sidebarView = "plugins"; state.sidebarVisible = true; render(); });
commands.register("sidebar.toggle", () => { state.sidebarVisible = !state.sidebarVisible; render(); });
commands.register("panel.toggle", () => { state.panelVisible = !state.panelVisible; render(); });
commands.register("plugin.installFromUrl", async (rawUrl: unknown) => {
  if (typeof rawUrl !== "string") throw new Error("Plugin URL must be a string.");
  await installPluginFromUrl(rawUrl);
});
commands.register("plugin.enable", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const plugin = await plugins.enable(rawId); persistPlugins(); showNotice(`Plugin '${plugin.manifest.name}' habilitado.`);
});
commands.register("plugin.disable", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const plugin = await plugins.disable(rawId); persistPlugins(); showNotice(`Plugin '${plugin.manifest.name}' desabilitado.`);
});
commands.register("plugin.uninstall", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const pluginName = plugins.get(rawId)?.manifest.name ?? rawId; await plugins.uninstall(rawId); persistPlugins(); showNotice(`Plugin '${pluginName}' removido.`);
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
void restorePlugins().then(render).catch(showError);

declare global {
  interface Window {
    tinyIde: {
      readonly commands: CommandRegistry;
      readonly events: EventBus;
      readonly capabilities: CapabilityRegistry;
      readonly plugins: PluginManager;
      installManifest(manifest: PluginManifest): Promise<PluginRecord>;
    };
  }
}

window.tinyIde = {
  commands,
  events,
  capabilities,
  plugins,
  installManifest: async (manifest) => {
    const installed = await plugins.install(manifest);
    persistPlugins();
    render();
    return installed;
  },
};
