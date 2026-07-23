import { describe, expect, it } from "vitest";
import { reconcileToolWindowLayout } from "./workbench-layout";

describe("workbench layout restoration", () => {
  it("does not discard persisted state before plugin restoration completes", () => {
    expect(reconcileToolWindowLayout({
      initialized: false,
      availableIds: [],
      current: { activeToolWindowId: "terminal", toolWindowVisible: false },
    })).toEqual({ activeToolWindowId: "terminal", toolWindowVisible: false });
  });

  it("selects an available tool window without reopening a closed region", () => {
    expect(reconcileToolWindowLayout({
      initialized: true,
      availableIds: ["terminal"],
      current: { activeToolWindowId: "removed", toolWindowVisible: false },
    })).toEqual({ activeToolWindowId: "terminal", toolWindowVisible: false });
  });

  it("preserves a valid visible tool window", () => {
    expect(reconcileToolWindowLayout({
      initialized: true,
      availableIds: ["terminal", "database"],
      current: { activeToolWindowId: "database", toolWindowVisible: true },
    })).toEqual({ activeToolWindowId: "database", toolWindowVisible: true });
  });

  it("closes the region when no tool windows remain", () => {
    expect(reconcileToolWindowLayout({
      initialized: true,
      availableIds: [],
      current: { activeToolWindowId: "terminal", toolWindowVisible: true },
    })).toEqual({ toolWindowVisible: false });
  });
});
