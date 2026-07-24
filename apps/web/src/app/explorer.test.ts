import { describe, expect, it } from "vitest";
import type { BrowserFileHandle, OpenDocument, WorkspaceEntry } from "../browser-filesystem";
import {
  collapseDeepestExplorerLevel,
  expandNextExplorerLevel,
  explorerAncestorDirectoryPaths,
  explorerDropTargetDirectory,
  explorerTargetDirectoryPath,
  explorerDirectoryEmptyState,
  explorerCreationInsertionIndex,
  hiddenExplorerEntryCount,
  findWorkspaceEntry,
  flattenVisibleEntries,
  joinWorkspacePath,
  nearestRemainingItemId,
  nextExplorerHiddenVisibility,
  parentEntryPath,
  remapOpenDocumentResource,
  replaceWorkspacePathPrefix,
  workspacePathBelongsToResource,
  workspacePathName,
  workspacePathParent,
  workspacePathContainsHiddenSegment,
} from "./explorer";

const entries: readonly WorkspaceEntry[] = [
  {
    name: "src",
    path: "src",
    kind: "directory",
    children: [
      { name: ".cache", path: "src/.cache", kind: "directory" },
      { name: "main.py", path: "src/main.py", kind: "file" },
    ],
  },
  { name: "README.md", path: "README.md", kind: "file" },
];

describe("explorer model", () => {
  it("uses free space as root and files as their parent drop target", () => {
    expect(explorerDropTargetDirectory(undefined, undefined)).toBe("");
    expect(explorerDropTargetDirectory(undefined, undefined, "src")).toBe("src");
    expect(explorerDropTargetDirectory("README.md", "file")).toBe("");
    expect(explorerDropTargetDirectory("src/main.ts", "file")).toBe("src");
    expect(explorerDropTargetDirectory("src/components", "directory")).toBe("src/components");
  });

  it("resolves entries and contextual target directories", () => {
    expect(findWorkspaceEntry(entries, "src/main.py")?.name).toBe("main.py");
    expect(explorerTargetDirectoryPath(entries, "src")).toBe("src");
    expect(explorerTargetDirectoryPath(entries, "src/main.py")).toBe("src");
    expect(explorerTargetDirectoryPath(entries, undefined)).toBe("");
  });

  it("flattens only visible expanded entries", () => {
    expect(flattenVisibleEntries(entries, new Set(["src"]), false).map((entry) => entry.path)).toEqual([
      "src",
      "src/main.py",
      "README.md",
    ]);
    expect(flattenVisibleEntries(entries, new Set(), true).map((entry) => entry.path)).toEqual([
      "src",
      "README.md",
    ]);
  });

  it("distinguishes empty directories from directories containing only hidden items", () => {
    expect(explorerDirectoryEmptyState([], false)).toBe("empty");
    expect(explorerDirectoryEmptyState(undefined, false)).toBe("empty");
    expect(explorerDirectoryEmptyState([{ name: ".cache", path: ".cache", kind: "directory" }], false)).toBe("hidden-only");
    expect(explorerDirectoryEmptyState([{ name: ".cache", path: ".cache", kind: "directory" }], true)).toBeUndefined();
    expect(explorerDirectoryEmptyState([{ name: "main.py", path: "main.py", kind: "file" }], false)).toBeUndefined();
    expect(hiddenExplorerEntryCount([
      { name: ".cache", path: ".cache", kind: "directory" },
      { name: ".meta", path: ".meta", kind: "file" },
      { name: "main.py", path: "main.py", kind: "file" },
    ])).toBe(2);
  });

  it("positions virtual creations using the same directory-first ordering as real entries", () => {
    const ordered: readonly WorkspaceEntry[] = [
      { name: "backend", path: "backend", kind: "directory" },
      { name: "docs", path: "docs", kind: "directory" },
      { name: "app.ts", path: "app.ts", kind: "file" },
      { name: "README.md", path: "README.md", kind: "file" },
    ];

    expect(explorerCreationInsertionIndex(ordered, "file", "")).toBe(2);
    expect(explorerCreationInsertionIndex(ordered, "file", "main.ts")).toBe(3);
    expect(explorerCreationInsertionIndex(ordered, "directory", "api")).toBe(0);
    expect(explorerCreationInsertionIndex(ordered, "directory", "frontend")).toBe(2);
  });

  it("hides globally visible and locally revealed hidden entries together", () => {
    const locallyRevealed = new Set(["src", "tests"]);

    expect(nextExplorerHiddenVisibility(false, new Set())).toEqual({
      showHidden: true,
      revealedHiddenPaths: new Set(),
    });
    expect(nextExplorerHiddenVisibility(true, locallyRevealed)).toEqual({
      showHidden: false,
      revealedHiddenPaths: new Set(),
    });
    expect(nextExplorerHiddenVisibility(false, locallyRevealed)).toEqual({
      showHidden: false,
      revealedHiddenPaths: new Set(),
    });
  });

  it("manipulates workspace paths consistently", () => {
    expect(workspacePathParent("src/lib/main.py")).toBe("src/lib");
    expect(workspacePathName("src/lib/main.py")).toBe("main.py");
    expect(joinWorkspacePath("src/lib", "main.py")).toBe("src/lib/main.py");
    expect(joinWorkspacePath("", "main.py")).toBe("main.py");
    expect(parentEntryPath("src/main.py")).toBe("src");
    expect(parentEntryPath("README.md")).toBeUndefined();
    expect(replaceWorkspacePathPrefix("src/lib/main.py", "src", "source")).toBe("source/lib/main.py");
    expect(replaceWorkspacePathPrefix("tests/main.py", "src", "source")).toBe("tests/main.py");
    expect(explorerAncestorDirectoryPaths("src/lib/main.py")).toEqual(["src", "src/lib"]);
    expect(explorerAncestorDirectoryPaths("README.md")).toEqual([]);
    expect(workspacePathContainsHiddenSegment("src/.cache/data.json")).toBe(true);
    expect(workspacePathContainsHiddenSegment("src/main.py")).toBe(false);
  });

  it("remaps open document identities after file and directory moves", () => {
    const handle = { kind: "file", name: "main.py" } as BrowserFileHandle;
    const nextHandle = { kind: "file", name: "app.py" } as BrowserFileHandle;
    const document = {
      id: "src/lib/main.py",
      name: "main.py",
      path: "src/lib/main.py",
      handle,
      kind: "text",
      mediaType: "text/x-python",
      size: 8,
      content: "print(1)",
      savedContent: "print(1)",
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      scrollLeft: 0,
    } satisfies OpenDocument;

    expect(workspacePathBelongsToResource(document.path, "src")).toBe(true);
    expect(workspacePathBelongsToResource(document.path, "tests")).toBe(false);
    expect(remapOpenDocumentResource(document, "src", "source", nextHandle)).toMatchObject({
      id: "source/lib/main.py",
      path: "source/lib/main.py",
      name: "main.py",
      handle: nextHandle,
    });
    expect(remapOpenDocumentResource(document, "src/lib/main.py", "src/lib/app.py", nextHandle)).toMatchObject({
      id: "src/lib/app.py",
      path: "src/lib/app.py",
      name: "app.py",
      handle: nextHandle,
    });
  });

  it("expands and collapses one tree level at a time", () => {
    expect([...expandNextExplorerLevel(entries, new Set(), false)]).toEqual(["src"]);
    expect([...expandNextExplorerLevel(entries, new Set(["src"]), false)]).toEqual(["src"]);
    expect([...expandNextExplorerLevel(entries, new Set(["src"]), true)]).toEqual(["src", "src/.cache"]);
    expect([...collapseDeepestExplorerLevel(new Set(["src", "src/.cache"]))]).toEqual(["src"]);
    expect([...collapseDeepestExplorerLevel(new Set(["src"]))]).toEqual([]);
    expect(collapseDeepestExplorerLevel(new Set())).toEqual(new Set());
  });

  it("selects the nearest remaining tab after explorer deletion", () => {
    const ordered = ["a.py", "b.py", "c.py", "d.py"];
    expect(nearestRemainingItemId(ordered, new Set(["b.py"]), "b.py")).toBe("c.py");
    expect(nearestRemainingItemId(ordered, new Set(["b.py", "c.py"]), "b.py")).toBe("d.py");
    expect(nearestRemainingItemId(ordered, new Set(["c.py", "d.py"]), "d.py")).toBe("b.py");
    expect(nearestRemainingItemId(ordered, new Set(["a.py", "b.py", "c.py", "d.py"]), "c.py")).toBeUndefined();
    expect(nearestRemainingItemId(ordered, new Set(["b.py"]), "a.py")).toBe("a.py");
    expect(nearestRemainingItemId(ordered, new Set(["b.py"]), undefined)).toBeUndefined();
  });
});
