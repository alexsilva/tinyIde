import { describe, expect, it, vi } from "vitest";
import type { PluginContext, PluginRecord } from "@tinyide/plugin-api";
import { ModulePluginHost } from "./module-plugin-host";

const plugin = (frontend?: string): PluginRecord => ({
  manifest: {
    id: "sample",
    name: "Sample",
    version: "1.0.0",
    publisher: "tinyide",
    category: "tool",
    engines: { tinyide: "*" },
    ...(frontend ? { entrypoints: { frontend } } : {}),
  },
  state: "enabled",
  installedAt: "2026-01-01T00:00:00.000Z",
});

const context = (): PluginContext => ({
  commands: {} as PluginContext["commands"],
  events: {} as PluginContext["events"],
  capabilities: {} as PluginContext["capabilities"],
  subscriptions: [],
});

describe("ModulePluginHost", () => {
  it("activates named exports and disposes subscriptions in reverse order", async () => {
    const order: string[] = [];
    const host = new ModulePluginHost({
      loadModule: async () => ({
        activate(this: { marker: string }, received: PluginContext) {
          order.push(this.marker, received === ctx ? "context" : "wrong");
        },
        deactivate(this: { marker: string }) {
          order.push(`deactivate:${this.marker}`);
        },
        marker: "named",
      }),
    });
    const ctx = context();
    ctx.subscriptions.push({ dispose: () => order.push("first") });
    ctx.subscriptions.push({ dispose: () => order.push("second") });

    await host.activate(plugin(), ctx);
    await host.deactivate(plugin());
    expect(order).toEqual(["named", "context", "deactivate:named", "second", "first"]);
    await host.deactivate(plugin());
  });

  it("accepts default exports without deactivate", async () => {
    const activate = vi.fn();
    const host = new ModulePluginHost({ loadModule: async () => ({ default: { activate } }) });
    await host.activate(plugin(), context());
    await host.deactivate(plugin());
    expect(activate).toHaveBeenCalledOnce();
  });

  it("rejects invalid modules", async () => {
    const host = new ModulePluginHost({ loadModule: async () => ({}) });
    await expect(host.activate(plugin(), context())).rejects.toThrow(
      "Plugin frontend entrypoint must export an activate(context) function.",
    );
  });

  it("rejects a missing frontend entrypoint with the default loader", async () => {
    const host = new ModulePluginHost();
    await expect(host.activate(plugin(), context())).rejects.toThrow(
      "Plugin does not declare a frontend entrypoint: sample",
    );
  });

  it("loads a declared frontend through the default dynamic importer", async () => {
    const host = new ModulePluginHost();
    const source = "data:text/javascript,export function activate(context){context.subscriptions.push({dispose(){}})}";
    const ctx = context();
    await host.activate(plugin(source), ctx);
    expect(ctx.subscriptions).toHaveLength(1);
    await host.deactivate(plugin(source));
  });
});
