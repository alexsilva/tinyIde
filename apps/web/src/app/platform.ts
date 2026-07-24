import {
  CapabilityRegistry,
  CommandRegistry,
  EventBus,
  PluginManager,
} from "@tinyide/core";
import type {
  ExecutionEnvironmentProvider,
  ExecutionProfileContributionProvider,
  InteractiveSessionHookProvider,
  InteractiveSessionProvider,
  LanguageProvider,
  PluginContext,
  PluginBackendRequestOptions,
  PluginBackendApi,
  PluginManifest,
  PluginRecord,
  PluginSettingsProvider,
  ResourceContextMenuProvider,
  ResourceDecorationProvider,
  ResourceIconProvider,
  ScriptExecutionContribution,
  TextEditorLineDecorationProvider,
  WorkbenchApi,
  WorkbenchDialogContribution,
  WorkbenchTextEditorReplaceContentRequest,
  WorkbenchTextEditorSaveRequest,
  WorkbenchTextHighlightRequest,
  WorkbenchTextHighlightResult,
  WorkbenchPanelHook,
  WorkbenchResourceEditorProvider,
  WorkbenchSidebarHook,
  WorkbenchTitlebarContribution,
  WorkbenchToolWindowHook,
  Disposable,
} from "@tinyide/plugin-api";
import { AppPluginHost } from "./plugin-host";

const PLATFORM_VERSION = "0.4.0";
const STORAGE_KEY = "tinyide.react.plugins.v1";

interface StoredPlugin {
  readonly manifest: PluginManifest;
  readonly manifestUrl: string;
  readonly sourceUrl: string;
  readonly enabled: boolean;
}

export interface PluginCatalogEntry {
  readonly manifest: PluginManifest;
  readonly manifestUrl: string;
}

export interface PlatformSnapshot {
  readonly initialized: boolean;
  readonly catalogLoading: boolean;
  readonly plugins: readonly PluginRecord[];
  readonly catalog: readonly PluginCatalogEntry[];
}

type SnapshotListener = () => void;

interface WorkbenchBinding {
  openSidebar(id: string): void;
  openToolWindow(id: string): void;
  openDialog(dialog: WorkbenchDialogContribution): Disposable;
  replaceEditorContent(request: WorkbenchTextEditorReplaceContentRequest): Promise<void>;
  saveEditorDocument(request: WorkbenchTextEditorSaveRequest): Promise<void>;
  highlightText(request: WorkbenchTextHighlightRequest): WorkbenchTextHighlightResult;
}

class AppWorkbenchApi implements WorkbenchApi {
  #binding: WorkbenchBinding | undefined;

  readonly dialogs = {
    open: (dialog: WorkbenchDialogContribution): Disposable => {
      if (!this.#binding) throw new Error("O workbench ainda não está disponível.");
      return this.#binding.openDialog(dialog);
    },
  };

  readonly editor = {
    replaceContent: async (request: WorkbenchTextEditorReplaceContentRequest): Promise<void> => {
      if (!this.#binding) throw new Error("O workbench ainda não está disponível.");
      await this.#binding.replaceEditorContent(request);
    },
    save: async (request: WorkbenchTextEditorSaveRequest): Promise<void> => {
      if (!this.#binding) throw new Error("O workbench ainda não está disponível.");
      await this.#binding.saveEditorDocument(request);
    },
  };

  readonly text = {
    highlight: (request: WorkbenchTextHighlightRequest): WorkbenchTextHighlightResult => {
      if (!this.#binding) throw new Error("O workbench ainda não está disponível.");
      return this.#binding.highlightText(request);
    },
  };

  bind(binding: WorkbenchBinding): Disposable {
    this.#binding = binding;
    return {
      dispose: () => {
        if (this.#binding === binding) this.#binding = undefined;
      },
    };
  }

  openToolWindow(id: string): void {
    if (!this.#binding) throw new Error("O workbench ainda não está disponível.");
    this.#binding.openToolWindow(id);
  }

  openSidebar(id: string): void {
    if (!this.#binding) throw new Error("O workbench ainda não está disponível.");
    this.#binding.openSidebar(id);
  }
}

function pluginSourceUrl(manifest: PluginManifest, manifestUrl: string): string {
  const frontend = manifest.entrypoints?.frontend;
  if (!frontend) throw new Error(`Plugin '${manifest.name}' não possui entrypoint de frontend.`);
  const sourceUrl = new URL(frontend, manifestUrl);
  sourceUrl.searchParams.set("tinyide-plugin-version", manifest.version);
  return sourceUrl.href;
}

function pluginBackend(pluginId: string): PluginBackendApi {
  return {
    async request<Response>(path: string, options: PluginBackendRequestOptions = {}): Promise<Response> {
      const suffix = path.startsWith("/") ? path : `/${path}`;
      const pathname = suffix.split(/[?#]/, 1)[0] ?? "";
      if (suffix.startsWith("//") || pathname.split("/").includes("..")) {
        throw new Error("O caminho do backend do plugin deve ser relativo ao próprio plugin.");
      }
      const response = await fetch(`/plugin-api/${encodeURIComponent(pluginId)}${suffix}`, {
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers ?? {}),
        },
      });
      const contentType = response.headers.get("Content-Type") ?? "";
      const payload = response.status === 204
        ? undefined
        : contentType.includes("application/json")
          ? await response.json().catch(() => undefined)
          : await response.text().catch(() => undefined);
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : `Backend do plugin indisponível: HTTP ${response.status}`;
        throw new Error(message);
      }
      return payload as Response;
    },
  };
}

function pluginContext(platform: TinyIdePlatform, pluginId: string): PluginContext {
  return {
    backend: pluginBackend(pluginId),
    commands: platform.commands,
    events: platform.events,
    workbench: platform.workbench,
    extensions: {
      registerLanguageProvider: (provider: LanguageProvider) => platform.capabilities.register("language.provider", provider),
      registerResourceIconProvider: (provider: ResourceIconProvider) => platform.capabilities.register("resource.icon", provider),
      registerResourceDecorationProvider: (provider: ResourceDecorationProvider) => platform.capabilities.register("resource.decoration", provider),
      registerExecutionEnvironmentProvider: (provider: ExecutionEnvironmentProvider) => platform.capabilities.register("execution.environment", provider),
      registerExecutionProfileContributionProvider: (provider: ExecutionProfileContributionProvider) => platform.capabilities.register("execution.profile.contribution", provider),
      registerScriptExecution: (contribution: ScriptExecutionContribution) => platform.capabilities.register("execution.script", contribution),
      registerResourceContextMenuProvider: (provider: ResourceContextMenuProvider) => platform.capabilities.register("resource.contextMenu", provider),
      registerInteractiveSessionHook: (provider: InteractiveSessionHookProvider) => platform.capabilities.register("interactive.session.hook", provider),
      registerInteractiveSessionProvider: (provider: InteractiveSessionProvider) => platform.capabilities.register("interactive.session", provider),
      getInteractiveSessionHooks: () => platform.capabilities.getAll<InteractiveSessionHookProvider>("interactive.session.hook"),
      registerPluginSettingsProvider: (provider: PluginSettingsProvider) => platform.capabilities.register("plugin.settings", provider),
      registerWorkbenchSidebarHook: (hook: WorkbenchSidebarHook) => platform.capabilities.register("workbench.sidebar.hook", hook),
      registerWorkbenchPanelHook: (hook: WorkbenchPanelHook) => platform.capabilities.register("workbench.panel.hook", hook),
      registerWorkbenchToolWindowHook: (hook: WorkbenchToolWindowHook) => platform.capabilities.register("workbench.toolWindow.hook", hook),
      registerWorkbenchTitlebarContribution: (contribution: WorkbenchTitlebarContribution) => platform.capabilities.register("workbench.titlebar", contribution),
      registerTextEditorLineDecorationProvider: (provider: TextEditorLineDecorationProvider) => platform.capabilities.register("textEditor.lineDecoration", provider),
      registerWorkbenchResourceEditorProvider: (provider: WorkbenchResourceEditorProvider) => platform.capabilities.register("workbench.resourceEditor", provider),
    },
    subscriptions: [],
  };
}

export class TinyIdePlatform {
  readonly commands = new CommandRegistry();
  readonly events = new EventBus();
  readonly capabilities = new CapabilityRegistry();
  readonly workbench = new AppWorkbenchApi();

  readonly #sourceUrls = new Map<string, string>();
  readonly #manifestUrls = new Map<string, string>();
  readonly #listeners = new Set<SnapshotListener>();
  readonly #host = new AppPluginHost({
    loadModule: (plugin) => {
      const sourceUrl = this.#sourceUrls.get(plugin.manifest.id);
      if (!sourceUrl) throw new Error(`Fonte do plugin não registrada: ${plugin.manifest.id}`);
      return import(/* @vite-ignore */ sourceUrl);
    },
  });
  readonly plugins = new PluginManager({
    platformVersion: PLATFORM_VERSION,
    events: this.events,
    host: this.#host,
  });

  #initialized = false;
  #initializationPromise: Promise<void> | undefined;
  #catalogLoading = false;
  #catalog: PluginCatalogEntry[] = [];

  constructor() {
    const notifyEvents = [
      "plugin.installed",
      "plugin.enabled",
      "plugin.disabled",
      "plugin.activated",
      "plugin.deactivated",
      "plugin.failed",
      "plugin.uninstalled",
    ];
    for (const event of notifyEvents) {
      this.events.on(event, () => this.#notify());
    }

    this.capabilities.register("core.commands", this.commands);
    this.capabilities.register("core.events", this.events);
    this.capabilities.register("core.plugins", this.plugins);
  }

  snapshot(): PlatformSnapshot {
    return {
      initialized: this.#initialized,
      catalogLoading: this.#catalogLoading,
      plugins: this.plugins.list(),
      catalog: [...this.#catalog],
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    if (this.#initializationPromise) return this.#initializationPromise;

    this.#initializationPromise = (async () => {
      await this.#restore();
      await this.discoverPlugins();
      this.#initialized = true;
      this.#notify();
    })();

    try {
      await this.#initializationPromise;
    } finally {
      this.#initializationPromise = undefined;
    }
  }

  async discoverPlugins(): Promise<void> {
    this.#catalogLoading = true;
    this.#notify();
    try {
      const response = await fetch("/dev-plugins/index.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Catálogo indisponível: HTTP ${response.status}`);
      const payload = (await response.json()) as { readonly plugins?: readonly { readonly manifestUrl?: unknown }[] };
      const manifestUrls = (payload.plugins ?? [])
        .map((entry) => entry.manifestUrl)
        .filter((value): value is string => typeof value === "string");

      const entries = await Promise.all(
        manifestUrls.map(async (manifestUrl): Promise<PluginCatalogEntry | undefined> => {
          const absoluteUrl = new URL(manifestUrl, window.location.href).href;
          const manifestResponse = await fetch(absoluteUrl, { cache: "no-store" });
          if (!manifestResponse.ok) return undefined;
          return {
            manifest: (await manifestResponse.json()) as PluginManifest,
            manifestUrl: absoluteUrl,
          };
        }),
      );
      this.#catalog = entries.filter((entry): entry is PluginCatalogEntry => entry !== undefined);
    } finally {
      this.#catalogLoading = false;
      this.#notify();
    }
  }

  async install(manifestUrl: string): Promise<void> {
    const absoluteManifestUrl = new URL(manifestUrl, window.location.href).href;
    const response = await fetch(absoluteManifestUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Falha ao carregar manifesto: HTTP ${response.status}`);

    const manifest = (await response.json()) as PluginManifest;
    const sourceUrl = pluginSourceUrl(manifest, absoluteManifestUrl);
    await this.plugins.install(manifest);
    this.#sourceUrls.set(manifest.id, sourceUrl);
    this.#manifestUrls.set(manifest.id, absoluteManifestUrl);
    await this.plugins.enable(manifest.id);
    await this.plugins.activate(manifest.id, pluginContext(this, manifest.id));
    this.#persist();
    this.#notify();
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.plugins.enable(id);
      await this.plugins.activate(id, pluginContext(this, id));
    } else {
      await this.plugins.disable(id);
    }
    this.#persist();
    this.#notify();
  }

  async uninstall(id: string): Promise<void> {
    await this.plugins.uninstall(id);
    this.#sourceUrls.delete(id);
    this.#manifestUrls.delete(id);
    this.#persist();
    this.#notify();
  }

  async #restore(): Promise<void> {
    let stored: readonly StoredPlugin[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      stored = raw ? (JSON.parse(raw) as readonly StoredPlugin[]) : [];
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }

    for (const entry of stored) {
      try {
        let manifest = entry.manifest;
        let manifestUrl = entry.manifestUrl;
        let sourceUrl = entry.sourceUrl;
        try {
          const response = await fetch(manifestUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
          if (response.ok) {
            manifest = (await response.json()) as PluginManifest;
            sourceUrl = pluginSourceUrl(manifest, manifestUrl);
          }
        } catch {
          // Installed plugins remain restorable when their original source is temporarily unavailable.
        }
        await this.plugins.install(manifest);
        this.#sourceUrls.set(manifest.id, sourceUrl);
        this.#manifestUrls.set(manifest.id, manifestUrl);
        if (entry.enabled) {
          await this.plugins.enable(manifest.id);
          await this.plugins.activate(manifest.id, pluginContext(this, manifest.id));
        }
      } catch (error) {
        console.warn(`Não foi possível restaurar o plugin ${entry.manifest.id}.`, error);
      }
    }
  }

  #persist(): void {
    const stored = this.plugins.list().flatMap((plugin): StoredPlugin[] => {
      const sourceUrl = this.#sourceUrls.get(plugin.manifest.id);
      const manifestUrl = this.#manifestUrls.get(plugin.manifest.id);
      if (!sourceUrl || !manifestUrl) return [];
      return [{
        manifest: plugin.manifest,
        sourceUrl,
        manifestUrl,
        enabled: plugin.state === "active" || plugin.state === "enabled",
      }];
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const platform = new TinyIdePlatform();
