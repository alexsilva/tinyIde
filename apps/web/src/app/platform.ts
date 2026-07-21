import {
  CapabilityRegistry,
  CommandRegistry,
  EventBus,
  ModulePluginHost,
  PluginManager,
} from "@tinyide/core";
import type { PluginManifest, PluginRecord } from "@tinyide/plugin-api";

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

function pluginContext(platform: TinyIdePlatform) {
  return {
    commands: platform.commands,
    events: platform.events,
    capabilities: platform.capabilities,
    subscriptions: [],
  };
}

export class TinyIdePlatform {
  readonly commands = new CommandRegistry();
  readonly events = new EventBus();
  readonly capabilities = new CapabilityRegistry();

  readonly #sourceUrls = new Map<string, string>();
  readonly #manifestUrls = new Map<string, string>();
  readonly #listeners = new Set<SnapshotListener>();
  readonly #host = new ModulePluginHost({
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
    const frontend = manifest.entrypoints?.frontend;
    if (!frontend) throw new Error(`Plugin '${manifest.name}' não possui entrypoint de frontend.`);

    const sourceUrl = new URL(frontend, absoluteManifestUrl).href;
    await this.plugins.install(manifest);
    this.#sourceUrls.set(manifest.id, sourceUrl);
    this.#manifestUrls.set(manifest.id, absoluteManifestUrl);
    await this.plugins.enable(manifest.id);
    await this.plugins.activate(manifest.id, pluginContext(this));
    this.#persist();
    this.#notify();
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.plugins.enable(id);
      await this.plugins.activate(id, pluginContext(this));
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
        await this.plugins.install(entry.manifest);
        this.#sourceUrls.set(entry.manifest.id, entry.sourceUrl);
        this.#manifestUrls.set(entry.manifest.id, entry.manifestUrl);
        if (entry.enabled) {
          await this.plugins.enable(entry.manifest.id);
          await this.plugins.activate(entry.manifest.id, pluginContext(this));
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
