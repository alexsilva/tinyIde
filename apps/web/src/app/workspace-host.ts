import type {
  BrowserDirectoryHandle,
  BrowserFileHandle,
  BrowserWritableFileStream,
} from "../browser-filesystem";

interface DesktopWorkspaceDescriptor {
  readonly token: string;
  readonly name: string;
  readonly path: string;
}

interface DesktopWorkspaceEntryDescriptor {
  readonly name: string;
  readonly kind: "file" | "directory";
}

interface DesktopFilePayload {
  readonly bytes: Uint8Array;
  readonly lastModified: number;
}

export interface TinyIdeDesktopApi {
  getPathForFile(file: File): string;
  pickDirectory?(): Promise<DesktopWorkspaceDescriptor | undefined>;
  restoreDirectory?(path: string): Promise<DesktopWorkspaceDescriptor | undefined>;
  listDirectory?(token: string, path: string): Promise<readonly DesktopWorkspaceEntryDescriptor[]>;
  ensureFile?(token: string, path: string, create: boolean): Promise<boolean>;
  ensureDirectory?(token: string, path: string, create: boolean): Promise<boolean>;
  readFile?(token: string, path: string): Promise<DesktopFilePayload>;
  writeFile?(token: string, path: string, bytes: ArrayBuffer): Promise<boolean>;
  removeEntry?(token: string, path: string, recursive: boolean): Promise<boolean>;
}

type DesktopWorkspaceApi = TinyIdeDesktopApi & Required<Pick<TinyIdeDesktopApi,
  | "pickDirectory"
  | "restoreDirectory"
  | "listDirectory"
  | "ensureFile"
  | "ensureDirectory"
  | "readFile"
  | "writeFile"
  | "removeEntry"
>>;

declare global {
  interface Window {
    tinyideDesktop?: TinyIdeDesktopApi;
  }
}

const IGNORED_PROBE_DIRECTORIES = new Set([".git", ".venv", "node_modules"]);

function joinWorkspacePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function writablePart(data: string | Blob | BufferSource): BlobPart {
  if (typeof data === "string" || data instanceof Blob || data instanceof ArrayBuffer) return data;
  return Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).buffer;
}

function supportsDesktopWorkspace(api: TinyIdeDesktopApi | undefined): api is DesktopWorkspaceApi {
  return Boolean(
    api?.pickDirectory
    && api.restoreDirectory
    && api.listDirectory
    && api.ensureFile
    && api.ensureDirectory
    && api.readFile
    && api.writeFile
    && api.removeEntry,
  );
}

class DesktopFileHandle implements BrowserFileHandle {
  readonly kind = "file" as const;
  readonly name: string;

  constructor(
    private readonly desktop: DesktopWorkspaceApi,
    private readonly token: string,
    private readonly path: string,
  ) {
    this.name = fileName(path);
  }

  async getFile(): Promise<File> {
    const payload = await this.desktop.readFile(this.token, this.path);
    const bytes = Uint8Array.from(payload.bytes);
    return new File([bytes.buffer], this.name, { lastModified: payload.lastModified });
  }

  async createWritable(): Promise<BrowserWritableFileStream> {
    const parts: BlobPart[] = [];
    return {
      write: async (data) => {
        parts.push(writablePart(data));
      },
      close: async () => {
        const bytes = await new Blob(parts).arrayBuffer();
        await this.desktop.writeFile(this.token, this.path, bytes);
      },
    };
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }
}

export interface DesktopDirectoryHandle extends BrowserDirectoryHandle {
  readonly desktopWorkspaceRoot: string;
}

class DesktopDirectoryHandleImpl implements DesktopDirectoryHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  readonly desktopWorkspaceRoot: string;

  constructor(
    private readonly desktop: DesktopWorkspaceApi,
    private readonly descriptor: DesktopWorkspaceDescriptor,
    private readonly path = "",
  ) {
    this.name = path ? fileName(path) : descriptor.name;
    this.desktopWorkspaceRoot = descriptor.path;
  }

  async *values(): AsyncIterableIterator<BrowserFileHandle | BrowserDirectoryHandle> {
    const entries = await this.desktop.listDirectory(this.descriptor.token, this.path);
    for (const entry of entries) {
      const childPath = joinWorkspacePath(this.path, entry.name);
      yield entry.kind === "directory"
        ? new DesktopDirectoryHandleImpl(this.desktop, this.descriptor, childPath)
        : new DesktopFileHandle(this.desktop, this.descriptor.token, childPath);
    }
  }

  async getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<BrowserFileHandle> {
    const childPath = joinWorkspacePath(this.path, name);
    await this.desktop.ensureFile(this.descriptor.token, childPath, options?.create === true);
    return new DesktopFileHandle(this.desktop, this.descriptor.token, childPath);
  }

  async getDirectoryHandle(name: string, options?: { readonly create?: boolean }): Promise<BrowserDirectoryHandle> {
    const childPath = joinWorkspacePath(this.path, name);
    await this.desktop.ensureDirectory(this.descriptor.token, childPath, options?.create === true);
    return new DesktopDirectoryHandleImpl(this.desktop, this.descriptor, childPath);
  }

  async removeEntry(name: string, options?: { readonly recursive?: boolean }): Promise<void> {
    await this.desktop.removeEntry(
      this.descriptor.token,
      joinWorkspacePath(this.path, name),
      options?.recursive === true,
    );
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }
}

export function isDesktopHost(): boolean {
  return typeof window !== "undefined" && supportsDesktopWorkspace(window.tinyideDesktop);
}

export function isDesktopWorkspaceHandle(
  handle: BrowserDirectoryHandle | undefined,
): handle is DesktopDirectoryHandle {
  return Boolean(handle && "desktopWorkspaceRoot" in handle);
}

export async function pickWorkspaceDirectory(): Promise<BrowserDirectoryHandle> {
  const desktop = typeof window === "undefined" ? undefined : window.tinyideDesktop;
  if (supportsDesktopWorkspace(desktop)) {
    const descriptor = await desktop.pickDirectory();
    if (!descriptor) throw new DOMException("A seleção do diretório foi cancelada.", "AbortError");
    return new DesktopDirectoryHandleImpl(desktop, descriptor);
  }
  if (!window.showDirectoryPicker) throw new Error("Este navegador não oferece seleção de pastas.");
  return window.showDirectoryPicker();
}

export async function restoreDesktopWorkspaceHandle(
  workspaceRoot: string | undefined,
): Promise<BrowserDirectoryHandle | undefined> {
  const desktop = typeof window === "undefined" ? undefined : window.tinyideDesktop;
  if (!supportsDesktopWorkspace(desktop) || !workspaceRoot) return undefined;
  const descriptor = await desktop.restoreDirectory(workspaceRoot);
  return descriptor ? new DesktopDirectoryHandleImpl(desktop, descriptor) : undefined;
}

function parentPath(path: string): string | undefined {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separatorIndex < 0) return undefined;
  if (separatorIndex === 0) return path.slice(0, 1);
  if (separatorIndex === 2 && /^[A-Za-z]:[\\/]$/.test(path.slice(0, 3))) return path.slice(0, 3);
  return path.slice(0, separatorIndex);
}

export function workspaceRootFromFilePath(
  absoluteFilePath: string,
  relativeSegments: readonly string[],
): string | undefined {
  let current = absoluteFilePath;
  for (const _segment of relativeSegments) {
    const parent = parentPath(current);
    if (!parent) return undefined;
    current = parent;
  }
  return current;
}

async function findBackingFile(
  handle: BrowserDirectoryHandle,
  parentSegments: readonly string[] = [],
  depth = 0,
): Promise<{ readonly handle: BrowserFileHandle; readonly segments: readonly string[] } | undefined> {
  const entries: (BrowserFileHandle | BrowserDirectoryHandle)[] = [];
  for await (const entry of handle.values()) entries.push(entry);

  const file = entries.find((entry): entry is BrowserFileHandle => entry.kind === "file");
  if (file) return { handle: file, segments: [...parentSegments, file.name] };
  if (depth >= 4) return undefined;

  for (const directory of entries) {
    if (directory.kind !== "directory" || IGNORED_PROBE_DIRECTORIES.has(directory.name)) continue;
    const nested = await findBackingFile(directory, [...parentSegments, directory.name], depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

export async function workspaceRootHintForHandle(
  handle: BrowserDirectoryHandle,
  desktop: TinyIdeDesktopApi | undefined = typeof window === "undefined"
    ? undefined
    : window.tinyideDesktop,
): Promise<string | undefined> {
  if (isDesktopWorkspaceHandle(handle)) return handle.desktopWorkspaceRoot;
  if (!desktop) return undefined;

  const backingFile = await findBackingFile(handle);
  if (backingFile) {
    const absoluteFilePath = desktop.getPathForFile(await backingFile.handle.getFile());
    if (absoluteFilePath) return workspaceRootFromFilePath(absoluteFilePath, backingFile.segments);
  }

  if (!handle.removeEntry) return undefined;
  const markerName = `.tinyide-workspace-probe-${crypto.randomUUID()}`;
  const marker = await handle.getFileHandle(markerName, { create: true });
  try {
    const absoluteMarkerPath = desktop.getPathForFile(await marker.getFile());
    return absoluteMarkerPath
      ? workspaceRootFromFilePath(absoluteMarkerPath, [markerName])
      : undefined;
  } finally {
    await handle.removeEntry(markerName).catch(() => undefined);
  }
}
