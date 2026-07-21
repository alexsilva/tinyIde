import type { TextDiagnostic } from "@tinyide/plugin-api";
import {
  readApplicationSnapshot,
  writeApplicationSnapshot,
} from "../session-store";
import type {
  BrowserDirectoryHandle,
  BrowserFileHandle,
  OpenDocument,
  WorkspaceEntry,
} from "../browser-filesystem";

const SESSION_KEY = "tinyide.react.session.v2";

export type PersistedSidebarView = "explorer" | "plugins" | "environments";

export interface LayoutState {
  readonly sidebarVisible: boolean;
  readonly sidebarWidth: number;
  readonly sidebarView: PersistedSidebarView;
  readonly panelVisible: boolean;
  readonly panelHeight: number;
  readonly panelTab: "output" | "problems";
}

export interface SessionState extends LayoutState {
  readonly workspaceName: string;
  readonly activeDocumentId?: string;
  readonly expandedDirectories: readonly string[];
  readonly explorerShowHidden: boolean;
  readonly selectedEnvironmentId?: string;
}

interface StoredWorkspaceEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly children?: readonly StoredWorkspaceEntry[];
}

interface StoredDocument {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
  readonly handle?: BrowserFileHandle;
  readonly content: string;
  readonly savedContent: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

export interface ApplicationSnapshot {
  readonly version: 2;
  readonly workspaceName: string;
  readonly workspaceHandle?: BrowserDirectoryHandle;
  readonly workspaceEntries: readonly StoredWorkspaceEntry[];
  readonly documents: readonly StoredDocument[];
  readonly diagnostics: readonly TextDiagnostic[];
  readonly output: readonly string[];
}

export const DEFAULT_LAYOUT: LayoutState = {
  sidebarVisible: true,
  sidebarWidth: 280,
  sidebarView: "explorer",
  panelVisible: true,
  panelHeight: 190,
  panelTab: "output",
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function readSession(): SessionState {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return {
      ...DEFAULT_LAYOUT,
      workspaceName: "Sem workspace",
      expandedDirectories: [],
      explorerShowHidden: false,
    };
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    const sidebarView = parsed.sidebarView === "plugins" || parsed.sidebarView === "environments"
      ? parsed.sidebarView
      : "explorer";
    return {
      sidebarVisible: parsed.sidebarVisible !== false,
      sidebarWidth: clamp(Number(parsed.sidebarWidth) || DEFAULT_LAYOUT.sidebarWidth, 180, 720),
      sidebarView,
      panelVisible: parsed.panelVisible !== false,
      panelHeight: clamp(Number(parsed.panelHeight) || DEFAULT_LAYOUT.panelHeight, 96, 640),
      panelTab: parsed.panelTab === "problems" ? "problems" : "output",
      workspaceName: typeof parsed.workspaceName === "string" ? parsed.workspaceName : "Sem workspace",
      ...(typeof parsed.activeDocumentId === "string" ? { activeDocumentId: parsed.activeDocumentId } : {}),
      expandedDirectories: Array.isArray(parsed.expandedDirectories)
        ? parsed.expandedDirectories.filter((value): value is string => typeof value === "string")
        : [],
      explorerShowHidden: parsed.explorerShowHidden === true,
      ...(typeof parsed.selectedEnvironmentId === "string"
        ? { selectedEnvironmentId: parsed.selectedEnvironmentId }
        : {}),
    };
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return {
      ...DEFAULT_LAYOUT,
      workspaceName: "Sem workspace",
      expandedDirectories: [],
      explorerShowHidden: false,
    };
  }
}

export function writeSession(session: SessionState): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function serializeEntries(entries: readonly WorkspaceEntry[]): readonly StoredWorkspaceEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
    ...(entry.children ? { children: serializeEntries(entry.children) } : {}),
  }));
}

export function deserializeEntries(entries: readonly StoredWorkspaceEntry[]): readonly WorkspaceEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
    ...(entry.children ? { children: deserializeEntries(entry.children) } : {}),
  }));
}

export async function readReactSnapshot(): Promise<ApplicationSnapshot | undefined> {
  const snapshot = await readApplicationSnapshot<ApplicationSnapshot>();
  return snapshot?.version === 2 ? snapshot : undefined;
}

export async function writeReactSnapshot(input: {
  readonly workspaceName: string;
  readonly workspaceHandle?: BrowserDirectoryHandle;
  readonly workspaceEntries: readonly WorkspaceEntry[];
  readonly documents: readonly OpenDocument[];
  readonly diagnostics: readonly TextDiagnostic[];
  readonly output: readonly string[];
}): Promise<void> {
  const base = {
    version: 2 as const,
    workspaceName: input.workspaceName,
    workspaceEntries: serializeEntries(input.workspaceEntries),
    documents: input.documents.map((document) => ({
      id: document.id,
      name: document.name,
      ...(document.path ? { path: document.path } : {}),
      ...(document.handle ? { handle: document.handle } : {}),
      content: document.content,
      savedContent: document.savedContent,
      selectionStart: document.selectionStart,
      selectionEnd: document.selectionEnd,
      scrollTop: document.scrollTop,
      scrollLeft: document.scrollLeft,
    })),
    diagnostics: input.diagnostics,
    output: input.output,
  };

  try {
    await writeApplicationSnapshot({
      ...base,
      ...(input.workspaceHandle ? { workspaceHandle: input.workspaceHandle } : {}),
    });
  } catch (error) {
    console.warn("Não foi possível persistir handles; salvando snapshot sem handles.", error);
    await writeApplicationSnapshot({
      ...base,
      documents: base.documents.map(({ handle: _handle, ...document }) => document),
    });
  }
}
