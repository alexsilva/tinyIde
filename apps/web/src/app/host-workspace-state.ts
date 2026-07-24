let activeWorkspaceRoot: string | undefined;

export function getActiveHostWorkspaceRoot(): string | undefined {
  return activeWorkspaceRoot;
}

export function setActiveHostWorkspaceRoot(workspaceRoot: string | undefined): void {
  activeWorkspaceRoot = workspaceRoot;
}
