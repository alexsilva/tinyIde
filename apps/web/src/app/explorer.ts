import type { WorkspaceEntry } from "../browser-filesystem";

export function workspacePathParent(path: string): string {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

export function workspacePathName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

export function joinWorkspacePath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function findWorkspaceEntry(
  entries: readonly WorkspaceEntry[],
  path: string,
): WorkspaceEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const nested = entry.children ? findWorkspaceEntry(entry.children, path) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

export function explorerTargetDirectoryPath(
  entries: readonly WorkspaceEntry[],
  selectedPath: string | undefined,
): string {
  if (!selectedPath) return "";
  const selected = findWorkspaceEntry(entries, selectedPath);
  if (!selected) return "";
  return selected.kind === "directory" ? selected.path : workspacePathParent(selected.path);
}

export function flattenVisibleEntries(
  entries: readonly WorkspaceEntry[],
  expanded: ReadonlySet<string>,
  showHidden: boolean,
): readonly WorkspaceEntry[] {
  const flattened: WorkspaceEntry[] = [];
  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith(".")) continue;
    flattened.push(entry);
    if (entry.kind === "directory" && expanded.has(entry.path) && entry.children) {
      flattened.push(...flattenVisibleEntries(entry.children, expanded, showHidden));
    }
  }
  return flattened;
}

export function replaceWorkspacePathPrefix(path: string, previousPath: string, nextPath: string): string {
  if (path === previousPath) return nextPath;
  if (!path.startsWith(`${previousPath}/`)) return path;
  return `${nextPath}${path.slice(previousPath.length)}`;
}

export function parentEntryPath(path: string): string | undefined {
  const parent = workspacePathParent(path);
  return parent || undefined;
}
