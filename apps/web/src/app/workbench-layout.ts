export interface ToolWindowLayoutState {
  readonly activeToolWindowId?: string;
  readonly toolWindowVisible: boolean;
}

export function reconcileToolWindowLayout(input: {
  readonly initialized: boolean;
  readonly availableIds: readonly string[];
  readonly current: ToolWindowLayoutState;
}): ToolWindowLayoutState {
  const { initialized, availableIds, current } = input;
  if (!initialized) return current;
  const firstAvailableId = availableIds[0];
  if (!firstAvailableId) return { toolWindowVisible: false };
  if (current.activeToolWindowId && availableIds.includes(current.activeToolWindowId)) {
    return current;
  }
  return {
    activeToolWindowId: firstAvailableId,
    toolWindowVisible: current.toolWindowVisible,
  };
}
