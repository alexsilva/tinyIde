export interface WorkspaceRootResolutionInput {
  readonly workspaceName?: string | undefined;
  readonly pathHints: readonly (string | undefined)[];
}

function normalizePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

export function inferWorkspaceRoot(input: WorkspaceRootResolutionInput): string | undefined {
  const workspaceName = input.workspaceName?.trim();
  if (!workspaceName) {
    const first = input.pathHints.find((value): value is string => Boolean(value?.trim()));
    return first ? normalizePath(first) : undefined;
  }

  for (const rawPath of input.pathHints) {
    if (!rawPath || rawPath.includes("${")) continue;
    const normalized = normalizePath(rawPath);
    if (!normalized) continue;
    const segments = normalized.split("/");
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (segments[index] !== workspaceName) continue;
      return segments.slice(0, index + 1).join("/");
    }
  }

  return undefined;
}
