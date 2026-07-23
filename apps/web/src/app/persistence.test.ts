import { describe, expect, it } from "vitest";
import {
  restoreWorkspaceDocuments,
  workspaceDocumentsForSnapshot,
} from "./persistence";
import type {
  BrowserDirectoryHandle,
  BrowserFileHandle,
  OpenDocument,
} from "../browser-filesystem";

function document(overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    id: "src/main.py",
    name: "main.py",
    path: "src/main.py",
    workspaceRoot: "/workspace/current",
    kind: "text",
    mediaType: "text/plain",
    size: 11,
    content: "print('ok')",
    savedContent: "print('ok')",
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
    ...overrides,
  };
}

function detachedDocument(id: string): OpenDocument {
  const { path: _path, workspaceRoot: _workspaceRoot, ...detached } = document({ id });
  return detached;
}

function legacyWorkspaceDocument(overrides: Partial<OpenDocument> = {}): OpenDocument {
  const { workspaceRoot: _workspaceRoot, ...legacy } = document(overrides);
  return legacy;
}

function fileHandle(name: string): BrowserFileHandle {
  return {
    kind: "file",
    name,
    async getFile() { return new File(["content"], name); },
    async createWritable() { throw new Error("unused"); },
  };
}

function directoryHandle(
  name: string,
  children: readonly (BrowserDirectoryHandle | BrowserFileHandle)[],
): BrowserDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *values() { yield* children; },
    async getFileHandle(childName) {
      const child = children.find((item) => item.kind === "file" && item.name === childName);
      if (!child || child.kind !== "file") throw new Error("missing file");
      return child;
    },
    async getDirectoryHandle(childName) {
      const child = children.find((item) => item.kind === "directory" && item.name === childName);
      if (!child || child.kind !== "directory") throw new Error("missing directory");
      return child;
    },
  };
}

describe("workspace document persistence", () => {
  it("persists only documents explicitly owned by the current workspace", () => {
    const current = document();
    const other = document({ id: "other.py", path: "other.py", workspaceRoot: "/workspace/other" });
    const external = detachedDocument("file:external.py");
    const untitled = detachedDocument("untitled:1");

    expect(workspaceDocumentsForSnapshot(
      [current, other, external, untitled],
      "/workspace/current",
    )).toEqual([current]);
    expect(workspaceDocumentsForSnapshot([current], undefined)).toEqual([]);
  });

  it("restores matching documents and resolves their handles from the workspace", async () => {
    const main = fileHandle("main.py");
    const source = directoryHandle("src", [main]);
    const root = directoryHandle("workspace", [source]);
    const restored = await restoreWorkspaceDocuments([
      document(),
      document({ id: "other.py", path: "other.py", workspaceRoot: "/workspace/other" }),
      document({ id: "missing.py", path: "missing.py" }),
      detachedDocument("external"),
    ], "/workspace/current", root);

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: "src/main.py",
      workspaceRoot: "/workspace/current",
      handle: main,
    });
  });

  it("does not restore legacy documents without a workspace handle", async () => {
    expect(await restoreWorkspaceDocuments([
      legacyWorkspaceDocument(),
      legacyWorkspaceDocument({ id: "owned.py", path: "owned.py" }),
    ], "/workspace/current")).toEqual([]);
  });
});
