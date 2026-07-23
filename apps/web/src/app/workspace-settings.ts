import type {
  ExecutionProfile,
  LanguageLintSettings,
  PluginSettingsMap,
} from "@tinyide/plugin-api";

export interface WorkspaceExecutionProfiles {
  readonly profiles: readonly ExecutionProfile[];
  readonly selectedId?: string;
}

export interface WorkspaceEnvironmentSettings {
  readonly selectedId?: string;
}

export interface WorkspaceEditorSettings {
  /** Shows the numeric line ruler beside the text editor. Defaults to true. */
  readonly lineNumbers?: boolean;
}

export interface WorkspaceSettings {
  readonly version: 1;
  /** Project-specific execution profiles, equivalent to IDE run configurations. */
  readonly executionProfiles?: WorkspaceExecutionProfiles;
  /** Per-language lint choices that belong to this project. */
  readonly lint?: Readonly<Record<string, LanguageLintSettings>>;
  /** Environment selected for this project. Environment definitions are plugin-owned under .tinyide. */
  readonly environment?: WorkspaceEnvironmentSettings;
  /** Native editor preferences owned by the tinyIde workbench. */
  readonly editor?: WorkspaceEditorSettings;
  /** Reserved namespace for project-local plugin settings. */
  readonly plugins?: PluginSettingsMap;
}

export const EMPTY_WORKSPACE_SETTINGS: WorkspaceSettings = { version: 1 };

function headers(workspaceRoot: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-TinyIde-Workspace-Root": workspaceRoot,
  };
}

export async function readWorkspaceSettings(workspaceRoot: string): Promise<WorkspaceSettings> {
  const response = await fetch("/core-api/workspace/settings", {
    cache: "no-store",
    headers: headers(workspaceRoot),
  });
  const payload = await response.json() as WorkspaceSettings | { readonly error?: string };
  if (!response.ok) {
    throw new Error("error" in payload && payload.error
      ? payload.error
      : "Não foi possível ler a configuração local do workspace.");
  }
  return payload as WorkspaceSettings;
}

export async function writeWorkspaceSettings(
  workspaceRoot: string,
  settings: WorkspaceSettings,
): Promise<WorkspaceSettings> {
  const response = await fetch("/core-api/workspace/settings", {
    method: "PUT",
    headers: headers(workspaceRoot),
    body: JSON.stringify(settings),
  });
  const payload = await response.json() as WorkspaceSettings | { readonly error?: string };
  if (!response.ok) {
    throw new Error("error" in payload && payload.error
      ? payload.error
      : "Não foi possível salvar a configuração local do workspace.");
  }
  return payload as WorkspaceSettings;
}
