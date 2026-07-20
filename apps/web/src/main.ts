import { CapabilityRegistry, CommandRegistry, EventBus, PluginManager } from "@tinyide/core";
import type { PluginManifest, PluginRecord } from "@tinyide/plugin-api";
import "./styles.css";

const PLATFORM_VERSION = "0.2.0";
const PLUGIN_STORAGE_KEY = "tinyide.installedPlugins";

interface BrowserFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface BrowserDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<BrowserEntryHandle>;
}

type BrowserEntryHandle = BrowserFileHandle | BrowserDirectoryHandle;

interface FilePickerWindow extends Window {
  showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>;
}

interface WorkspaceEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly handle: BrowserEntryHandle;
}

interface OpenDocument {
  readonly name: string;
  readonly handle: BrowserFileHandle;
  content: string;
  savedContent: string;
}

type SidebarView = "explorer" | "plugins";

interface AppState {
  sidebarVisible: boolean;
  panelVisible: boolean;
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
  const pickerWindow = window as FilePickerWindow;
  if (!pickerWindow.showDirectoryPicker) {
    throw new Error("Directory access is not supported by this browser.");
  }

  const handle = await pickerWindow.showDirectoryPicker();
  state.workspaceName = handle.name;
  state.workspaceEntries = await readDirectory(handle);
  state.activeDocument = undefined;
  state.sidebarVisible = true;
  state.sidebarView = "explorer";
  await events.emit("workspace.opened", { name: handle.name });
  showNotice(`Workspace '${handle.name}' aberto.`);
}

async function openFile(rawName: unknown): Promise<void> {
  if (typeof rawName !== "string") throw new Error("File name must be a string.");
  const entry = state.workspaceEntries.find((candidate) => candidate.name === rawName);
  if (!entry || entry.kind !== "file") throw new Error(`Arquivo não encontrado: ${rawName}`);

  const handle = entry.handle as BrowserFileHandle;
  const file = await handle.getFile();
  const content = await file.text();
  state.activeDocument = { name: file.name, handle, content, savedContent: content };
  await events.emit("file.opened", { name: file.name });
  log(`file.opened: ${file.name}`);
}

async function saveFile(): Promise<void> {
  const document = state.activeDocument;
  if (!document) throw new Error("Nenhum arquivo aberto.");
  if (document.content === document.savedContent) {
    showNotice(`'${document.name}' já está salvo.`);
    return;
  }

  const writable = await document.handle.createWritable();
  try {
    await writable.write(document.content);
    await writable.close();
  } catch (error) {
    try {
      await writable.close();
    } catch {
      // The original write error is more useful.
    }
    throw error;
  }

  document.savedContent = document.content;
  await events.emit("file.saved", { name: document.name });
  showNotice(`'${document.name}' salvo.`);
}

async function installPluginFromUrl(url: string): Promise<void> {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) throw new Error("Informe a URL de um manifesto de plugin.");
  const response = await fetch(normalizedUrl, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Manifest request failed with status ${response.status}.`);
  const installed = await plugins.install((await response.json()) as unknown);
  persistPlugins();
  showNotice(`Plugin '${installed.manifest.name}' instalado.`);
}

function renderWorkspaceEntries(): string {
  if (!state.workspaceName) {
    return `<div class="empty-state"><p>Nenhum diretório aberto.</p><button class="primary-button" data-command="workspace.open">Abrir diretório</button></div>`;
  }

  const entries = state.workspaceEntries
    .map((entry) => {
      const active = state.activeDocument?.name === entry.name ? " is-active" : "";
      const command = entry.kind === "file" ? 'data-command="file.open"' : "disabled";
      return `<button class="tree-entry${active}" type="button" ${command} data-file-name="${escapeHtml(entry.name)}"><span class="tree-entry__icon">${entry.kind === "directory" ? "D" : "F"}</span><span>${escapeHtml(entry.name)}</span></button>`;
    })
    .join("");

  return `<div class="workspace-title">${escapeHtml(state.workspaceName)}</div><div class="tree">${entries || '<p class="muted">Diretório vazio.</p>'}</div>`;
}

function pluginActions(plugin: PluginRecord): string {
  const action = plugin.state === "enabled" ? "plugin.disable" : "plugin.enable";
  const label = plugin.state === "enabled" ? "Desabilitar" : "Habilitar";
  return `<div class="plugin-actions"><button data-command="${action}" data-plugin-id="${escapeHtml(plugin.manifest.id)}">${label}</button><button data-command="plugin.uninstall" data-plugin-id="${escapeHtml(plugin.manifest.id)}">Remover</button></div>`;
}

function renderPlugins(): string {
  const cards = plugins
    .list()
    .map(
      (plugin) => `<article class="plugin-card"><div class="plugin-card__heading"><strong>${escapeHtml(plugin.manifest.name)}</strong><span class="state-badge">${escapeHtml(plugin.state)}</span></div><p>${escapeHtml(plugin.manifest.description ?? "Sem descrição.")}</p><small>${escapeHtml(plugin.manifest.id)} · ${escapeHtml(plugin.manifest.version)}</small>${pluginActions(plugin)}</article>`,
    )
    .join("");

  return `<form class="plugin-install" data-form="plugin-install"><label for="plugin-url">Manifesto remoto</label><div class="input-row"><input id="plugin-url" name="url" type="url" placeholder="https://registry.example/plugin.json" required /><button class="primary-button" type="submit">Instalar</button></div><p class="hint">O protótipo instala e valida metadados externos.</p></form><div class="plugin-list">${cards || '<div class="empty-state"><p>Nenhum plugin instalado.</p></div>'}</div>`;
}

function renderSidebar(): string {
  const title = state.sidebarView === "explorer" ? "EXPLORER" : "PLUGINS";
  const content = state.sidebarView === "explorer" ? renderWorkspaceEntries() : renderPlugins();
  return `<aside class="sidebar ${state.sidebarVisible ? "" : "is-hidden"}"><header class="sidebar__header">${title}</header><div class="sidebar__content">${content}</div></aside>`;
}

function renderWelcome(): string {
  return `<article class="editor welcome-editor"><div class="editor__gutter" aria-hidden="true">1<br />2<br />3<br />4<br />5<br />6<br />7<br />8</div><div class="editor__content"><span class="token-heading"># tinyIde</span><br /><br />Abra um diretório, selecione um arquivo de texto, edite e salve com Ctrl+S.<br /><br /><span class="token-heading">## Fluxo funcional</span><br /><br />- File System Access API<br />- edição de conteúdo<br />- detecção de alterações<br />- gravação no arquivo original<br /><br /><span class="token-comment">Python e Django continuam externos ao core.</span></div></article>`;
}

function renderEditor(): string {
  const document = state.activeDocument;
  if (!document) return renderWelcome();
  const dirty = document.content !== document.savedContent;
  return `<div class="code-editor"><div class="editor-toolbar"><span>${dirty ? "● " : ""}${escapeHtml(document.name)}</span><button class="primary-button" data-command="file.save" ${dirty ? "" : "disabled"}>Salvar</button></div><textarea class="code-input" data-editor spellcheck="false" aria-label="Editor de ${escapeHtml(document.name)}">${escapeHtml(document.content)}</textarea></div>`;
}

function renderNotice(): string {
  if (!state.notice && !state.error) return "";
  const type = state.error ? "error" : "notice";
  return `<div class="toast toast--${type}">${escapeHtml(state.error ?? state.notice ?? "")}</div>`;
}

function render(): void {
  const document = state.activeDocument;
  const dirty = document ? document.content !== document.savedContent : false;
  appRoot.innerHTML = `<div class="ide-shell"><header class="titlebar"><div class="brand">tinyIde</div><nav class="menu" aria-label="Menu principal"><button data-command="workspace.open">Arquivo</button><button data-command="file.save">Salvar</button><button data-command="panel.toggle">Painel</button></nav><div class="titlebar__center">${escapeHtml(state.workspaceName ?? "Sem workspace")}</div><div class="version">v${PLATFORM_VERSION}</div></header><main class="workbench ${state.sidebarVisible ? "" : "workbench--sidebar-hidden"}"><nav class="activitybar" aria-label="Atividades"><button class="activity-button ${state.sidebarView === "explorer" ? "is-active" : ""}" data-command="view.explorer" title="Explorer">EX</button><button class="activity-button ${state.sidebarView === "plugins" ? "is-active" : ""}" data-command="view.plugins" title="Plugins">PL</button><div class="activitybar__spacer"></div><button class="activity-button" data-command="panel.toggle" title="Painel">PN</button></nav>${renderSidebar()}<section class="editor-area"><div class="editor-tabs"><button class="editor-tab is-active"><span>TXT</span>${escapeHtml(document?.name ?? "welcome.md")}${dirty ? " ●" : ""}</button></div>${renderEditor()}<section class="bottom-panel ${state.panelVisible ? "" : "is-hidden"}"><header class="panel-tabs"><button class="is-active">SAÍDA</button><button>PROBLEMAS <span class="counter">0</span></button></header><pre class="output">${state.logs.map(escapeHtml).join("\n")}</pre></section></section></main><footer class="statusbar"><button data-command="workspace.open">${escapeHtml(state.workspaceName ?? "Abrir workspace")}</button><span>${plugins.list().length} plugin(s)</span><span class="statusbar__spacer"></span><span>${dirty ? "Alterações não salvas" : "Salvo"}</span><span>UTF-8</span><span>Texto</span></footer>${renderNotice()}</div>`;
  bindInteractions();
}

function bindInteractions(): void {
  appRoot.querySelectorAll<HTMLElement>("[data-command]").forEach((element) => {
    element.addEventListener("click", () => {
      const command = element.dataset.command;
      if (!command) return;
      const argument = element.dataset.pluginId ?? element.dataset.fileName;
      void commands.execute(command, argument).catch(showError);
    });
  });

  appRoot.querySelector<HTMLTextAreaElement>("[data-editor]")?.addEventListener("input", (event) => {
    if (!state.activeDocument) return;
    state.activeDocument.content = (event.currentTarget as HTMLTextAreaElement).value;
    const dirty = state.activeDocument.content !== state.activeDocument.savedContent;
    appRoot.querySelector(".statusbar span:nth-last-child(3)")!.textContent = dirty ? "Alterações não salvas" : "Salvo";
    const tab = appRoot.querySelector<HTMLElement>(".editor-tab");
    if (tab) tab.innerHTML = `<span>TXT</span>${escapeHtml(state.activeDocument.name)}${dirty ? " ●" : ""}`;
    const saveButton = appRoot.querySelector<HTMLButtonElement>(".editor-toolbar [data-command='file.save']");
    if (saveButton) saveButton.disabled = !dirty;
  });

  appRoot.querySelector<HTMLFormElement>('[data-form="plugin-install"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = new FormData(event.currentTarget as HTMLFormElement).get("url");
    void commands.execute("plugin.installFromUrl", url).catch(showError);
  });
}

commands.register("workspace.open", openWorkspace);
commands.register("file.open", openFile);
commands.register("file.save", saveFile);
commands.register("view.explorer", () => {
  state.sidebarView = "explorer";
  state.sidebarVisible = true;
  render();
});
commands.register("view.plugins", () => {
  state.sidebarView = "plugins";
  state.sidebarVisible = true;
  render();
});
commands.register("sidebar.toggle", () => {
  state.sidebarVisible = !state.sidebarVisible;
  render();
});
commands.register("panel.toggle", () => {
  state.panelVisible = !state.panelVisible;
  render();
});
commands.register("plugin.installFromUrl", async (rawUrl: unknown) => {
  if (typeof rawUrl !== "string") throw new Error("Plugin URL must be a string.");
  await installPluginFromUrl(rawUrl);
});
commands.register("plugin.enable", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const plugin = await plugins.enable(rawId);
  persistPlugins();
  showNotice(`Plugin '${plugin.manifest.name}' habilitado.`);
});
commands.register("plugin.disable", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const plugin = await plugins.disable(rawId);
  persistPlugins();
  showNotice(`Plugin '${plugin.manifest.name}' desabilitado.`);
});
commands.register("plugin.uninstall", async (rawId: unknown) => {
  if (typeof rawId !== "string") throw new Error("Plugin id must be a string.");
  const pluginName = plugins.get(rawId)?.manifest.name ?? rawId;
  await plugins.uninstall(rawId);
  persistPlugins();
  showNotice(`Plugin '${pluginName}' removido.`);
});

events.on<{ name: string }>("workspace.opened", ({ name }) => log(`workspace.opened: ${name}`));
events.on<{ name: string }>("file.saved", ({ name }) => log(`file.saved: ${name}`));
events.on<PluginRecord>("plugin.installed", (plugin) => log(`plugin.installed: ${plugin.manifest.id}@${plugin.manifest.version}`));
events.on<PluginRecord>("plugin.enabled", (plugin) => log(`plugin.enabled: ${plugin.manifest.id}`));
events.on<PluginRecord>("plugin.disabled", (plugin) => log(`plugin.disabled: ${plugin.manifest.id}`));
events.on<PluginRecord>("plugin.uninstalled", (plugin) => log(`plugin.uninstalled: ${plugin.manifest.id}`));

capabilities.register("core.commands", commands);
capabilities.register("core.events", events);
capabilities.register("core.plugins", plugins);

window.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void commands.execute("file.save").catch(showError);
  }
  if (event.ctrlKey && event.key.toLowerCase() === "b") {
    event.preventDefault();
    void commands.execute("sidebar.toggle");
  }
  if (event.ctrlKey && event.key.toLowerCase() === "j") {
    event.preventDefault();
    void commands.execute("panel.toggle");
  }
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
