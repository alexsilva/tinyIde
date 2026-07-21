import { describe, expect, it, vi } from "vitest";
import { FileBrowserController, type FileBrowserEntry } from "./file-browser";

describe("FileBrowserController performance", () => {
  it("filters 100,000 entries within the interactive budget and reuses the result", async () => {
    const entries: FileBrowserEntry[] = Array.from({ length: 100_000 }, (_, index) => ({
      name: index % 10 === 0 ? `target-${index}.py` : `file-${index}.txt`,
      path: `/workspace/${index}`,
      kind: "file",
      action: "select",
      detail: "Arquivo",
      icon: "file",
    }));
    const controller = new FileBrowserController(vi.fn());
    await controller.open({
      title: "",
      description: "",
      confirmLabel: "",
      selectionTitle: "",
      emptySelectionTitle: "",
      emptySelectionDescription: "",
      selectionIcon: "file",
      source: { load: async () => ({ path: "/workspace", entries }) },
      onConfirm: () => undefined,
    });
    controller.setFilter("target");

    const firstStart = performance.now();
    const first = controller.snapshot().visibleEntries;
    const firstDuration = performance.now() - firstStart;
    const cachedStart = performance.now();
    const cached = controller.snapshot().visibleEntries;
    const cachedDuration = performance.now() - cachedStart;

    expect(first).toHaveLength(10_000);
    expect(cached).toBe(first);
    expect(firstDuration).toBeLessThan(100);
    expect(cachedDuration).toBeLessThan(5);
  });
});
