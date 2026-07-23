import type { WorkspaceSettings } from "./workspace-settings";

export interface ResolvedEditorSettings {
  readonly lineNumbers: boolean;
}

export const DEFAULT_EDITOR_SETTINGS: ResolvedEditorSettings = {
  lineNumbers: true,
};

export function resolveEditorSettings(settings: WorkspaceSettings): ResolvedEditorSettings {
  return {
    lineNumbers: settings.editor?.lineNumbers !== false,
  };
}

export function editorLineNumbers(source: string): readonly string[] {
  const count = source.split("\n").length;
  const width = Math.max(2, String(count).length);
  return Array.from({ length: count }, (_, index) => String(index + 1).padStart(width, "0"));
}
