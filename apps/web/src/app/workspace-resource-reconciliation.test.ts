import { describe, expect, it } from "vitest";
import {
  readFileDocument,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type OpenDocument,
} from "../browser-filesystem";
import { reconcileOpenDocumentsAfterWorkspaceChange } from "./workspace-resource-reconciliation";

function fileHandle(name: string, content: BlobPart = "content", type = ""): BrowserFileHandle {
  return {
    kind: "file",
    name,
    getFile: async () => new File([content], name, {type}),
    createWritable: async () => ({write: async () => undefined, close: async () => undefined}),
  };
}

function directoryHandle(name: string, children: readonly (BrowserFileHandle | BrowserDirectoryHandle)[]): BrowserDirectoryHandle {
  const directories = new Map(children.filter((child): child is BrowserDirectoryHandle => child.kind === "directory").map((child) => [child.name, child]));
  const files = new Map(children.filter((child): child is BrowserFileHandle => child.kind === "file").map((child) => [child.name, child]));
  return {
    kind: "directory",
    name,
    async *values() { yield* children; },
    getFileHandle: async (childName) => {
      const child = files.get(childName);
      if (!child) throw new Error(`missing file: ${childName}`);
      return child;
    },
    getDirectoryHandle: async (childName) => {
      const child = directories.get(childName);
      if (!child) throw new Error(`missing directory: ${childName}`);
      return child;
    },
  };
}

async function openDocument(path: string, content: string): Promise<OpenDocument> {
  return readFileDocument(fileHandle(path.split("/").at(-1) ?? path, content), path, "/workspace");
}

describe("workspace resource reconciliation", () => {
  it("reloads clean documents and closes files removed by reset --hard", async () => {
    const changed = await openDocument("src/changed.py", "old\n");
    const removed = await openDocument("src/removed.py", "removed\n");
    const root = directoryHandle("root", [
      directoryHandle("src", [fileHandle("changed.py", "new\n")]),
    ]);

    const result = await reconcileOpenDocumentsAfterWorkspaceChange({
      documents: [changed, removed],
      workspaceHandle: root,
      workspaceRoot: "/workspace",
    });

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      id: "src/changed.py",
      content: "new\n",
      savedContent: "new\n",
    });
    expect(result.removedIds).toEqual(["src/removed.py"]);
  });

  it("remaps an open tab from an explicit Git rename", async () => {
    const document = await openDocument("src/old.py", "print('ok')\n");
    const root = directoryHandle("root", [
      directoryHandle("src", [fileHandle("new.py", "print('changed')\n")]),
    ]);

    const result = await reconcileOpenDocumentsAfterWorkspaceChange({
      documents: [document],
      workspaceHandle: root,
      workspaceRoot: "/workspace",
      renames: [{from: "src/old.py", to: "src/new.py"}],
    });

    expect(result.documents[0]).toMatchObject({
      id: "src/new.py",
      path: "src/new.py",
      name: "new.py",
      content: "print('changed')\n",
    });
    expect(result.remappedIds).toEqual([{from: "src/old.py", to: "src/new.py"}]);
    expect(result.removedIds).toEqual([]);
  });

  it("closes a missing tab when no explicit rename is supplied", async () => {
    const document = await openDocument("src/main.py", "print('same')\n");
    const root = directoryHandle("root", [
      directoryHandle("lib", [fileHandle("main.py", "print('same')\n")]),
    ]);

    const result = await reconcileOpenDocumentsAfterWorkspaceChange({
      documents: [document],
      workspaceHandle: root,
      workspaceRoot: "/workspace",
    });

    expect(result.documents).toEqual([]);
    expect(result.removedIds).toEqual(["src/main.py"]);
    expect(result.remappedIds).toEqual([]);
  });

  it("preserves unsaved editor content while updating the disk baseline", async () => {
    const original = await openDocument("src/main.py", "disk-old\n");
    const dirty: OpenDocument = {...original, content: "editor-unsaved\n"};
    const root = directoryHandle("root", [
      directoryHandle("src", [fileHandle("main.py", "disk-reset\n")]),
    ]);

    const result = await reconcileOpenDocumentsAfterWorkspaceChange({
      documents: [dirty],
      workspaceHandle: root,
      workspaceRoot: "/workspace",
    });

    expect(result.documents[0]).toMatchObject({
      content: "editor-unsaved\n",
      savedContent: "disk-reset\n",
    });
  });

});
