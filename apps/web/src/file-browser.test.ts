import { describe, expect, it, vi } from "vitest";
import { FileBrowserController, type FileBrowserListing, type FileBrowserOptions } from "./file-browser";

const listing: FileBrowserListing = {
  path: "/workspace",
  parentPath: "/",
  entries: [
    { name: "src", path: "/workspace/src", kind: "directory", action: "navigate", detail: "Pasta", icon: "folder" },
    { name: "main.py", path: "/workspace/main.py", kind: "file", action: "select", detail: "Arquivo", icon: "file" },
    { name: "disabled.py", path: "/workspace/disabled.py", kind: "file", action: "select", detail: "Arquivo", icon: "file", disabled: true },
  ],
};

function options(overrides: Partial<FileBrowserOptions> = {}): FileBrowserOptions {
  return {
    title: "Selecionar",
    description: "Descrição",
    confirmLabel: "Confirmar",
    selectionTitle: "Seleção",
    emptySelectionTitle: "Sem seleção",
    emptySelectionDescription: "Selecione um item",
    selectionIcon: "file",
    source: { load: vi.fn(async () => listing) },
    onConfirm: vi.fn(),
    allowHiddenToggle: true,
    ...overrides,
  };
}

describe("FileBrowserController", () => {
  it("returns an empty filtered snapshot before opening and ignores confirmation", async () => {
    const controller = new FileBrowserController(vi.fn());
    controller.setFilter("missing");
    expect(controller.snapshot().visibleEntries).toEqual([]);
    await controller.confirm();
  });

  it("opens, filters, selects and confirms", async () => {
    const onChange = vi.fn();
    const controller = new FileBrowserController(onChange);
    const config = options({ initialPath: "/workspace", includeHidden: true });
    await controller.open(config);
    expect(config.source.load).toHaveBeenCalledWith({ path: "/workspace", includeHidden: true });
    expect(controller.snapshot()).toMatchObject({ open: true, loading: false, includeHidden: true });

    controller.setFilter(" MAIN ");
    expect(controller.snapshot().visibleEntries.map((entry) => entry.name)).toEqual(["main.py"]);
    await controller.activate("/workspace/main.py");
    expect(controller.snapshot().selectedPath).toBe("/workspace/main.py");
    await controller.confirm();
    expect(config.onConfirm).toHaveBeenCalledWith("/workspace/main.py");
    expect(controller.snapshot().open).toBe(false);
  });

  it("navigates directories and ignores invalid or disabled entries", async () => {
    const source = { load: vi.fn(async ({ path }: { path?: string }) => ({ ...listing, path: path ?? "/workspace" })) };
    const controller = new FileBrowserController(vi.fn());
    await controller.navigate("/ignored");
    await controller.activate("missing");
    await controller.open(options({ source }));
    await controller.confirm();
    await controller.activate("/workspace/disabled.py");
    expect(controller.snapshot().selectedPath).toBeUndefined();
    await controller.activate("/workspace/src");
    expect(source.load).toHaveBeenLastCalledWith({ path: "/workspace/src", includeHidden: false });
  });

  it("toggles hidden files only when allowed", async () => {
    const source = { load: vi.fn(async () => listing) };
    const controller = new FileBrowserController(vi.fn());
    await controller.setIncludeHidden(true);
    await controller.open(options({ source, allowHiddenToggle: false }));
    await controller.setIncludeHidden(true);
    expect(source.load).toHaveBeenCalledTimes(1);
    controller.close();

    await controller.open(options({ source, allowHiddenToggle: true }));
    await controller.setIncludeHidden(true);
    expect(source.load).toHaveBeenLastCalledWith({ path: "/workspace", includeHidden: true });
  });

  it("discards stale loads", async () => {
    let resolveFirst!: (value: FileBrowserListing) => void;
    const first = new Promise<FileBrowserListing>((resolve) => { resolveFirst = resolve; });
    const source = { load: vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(listing) };
    const controller = new FileBrowserController(vi.fn());
    const opening = controller.open(options({ source }));
    const navigation = controller.navigate("/workspace");
    await navigation;
    resolveFirst({ ...listing, path: "/stale", entries: [] });
    await opening;
    expect(controller.snapshot().listing?.path).toBe("/workspace");
  });
});
