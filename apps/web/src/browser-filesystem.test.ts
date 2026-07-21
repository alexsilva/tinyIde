import { describe, expect, it, vi } from "vitest";
import {
  listDirectory,
  readFileDocument,
  resolveDirectoryHandle,
  resolveFileHandle,
  writeFileDocument,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type OpenDocument,
} from "./browser-filesystem";

function fileHandle(name: string, content = "content"): BrowserFileHandle {
  return {
    kind: "file",
    name,
    getFile: async () => new File([content], name),
    createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
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

describe("browser filesystem", () => {
  it("lists directories before files and sorts names", async () => {
    const alpha = directoryHandle("alpha", []);
    const zeta = directoryHandle("zeta", []);
    const aFile = fileHandle("a.py");
    const bFile = fileHandle("b.py");
    const entries = await listDirectory(directoryHandle("root", [bFile, zeta, aFile, alpha]), "src");
    expect(entries.map((entry) => [entry.kind, entry.name, entry.path])).toEqual([
      ["directory", "alpha", "src/alpha"],
      ["directory", "zeta", "src/zeta"],
      ["file", "a.py", "src/a.py"],
      ["file", "b.py", "src/b.py"],
    ]);
    expect((await listDirectory(directoryHandle("empty", [aFile])))[0]?.path).toBe("a.py");
  });

  it("reads files with and without a workspace path", async () => {
    const handle = fileHandle("main.py", "print('ok')");
    expect(await readFileDocument(handle, "src/main.py", "/workspace/project")).toMatchObject({
      id: "src/main.py",
      path: "src/main.py",
      workspaceRoot: "/workspace/project",
      name: "main.py",
      content: "print('ok')",
      savedContent: "print('ok')",
    });
    expect(await readFileDocument(handle)).toMatchObject({ id: "file:main.py", name: "main.py" });
  });

  it("resolves nested directory and file handles from the workspace root", async () => {
    const main = fileHandle("main.py");
    const source = directoryHandle("src", [main]);
    const packages = directoryHandle("packages", [source]);
    const root = directoryHandle("root", [packages]);
    expect(await resolveDirectoryHandle(root, "")).toBe(root);
    expect(await resolveDirectoryHandle(root, "/packages/src/")).toBe(source);
    expect(await resolveFileHandle(root, "packages/src/main.py")).toBe(main);
    await expect(resolveFileHandle(root, "")).rejects.toThrow("O caminho do arquivo está vazio.");
  });

  it("writes content, closes the stream and updates document metadata", async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const handle: BrowserFileHandle = {
      ...fileHandle("saved.py"),
      createWritable: async () => ({ write, close }),
    };
    const document: OpenDocument = {
      id: "draft",
      name: "draft.py",
      content: "print(1)",
      savedContent: "",
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      scrollLeft: 0,
    };
    const saved = await writeFileDocument(document, handle);
    expect(write).toHaveBeenCalledWith("print(1)");
    expect(close).toHaveBeenCalledOnce();
    expect(saved).toMatchObject({ id: "file:saved.py", name: "saved.py", savedContent: "print(1)" });
  });

  it("closes the stream even when writing fails", async () => {
    const close = vi.fn(async () => undefined);
    const handle: BrowserFileHandle = {
      ...fileHandle("failed.py"),
      createWritable: async () => ({ write: async () => { throw new Error("disk"); }, close }),
    };
    await expect(writeFileDocument({
      id: "src/failed.py",
      name: "failed.py",
      path: "src/failed.py",
      content: "x",
      savedContent: "",
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      scrollLeft: 0,
    }, handle)).rejects.toThrow("disk");
    expect(close).toHaveBeenCalledOnce();
  });
});
