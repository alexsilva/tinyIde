export interface BrowserPermissionDescriptor {
  readonly mode: "read" | "readwrite";
}

export interface BrowserWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserWritableFileStream>;
  queryPermission?(descriptor: BrowserPermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor: BrowserPermissionDescriptor): Promise<PermissionState>;
}

export interface BrowserDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterableIterator<BrowserFileHandle | BrowserDirectoryHandle>;
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<BrowserFileHandle>;
  getDirectoryHandle(name: string, options?: { readonly create?: boolean }): Promise<BrowserDirectoryHandle>;
  queryPermission?(descriptor: BrowserPermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor: BrowserPermissionDescriptor): Promise<PermissionState>;
}

export interface WorkspaceEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly handle?: BrowserFileHandle | BrowserDirectoryHandle;
  readonly children?: readonly WorkspaceEntry[];
}

export interface OpenDocument {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
  readonly workspaceRoot?: string;
  readonly handle?: BrowserFileHandle;
  readonly content: string;
  readonly savedContent: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>;
    showOpenFilePicker?: () => Promise<BrowserFileHandle[]>;
    showSaveFilePicker?: (options?: {
      readonly suggestedName?: string;
      readonly types?: readonly {
        readonly description: string;
        readonly accept: Readonly<Record<string, readonly string[]>>;
      }[];
    }) => Promise<BrowserFileHandle>;
  }
}

export async function listDirectory(
  handle: BrowserDirectoryHandle,
  parentPath = "",
): Promise<readonly WorkspaceEntry[]> {
  const entries: WorkspaceEntry[] = [];

  for await (const child of handle.values()) {
    const path = parentPath ? `${parentPath}/${child.name}` : child.name;
    entries.push({
      name: child.name,
      path,
      kind: child.kind,
      handle: child,
    });
  }

  return entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function workspacePathSegments(path: string): readonly string[] {
  return path.split("/").filter(Boolean);
}

export async function resolveDirectoryHandle(
  workspaceHandle: BrowserDirectoryHandle,
  path: string,
): Promise<BrowserDirectoryHandle> {
  let current = workspaceHandle;
  for (const segment of workspacePathSegments(path)) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

export async function resolveFileHandle(
  workspaceHandle: BrowserDirectoryHandle,
  path: string,
): Promise<BrowserFileHandle> {
  const segments = [...workspacePathSegments(path)];
  const fileName = segments.pop();
  if (!fileName) throw new Error("O caminho do arquivo está vazio.");
  const parent = await resolveDirectoryHandle(workspaceHandle, segments.join("/"));
  return parent.getFileHandle(fileName);
}

export async function readFileDocument(
  handle: BrowserFileHandle,
  path?: string,
  workspaceRoot?: string,
): Promise<OpenDocument> {
  const file = await handle.getFile();
  const content = await file.text();
  return {
    id: path ?? `file:${file.name}`,
    name: file.name,
    ...(path ? { path } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    handle,
    content,
    savedContent: content,
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
  };
}

export async function writeFileDocument(
  document: OpenDocument,
  handle: BrowserFileHandle,
): Promise<OpenDocument> {
  const writable = await handle.createWritable();
  try {
    await writable.write(document.content);
  } finally {
    await writable.close();
  }

  return {
    ...document,
    id: document.path ?? `file:${handle.name}`,
    name: handle.name,
    handle,
    savedContent: document.content,
  };
}
