import type { CapabilityRegistryApi, Disposable } from "@tinyide/plugin-api";

export class CapabilityRegistry implements CapabilityRegistryApi {
  readonly #providers = new Map<string, Set<unknown>>();

  register<Provider>(id: string, provider: Provider): Disposable {
    const capabilityId = id.trim();

    if (!capabilityId) {
      throw new Error("Capability id cannot be empty.");
    }

    const providers = this.#providers.get(capabilityId) ?? new Set<unknown>();
    providers.add(provider);
    this.#providers.set(capabilityId, providers);

    return {
      dispose: () => {
        providers.delete(provider);

        if (providers.size === 0) {
          this.#providers.delete(capabilityId);
        }
      },
    };
  }

  get<Provider>(id: string): Provider {
    const provider = this.tryGet<Provider>(id);

    if (provider === undefined) {
      throw new Error(`Capability not registered: ${id}`);
    }

    return provider;
  }

  tryGet<Provider>(id: string): Provider | undefined {
    return this.#providers.get(id)?.values().next().value as Provider | undefined;
  }

  getAll<Provider>(id: string): readonly Provider[] {
    return [...(this.#providers.get(id) ?? [])] as Provider[];
  }

  has(id: string): boolean {
    return (this.#providers.get(id)?.size ?? 0) > 0;
  }
}
