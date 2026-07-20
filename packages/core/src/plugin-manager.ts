import type {
  EventBusApi,
  PluginContext,
  PluginHost,
  PluginManifest,
  PluginRecord,
  PluginState,
} from "@tinyide/plugin-api";
import { validatePluginManifest } from "./plugin-manifest";
import { satisfiesVersion } from "./version";

export interface PluginManagerOptions {
  readonly platformVersion: string;
  readonly events: EventBusApi;
  readonly host?: PluginHost;
}

export class PluginManager {
  readonly #plugins = new Map<string, PluginRecord>();
  readonly #platformVersion: string;
  readonly #events: EventBusApi;
  readonly #host: PluginHost | undefined;

  constructor(options: PluginManagerOptions) {
    this.#platformVersion = options.platformVersion;
    this.#events = options.events;
    this.#host = options.host;
  }

  list(): readonly PluginRecord[] {
    return [...this.#plugins.values()].sort((left, right) =>
      left.manifest.name.localeCompare(right.manifest.name),
    );
  }

  get(id: string): PluginRecord | undefined {
    return this.#plugins.get(id);
  }

  async install(value: unknown): Promise<PluginRecord> {
    const manifest = validatePluginManifest(value);

    if (this.#plugins.has(manifest.id)) {
      throw new Error(`Plugin already installed: ${manifest.id}`);
    }

    if (!satisfiesVersion(manifest.engines.tinyide, this.#platformVersion)) {
      throw new Error(
        `Plugin ${manifest.id} requires tinyIde ${manifest.engines.tinyide}; current version is ${this.#platformVersion}.`,
      );
    }

    const record: PluginRecord = {
      manifest,
      state: "installed",
      installedAt: new Date().toISOString(),
    };

    this.#plugins.set(manifest.id, record);
    await this.#events.emit("plugin.installed", record);
    return record;
  }

  async enable(id: string): Promise<PluginRecord> {
    const current = this.#require(id);
    this.#assertDependencies(current.manifest);
    return this.#transition(current, "enabled", "plugin.enabled");
  }

  async disable(id: string): Promise<PluginRecord> {
    const current = this.#require(id);

    if (current.state === "active") {
      await this.deactivate(id);
    }

    return this.#transition(this.#require(id), "disabled", "plugin.disabled");
  }

  async activate(id: string, context: PluginContext): Promise<PluginRecord> {
    const current = this.#require(id);

    if (!this.#host) {
      throw new Error("No plugin host is configured.");
    }

    if (current.state !== "enabled") {
      throw new Error(`Plugin must be enabled before activation: ${id}`);
    }

    this.#assertDependencies(current.manifest);
    await this.#transition(current, "activating", "plugin.activating");

    try {
      await this.#host.activate(this.#require(id), context);
      return await this.#transition(this.#require(id), "active", "plugin.activated");
    } catch (error) {
      const failed = this.#withState(this.#require(id), "failed", (error as Error).message);
      this.#plugins.set(id, failed);
      await this.#events.emit("plugin.failed", failed);
      throw error;
    }
  }

  async deactivate(id: string): Promise<PluginRecord> {
    const current = this.#require(id);

    if (!this.#host) {
      throw new Error("No plugin host is configured.");
    }

    if (current.state !== "active") {
      return current;
    }

    await this.#transition(current, "deactivating", "plugin.deactivating");
    await this.#host.deactivate(this.#require(id));
    return this.#transition(this.#require(id), "enabled", "plugin.deactivated");
  }

  async uninstall(id: string): Promise<void> {
    const current = this.#require(id);

    if (current.state === "active") {
      await this.deactivate(id);
    }

    const uninstalled = this.#withState(this.#require(id), "uninstalled");
    this.#plugins.delete(id);
    await this.#events.emit("plugin.uninstalled", uninstalled);
  }

  async #transition(
    current: PluginRecord,
    state: PluginState,
    event: string,
  ): Promise<PluginRecord> {
    const updated = this.#withState(current, state);
    this.#plugins.set(current.manifest.id, updated);
    await this.#events.emit(event, updated);
    return updated;
  }

  #withState(current: PluginRecord, state: PluginState, error?: string): PluginRecord {
    return error === undefined
      ? { manifest: current.manifest, installedAt: current.installedAt, state }
      : { ...current, state, error };
  }

  #assertDependencies(manifest: PluginManifest): void {
    for (const [dependencyId, range] of Object.entries(manifest.dependencies ?? {})) {
      const dependency = this.#plugins.get(dependencyId);

      if (!dependency) {
        throw new Error(`Missing plugin dependency: ${dependencyId}`);
      }

      if (!satisfiesVersion(range, dependency.manifest.version)) {
        throw new Error(
          `Plugin dependency ${dependencyId} must satisfy ${range}; installed version is ${dependency.manifest.version}.`,
        );
      }
    }
  }

  #require(id: string): PluginRecord {
    const plugin = this.#plugins.get(id);

    if (!plugin) {
      throw new Error(`Plugin not installed: ${id}`);
    }

    return plugin;
  }
}
