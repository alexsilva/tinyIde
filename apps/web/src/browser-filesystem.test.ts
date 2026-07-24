import { describe, expect, it, vi } from "vitest";
import {
  listDirectory,
  inspectBrowserFile,
  moveWorkspaceEntry,
  readFileDocument,
  renameWorkspaceEntry,
  removeWorkspaceEntry,
  resolveDirectoryHandle,
  resolveFileHandle,
  writeFileDocument,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type OpenDocument,
} from "./browser-filesystem";

function fileHandle(name: string, content: BlobPart = "content", type = ""): BrowserFileHandle {
  return {
    kind: "file",
    name,
    getFile: async () => new File([content], name, { type }),
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
      kind: "text",
      content: "print('ok')",
      savedContent: "print('ok')",
    });
    expect(await readFileDocument(handle)).toMatchObject({ id: "file:main.py", name: "main.py" });
  });

  it("classifies images and binary files without decoding them as editor text", async () => {
    const image = await readFileDocument(
      fileHandle("preview.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"),
      "assets/preview.png",
    );
    expect(image).toMatchObject({
      kind: "image",
      mediaType: "image/png",
      size: 8,
      content: "",
      savedContent: "",
    });

    const binary = await readFileDocument(
      fileHandle("payload.bin", new Uint8Array([1, 0, 2, 3, 255])),
      "fixtures/payload.bin",
    );
    expect(binary).toMatchObject({
      kind: "binary",
      mediaType: "application/octet-stream",
      size: 5,
      content: "",
      savedContent: "",
    });
  });

  it("classifies empty, extensionless, invalid UTF-8 and control-heavy files", async () => {
    await expect(inspectBrowserFile(new File([], "README"))).resolves.toEqual({
      kind: "text",
      mediaType: "application/octet-stream",
      size: 0,
    });
    await expect(inspectBrowserFile(new File([new Uint8Array([0xc3, 0x28])], "invalid")))
      .resolves.toMatchObject({ kind: "binary" });
    await expect(inspectBrowserFile(new File(["\u0001\u0002\u0003\t\n\f\r"], "controls.txt")))
      .resolves.toMatchObject({ kind: "binary" });
    await expect(inspectBrowserFile(new File(["\t\n\f\rregular text"], "allowed-controls.txt")))
      .resolves.toMatchObject({ kind: "text" });
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

  it("removes nested workspace entries and reports unsupported handles", async () => {
    const removeEntry = vi.fn(async () => undefined);
    const source: BrowserDirectoryHandle = {
      ...directoryHandle("src", []),
      removeEntry,
    };
    const root = directoryHandle("root", [source]);
    await removeWorkspaceEntry(root, "src/main.py");
    expect(removeEntry).toHaveBeenCalledWith("main.py", { recursive: false });
    await removeWorkspaceEntry(root, "src/generated", true);
    expect(removeEntry).toHaveBeenCalledWith("generated", { recursive: true });
    await expect(removeWorkspaceEntry(root, "")).rejects.toThrow("O caminho do recurso está vazio.");
    await expect(removeWorkspaceEntry(directoryHandle("unsupported", []), "file.txt"))
      .rejects.toThrow("Este navegador não oferece exclusão de arquivos pelo workspace.");
  });

  it("writes content, closes the stream and updates document metadata", async () => {
    const write = vi.fn(async (_data: string | Blob | BufferSource) => undefined);
    const close = vi.fn(async () => undefined);
    const handle: BrowserFileHandle = {
      ...fileHandle("saved.py"),
      createWritable: async () => ({ write, close }),
    };
    const document: OpenDocument = {
      id: "draft",
      name: "draft.py",
      kind: "text",
      mediaType: "text/plain",
      size: 0,
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

  it("refuses to write non-text resources through the text document writer", async () => {
    const handle = fileHandle("payload.bin", new Uint8Array([0, 1, 2]));
    await expect(writeFileDocument({
      id: "payload.bin",
      name: "payload.bin",
      kind: "binary",
      mediaType: "application/octet-stream",
      size: 3,
      content: "",
      savedContent: "",
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      scrollLeft: 0,
    }, handle)).rejects.toThrow("não é um documento de texto");
  });

  it("renames files by copying their bytes and removing the original entry", async () => {
    const source = fileHandle("old.txt", "payload");
    const write = vi.fn(async (_data: string | Blob | BufferSource) => undefined);
    const close = vi.fn(async () => undefined);
    const target: BrowserFileHandle = {
      ...fileHandle("new.txt"),
      createWritable: async () => ({ write, close }),
    };
    const removeEntry = vi.fn(async () => undefined);
    const root: BrowserDirectoryHandle = {
      kind: "directory",
      name: "root",
      async *values() { yield source; },
      async getFileHandle(name, options) {
        if (name === "old.txt") return source;
        if (name === "new.txt" && options?.create) return target;
        throw new Error("missing file");
      },
      async getDirectoryHandle() { throw new Error("missing directory"); },
      removeEntry,
    };

    expect(await renameWorkspaceEntry(root, "old.txt", "new.txt")).toBe("new.txt");
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toBeInstanceOf(ArrayBuffer);
    expect(close).toHaveBeenCalledOnce();
    expect(removeEntry).toHaveBeenCalledWith("old.txt", { recursive: false });
  });

  it("validates rename names before touching the workspace", async () => {
    const root = directoryHandle("root", []);
    await expect(renameWorkspaceEntry(root, "", "file.txt")).rejects.toThrow("O caminho do recurso está vazio.");
    await expect(renameWorkspaceEntry(root, "file.txt", "")).rejects.toThrow("Informe um nome.");
    await expect(renameWorkspaceEntry(root, "file.txt", "nested/file.txt")).rejects.toThrow("Use apenas o nome");
    await expect(renameWorkspaceEntry(root, "file.txt", "file.txt")).resolves.toBe("file.txt");
    await expect(renameWorkspaceEntry(root, "file.txt", "renamed.txt"))
      .rejects.toThrow("Este navegador não oferece renomeação de arquivos pelo workspace.");
  });

  it("renames directories recursively before removing the original tree", async () => {
    const nestedFile = fileHandle("nested.py", "print(2)");
    const nestedDirectory = directoryHandle("lib", [nestedFile]);
    const sourceFile = fileHandle("main.py", "print(1)");
    const sourceDirectory = directoryHandle("src", [sourceFile, nestedDirectory]);
    const targetFiles = new Map<string, BrowserFileHandle>();
    const nestedTargetFiles = new Map<string, BrowserFileHandle>();
    const nestedTargetDirectory: BrowserDirectoryHandle = {
      kind: "directory",
      name: "lib",
      async *values() { yield* nestedTargetFiles.values(); },
      async getFileHandle(name, options) {
        const current = nestedTargetFiles.get(name);
        if (current) return current;
        if (!options?.create) throw new Error("missing file");
        const created = fileHandle(name);
        nestedTargetFiles.set(name, created);
        return created;
      },
      async getDirectoryHandle() { throw new Error("unused"); },
    };
    const targetDirectory: BrowserDirectoryHandle = {
      kind: "directory",
      name: "source",
      async *values() { yield* targetFiles.values(); },
      async getFileHandle(name, options) {
        const current = targetFiles.get(name);
        if (current) return current;
        if (!options?.create) throw new Error("missing file");
        const created = fileHandle(name);
        targetFiles.set(name, created);
        return created;
      },
      async getDirectoryHandle(name, options) {
        if (name === "lib" && options?.create) return nestedTargetDirectory;
        throw new Error("missing directory");
      },
    };
    const removeEntry = vi.fn(async () => undefined);
    const root: BrowserDirectoryHandle = {
      kind: "directory",
      name: "root",
      async *values() { yield sourceDirectory; },
      async getFileHandle() { throw new Error("not a file"); },
      async getDirectoryHandle(name, options) {
        if (name === "src") return sourceDirectory;
        if (name === "source" && options?.create) return targetDirectory;
        throw new Error("missing directory");
      },
      removeEntry,
    };

    expect(await renameWorkspaceEntry(root, "src", "source")).toBe("source");
    expect(targetFiles.has("main.py")).toBe(true);
    expect(nestedTargetFiles.has("nested.py")).toBe(true);
    expect(removeEntry).toHaveBeenCalledWith("src", { recursive: true });
  });

  it("returns nested renamed paths and closes copy streams after failures", async () => {
    const source = fileHandle("old.txt", "payload");
    const close = vi.fn(async () => undefined);
    const target: BrowserFileHandle = {
      ...fileHandle("new.txt"),
      createWritable: async () => ({
        write: async () => { throw new Error("copy failed"); },
        close,
      }),
    };
    const removeEntry = vi.fn(async () => undefined);
    const parent: BrowserDirectoryHandle = {
      kind: "directory",
      name: "src",
      async *values() { yield source; },
      async getFileHandle(name, options) {
        if (name === "old.txt") return source;
        if (name === "new.txt" && options?.create) return target;
        throw new Error("missing file");
      },
      async getDirectoryHandle() { throw new Error("missing directory"); },
      removeEntry,
    };
    const root = directoryHandle("root", [parent]);
    await expect(renameWorkspaceEntry(root, "src/old.txt", "new.txt")).rejects.toThrow("copy failed");
    expect(close).toHaveBeenCalledOnce();
    expect(removeEntry).not.toHaveBeenCalled();

    const successfulTarget = fileHandle("new.txt");
    const successfulParent: BrowserDirectoryHandle = {
      ...parent,
      async getFileHandle(name, options) {
        if (name === "old.txt") return source;
        if (name === "new.txt" && options?.create) return successfulTarget;
        throw new Error("missing file");
      },
    };
    const successfulRoot = directoryHandle("root", [successfulParent]);
    await expect(renameWorkspaceEntry(successfulRoot, "src/old.txt", "new.txt"))
      .resolves.toBe("src/new.txt");
  });

  it("moves files into a target directory and removes the source", async () => {
    const source = fileHandle("main.py", "print(1)");
    const targetFiles = new Map<string, BrowserFileHandle>();
    const target: BrowserDirectoryHandle = {
      kind: "directory",
      name: "src",
      async *values() { yield* targetFiles.values(); },
      async getFileHandle(name, options) {
        const existing = targetFiles.get(name);
        if (existing) return existing;
        if (!options?.create) throw new Error("missing file");
        const created = fileHandle(name);
        targetFiles.set(name, created);
        return created;
      },
      async getDirectoryHandle() { throw new Error("missing directory"); },
    };
    const removeEntry = vi.fn(async () => undefined);
    const root: BrowserDirectoryHandle = {
      kind: "directory",
      name: "root",
      async *values() { yield source; yield target; },
      async getFileHandle(name) {
        if (name === "main.py") return source;
        throw new Error("missing file");
      },
      async getDirectoryHandle(name) {
        if (name === "src") return target;
        throw new Error("missing directory");
      },
      removeEntry,
    };

    await expect(moveWorkspaceEntry(root, "main.py", "src")).resolves.toBe("src/main.py");
    expect(targetFiles.has("main.py")).toBe(true);
    expect(removeEntry).toHaveBeenCalledWith("main.py", { recursive: false });
    await expect(moveWorkspaceEntry(root, "src", "src/nested")).rejects.toThrow("dentro dela mesma");
  });

  it("moves directories, handles root targets and reports unsupported moves", async () => {
    const nestedFile = fileHandle("data.json", "{}");
    const sourceDirectory = directoryHandle("assets", [nestedFile]);
    const copiedFiles = new Map<string, BrowserFileHandle>();
    const copiedDirectory: BrowserDirectoryHandle = {
      kind: "directory",
      name: "assets",
      async *values() { yield* copiedFiles.values(); },
      async getFileHandle(name, options) {
        const existing = copiedFiles.get(name);
        if (existing) return existing;
        if (!options?.create) throw new Error("missing file");
        const created = fileHandle(name);
        copiedFiles.set(name, created);
        return created;
      },
      async getDirectoryHandle() { throw new Error("missing directory"); },
    };
    const target: BrowserDirectoryHandle = {
      ...directoryHandle("target", []),
      async getDirectoryHandle(name, options) {
        if (name === "assets" && options?.create) return copiedDirectory;
        throw new Error("missing directory");
      },
    };
    const removeEntry = vi.fn(async () => undefined);
    const root: BrowserDirectoryHandle = {
      ...directoryHandle("root", [sourceDirectory, target]),
      removeEntry,
    };

    await expect(moveWorkspaceEntry(root, "assets", "target")).resolves.toBe("target/assets");
    expect(copiedFiles.has("data.json")).toBe(true);
    expect(removeEntry).toHaveBeenCalledWith("assets", { recursive: true });
    await expect(moveWorkspaceEntry(root, "target/assets", "target")).resolves.toBe("target/assets");
    await expect(moveWorkspaceEntry(root, "", "target")).rejects.toThrow("O caminho do recurso está vazio.");
    await expect(moveWorkspaceEntry(
      directoryHandle("unsupported", [fileHandle("main.py"), directoryHandle("target", [])]),
      "main.py",
      "target",
    ))
      .rejects.toThrow("Este navegador não oferece movimentação de arquivos pelo workspace.");

    const nestedRemoveEntry = vi.fn(async () => undefined);
    const nestedSource: BrowserDirectoryHandle = {
      ...directoryHandle("source", [fileHandle("nested.py")]),
      removeEntry: nestedRemoveEntry,
    };
    const rootFiles = new Map<string, BrowserFileHandle>();
    const rootTarget: BrowserDirectoryHandle = {
      ...directoryHandle("root", [nestedSource]),
      async getFileHandle(name, options) {
        const existing = rootFiles.get(name);
        if (existing) return existing;
        if (!options?.create) throw new Error("missing file");
        const created = fileHandle(name);
        rootFiles.set(name, created);
        return created;
      },
    };
    await expect(moveWorkspaceEntry(rootTarget, "source/nested.py", "")).resolves.toBe("nested.py");
    expect(rootFiles.has("nested.py")).toBe(true);
    expect(nestedRemoveEntry).toHaveBeenCalledWith("nested.py", { recursive: false });
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
      kind: "text",
      mediaType: "text/plain",
      size: 1,
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
