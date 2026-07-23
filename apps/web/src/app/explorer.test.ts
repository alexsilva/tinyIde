import { describe, expect, it } from "vitest";
import type { WorkspaceEntry } from "../browser-filesystem";
import {
  explorerTargetDirectoryPath,
  findWorkspaceEntry,
  flattenVisibleEntries,
  joinWorkspacePath,
  parentEntryPath,
  replaceWorkspacePathPrefix,
  workspacePathName,
  workspacePathParent,
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

  it("manipulates workspace paths consistently", () => {
    expect(workspacePathParent("src/lib/main.py")).toBe("src/lib");
    expect(workspacePathName("src/lib/main.py")).toBe("main.py");
    expect(joinWorkspacePath("src/lib", "main.py")).toBe("src/lib/main.py");
    expect(joinWorkspacePath("", "main.py")).toBe("main.py");
    expect(parentEntryPath("src/main.py")).toBe("src");
    expect(parentEntryPath("README.md")).toBeUndefined();
    expect(replaceWorkspacePathPrefix("src/lib/main.py", "src", "source")).toBe("source/lib/main.py");
    expect(replaceWorkspacePathPrefix("tests/main.py", "src", "source")).toBe("tests/main.py");
  });
});
