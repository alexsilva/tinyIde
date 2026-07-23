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

export function explorerAncestorDirectoryPaths(path: string): readonly string[] {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  const ancestors: string[] = [];
  for (let index = 1; index <= segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

export function workspacePathContainsHiddenSegment(path: string): boolean {
  return path.split("/").filter(Boolean).some((segment) => segment.startsWith("."));
}

export function explorerDirectoryEmptyState(
  entries: readonly WorkspaceEntry[] | undefined,
  showHidden: boolean,
): "empty" | "hidden-only" | undefined {
  if (!entries?.length) return "empty";
  if (!showHidden && entries.every((entry) => entry.name.startsWith("."))) return "hidden-only";
  return undefined;
}

export function hiddenExplorerEntryCount(entries: readonly WorkspaceEntry[] | undefined): number {
  return entries?.filter((entry) => entry.name.startsWith(".")).length ?? 0;
}

export function expandNextExplorerLevel(
  entries: readonly WorkspaceEntry[],
  expanded: ReadonlySet<string>,
  showHidden: boolean,
): ReadonlySet<string> {
  const next = new Set(expanded);
  const visit = (items: readonly WorkspaceEntry[]) => {
    for (const entry of items) {
      if (!showHidden && entry.name.startsWith(".")) continue;
      if (entry.kind !== "directory") continue;
      if (!expanded.has(entry.path)) {
        next.add(entry.path);
        continue;
      }
      if (entry.children) visit(entry.children);
    }
  };
  visit(entries);
  return next;
}

export function collapseDeepestExplorerLevel(expanded: ReadonlySet<string>): ReadonlySet<string> {
  if (!expanded.size) return expanded;
  const deepestLevel = Math.max(...[...expanded].map((path) => path.split("/").filter(Boolean).length));
  return new Set([...expanded].filter((path) => path.split("/").filter(Boolean).length < deepestLevel));
}

export function nearestRemainingItemId(
  orderedIds: readonly string[],
  removedIds: ReadonlySet<string>,
  activeId: string | undefined,
): string | undefined {
  if (!activeId || !removedIds.has(activeId)) return activeId;
  const activeIndex = orderedIds.indexOf(activeId);
  if (activeIndex < 0) return undefined;
  for (let index = activeIndex + 1; index < orderedIds.length; index += 1) {
    const after = orderedIds[index];
    if (after && !removedIds.has(after)) return after;
  }
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const before = orderedIds[index];
    if (before && !removedIds.has(before)) return before;
  }
  return undefined;
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
