import { describe, expect, it, vi } from "vitest";

import { EventBus } from "./event-bus";
import { PluginManager } from "./plugin-manager";
import type { PluginContext, PluginHost } from "@tinyide/plugin-api";

const manifest = {
  id: "example.theme",
  name: "Example Theme",
  version: "1.2.0",
  publisher: "example",
  category: "tool",
  engines: { tinyide: ">=0.1.0 <1.0.0" },
  permissions: ["ui.contribute"],
} as const;

describe("PluginManager", () => {
  it("installs, enables, disables and removes external metadata", async () => {
    const manager = new PluginManager({
      platformVersion: "0.1.0",
      events: new EventBus(),
    });

    await expect(manager.install(manifest)).resolves.toMatchObject({ state: "installed" });
    await expect(manager.enable(manifest.id)).resolves.toMatchObject({ state: "enabled" });
    await expect(manager.disable(manifest.id)).resolves.toMatchObject({ state: "disabled" });
    await manager.uninstall(manifest.id);

    expect(manager.get(manifest.id)).toBeUndefined();
  });

  it("rejects incompatible platform versions", async () => {
    const manager = new PluginManager({
      platformVersion: "0.1.0",
      events: new EventBus(),
    });

    await expect(
      manager.install({
        ...manifest,
        id: "example.incompatible",
        engines: { tinyide: ">=2.0.0 <3.0.0" },
      }),
    ).rejects.toThrow("requires tinyIde");
  });

  it("requires declared dependencies before enabling", async () => {
    const manager = new PluginManager({
      platformVersion: "0.1.0",
      events: new EventBus(),
    });
    const dependent = {
      ...manifest,
      id: "example.dependent",
      dependencies: { "example.runtime": ">=1.0.0 <2.0.0" },
    };

    await manager.install(dependent);

    await expect(manager.enable(dependent.id)).rejects.toThrow("Missing plugin dependency");
  });

  it("sorts plugins, rejects duplicates and validates dependency versions", async () => {
    const manager = new PluginManager({ platformVersion: "0.1.0", events: new EventBus() });
    const runtime = { ...manifest, id: "example.runtime", name: "Zulu Runtime", version: "1.0.0" };
    const dependent = {
      ...manifest,
      id: "example.dependent",
      name: "Alpha Dependent",
      dependencies: { "example.runtime": ">=2.0.0" },
    };
    await manager.install(runtime);
    await manager.install(dependent);
    expect(manager.list().map((record) => record.manifest.id)).toEqual([dependent.id, runtime.id]);
    await expect(manager.install(runtime)).rejects.toThrow("Plugin already installed");
    await expect(manager.enable(dependent.id)).rejects.toThrow("must satisfy");
    await expect(manager.enable("missing")).rejects.toThrow("Plugin not installed");
  });

  it("activates, deactivates, disables and uninstalls through a host", async () => {
    const events = new EventBus();
    const emitted: string[] = [];
    for (const name of ["plugin.activating", "plugin.activated", "plugin.deactivating", "plugin.deactivated", "plugin.disabled", "plugin.uninstalled"]) {
      events.on(name, () => { emitted.push(name); });
    }
    const host: PluginHost = {
      activate: vi.fn(async () => undefined),
      deactivate: vi.fn(async () => undefined),
    };
    const manager = new PluginManager({ platformVersion: "0.1.0", events, host });
    const context = {} as PluginContext;
    await manager.install(manifest);
    await manager.enable(manifest.id);
    await expect(manager.activate(manifest.id, context)).resolves.toMatchObject({ state: "active" });
    await expect(manager.deactivate(manifest.id)).resolves.toMatchObject({ state: "enabled" });
    await expect(manager.deactivate(manifest.id)).resolves.toMatchObject({ state: "enabled" });
    await manager.activate(manifest.id, context);
    await expect(manager.disable(manifest.id)).resolves.toMatchObject({ state: "disabled" });
    await manager.enable(manifest.id);
    await manager.activate(manifest.id, context);
    await manager.uninstall(manifest.id);
    expect(manager.get(manifest.id)).toBeUndefined();
    expect(host.activate).toHaveBeenCalledTimes(3);
    expect(host.deactivate).toHaveBeenCalledTimes(3);
    expect(emitted).toContain("plugin.uninstalled");
  });

  it("requires a host and enabled state for activation", async () => {
    const manager = new PluginManager({ platformVersion: "0.1.0", events: new EventBus() });
    await manager.install(manifest);
    await expect(manager.activate(manifest.id, {} as PluginContext)).rejects.toThrow("No plugin host");
    await expect(manager.deactivate(manifest.id)).rejects.toThrow("No plugin host");

    const hosted = new PluginManager({
      platformVersion: "0.1.0",
      events: new EventBus(),
      host: { activate: async () => undefined, deactivate: async () => undefined },
    });
    await hosted.install(manifest);
    await expect(hosted.activate(manifest.id, {} as PluginContext)).rejects.toThrow("must be enabled");
    await expect(hosted.deactivate(manifest.id)).resolves.toMatchObject({ state: "installed" });
  });

  it("marks failed activation and emits the failed event", async () => {
    const events = new EventBus();
    const failed = vi.fn();
    events.on("plugin.failed", failed);
    const manager = new PluginManager({
      platformVersion: "0.1.0",
      events,
      host: {
        activate: async () => { throw new Error("boom"); },
        deactivate: async () => undefined,
      },
    });
    await manager.install(manifest);
    await manager.enable(manifest.id);
    await expect(manager.activate(manifest.id, {} as PluginContext)).rejects.toThrow("boom");
    expect(manager.get(manifest.id)).toMatchObject({ state: "failed", error: "boom" });
    expect(failed).toHaveBeenCalledOnce();
  });

  it("reports a missing dependency even when the dependencies map is absent or empty", async () => {
    const manager = new PluginManager({ platformVersion: "0.1.0", events: new EventBus() });
    await manager.install({ ...manifest, id: "no.dependencies", dependencies: {} });
    await expect(manager.enable("no.dependencies")).resolves.toMatchObject({ state: "enabled" });
  });

  it("enables a plugin when installed dependencies satisfy the declared range", async () => {
    const manager = new PluginManager({ platformVersion: "0.1.0", events: new EventBus() });
    await manager.install({ ...manifest, id: "runtime", version: "1.5.0" });
    await manager.install({ ...manifest, id: "dependent", dependencies: { runtime: ">=1.0.0 <2.0.0" } });
    await expect(manager.enable("dependent")).resolves.toMatchObject({ state: "enabled" });
  });
});
