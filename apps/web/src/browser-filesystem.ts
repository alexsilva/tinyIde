export interface BrowserPermissionDescriptor {
  readonly mode: "read" | "readwrite";
}

export interface BrowserWritableFileStream {
  write(data: string | Blob | BufferSource): Promise<void>;
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
  removeEntry?(name: string, options?: { readonly recursive?: boolean }): Promise<void>;
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
  readonly kind: "text" | "image" | "binary";
  readonly mediaType: string;
  readonly size: number;
  readonly content: string;
  readonly savedContent: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

const IMAGE_MEDIA_TYPES = new Map<string, string>([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLocaleLowerCase() : "";
}

function inferredMediaType(file: File): string {
  const declared = file.type.trim().toLocaleLowerCase();
  if (declared) return declared;
  return IMAGE_MEDIA_TYPES.get(fileExtension(file.name)) ?? "application/octet-stream";
}

function sampleLooksBinary(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  if (bytes.includes(0)) return true;
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return true;
  }
  let controls = 0;
  for (const character of decoded) {
    const code = character.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) controls += 1;
  }
  return controls / Math.max(1, decoded.length) > 0.05;
}

export async function inspectBrowserFile(file: File): Promise<{
  readonly kind: OpenDocument["kind"];
  readonly mediaType: string;
  readonly size: number;
}> {
  const mediaType = inferredMediaType(file);
  if (mediaType.startsWith("image/") || IMAGE_MEDIA_TYPES.has(fileExtension(file.name))) {
    return { kind: "image", mediaType, size: file.size };
  }
  const sample = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  return {
    kind: sampleLooksBinary(sample) ? "binary" : "text",
    mediaType,
    size: file.size,
  };
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

export async function removeWorkspaceEntry(
  workspaceHandle: BrowserDirectoryHandle,
  path: string,
  recursive = false,
): Promise<void> {
  const segments = [...workspacePathSegments(path)];
  const name = segments.pop();
  if (!name) throw new Error("O caminho do recurso está vazio.");
  const parent = await resolveDirectoryHandle(workspaceHandle, segments.join("/"));
  if (!parent.removeEntry) throw new Error("Este navegador não oferece exclusão de arquivos pelo workspace.");
  await parent.removeEntry(name, { recursive });
}

async function copyFileHandle(source: BrowserFileHandle, target: BrowserFileHandle): Promise<void> {
  const file = await source.getFile();
  const writable = await target.createWritable();
  try {
    await writable.write(await file.arrayBuffer());
  } finally {
    await writable.close();
  }
}

async function copyDirectoryHandle(source: BrowserDirectoryHandle, target: BrowserDirectoryHandle): Promise<void> {
  for await (const child of source.values()) {
    if (child.kind === "file") {
      await copyFileHandle(child, await target.getFileHandle(child.name, { create: true }));
    } else {
      await copyDirectoryHandle(child, await target.getDirectoryHandle(child.name, { create: true }));
    }
  }
}

export async function renameWorkspaceEntry(
  workspaceHandle: BrowserDirectoryHandle,
  path: string,
  nextName: string,
): Promise<string> {
  const segments = [...workspacePathSegments(path)];
  const currentName = segments.pop();
  if (!currentName) throw new Error("O caminho do recurso está vazio.");
  const normalizedName = nextName.trim();
  if (!normalizedName) throw new Error("Informe um nome.");
  if (normalizedName.includes("/") || normalizedName.includes("\\")) {
    throw new Error("Use apenas o nome, sem barras ou caminho.");
  }
  if (normalizedName === currentName) return path;

  const parentPath = segments.join("/");
  const parent = await resolveDirectoryHandle(workspaceHandle, parentPath);
  if (!parent.removeEntry) throw new Error("Este navegador não oferece renomeação de arquivos pelo workspace.");

  let source: BrowserFileHandle | BrowserDirectoryHandle;
  try {
    source = await parent.getFileHandle(currentName);
  } catch {
    source = await parent.getDirectoryHandle(currentName);
  }

  if (source.kind === "file") {
    const target = await parent.getFileHandle(normalizedName, { create: true });
    await copyFileHandle(source, target);
    await parent.removeEntry(currentName, { recursive: false });
  } else {
    const target = await parent.getDirectoryHandle(normalizedName, { create: true });
    await copyDirectoryHandle(source, target);
    await parent.removeEntry(currentName, { recursive: true });
  }

  return parentPath ? `${parentPath}/${normalizedName}` : normalizedName;
}

export async function moveWorkspaceEntry(
  workspaceHandle: BrowserDirectoryHandle,
  sourcePath: string,
  targetDirectoryPath: string,
): Promise<string> {
  const sourceSegments = [...workspacePathSegments(sourcePath)];
  const sourceName = sourceSegments.pop();
  if (!sourceName) throw new Error("O caminho do recurso está vazio.");
  const sourceParentPath = sourceSegments.join("/");
  if (sourceParentPath === targetDirectoryPath) return sourcePath;
  if (targetDirectoryPath === sourcePath || targetDirectoryPath.startsWith(`${sourcePath}/`)) {
    throw new Error("Não é possível mover uma pasta para dentro dela mesma.");
  }

  const sourceParent = await resolveDirectoryHandle(workspaceHandle, sourceParentPath);
  const targetParent = await resolveDirectoryHandle(workspaceHandle, targetDirectoryPath);
  if (!sourceParent.removeEntry) throw new Error("Este navegador não oferece movimentação de arquivos pelo workspace.");

  let source: BrowserFileHandle | BrowserDirectoryHandle;
  try {
    source = await sourceParent.getFileHandle(sourceName);
  } catch {
    source = await sourceParent.getDirectoryHandle(sourceName);
  }

  if (source.kind === "file") {
    await copyFileHandle(source, await targetParent.getFileHandle(sourceName, { create: true }));
    await sourceParent.removeEntry(sourceName, { recursive: false });
  } else {
    await copyDirectoryHandle(source, await targetParent.getDirectoryHandle(sourceName, { create: true }));
    await sourceParent.removeEntry(sourceName, { recursive: true });
  }

  return targetDirectoryPath ? `${targetDirectoryPath}/${sourceName}` : sourceName;
}

export async function readFileDocument(
  handle: BrowserFileHandle,
  path?: string,
  workspaceRoot?: string,
): Promise<OpenDocument> {
  const file = await handle.getFile();
  const inspection = await inspectBrowserFile(file);
  const content = inspection.kind === "text" ? await file.text() : "";
  return {
    id: path ?? `file:${file.name}`,
    name: file.name,
    ...(path ? { path } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    handle,
    ...inspection,
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
  if (document.kind !== "text") {
    throw new Error("Este recurso não é um documento de texto editável.");
  }
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
    size: new Blob([document.content]).size,
    savedContent: document.content,
  };
}
