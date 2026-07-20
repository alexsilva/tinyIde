import { describe, expect, it } from "vitest";

import { EventBus } from "./event-bus";
import { PluginManager } from "./plugin-manager";

const manifest = {
  id: "example.theme",
  name: "Example Theme",
  version: "1.2.0",
  publisher: "example",
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
});
