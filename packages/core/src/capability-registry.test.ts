import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "./capability-registry";

describe("CapabilityRegistry", () => {
  it("registers, retrieves and disposes providers", () => {
    const registry = new CapabilityRegistry();
    const first = { id: 1 };
    const second = { id: 2 };
    const firstDisposable = registry.register(" capability ", first);
    const secondDisposable = registry.register("capability", second);

    expect(registry.has("capability")).toBe(true);
    expect(registry.get("capability")).toBe(first);
    expect(registry.tryGet("capability")).toBe(first);
    expect(registry.getAll("capability")).toEqual([first, second]);

    firstDisposable.dispose();
    expect(registry.get("capability")).toBe(second);
    secondDisposable.dispose();
    expect(registry.has("capability")).toBe(false);
    expect(registry.tryGet("capability")).toBeUndefined();
    expect(registry.getAll("capability")).toEqual([]);
  });

  it("rejects empty ids and missing providers", () => {
    const registry = new CapabilityRegistry();
    expect(() => registry.register("   ", {})).toThrow("Capability id cannot be empty.");
    expect(() => registry.get("missing")).toThrow("Capability not registered: missing");
  });
});
