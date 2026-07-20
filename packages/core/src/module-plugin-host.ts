import type { PluginContext, PluginHost, PluginModule, PluginRecord } from "@tinyide/plugin-api";

type ImportedPluginModule = Partial<PluginModule> & {
  readonly default?: Partial<PluginModule>;
};

export interface ModulePluginHostOptions {
  readonly loadModule?: (plugin: PluginRecord) => Promise<unknown>;
}

function normalizeModule(imported: ImportedPluginModule): PluginModule {
  const candidate = imported.activate ? imported : imported.default;

  if (!candidate || typeof candidate.activate !== "function") {
    throw new Error("Plugin frontend entrypoint must export an activate(context) function.");
  }

  return {
    activate: candidate.activate.bind(candidate),
    ...(typeof candidate.deactivate === "function"
      ? { deactivate: candidate.deactivate.bind(candidate) }
      : {}),
  };
}

export class ModulePluginHost implements PluginHost {
  readonly #modules = new Map<
    string,
    { readonly module: PluginModule; readonly context: PluginContext }
  >();
  readonly #loadModule: (plugin: PluginRecord) => Promise<unknown>;

  constructor(options: ModulePluginHostOptions = {}) {
    this.#loadModule =
      options.loadModule ??
      ((plugin) => {
        const entrypoint = plugin.manifest.entrypoints?.frontend;
        if (!entrypoint) {
          throw new Error(`Plugin does not declare a frontend entrypoint: ${plugin.manifest.id}`);
        }
        return import(/* @vite-ignore */ entrypoint);
      });
  }

  async activate(plugin: PluginRecord, context: PluginContext): Promise<void> {
    const imported = (await this.#loadModule(plugin)) as ImportedPluginModule;
    const module = normalizeModule(imported);
    await module.activate(context);
    this.#modules.set(plugin.manifest.id, { module, context });
  }

  async deactivate(plugin: PluginRecord): Promise<void> {
    const active = this.#modules.get(plugin.manifest.id);

    if (!active) {
      return;
    }

    await active.module.deactivate?.();

    for (const subscription of [...active.context.subscriptions].reverse()) {
      subscription.dispose();
    }

    this.#modules.delete(plugin.manifest.id);
  }
}
