import { describe, expect, it, vi } from "vitest";
import type {
  BrowserDirectoryHandle,
  BrowserFileHandle,
} from "../browser-filesystem";
import {
  workspaceRootFromFilePath,
  workspaceRootHintForHandle,
} from "./workspace-host";

function fileHandle(name: string): BrowserFileHandle {
  return {
    kind: "file",
    name,
    getFile: async () => ({ name } as File),
    createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
  };
}

function directoryHandle(
  name: string,
  children: readonly (BrowserFileHandle | BrowserDirectoryHandle)[],
): BrowserDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *values() { yield* children; },
    getFileHandle: async (childName) => {
      const child = children.find((entry): entry is BrowserFileHandle => entry.kind === "file" && entry.name === childName);
      if (!child) throw new Error(`missing file: ${childName}`);
      return child;
    },
    getDirectoryHandle: async (childName) => {
      const child = children.find((entry): entry is BrowserDirectoryHandle => entry.kind === "directory" && entry.name === childName);
      if (!child) throw new Error(`missing directory: ${childName}`);
      return child;
    },
  };
}

describe("workspaceRootFromFilePath", () => {
  it("deriva a raiz Linux a partir do caminho de um arquivo interno", () => {
    expect(workspaceRootFromFilePath("/mnt/projects/preco/src/main.ts", ["src", "main.ts"]))
      .toBe("/mnt/projects/preco");
  });

  it("deriva a raiz Windows a partir do caminho de um arquivo interno", () => {
    expect(workspaceRootFromFilePath("C:\\projects\\preco\\src\\main.ts", ["src", "main.ts"]))
      .toBe("C:\\projects\\preco");
  });
});

describe("workspaceRootHintForHandle", () => {
  it("usa o caminho real exposto pelo host desktop", async () => {
    const file = fileHandle("package.json");
    const handle = directoryHandle("preco", [file]);
    const desktop = {
      getPathForFile: vi.fn(() => "/mnt/projects/preco/package.json"),
    };

    await expect(workspaceRootHintForHandle(handle, desktop)).resolves.toBe("/mnt/projects/preco");
  });

  it("mantém o fallback por nome no navegador comum", async () => {
    const handle = directoryHandle("preco", [fileHandle("package.json")]);
    await expect(workspaceRootHintForHandle(handle, undefined)).resolves.toBeUndefined();
  });
});
