import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "./command-registry";

describe("CommandRegistry", () => {
  it("registers and executes a command", async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn((value: number) => value * 2);

    registry.register("sample.double", handler);

    await expect(registry.execute("sample.double", 4)).resolves.toBe(8);
    expect(handler).toHaveBeenCalledWith(4);
  });

  it("rejects duplicate commands", () => {
    const registry = new CommandRegistry();
    registry.register("sample.command", () => undefined);

    expect(() => registry.register("sample.command", () => undefined)).toThrow(
      "Command already registered",
    );
  });

  it("removes a command through its disposable", async () => {
    const registry = new CommandRegistry();
    const registration = registry.register("sample.command", () => undefined);

    registration.dispose();

    await expect(registry.execute("sample.command")).rejects.toThrow("Unknown command");
  });

  it("normalizes ids, lists commands and ignores repeated disposal", () => {
    const registry = new CommandRegistry();
    const disposable = registry.register(" sample.z ", () => undefined);
    registry.register("sample.a", () => undefined);

    expect(registry.has("sample.z")).toBe(true);
    expect(registry.list()).toEqual(["sample.a", "sample.z"]);
    disposable.dispose();
    disposable.dispose();
    expect(registry.has("sample.z")).toBe(false);
  });

  it("rejects empty command ids", () => {
    const registry = new CommandRegistry();
    expect(() => registry.register("  ", () => undefined)).toThrow("Command id cannot be empty.");
  });
});
