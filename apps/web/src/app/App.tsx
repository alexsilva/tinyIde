import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Code2,
  Cpu,
  Eye,
  EyeOff,
  File,
  FileWarning,
  FilePlus2,
  Files,
  Folder,
  FolderOpen,
  FolderRoot,
  GitBranch,
  HardDrive,
  History,
  Info,
  Image as ImageIcon,
  LocateFixed,
  MoreVertical,
  Package,
  PanelBottom,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Square,
  Terminal,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatCommandLineArguments, parseCommandLineArguments } from "@tinyide/core";
import {
  TEXT_EDITOR_DOCUMENT_CHANGED_EVENT,
  TEXT_EDITOR_DOCUMENT_SAVED_EVENT,
  WORKSPACE_RESOURCES_CHANGED_EVENT,
} from "@tinyide/plugin-api";
import type {
  ExecutionEnvironment,
  ExecutionEnvironmentDirectoryListing,
  ExecutionEnvironmentProvider,
  ExecutionProfile,
  ExecutionProfileExecutableOption,
  LanguageLintSettings,
  LanguageProvider,
  PluginSettingValues,
  ResourceContext,
  ResourceDecoration,
  ResourceContextMenuItem,
  ResourceContextMenuProvider,
  TextEditorDocumentChangedEvent,
  TextEditorDocumentSnapshot,
  TextEditorDocumentSavedEvent,
  TextEditorLineDecoration,
  TextDiagnostic,
  WorkbenchDialogContribution,
  WorkbenchEditorToolbarItem,
  WorkbenchEditorToolbarProvider,
  WorkbenchActivityIcon,
  WorkbenchPanelContribution,
  WorkbenchPanelHookContribution,
  WorkbenchTabApi,
  WorkbenchTabContribution,
  WorkbenchPanelHook,
  WorkbenchResourceEditorProvider,
  WorkbenchSidebarContribution,
  WorkbenchSidebarHook,
  WorkbenchStateApi,
  WorkbenchStateSnapshot,
  WorkbenchTitlebarContribution,
  WorkbenchToolWindowContribution,
  WorkbenchToolWindowHookContribution,
  WorkbenchToolWindowHook,
  WorkspaceResourcesChangedEvent,
} from "@tinyide/plugin-api";
import {
  listDirectory,
  moveWorkspaceEntry,
  readFileDocument,
  renameWorkspaceEntry,
  resolveDirectoryHandle,
  resolveFileHandle,
  removeWorkspaceEntry,
  writeFileDocument,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type OpenDocument,
  type WorkspaceEntry,
} from "../browser-filesystem";

export function editorToolbarDocumentSnapshot(document: OpenDocument): TextEditorDocumentSnapshot {
  return {
    id: document.id,
    name: document.name,
    ...(document.path ? { path: document.path } : {}),
    ...(document.workspaceRoot ? { workspaceRoot: document.workspaceRoot } : {}),
    content: document.content,
    isDirty: document.content !== document.savedContent,
  };
}

import {
  collapseDeepestExplorerLevel,
  expandNextExplorerLevel,
  explorerAncestorDirectoryPaths,
  explorerDropTargetDirectory,
  explorerDirectoryEmptyState,
  explorerCreationInsertionIndex,
  hiddenExplorerEntryCount,
  explorerTargetDirectoryPath,
  findWorkspaceEntry,
  flattenVisibleEntries,
  joinWorkspacePath,
  nearestRemainingItemId,
  nextExplorerHiddenVisibility,
  parentEntryPath,
  replaceWorkspacePathPrefix,
  workspacePathName,
  workspacePathParent,
  workspacePathContainsHiddenSegment,
} from "./explorer";
import { platform } from "./platform";
import {
  DEFAULT_LAYOUT,
  deserializeEntries,
  readReactSnapshot,
  readSession,
  restoreWorkspaceDocuments,
  writeReactSnapshot,
  writeSession,
  type PersistedSidebarView,
} from "./persistence";
import {
  environmentProvider,
  hostProcessOutputLines,
  languageProviderFor,
  lintDocument,
  loadEnvironments,
  loadProfileContributions,
  listHostProcesses,
  readHostContext,
  readHostProcess,
  runExecutionProfile,
  runScript,
  pluginSettingsProviders,
  resourceIconFor,
  resourceDecorationProviders,
  resourceEditorProviderFor,
  scriptExecutionFor,
  setHostWorkspace,
  stopHostProcess,
  textEditorLineDecorationProviders,
  workbenchResourceDescriptor,
} from "./runtime";
import {
  resolvePluginSettingValues,
  updatePluginSettingValue,
} from "./plugin-settings";
import { editorLineNumbers, resolveEditorSettings } from "./editor-settings";
import { reconcileToolWindowLayout } from "./workbench-layout";
import {
  EMPTY_WORKSPACE_SETTINGS,
  readWorkspaceSettings,
  writeWorkspaceSettings,
  type WorkspaceExecutionProfiles,
  type WorkspaceSettings,
} from "./workspace-settings";
import {
  createEditorHistory,
  recordEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
  type EditorHistory,
} from "./editor-history";
import { applyEditorTab } from "./editor-indentation";

const PROFILE_KEY = "tinyide.react.executionProfiles.v1";
const LINT_SETTINGS_KEY = "tinyide.react.lintSettings.v1";

type SidebarView = PersistedSidebarView;

type StoredProfiles = WorkspaceExecutionProfiles;

type ContextMenuTarget =
  | { readonly kind: "root" }
  | { readonly kind: "entry"; readonly entry: WorkspaceEntry }
  | { readonly kind: "document"; readonly document: OpenDocument };

interface ContextMenuState {
  readonly target: ContextMenuTarget;
  readonly x: number;
  readonly y: number;
  readonly items: readonly ResourceContextMenuItem[];
}

function expandWorkbenchPanelContribution(
  contribution: WorkbenchPanelHookContribution,
): readonly WorkbenchPanelContribution[] {
  if (!("tabs" in contribution)) return [contribution];
  return contribution.tabs.map((tab) => ({
    id: tab.id,
    pluginId: contribution.pluginId,
    label: tab.label,
    ...((tab.order ?? contribution.order) !== undefined ? { order: tab.order ?? contribution.order } : {}),
    mount: tab.mount,
  }));
}

function expandWorkbenchToolWindowContribution(
  contribution: WorkbenchToolWindowHookContribution,
): readonly WorkbenchToolWindowContribution[] {
  if (!("views" in contribution)) return [contribution];
  return [{
    id: contribution.id,
    pluginId: contribution.pluginId,
    label: contribution.label,
    ...(contribution.icon ? { icon: contribution.icon } : {}),
    ...(contribution.order !== undefined ? { order: contribution.order } : {}),
    mount({ container, headerContainer, tabs, state }) {
      container.replaceChildren();
      const views = [...contribution.views]
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.label.localeCompare(right.label));
      const sections = new Map<string, HTMLElement>();
      const tabDisposables: Array<{ dispose(): void }> = [];
      const mountedDisposables: Array<{ dispose(): void }> = [];
      let disposed = false;

      const activate = (id: string) => {
        for (const [viewId, section] of sections) section.hidden = viewId !== id;
      };

      for (const view of views) {
        const section = document.createElement("section");
        section.className = "workbench-tool-window-view";
        section.dataset.viewId = view.id;
        section.hidden = true;
        container.append(section);
        sections.set(view.id, section);
        tabDisposables.push(tabs.register({
          id: view.id,
          label: view.label,
          ...(view.order !== undefined ? { order: view.order } : {}),
          onSelect: () => activate(view.id),
        }));
        try {
          const mounted = view.mount({ container: section, state });
          if (mounted && typeof (mounted as PromiseLike<unknown>).then === "function") {
            void Promise.resolve(mounted).then((result) => {
              if (!result) return;
              if (disposed) result.dispose();
              else mountedDisposables.push(result);
            }).catch((cause) => {
              if (!disposed) section.textContent = cause instanceof Error ? cause.message : String(cause);
            });
          } else if (mounted) {
            mountedDisposables.push(mounted as { dispose(): void });
          }
        } catch (cause) {
          section.textContent = cause instanceof Error ? cause.message : String(cause);
        }
      }

      const firstView = views[0];
      if (firstView) tabs.select(firstView.id);
      return {
        dispose() {
          disposed = true;
          mountedDisposables.forEach((item) => item.dispose());
          tabDisposables.forEach((item) => item.dispose());
          container.replaceChildren();
        },
      };
    },
  }];
}

function createWorkbenchTabApi(container: HTMLElement): WorkbenchTabApi & { dispose(): void } {
  const strip = document.createElement("div");
  strip.className = "workbench-tab-strip";
  container.append(strip);
  const tabs = new Map<string, { contribution: WorkbenchTabContribution; element: HTMLDivElement }>();
  let activeId: string | undefined;

  const renderSelection = () => {
    for (const [id, record] of tabs) {
      const active = id === activeId;
      record.element.classList.toggle("is-active", active);
      record.element.querySelector("button[role='tab']")?.setAttribute("aria-selected", String(active));
    }
  };

  const select = (id: string) => {
    const record = tabs.get(id);
    if (!record) return;
    activeId = id;
    renderSelection();
    record.contribution.onSelect();
  };

  return {
    register(contribution) {
      if (tabs.has(contribution.id)) throw new Error(`Aba já registrada: ${contribution.id}`);
      const group = document.createElement("div");
      group.className = "workbench-tab-group";
      const button = document.createElement("button");
      button.type = "button";
      button.role = "tab";
      button.className = "workbench-tab";
      button.textContent = contribution.label;
      button.addEventListener("click", () => select(contribution.id));
      group.append(button);
      if (contribution.closable) {
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "workbench-tab-close";
        closeButton.setAttribute("aria-label", `Fechar ${contribution.label}`);
        closeButton.textContent = "×";
        closeButton.addEventListener("click", (event) => {
          event.stopPropagation();
          void contribution.onClose?.();
        });
        group.append(closeButton);
      }
      tabs.set(contribution.id, { contribution, element: group });
      const ordered = [...tabs.entries()].sort(([, left], [, right]) =>
        (left.contribution.order ?? 0) - (right.contribution.order ?? 0)
        || left.contribution.label.localeCompare(right.contribution.label));
      strip.replaceChildren(...ordered.map(([, record]) => record.element));
      if (!activeId) select(contribution.id);
      else renderSelection();
      return {
        dispose() {
          const wasActive = activeId === contribution.id;
          tabs.delete(contribution.id);
          group.remove();
          if (wasActive) {
            activeId = tabs.keys().next().value;
            if (activeId) select(activeId);
          }
        },
      };
    },
    select,
    activeId: () => activeId,
    dispose() {
      tabs.clear();
      activeId = undefined;
      strip.remove();
    },
  };
}

interface ActiveWorkbenchDialog {
  readonly token: symbol;
  readonly contribution: WorkbenchDialogContribution;
}

function lineDecorationClassName(decorations: readonly TextEditorLineDecoration[]): string {
  const kinds = [...new Set(decorations.map((decoration) => decoration.kind))];
  return kinds.map((kind) => ` has-${kind}`).join("");
}

function lintSettingsStorageKey(workspaceName: string, providerId: string): string {
  return `${LINT_SETTINGS_KEY}:${encodeURIComponent(workspaceName)}:${encodeURIComponent(providerId)}`;
}

function defaultLintSettings(provider: LanguageProvider): LanguageLintSettings {
  const defaults = (provider.lintRules ?? [])
    .filter((rule) => rule.defaultEnabled)
    .map((rule) => rule.id);
  return { enabledRuleIds: defaults };
}

function readLegacyLintSettings(workspaceName: string, provider: LanguageProvider): LanguageLintSettings | undefined {
  try {
    const raw = localStorage.getItem(lintSettingsStorageKey(workspaceName, provider.id));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<LanguageLintSettings>;
    return {
      enabledRuleIds: Array.isArray(parsed.enabledRuleIds)
        ? parsed.enabledRuleIds.filter((value): value is string => typeof value === "string")
        : defaultLintSettings(provider).enabledRuleIds,
    };
  } catch {
    return undefined;
  }
}

function makeProfile(): ExecutionProfile {
  const id = `profile-${crypto.randomUUID()}`;
  return {
    id,
    name: "Novo perfil",
    environment: { mode: "none" },
    saveBeforeRun: true,
    steps: [
      {
        id: "step-1",
        name: "Executar",
        executable: "",
        command: "",
        parameters: [],
        workingDirectory: "${workspaceRoot}",
      },
    ],
  };
}

function profileStorageKey(workspaceName: string): string {
  const scope = workspaceName && workspaceName !== "Sem workspace" ? workspaceName : "global";
  return `${PROFILE_KEY}:${scope}`;
}

function readLegacyProfiles(workspaceName: string): StoredProfiles | undefined {
  try {
    const scopedKey = profileStorageKey(workspaceName);
    let raw = localStorage.getItem(scopedKey);
    if (!raw) {
      raw = localStorage.getItem(PROFILE_KEY);
      if (raw) {
        localStorage.setItem(scopedKey, raw);
        localStorage.removeItem(PROFILE_KEY);
      }
    }
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredProfiles;
    const result = {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      ...(typeof parsed.selectedId === "string" ? { selectedId: parsed.selectedId } : {}),
    };
    if (!localStorage.getItem(scopedKey)) localStorage.setItem(scopedKey, JSON.stringify(result));
    return result;
  } catch {
    return undefined;
  }
}

function parseEnvironmentVariables(value: string): Readonly<Record<string, string>> {
  const variables: Record<string, string> = {};
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Variável de ambiente inválida: ${line}`);
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Nome de variável inválido: ${name}`);
    variables[name] = line.slice(separator + 1);
  }
  return variables;
}

function environmentVariablesText(value: Readonly<Record<string, string>> | undefined): string {
  return Object.entries(value ?? {}).map(([name, item]) => `${name}=${item}`).join("\n");
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly active?: boolean;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          className={`icon-button${active ? " is-active" : ""}`}
          type="button"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side="right" sideOffset={8}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function WorkbenchActivityIconView({ icon }: { readonly icon: WorkbenchActivityIcon | undefined }) {
  if (icon === "files") return <Files size={20} />;
  if (icon === "history") return <History size={20} />;
  if (icon === "source-control") return <GitBranch size={20} />;
  if (icon === "terminal") return <Terminal size={20} />;
  return <Box size={20} />;
}

function ExplorerCreationRow({
  kind,
  name,
  error,
  onNameChange,
  onSubmit,
  onCancel,
}: {
  readonly kind: "file" | "directory";
  readonly name: string;
  readonly error: string | undefined;
  readonly onNameChange: (name: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const label = kind === "directory" ? "Nome da nova pasta" : "Nome do novo arquivo";
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      rowRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={rowRef}
      className="tree-entry-row tree-entry-row--creation"
      data-explorer-creation-row
    >
      <form
        className={`tree-entry tree-entry--${kind} tree-entry--creation${error ? " has-error" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {kind === "directory"
          ? <Folder className="tree-entry__icon tree-entry__icon--directory" size={15} />
          : <File className="tree-entry__icon tree-entry__icon--file" size={15} />}
        <input
          ref={inputRef}
          autoFocus
          value={name}
          aria-label={label}
          placeholder={label}
          aria-invalid={Boolean(error)}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
        />
        <button className="icon-button small" type="submit" aria-label="Confirmar criação"><Check size={13} /></button>
        <button className="icon-button small" type="button" aria-label="Cancelar criação" onClick={onCancel}><X size={13} /></button>
        {error ? <span className="tree-entry-rename-error" role="alert">{error}</span> : null}
      </form>
    </div>
  );
}

function EntryTree({
  entries,
  parentPath,
  expanded,
  showHidden,
  revealHidden,
  revealedHiddenPaths,
  highlightedPath,
  selectedPath,
  resourceDecorations,
  onToggle,
  onSelect,
  onOpen,
  onContextMenu,
  onMove,
  draggingPath,
  dropTargetPath,
  onDraggingPathChange,
  onDropTargetPathChange,
  onShowHiddenDirectory,
  renamePath,
  renameName,
  renameError,
  onRenameNameChange,
  onRenameSubmit,
  onRenameCancel,
  creationKind,
  creationParentPath,
  creationName,
  creationError,
  onCreationNameChange,
  onCreationSubmit,
  onCreationCancel,
  workspaceName,
  workspaceRoot,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly parentPath: string;
  readonly expanded: ReadonlySet<string>;
  readonly showHidden: boolean;
  readonly revealHidden: boolean;
  readonly revealedHiddenPaths: ReadonlySet<string>;
  readonly highlightedPath: string | undefined;
  readonly selectedPath: string | undefined;
  readonly resourceDecorations: ReadonlyMap<string, ResourceDecoration>;
  readonly onToggle: (entry: WorkspaceEntry) => void;
  readonly onSelect: (entry: WorkspaceEntry) => void;
  readonly onOpen: (entry: WorkspaceEntry) => void;
  readonly onContextMenu: (entry: WorkspaceEntry, x: number, y: number) => void;
  readonly onMove: (sourcePath: string, targetDirectoryPath: string) => void;
  readonly draggingPath: string | undefined;
  readonly dropTargetPath: string | undefined;
  readonly onDraggingPathChange: (path: string | undefined) => void;
  readonly onDropTargetPathChange: (path: string | undefined) => void;
  readonly onShowHiddenDirectory: (path: string) => void;
  readonly renamePath: string | undefined;
  readonly renameName: string;
  readonly renameError: string | undefined;
  readonly onRenameNameChange: (name: string) => void;
  readonly onRenameSubmit: () => void;
  readonly onRenameCancel: () => void;
  readonly creationKind: "file" | "directory" | undefined;
  readonly creationParentPath: string;
  readonly creationName: string;
  readonly creationError: string | undefined;
  readonly onCreationNameChange: (name: string) => void;
  readonly onCreationSubmit: () => void;
  readonly onCreationCancel: () => void;
  readonly workspaceName: string;
  readonly workspaceRoot?: string;
}) {
  const visibleEntries = revealHidden
    ? entries
    : entries.filter((entry) => !entry.name.startsWith("."));
  const creationIndex = creationKind && creationParentPath === parentPath
    ? explorerCreationInsertionIndex(visibleEntries, creationKind, creationName.trim())
    : -1;
  const creationRow = creationKind && creationParentPath === parentPath ? (
    <ExplorerCreationRow
      kind={creationKind}
      name={creationName}
      error={creationError}
      onNameChange={onCreationNameChange}
      onSubmit={onCreationSubmit}
      onCancel={onCreationCancel}
    />
  ) : null;
  const treeItems: Array<
    | { readonly type: "creation" }
    | { readonly type: "entry"; readonly entry: WorkspaceEntry }
  > = visibleEntries.map((entry) => ({ type: "entry", entry }));
  if (creationRow) treeItems.splice(creationIndex, 0, { type: "creation" });

  return (
    <div className="tree" data-explorer-directory-path={parentPath}>
      {treeItems.map((item) => {
        if (item.type === "creation") {
          return <div key="explorer-creation-entry">{creationRow}</div>;
        }
        const { entry } = item;
        const contributedIcon = entry.kind === "file"
          ? resourceIconFor({
              kind: "file",
              name: entry.name,
              path: entry.path,
              ...(workspaceName !== "Sem workspace" ? { workspaceName } : {}),
              ...(workspaceRoot ? { workspaceRoot } : {}),
            })
          : undefined;
        const decoration = resourceDecorations.get(entry.path);
        return <div key={entry.path}>
          <div className="tree-entry-row">
            {renamePath === entry.path ? (
              <form className={`tree-entry tree-entry--${entry.kind} tree-entry--rename${renameError ? " has-error" : ""}`} onSubmit={(event) => { event.preventDefault(); onRenameSubmit(); }}>
                {entry.kind === "directory" ? <Folder className="tree-entry__icon tree-entry__icon--directory" size={15} /> : <File className="tree-entry__icon tree-entry__icon--file" size={15} />}
                <input
                  autoFocus
                  value={renameName}
                  aria-label={`Renomear ${entry.name}`}
                  aria-invalid={Boolean(renameError)}
                  onChange={(event) => onRenameNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") onRenameCancel();
                  }}
                />
                <button className="icon-button small" type="submit" aria-label="Confirmar renomeação"><Check size={13} /></button>
                <button className="icon-button small" type="button" aria-label="Cancelar renomeação" onClick={onRenameCancel}><X size={13} /></button>
                {renameError ? <span className="tree-entry-rename-error" role="alert">{renameError}</span> : null}
              </form>
            ) : (
              <button
                type="button"
                data-explorer-path={entry.path}
                data-explorer-kind={entry.kind}
                draggable
                className={`tree-entry tree-entry--${entry.kind}${highlightedPath === entry.path ? " is-new" : ""}${selectedPath === entry.path ? " is-selected" : ""}${draggingPath === entry.path ? " is-dragging" : ""}${dropTargetPath === entry.path ? " is-drop-target" : ""}`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-tinyide-workspace-path", entry.path);
                  onDraggingPathChange(entry.path);
                }}
                onDragEnd={() => {
                  onDraggingPathChange(undefined);
                  onDropTargetPathChange(undefined);
                }}
                onDragOver={(event) => {
                  if (entry.kind !== "directory") return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  onDropTargetPathChange(entry.path);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDropTargetPathChange(undefined);
                }}
                onDrop={(event) => {
                  if (entry.kind !== "directory") return;
                  event.preventDefault();
                  event.stopPropagation();
                  const sourcePath = event.dataTransfer.getData("application/x-tinyide-workspace-path");
                  onDropTargetPathChange(undefined);
                  if (sourcePath) onMove(sourcePath, entry.path);
                }}
                onClick={() => {
                  if (entry.kind === "directory") {
                    onSelect(entry);
                    onToggle(entry);
                    return;
                  }
                  if (selectedPath === entry.path) {
                    onOpen(entry);
                    return;
                  }
                  onSelect(entry);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSelect(entry);
                  onContextMenu(entry, event.clientX, event.clientY);
                }}
              >
              {entry.kind === "directory" ? (
                expanded.has(entry.path) ? <ChevronDown size={14} /> : <ChevronRight size={14} />
              ) : (
                <span className="tree-spacer" />
              )}
              {entry.kind === "directory" ? (
                expanded.has(entry.path)
                  ? <FolderOpen className="tree-entry__icon tree-entry__icon--directory" size={15} />
                  : <Folder className="tree-entry__icon tree-entry__icon--directory" size={15} />
              ) : contributedIcon ? (
                <span
                  className="resource-icon"
                  title={contributedIcon.title}
                  style={{
                    color: contributedIcon.foreground ?? "currentColor",
                    background: contributedIcon.background ?? "transparent",
                  }}
                >{contributedIcon.label}</span>
              ) : (
                <File className="tree-entry__icon tree-entry__icon--file" size={15} />
              )}
              <span
                className="tree-entry__name"
                title={decoration?.tooltip}
                style={decoration?.foreground ? { color: decoration.foreground } : undefined}
              >{entry.name}</span>
              {decoration?.badge ? <span className="tree-entry__badge">{decoration.badge}</span> : null}
              </button>
            )}
          </div>
          {entry.kind === "directory" && expanded.has(entry.path) && (entry.children || creationParentPath === entry.path) ? (
            <div className="tree-children">
              {creationKind && creationParentPath === entry.path ? (
                <EntryTree
                  entries={entry.children ?? []}
                  parentPath={entry.path}
                  expanded={expanded}
                  showHidden={showHidden}
                  revealHidden={showHidden || revealedHiddenPaths.has(entry.path)}
                  revealedHiddenPaths={revealedHiddenPaths}
                  highlightedPath={highlightedPath}
                  selectedPath={selectedPath}
                  resourceDecorations={resourceDecorations}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  onOpen={onOpen}
                  onContextMenu={onContextMenu}
                  onMove={onMove}
                  draggingPath={draggingPath}
                  dropTargetPath={dropTargetPath}
                  onDraggingPathChange={onDraggingPathChange}
                  onDropTargetPathChange={onDropTargetPathChange}
                  onShowHiddenDirectory={onShowHiddenDirectory}
                  renamePath={renamePath}
                  renameName={renameName}
                  renameError={renameError}
                  onRenameNameChange={onRenameNameChange}
                  onRenameSubmit={onRenameSubmit}
                  onRenameCancel={onRenameCancel}
                  creationKind={creationKind}
                  creationParentPath={creationParentPath}
                  creationName={creationName}
                  creationError={creationError}
                  onCreationNameChange={onCreationNameChange}
                  onCreationSubmit={onCreationSubmit}
                  onCreationCancel={onCreationCancel}
                  workspaceName={workspaceName}
                  {...(workspaceRoot ? { workspaceRoot } : {})}
                />
              ) : explorerDirectoryEmptyState(entry.children, showHidden || revealedHiddenPaths.has(entry.path)) === "hidden-only" ? (
                <button className="tree-empty-state tree-empty-state--action" type="button" onClick={() => onShowHiddenDirectory(entry.path)}>
                  Contém {hiddenExplorerEntryCount(entry.children)} {hiddenExplorerEntryCount(entry.children) === 1 ? "arquivo oculto" : "arquivos ocultos"}. Exibir?
                </button>
              ) : explorerDirectoryEmptyState(entry.children, showHidden || revealedHiddenPaths.has(entry.path)) === "empty" ? (
                <div className="tree-empty-state">Pasta vazia</div>
              ) : (
                <EntryTree
                  entries={entry.children ?? []}
                  parentPath={entry.path}
                  expanded={expanded}
                  showHidden={showHidden}
                  revealHidden={showHidden || revealedHiddenPaths.has(entry.path)}
                  revealedHiddenPaths={revealedHiddenPaths}
                  highlightedPath={highlightedPath}
                  selectedPath={selectedPath}
                  resourceDecorations={resourceDecorations}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  onOpen={onOpen}
                  onContextMenu={onContextMenu}
                  onMove={onMove}
                  draggingPath={draggingPath}
                  dropTargetPath={dropTargetPath}
                  onDraggingPathChange={onDraggingPathChange}
                  onDropTargetPathChange={onDropTargetPathChange}
                  onShowHiddenDirectory={onShowHiddenDirectory}
                  renamePath={renamePath}
                  renameName={renameName}
                  renameError={renameError}
                  onRenameNameChange={onRenameNameChange}
                  onRenameSubmit={onRenameSubmit}
                  onRenameCancel={onRenameCancel}
                  creationKind={creationKind}
                  creationParentPath={creationParentPath}
                  creationName={creationName}
                  creationError={creationError}
                  onCreationNameChange={onCreationNameChange}
                  onCreationSubmit={onCreationSubmit}
                  onCreationCancel={onCreationCancel}
                  workspaceName={workspaceName}
                  {...(workspaceRoot ? { workspaceRoot } : {})}
                />
              )}
            </div>
          ) : null}
        </div>;
      })}
    </div>
  );
}

function HighlightedSource({ source, provider }: { readonly source: string; readonly provider: LanguageProvider }) {
  const tokens = [...provider.highlight(source)].sort((left, right) => left.start - right.start);
  const fragments: React.ReactNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor || token.start < 0 || token.end > source.length) continue;
    if (token.start > cursor) fragments.push(source.slice(cursor, token.start));
    fragments.push(<span className={`syntax-${token.scope}`} key={`${token.start}:${token.end}`}>{source.slice(token.start, token.end)}</span>);
    cursor = token.end;
  }
  if (cursor < source.length) fragments.push(source.slice(cursor));
  fragments.push("\n");
  return <>{fragments}</>;
}

function HighlightedLine({ source, provider }: { readonly source: string; readonly provider: LanguageProvider | undefined }) {
  if (!provider) return <>{source}</>;
  const tokens = [...provider.highlight(source)].sort((left, right) => left.start - right.start);
  const fragments: React.ReactNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor || token.start < 0 || token.end > source.length) continue;
    if (token.start > cursor) fragments.push(source.slice(cursor, token.start));
    fragments.push(<span className={`syntax-${token.scope}`} key={`${token.start}:${token.end}`}>{source.slice(token.start, token.end)}</span>);
    cursor = token.end;
  }
  if (cursor < source.length) fragments.push(source.slice(cursor));
  return <>{fragments}</>;
}

function EditorLineDiffPeek({
  decoration,
  provider,
  top,
  onClose,
  onAction,
}: {
  readonly decoration: TextEditorLineDecoration;
  readonly provider: LanguageProvider | undefined;
  readonly top: number;
  readonly onClose: () => void;
  readonly onAction: (action: NonNullable<TextEditorLineDecoration["actions"]>[number]) => void;
}) {
  const change = decoration.change;
  if (!change) return null;
  const allLines = [...change.before, ...change.after].map((line) => line.line);
  const width = Math.max(2, String(Math.max(1, ...allLines)).length);
  const rows = [
    ...change.before.map((line) => ({ ...line, kind: "before" as const, marker: "−" })),
    ...change.after.map((line) => ({ ...line, kind: "after" as const, marker: "+" })),
  ];
  return (
    <section
      className="editor-line-diff-peek"
      aria-label={`Diferença da linha ${decoration.line}`}
      style={{ "--editor-line-diff-top": `${top}px` } as React.CSSProperties}
    >
      <div className="editor-line-diff-peek__heading">
        <div>
          <span className={`editor-line-diff-peek__status is-${decoration.kind}`} />
          <strong>{decoration.label ?? decoration.tooltip ?? `Alteração na linha ${decoration.line}`}</strong>
        </div>
        <div className="editor-line-diff-peek__actions">
          {decoration.actions?.map((action) => {
            const ActionIcon = action.id.includes("revert")
              ? Undo2
              : action.id.includes("diff")
                ? Code2
                : MoreVertical;
            return (
              <button
                className="icon-button small editor-line-diff-peek__action"
                key={action.id}
                type="button"
                title={action.title ?? action.label}
                aria-label={action.label}
                onClick={() => onAction(action)}
              >
                <ActionIcon size={14} />
              </button>
            );
          })}
          <button
            className="icon-button small editor-line-diff-peek__action"
            type="button"
            title="Fechar"
            aria-label="Fechar diff da linha"
            onClick={onClose}
          ><X size={14} /></button>
        </div>
      </div>
      <div className="editor-line-diff-peek__code">
        {rows.length ? rows.map((line, index) => (
          <div className={`editor-line-diff-peek__row is-${line.kind}`} key={`${line.kind}:${line.line}:${index}`}>
            <span className="editor-line-diff-peek__marker">{line.marker}</span>
            <span className="editor-line-diff-peek__line-number">{String(line.line).padStart(width, "0")}</span>
            <pre><HighlightedLine source={line.content} provider={provider} /></pre>
          </div>
        )) : <div className="editor-line-diff-peek__empty">Alteração sem conteúdo textual.</div>}
      </div>
    </section>
  );
}

function DiagnosticLayer({
  diagnostics,
  source,
  hoveredLine,
}: {
  readonly diagnostics: readonly TextDiagnostic[];
  readonly source: string;
  readonly hoveredLine: number | undefined;
}) {
  const sourceLines = source.split(/\r?\n/);
  const diagnosticsByLine = new Map<number, TextDiagnostic[]>();
  diagnostics.forEach((diagnostic) => {
    const current = diagnosticsByLine.get(diagnostic.line) ?? [];
    current.push(diagnostic);
    diagnosticsByLine.set(diagnostic.line, current);
  });

  return (
    <div className="diagnostic-layer">
      {[...diagnosticsByLine.entries()].map(([line, lineDiagnostics]) => {
        const severity = lineDiagnostics.some((diagnostic) => diagnostic.severity === "error")
          ? "error"
          : lineDiagnostics.some((diagnostic) => diagnostic.severity === "warning")
            ? "warning"
            : "information";
        const lineLength = sourceLines[line - 1]?.length ?? 0;
        return (
          <div
            className={`diagnostic-line diagnostic-line--${severity}${hoveredLine === line ? " is-hovered" : ""}`}
            key={line}
            style={{
              "--diagnostic-line": line,
              "--diagnostic-line-length": lineLength,
            } as React.CSSProperties}
            aria-hidden={hoveredLine === line ? undefined : true}
          >
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  className="diagnostic-line__details"
                  type="button"
                  aria-label={`Detalhes dos problemas na linha ${line}`}
                >
                  <CircleAlert size={14} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="tooltip diagnostic-tooltip" side="right" sideOffset={7}>
                  {lineDiagnostics.map((diagnostic, index) => (
                    <span key={`${diagnostic.column}:${diagnostic.code ?? index}`}>
                      <strong>{diagnostic.line}:{diagnostic.column}</strong>
                      {diagnostic.message}
                    </span>
                  ))}
                  <Tooltip.Arrow className="tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        );
      })}
    </div>
  );
}

async function hydrateExpandedEntries(
  entries: readonly WorkspaceEntry[],
  expanded: ReadonlySet<string>,
): Promise<readonly WorkspaceEntry[]> {
  return Promise.all(entries.map(async (entry) => {
    if (entry.kind !== "directory" || !entry.handle || !expanded.has(entry.path)) return entry;
    const children = await listDirectory(entry.handle as BrowserDirectoryHandle, entry.path);
    return { ...entry, children: await hydrateExpandedEntries(children, expanded) };
  }));
}

function ProfileDialog({
  open,
  onOpenChange,
  profiles,
  selectedId,
  environments,
  executableOptions,
  onBrowseCommand,
  onChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly profiles: readonly ExecutionProfile[];
  readonly selectedId: string | undefined;
  readonly environments: readonly ExecutionEnvironment[];
  readonly executableOptions: readonly ExecutionProfileExecutableOption[];
  readonly onBrowseCommand: () => Promise<string | undefined>;
  readonly onChange: (profiles: readonly ExecutionProfile[], selectedId?: string) => void;
}) {
  const [drafts, setDrafts] = useState<readonly ExecutionProfile[]>(profiles);
  const [editingId, setEditingId] = useState<string | undefined>(selectedId ?? profiles[0]?.id);
  const [removalId, setRemovalId] = useState<string>();
  const [parameterDrafts, setParameterDrafts] = useState<Readonly<Record<string, string>>>({});
  const [parameterError, setParameterError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setDrafts(profiles);
    setEditingId(selectedId ?? profiles[0]?.id);
    setRemovalId(undefined);
    setParameterDrafts(Object.fromEntries(profiles.map((profile) => [
      profile.id,
      formatCommandLineArguments(profile.steps[0]?.parameters ?? []),
    ])));
    setParameterError(undefined);
  }, [open, profiles, selectedId]);

  const editing = drafts.find((profile) => profile.id === editingId);
  const step = editing?.steps[0];
  const editingEnvironmentId = editing?.environment.mode === "fixed"
    ? editing.environment.environmentId
    : undefined;

  const updateEditing = (update: (profile: ExecutionProfile) => ExecutionProfile) => {
    if (!editingId) return;
    setDrafts((current) => current.map((profile) => (profile.id === editingId ? update(profile) : profile)));
  };

  const addProfile = () => {
    const profile = makeProfile();
    setDrafts((current) => [...current, profile]);
    setParameterDrafts((current) => ({ ...current, [profile.id]: "" }));
    setEditingId(profile.id);
  };

  const removeProfile = (id: string) => {
    setDrafts((current) => current.filter((profile) => profile.id !== id));
    setParameterDrafts((current) => Object.fromEntries(Object.entries(current).filter(([profileId]) => profileId !== id)));
    if (editingId === id) setEditingId(undefined);
    setRemovalId(undefined);
  };

  const saveProfiles = () => {
    try {
      const parsedDrafts = drafts.map((profile) => {
        const rawParameters = parameterDrafts[profile.id]
          ?? formatCommandLineArguments(profile.steps[0]?.parameters ?? []);
        const parameters = rawParameters.trim() ? parseCommandLineArguments(rawParameters) : [];
        return {
          ...profile,
          steps: profile.steps.map((profileStep, index) => index === 0
            ? { ...profileStep, parameters }
            : profileStep),
        };
      });
      setParameterError(undefined);
      onChange(parsedDrafts, editing?.id);
      onOpenChange(false);
    } catch (cause) {
      setParameterError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const removalProfile = drafts.find((profile) => profile.id === removalId);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content profile-dialog">
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">EXECUÇÃO</span>
              <Dialog.Title>Perfis de execução</Dialog.Title>
              <Dialog.Description>Configure comandos reutilizáveis sem acoplar linguagem ao core.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="icon-button" type="button" aria-label="Fechar">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          <div className="profile-layout">
            <aside className="profile-list-panel">
              <div className="section-title-row">
                <strong>Perfis</strong>
                <span>{drafts.length}</span>
              </div>
              <div className="profile-list">
                {drafts.map((profile) => (
                  <article
                    key={profile.id}
                    className={`profile-card${editingId === profile.id ? " is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="profile-card__select"
                      onClick={() => setEditingId(profile.id)}
                    >
                      <Terminal size={16} />
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{profile.steps.length} etapa(s)</small>
                      </span>
                    </button>
                    <button
                      className="card-delete"
                      type="button"
                      aria-label={`Remover ${profile.name}`}
                      title={`Remover ${profile.name}`}
                      onClick={() => setRemovalId(profile.id)}
                    >
                      <X size={14} />
                    </button>
                  </article>
                ))}
              </div>
              <button className="button secondary full" type="button" onClick={addProfile}>
                <Plus size={15} /> Novo perfil
              </button>
            </aside>

            <div className="profile-editor">
              {editing && step ? (
                <>
                  <div className="form-grid two-columns">
                    <label>
                      Nome do perfil
                      <input
                        value={editing.name}
                        placeholder="Ex.: Servidor de desenvolvimento"
                        onChange={(event) => updateEditing((profile) => ({ ...profile, name: event.target.value }))}
                      />
                    </label>
                    <label>
                      Ambiente
                      <select
                        value={editing.environment.mode === "fixed" ? editing.environment.environmentId : ""}
                        onChange={(event) => updateEditing((profile) => ({
                          ...profile,
                          environment: event.target.value
                            ? { mode: "fixed", environmentId: event.target.value }
                            : { mode: "none" },
                          steps: profile.steps.map((item, index) => index === 0
                            ? {
                                ...item,
                                executable: event.target.value ? "${environmentExecutable}" : item.executable,
                              }
                            : item),
                        }))}
                      >
                        <option value="">Nenhum ambiente</option>
                        {environments.map((environment) => (
                          <option key={environment.id} value={environment.id}>
                            {environment.name}{environment.version ? ` — ${environment.version}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <section className="form-section">
                    <div className="form-section-heading">
                      <Terminal size={17} />
                      <div>
                        <strong>Comando</strong>
                        <small>Primeira etapa do perfil.</small>
                      </div>
                    </div>
                    <label>
                      Executável
                      <input
                        value={editingEnvironmentId
                          ? environments.find((environment) => environment.id === editingEnvironmentId)?.executable ?? ""
                          : step.executable}
                        placeholder="Ex.: node, python, bash ou caminho completo"
                        readOnly={Boolean(editingEnvironmentId)}
                        onChange={(event) => updateEditing((profile) => ({
                          ...profile,
                          steps: profile.steps.map((item, index) => index === 0 ? { ...item, executable: event.target.value } : item),
                        }))}
                      />
                    </label>
                    {editing.environment.mode === "none" && executableOptions.filter((option) => !option.environmentId).length ? (
                      <div className="profile-executable-options">
                        {executableOptions.filter((option) => !option.environmentId).map((option) => (
                          <button
                            className="button secondary compact"
                            type="button"
                            key={option.id}
                            onClick={() => updateEditing((profile) => ({
                              ...profile,
                              steps: profile.steps.map((item, index) => index === 0
                                ? { ...item, executable: option.value }
                                : item),
                            }))}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <label>
                      Comando ou arquivo
                      <div className="path-row">
                        <input
                          value={step.command}
                          placeholder="Ex.: caminho/do/arquivo ou subcomando"
                          onChange={(event) => updateEditing((profile) => ({
                            ...profile,
                            steps: profile.steps.map((item, index) => index === 0 ? { ...item, command: event.target.value } : item),
                          }))}
                        />
                        <button className="button secondary compact" type="button" onClick={() => {
                          void onBrowseCommand().then((path) => {
                            if (!path) return;
                            updateEditing((profile) => ({
                              ...profile,
                              steps: profile.steps.map((item, index) => index === 0 ? { ...item, command: path } : item),
                            }));
                          });
                        }}>Procurar</button>
                      </div>
                    </label>
                    <label>
                      Parâmetros
                      <textarea
                        rows={5}
                        value={parameterDrafts[editing.id] ?? formatCommandLineArguments(step.parameters)}
                        placeholder="Ex.: --port 8000 --verbose"
                        onChange={(event) => {
                          setParameterDrafts((current) => ({ ...current, [editing.id]: event.target.value }));
                          setParameterError(undefined);
                        }}
                      />
                      {parameterError ? <small className="field-error">{parameterError}</small> : null}
                    </label>
                    <label>
                      Diretório de trabalho
                      <input
                        value={step.workingDirectory ?? ""}
                        placeholder="Ex.: ${workspaceRoot} ou caminho absoluto"
                        onChange={(event) => updateEditing((profile) => ({
                          ...profile,
                          steps: profile.steps.map((item, index) => index === 0
                            ? { ...item, workingDirectory: event.target.value }
                            : item),
                        }))}
                      />
                    </label>
                    <label>
                      Variáveis de ambiente
                      <textarea
                        rows={4}
                        value={environmentVariablesText(step.environmentVariables)}
                        placeholder="Ex.: DEBUG=1"
                        onChange={(event) => {
                          try {
                            const environmentVariables = parseEnvironmentVariables(event.target.value);
                            updateEditing((profile) => ({
                              ...profile,
                              steps: profile.steps.map((item, index) => index === 0
                                ? { ...item, environmentVariables }
                                : item),
                            }));
                          } catch {
                            // Preserve the last valid value while the user is still typing.
                          }
                        }}
                      />
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={step.continueOnError === true}
                        onChange={(event) => updateEditing((profile) => ({
                          ...profile,
                          steps: profile.steps.map((item, index) => index === 0
                            ? { ...item, continueOnError: event.target.checked }
                            : item),
                        }))}
                      />
                      Continuar após falha
                    </label>
                  </section>

                  <div className="dialog-footer">
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={editing.saveBeforeRun !== false}
                        onChange={(event) => updateEditing((profile) => ({ ...profile, saveBeforeRun: event.target.checked }))}
                      />
                      Salvar antes de executar
                    </label>
                    <div className="dialog-actions">
                      <Dialog.Close asChild>
                        <button className="button secondary" type="button">Cancelar</button>
                      </Dialog.Close>
                      <button
                        className="button primary"
                        type="button"
                        onClick={saveProfiles}
                      >
                        <Save size={15} /> Salvar perfis
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-panel">
                  <Settings2 size={28} />
                  <strong>Selecione ou crie um perfil</strong>
                </div>
              )}
            </div>
          </div>
          {removalProfile ? (
            <div className="profile-removal-backdrop" role="presentation">
              <section className="profile-removal-dialog" role="alertdialog" aria-modal="true" aria-labelledby="profile-removal-title">
                <div>
                  <span className="eyebrow">CONFIRMAÇÃO</span>
                  <h3 id="profile-removal-title">Remover perfil?</h3>
                  <p>O perfil <strong>{removalProfile.name}</strong> será removido quando as alterações forem salvas.</p>
                </div>
                <div className="dialog-actions">
                  <button className="button secondary" type="button" onClick={() => setRemovalId(undefined)}>Cancelar</button>
                  <button className="button danger" type="button" onClick={() => removeProfile(removalProfile.id)}>Remover</button>
                </div>
              </section>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkbenchSidebarHost({
  provider,
  state,
  onClose,
}: {
  readonly provider: WorkbenchSidebarContribution;
  readonly state: WorkbenchStateApi;
  readonly onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let mountedDisposable: { dispose(): void } | void;
    try {
      const mounted = provider.mount({ container, state, close: onClose });
      if (mounted && typeof (mounted as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(mounted)
          .then((disposable) => {
            if (disposed) disposable?.dispose();
            else mountedDisposable = disposable;
          })
          .catch((cause) => {
            if (!disposed) container.textContent = cause instanceof Error ? cause.message : String(cause);
          });
      } else {
        mountedDisposable = mounted as void | { dispose(): void };
      }
    } catch (cause) {
      container.textContent = cause instanceof Error ? cause.message : String(cause);
    }
    return () => {
      disposed = true;
      mountedDisposable?.dispose();
      container.replaceChildren();
    };
  }, [provider, state, onClose]);

  return <div className="plugin-sidebar-host" ref={containerRef} data-sidebar-id={provider.id} />;
}

function WorkbenchPanelHost({
  provider,
  state,
}: {
  readonly provider: WorkbenchPanelContribution;
  readonly state: WorkbenchStateApi;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let mountedDisposable: { dispose(): void } | void;
    try {
      const mounted = provider.mount({ container, state });
      if (mounted && typeof (mounted as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(mounted)
          .then((disposable) => {
            if (disposed) disposable?.dispose();
            else mountedDisposable = disposable;
          })
          .catch((cause) => {
            if (!disposed) container.textContent = cause instanceof Error ? cause.message : String(cause);
          });
      } else {
        mountedDisposable = mounted as void | { dispose(): void };
      }
    } catch (cause) {
      container.textContent = cause instanceof Error ? cause.message : String(cause);
    }

    return () => {
      disposed = true;
      mountedDisposable?.dispose();
      container.replaceChildren();
    };
  }, [provider, state]);

  return <div className="plugin-panel-host" ref={containerRef} data-panel-id={provider.id} />;
}

function WorkbenchToolWindowHost({
  provider,
  state,
  visible,
  height,
  onClose,
  onResize,
  onResetHeight,
}: {
  readonly provider: WorkbenchToolWindowContribution;
  readonly state: WorkbenchStateApi;
  readonly visible: boolean;
  readonly height: number;
  readonly onClose: () => void;
  readonly onResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onResetHeight: () => void;
}) {
  const headerContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const headerContainer = headerContainerRef.current;
    const container = containerRef.current;
    if (!headerContainer || !container) return;
    let disposed = false;
    let mountedDisposable: { dispose(): void } | void;
    const tabs = createWorkbenchTabApi(headerContainer);
    try {
      const mounted = provider.mount({ headerContainer, container, state, tabs, close: onClose });
      if (mounted && typeof (mounted as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(mounted)
          .then((disposable) => {
            if (disposed) disposable?.dispose();
            else mountedDisposable = disposable;
          })
          .catch((cause) => {
            if (!disposed) container.textContent = cause instanceof Error ? cause.message : String(cause);
          });
      } else {
        mountedDisposable = mounted as void | { dispose(): void };
      }
    } catch (cause) {
      container.textContent = cause instanceof Error ? cause.message : String(cause);
    }

    return () => {
      disposed = true;
      mountedDisposable?.dispose();
      tabs.dispose();
      headerContainer.replaceChildren();
      container.replaceChildren();
    };
  }, [provider, state, onClose]);

  return (
    <section
      className={`tool-window-panel${visible ? "" : " tool-window-panel--hidden"}`}
      style={{ height }}
      data-tool-window-id={provider.id}
    >
      <div
        className="resize-handle resize-handle--panel"
        role="separator"
        aria-label={`Redimensionar ${provider.label}`}
        onPointerDown={onResize}
        onDoubleClick={onResetHeight}
      />
      <div className="panel-heading tool-window-heading">
        <div className="tool-window-header-content" ref={headerContainerRef} />
        <button
          className="icon-button small"
          type="button"
          aria-label={`Fechar painel ${provider.label}`}
          onClick={onClose}
        ><X size={14} /></button>
      </div>
      <div className="plugin-panel-host" ref={containerRef} data-panel-id={provider.id} />
    </section>
  );
}

function WorkbenchDialogHost({
  provider,
  onClose,
}: {
  readonly provider: WorkbenchDialogContribution;
  readonly onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let mountedDisposable: { dispose(): void } | void;
    try {
      const mounted = provider.mount({ container, close: onClose });
      if (mounted && typeof (mounted as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(mounted)
          .then((disposable) => {
            if (disposed) disposable?.dispose();
            else mountedDisposable = disposable;
          })
          .catch((cause) => {
            if (!disposed) container.textContent = cause instanceof Error ? cause.message : String(cause);
          });
      } else {
        mountedDisposable = mounted as void | { dispose(): void };
      }
    } catch (cause) {
      container.textContent = cause instanceof Error ? cause.message : String(cause);
    }

    return () => {
      disposed = true;
      mountedDisposable?.dispose();
      container.replaceChildren();
    };
  }, [provider, onClose]);

  return <div className="plugin-dialog-host" ref={containerRef} data-dialog-id={provider.id} />;
}

function WorkbenchTitlebarHost({
  provider,
  state,
}: {
  readonly provider: WorkbenchTitlebarContribution;
  readonly state: WorkbenchStateApi;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let mountedDisposable: { dispose(): void } | void;
    const mounted = provider.mount({container, state});
    if (mounted && typeof (mounted as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(mounted).then((disposable) => {
        if (disposed) disposable?.dispose();
        else mountedDisposable = disposable;
      });
    } else {
      mountedDisposable = mounted as void | {dispose(): void};
    }
    return () => {
      disposed = true;
      mountedDisposable?.dispose();
      container.replaceChildren();
    };
  }, [provider, state]);
  return <div className="titlebar-plugin-actions" data-titlebar-contribution={provider.id} ref={containerRef} />;
}

async function readOpenDocumentBlob(document: OpenDocument): Promise<Blob> {
  if (document.handle) return document.handle.getFile();
  if (document.kind === "text") {
    return new Blob([document.content], { type: document.mediaType || "text/plain;charset=utf-8" });
  }
  throw new Error("O conteúdo binário não está mais disponível. Reabra o arquivo pelo workspace.");
}

function ResourceEditorHost({
  provider,
  document,
}: {
  readonly provider: WorkbenchResourceEditorProvider;
  readonly document: OpenDocument;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef(document);
  documentRef.current = document;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let mountedDisposable: { dispose(): void } | void;
    try {
      const mounted = provider.mount({
        container,
        resource: workbenchResourceDescriptor(document),
        read: () => readOpenDocumentBlob(documentRef.current),
      });
      if (mounted && typeof (mounted as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(mounted)
          .then((disposable) => {
            if (disposed) disposable?.dispose();
            else mountedDisposable = disposable;
          })
          .catch((cause) => {
            if (!disposed) container.textContent = cause instanceof Error ? cause.message : String(cause);
          });
      } else {
        mountedDisposable = mounted as void | { dispose(): void };
      }
    } catch (cause) {
      container.textContent = cause instanceof Error ? cause.message : String(cause);
    }
    return () => {
      disposed = true;
      mountedDisposable?.dispose();
      container.replaceChildren();
    };
  }, [provider, document.id]);

  return (
    <div
      className="resource-editor resource-editor--plugin"
      ref={containerRef}
      data-resource-editor-provider={provider.id}
    />
  );
}

function NativeImageEditor({ document }: { readonly document: OpenDocument }) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState<string>();
  const [dimensions, setDimensions] = useState<string>();

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setSource(undefined);
    setError(undefined);
    setDimensions(undefined);
    void readOpenDocumentBlob(document)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document.id, document.handle, document.size, document.mediaType]);

  return (
    <section className="resource-editor resource-editor--image" data-resource-kind="image">
      <div className="resource-editor__viewport">
        {source ? (
          <img
            src={source}
            alt={document.name}
            onLoad={(event) => {
              const image = event.currentTarget;
              setDimensions(`${image.naturalWidth} × ${image.naturalHeight}`);
            }}
          />
        ) : error ? (
          <div className="resource-editor__message is-error"><FileWarning size={34} /><strong>Não foi possível exibir a imagem.</strong><p>{error}</p></div>
        ) : (
          <div className="resource-editor__message"><ImageIcon size={34} /><strong>Carregando imagem…</strong></div>
        )}
      </div>
      <footer className="resource-editor__meta">
        <span>{document.mediaType}</span>
        {dimensions ? <span>{dimensions}</span> : null}
        <span>{formatByteSize(document.size)}</span>
      </footer>
    </section>
  );
}

function formatByteSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

function UnsupportedBinaryEditor({ document }: { readonly document: OpenDocument }) {
  return (
    <section className="resource-editor resource-editor--unsupported" data-resource-kind="binary">
      <div className="resource-editor__message">
        <FileWarning size={38} />
        <strong>Este arquivo não pode ser aberto no editor.</strong>
        <p>Nenhum plugin instalado oferece um visualizador para este formato binário.</p>
        <small>{document.mediaType} · {formatByteSize(document.size)}</small>
      </div>
    </section>
  );
}

export function App() {
  const initialSession = useMemo(() => readSession(), []);
  const [platformSnapshot, setPlatformSnapshot] = useState(() => platform.snapshot());
  const [sidebarView, setSidebarView] = useState<SidebarView>(initialSession.sidebarView);
  const [sidebarVisible, setSidebarVisible] = useState(initialSession.sidebarVisible);
  const [sidebarWidth, setSidebarWidth] = useState(initialSession.sidebarWidth);
  const [panelVisible, setPanelVisible] = useState(initialSession.panelVisible);
  const [panelHeight, setPanelHeight] = useState(initialSession.panelHeight);
  const [panelTab, setPanelTab] = useState(initialSession.panelTab);
  const [toolWindowVisible, setToolWindowVisible] = useState(initialSession.toolWindowVisible);
  const [toolWindowHeight, setToolWindowHeight] = useState(initialSession.toolWindowHeight);
  const [activeToolWindowId, setActiveToolWindowId] = useState<string | undefined>(initialSession.activeToolWindowId);
  const [workspaceHandle, setWorkspaceHandle] = useState<BrowserDirectoryHandle>();
  const [workspaceName, setWorkspaceName] = useState(initialSession.workspaceName);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | undefined>(initialSession.workspaceRoot);
  const [entries, setEntries] = useState<readonly WorkspaceEntry[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(initialSession.expandedDirectories));
  const [explorerShowHidden, setExplorerShowHidden] = useState(initialSession.explorerShowHidden);
  const [explorerRevealedHiddenPaths, setExplorerRevealedHiddenPaths] = useState<ReadonlySet<string>>(new Set());
  const [documents, setDocuments] = useState<readonly OpenDocument[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | undefined>(initialSession.activeDocumentId);
  const [output, setOutput] = useState<string[]>(["tinyIde React shell inicializado."]);
  const [diagnostics, setDiagnostics] = useState<readonly TextDiagnostic[]>([]);
  const [hoveredDiagnosticLine, setHoveredDiagnosticLine] = useState<number>();
  const [environments, setEnvironments] = useState<readonly ExecutionEnvironment[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | undefined>();
  const [environmentBusy, setEnvironmentBusy] = useState(false);
  const [environmentForm, setEnvironmentForm] = useState<"addExecutable" | "importEnvironment" | "createEnvironment" | "dependencies" | "edit">();
  const [editingEnvironmentId, setEditingEnvironmentId] = useState<string>();
  const [environmentPath, setEnvironmentPath] = useState("");
  const [environmentBrowserMode, setEnvironmentBrowserMode] = useState<"directory" | "file">();
  const [environmentListing, setEnvironmentListing] = useState<ExecutionEnvironmentDirectoryListing>();
  const [environmentBrowserFilter, setEnvironmentBrowserFilter] = useState("");
  const [environmentBrowserHidden, setEnvironmentBrowserHidden] = useState(false);
  const [environmentBrowserSelection, setEnvironmentBrowserSelection] = useState<string>();
  const [environmentBrowserExecutableOnly, setEnvironmentBrowserExecutableOnly] = useState(false);
  const [executableOptions, setExecutableOptions] = useState<readonly ExecutionProfileExecutableOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeProcessId, setActiveProcessId] = useState<string>();
  const [resumedProcessId, setResumedProcessId] = useState<string>();
  const [profilesState, setProfilesState] = useState<StoredProfiles>({ profiles: [] });
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings>(EMPTY_WORKSPACE_SETTINGS);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [lintSettingsOpen, setLintSettingsOpen] = useState(false);
  const [lintEnabledRuleIds, setLintEnabledRuleIds] = useState<readonly string[]>([]);
  const [pluginRemovalId, setPluginRemovalId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSectionId, setSettingsSectionId] = useState("editor");
  const [pluginSettingsDraft, setPluginSettingsDraft] = useState<PluginSettingValues>({});
  const [workbenchDialog, setWorkbenchDialog] = useState<ActiveWorkbenchDialog>();
  const [editorLineDecorations, setEditorLineDecorations] = useState<readonly TextEditorLineDecoration[]>([]);
  const [selectedEditorLineDecoration, setSelectedEditorLineDecoration] = useState<TextEditorLineDecoration>();
  const [editorDecorationRevision, setEditorDecorationRevision] = useState(0);
  const [resourceDecorations, setResourceDecorations] = useState<ReadonlyMap<string, ResourceDecoration>>(new Map());
  const [resourceDecorationRevision, setResourceDecorationRevision] = useState(0);
  const [restorationComplete, setRestorationComplete] = useState(false);
  const [error, setError] = useState<string>();
  const [workspaceAccess, setWorkspaceAccess] = useState<"ready" | "permission-required" | "missing">("ready");
  const [explorerCreation, setExplorerCreation] = useState<"file" | "directory">();
  const [explorerCreationParentPath, setExplorerCreationParentPath] = useState("");
  const [explorerCreationName, setExplorerCreationName] = useState("");
  const [explorerCreationError, setExplorerCreationError] = useState<string>();
  const [explorerRenamePath, setExplorerRenamePath] = useState<string>();
  const [explorerRenameName, setExplorerRenameName] = useState("");
  const [explorerRenameError, setExplorerRenameError] = useState<string>();
  const [explorerPendingDeletion, setExplorerPendingDeletion] = useState<WorkspaceEntry>();
  const [highlightedExplorerPath, setHighlightedExplorerPath] = useState<string>();
  const [selectedExplorerPath, setSelectedExplorerPath] = useState<string>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [draggingExplorerPath, setDraggingExplorerPath] = useState<string>();
  const [dropTargetExplorerPath, setDropTargetExplorerPath] = useState<string>();
  const restoredRef = useRef(false);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const explorerHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const browserResolverRef = useRef<((path: string | undefined) => void) | undefined>(undefined);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightedEditorScrollRef = useRef<HTMLDivElement | null>(null);
  const editorLineRulerRef = useRef<HTMLPreElement | null>(null);
  const editorHistoriesRef = useRef<Map<string, EditorHistory>>(new Map());
  const documentsRef = useRef<readonly OpenDocument[]>(documents);
  documentsRef.current = documents;
  const workspaceSettingsRef = useRef<WorkspaceSettings>(EMPTY_WORKSPACE_SETTINGS);
  const workspaceSettingsWriteQueueRef = useRef<Promise<WorkspaceSettings>>(Promise.resolve(EMPTY_WORKSPACE_SETTINGS));
  const workbenchStateRef = useRef<WorkbenchStateSnapshot>({
    workspaceName,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    activeSidebarId: sidebarView,
    sidebarVisible,
    activePanelId: panelTab,
    panelVisible,
    ...(activeToolWindowId ? { activeToolWindowId } : {}),
    toolWindowVisible,
    ...(selectedEnvironmentId ? { selectedExecutionEnvironmentId: selectedEnvironmentId } : {}),
    pluginSettings: workspaceSettings.plugins ?? {},
  });
  const workbenchStateListenersRef = useRef(new Set<(snapshot: WorkbenchStateSnapshot) => void>());
  const workbenchState = useMemo<WorkbenchStateApi>(() => ({
    snapshot: () => workbenchStateRef.current,
    subscribe: (listener) => {
      workbenchStateListenersRef.current.add(listener);
      return { dispose: () => workbenchStateListenersRef.current.delete(listener) };
    },
  }), []);

  const activeDocument = documents.find((document) => document.id === activeDocumentId);
  const [editorToolbarItems, setEditorToolbarItems] = useState<readonly WorkbenchEditorToolbarItem[]>([]);
  const activeResourceEditorProvider = resourceEditorProviderFor(activeDocument);
  const activeLanguageProvider = activeResourceEditorProvider ? undefined : languageProviderFor(activeDocument);
  const workbenchSidebars = useMemo(() => platform.capabilities
    .getAll<WorkbenchSidebarHook>("workbench.sidebar.hook")
    .flatMap((hook) => hook.contribute())
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.label.localeCompare(right.label)), [platformSnapshot]);
  const activePluginSidebar = workbenchSidebars.find((sidebar) => sidebar.id === sidebarView);
  const workbenchPanels = useMemo(() => platform.capabilities
    .getAll<WorkbenchPanelHook>("workbench.panel.hook")
    .flatMap((hook) => hook.contribute())
    .flatMap(expandWorkbenchPanelContribution)
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.label.localeCompare(right.label)), [platformSnapshot]);
  const workbenchToolWindows = useMemo(() => platform.capabilities
    .getAll<WorkbenchToolWindowHook>("workbench.toolWindow.hook")
    .flatMap((hook) => hook.contribute())
    .flatMap(expandWorkbenchToolWindowContribution)
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.label.localeCompare(right.label)), [platformSnapshot]);
  const workbenchTitlebarContributions = useMemo(() => platform.capabilities
    .getAll<WorkbenchTitlebarContribution>("workbench.titlebar")
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)), [platformSnapshot]);
  useEffect(() => {
    let cancelled = false;
    if (!activeDocument || activeDocument.kind !== "text") {
      setEditorToolbarItems([]);
      return;
    }
    const snapshot = editorToolbarDocumentSnapshot(activeDocument);
    const providers = platform.capabilities.getAll<WorkbenchEditorToolbarProvider>("workbench.editorToolbar");
    void Promise.all(providers.map((provider) => provider.provideItems(snapshot))).then((items) => {
      if (cancelled) return;
      setEditorToolbarItems(items.flat().filter((item) => item.enabled !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    });
    return () => { cancelled = true; };
  }, [activeDocument, platformSnapshot]);
  const activeToolWindow = workbenchToolWindows.find((toolWindow) => toolWindow.id === activeToolWindowId);
  const selectedProfile = profilesState.profiles.find((profile) => profile.id === profilesState.selectedId);
  const settingsProviders = pluginSettingsProviders();
  const activePluginSettingsProvider = settingsSectionId === "editor"
    ? undefined
    : settingsProviders.find((provider) => provider.pluginId === settingsSectionId);
  const editorSettings = resolveEditorSettings(workspaceSettings);
  const editorRulerLines = activeDocument?.kind === "text" ? editorLineNumbers(activeDocument.content) : ["01"];
  const editorDecorationsByLine = useMemo(() => {
    const grouped = new Map<number, TextEditorLineDecoration[]>();
    for (const decoration of editorLineDecorations) {
      if (!Number.isInteger(decoration.line) || decoration.line < 1) continue;
      const items = grouped.get(decoration.line) ?? [];
      items.push(decoration);
      grouped.set(decoration.line, items);
    }
    return grouped;
  }, [editorLineDecorations]);
  const showEditorGutter = activeDocument?.kind === "text"
    && !activeResourceEditorProvider
    && (editorSettings.lineNumbers || editorLineDecorations.length > 0);

  useEffect(() => {
    const snapshot: WorkbenchStateSnapshot = {
      workspaceName,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      activeSidebarId: sidebarView,
      sidebarVisible,
      activePanelId: panelTab,
      panelVisible,
      ...(activeToolWindowId ? { activeToolWindowId } : {}),
      toolWindowVisible,
      ...(selectedEnvironmentId ? { selectedExecutionEnvironmentId: selectedEnvironmentId } : {}),
      pluginSettings: workspaceSettings.plugins ?? {},
    };
    workbenchStateRef.current = snapshot;
    for (const listener of workbenchStateListenersRef.current) listener(snapshot);
  }, [workspaceName, workspaceRoot, sidebarView, sidebarVisible, panelTab, panelVisible, activeToolWindowId, toolWindowVisible, selectedEnvironmentId, workspaceSettings.plugins]);

  useEffect(() => {
    if (!restorationComplete) return;
    for (const document of documentsRef.current) {
      if (document.kind !== "text" || !document.path || document.content === document.savedContent) continue;
      void platform.events.emit<TextEditorDocumentChangedEvent>(TEXT_EDITOR_DOCUMENT_CHANGED_EVENT, {
        document: {
          id: document.id,
          name: document.name,
          path: document.path,
          ...(document.workspaceRoot ? { workspaceRoot: document.workspaceRoot } : {}),
          content: document.content,
          isDirty: true,
        },
        previousContent: document.savedContent,
        reason: "edit",
        isDirty: true,
      });
    }
  }, [platformSnapshot.plugins, restorationComplete]);

  useEffect(() => platform.workbench.bind({
    openSidebar(id) {
      if (!workbenchSidebars.some((sidebar) => sidebar.id === id)) {
        throw new Error(`Sidebar não registrada: ${id}`);
      }
      setSidebarView(id);
      setSidebarVisible(true);
    },
    openToolWindow(id) {
      if (!workbenchToolWindows.some((toolWindow) => toolWindow.id === id)) {
        throw new Error(`Tool window não registrada: ${id}`);
      }
      setActiveToolWindowId(id);
      setPanelVisible(false);
      setToolWindowVisible(true);
    },
    openDialog(contribution) {
      const token = Symbol(contribution.id);
      setWorkbenchDialog({ token, contribution });
      return {
        dispose: () => {
          setWorkbenchDialog((current) => current?.token === token ? undefined : current);
        },
      };
    },
    async replaceEditorContent(request) {
      const currentDocument = documentsRef.current.find((document) => document.id === request.documentId);
      if (!currentDocument || currentDocument.kind !== "text") return;
      const nextSavedContent = request.markSaved ? request.content : currentDocument.savedContent;
      if (currentDocument.content === request.content && currentDocument.savedContent === nextSavedContent) return;
      const previousContent = currentDocument.content;
      const changedDocument: OpenDocument = {
        ...currentDocument,
        content: request.content,
        savedContent: nextSavedContent,
        selectionStart: Math.min(request.selectionStart ?? currentDocument.selectionStart, request.content.length),
        selectionEnd: Math.min(request.selectionEnd ?? currentDocument.selectionEnd, request.content.length),
      };
      const nextDocuments = documentsRef.current.map((document) => document.id === request.documentId ? changedDocument : document);
      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      setDiagnostics([]);
      await platform.events.emit<TextEditorDocumentChangedEvent>(TEXT_EDITOR_DOCUMENT_CHANGED_EVENT, {
        document: {
          id: changedDocument.id,
          name: changedDocument.name,
          ...(changedDocument.path ? { path: changedDocument.path } : {}),
          ...(changedDocument.workspaceRoot ? { workspaceRoot: changedDocument.workspaceRoot } : {}),
          content: changedDocument.content,
          isDirty: changedDocument.content !== changedDocument.savedContent,
        },
        previousContent,
        reason: "edit",
        isDirty: changedDocument.content !== changedDocument.savedContent,
      });
      if (request.markSaved) {
        await platform.events.emit<TextEditorDocumentSavedEvent>(TEXT_EDITOR_DOCUMENT_SAVED_EVENT, {
          document: {
            id: changedDocument.id,
            name: changedDocument.name,
            ...(changedDocument.path ? { path: changedDocument.path } : {}),
            ...(changedDocument.workspaceRoot ? { workspaceRoot: changedDocument.workspaceRoot } : {}),
            content: changedDocument.content,
            isDirty: false,
          },
        });
      }
    },
    async saveEditorDocument(request) {
      const currentDocument = documentsRef.current.find((document) => document.id === request.documentId);
      if (!currentDocument) throw new Error(`Documento não encontrado: ${request.documentId}`);
      if (currentDocument.kind !== "text") throw new Error("Este recurso não é um documento de texto editável.");
      if (currentDocument.content === currentDocument.savedContent) return;
      await saveOpenDocument(currentDocument);
    },
    highlightText(request) {
      const lowerName = request.fileName.toLocaleLowerCase();
      const provider = platform.capabilities
        .getAll<LanguageProvider>("language.provider")
        .find((candidate) => candidate.extensions.some((extension) => lowerName.endsWith(extension)));
      return {
        ...(provider ? { languageId: provider.id } : {}),
        tokens: provider?.highlight(request.source) ?? [],
      };
    },
  }).dispose, [platformSnapshot.plugins]);

  useEffect(() => {
    if (!workbenchDialog) return;
    const installed = platformSnapshot.plugins.some(
      (plugin) => plugin.manifest.id === workbenchDialog.contribution.pluginId && plugin.state === "active",
    );
    if (!installed) setWorkbenchDialog(undefined);
  }, [platformSnapshot.plugins, workbenchDialog?.contribution.pluginId]);

  useEffect(() => {
    const subscriptions = textEditorLineDecorationProviders()
      .map((provider) => provider.onDidChange?.(() => setEditorDecorationRevision((current) => current + 1)))
      .filter((subscription): subscription is { dispose(): void } => Boolean(subscription));
    return () => subscriptions.forEach((subscription) => subscription.dispose());
  }, [platformSnapshot.plugins]);

  useEffect(() => {
    const subscriptions = resourceDecorationProviders()
      .map((provider) => provider.onDidChange?.(() => setResourceDecorationRevision((current) => current + 1)))
      .filter((subscription): subscription is { dispose(): void } => Boolean(subscription));
    return () => subscriptions.forEach((subscription) => subscription.dispose());
  }, [platformSnapshot.plugins]);

  useEffect(() => {
    const providers = resourceDecorationProviders();
    if (!providers.length || workspaceName === "Sem workspace") {
      setResourceDecorations(new Map());
      return;
    }
    let cancelled = false;
    const collect = (items: readonly WorkspaceEntry[]): WorkspaceEntry[] => items.flatMap((entry) => [
      entry,
      ...(entry.children ? collect(entry.children) : []),
    ]);
    const dirtyPaths = new Set(documents
      .filter((document) => document.path && document.kind === "text" && document.content !== document.savedContent)
      .map((document) => document.path as string));
    const allEntries = collect(entries);
    const resolveDecoration = async (entry: WorkspaceEntry) => {
      const resource: ResourceContext = {
        kind: entry.kind,
        name: entry.name,
        path: entry.path,
        workspaceName,
        ...(workspaceRoot ? { workspaceRoot } : {}),
        ...(entry.kind === "file" ? { isDirty: dirtyPaths.has(entry.path) } : {}),
      };
      const decorations = (await Promise.all(providers.map(async (provider) => {
        try { return await provider.provideDecoration(resource); }
        catch { return undefined; }
      }))).filter((value): value is ResourceDecoration => Boolean(value));
      const decoration = decorations.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0];
      return decoration ? [entry.path, decoration] as const : undefined;
    };
    const dirtyEntries = allEntries.filter((entry) => entry.kind === "file" && dirtyPaths.has(entry.path));
    if (dirtyEntries.length) {
      void Promise.all(dirtyEntries.map(resolveDecoration)).then((items) => {
        if (cancelled) return;
        setResourceDecorations((current) => {
          const next = new Map(current);
          dirtyEntries.forEach((entry) => next.delete(entry.path));
          items.forEach((item) => {
            if (item) next.set(item[0], item[1]);
          });
          return next;
        });
      });
    }
    void Promise.all(allEntries.map(resolveDecoration)).then((items) => {
      if (cancelled) return;
      setResourceDecorations(new Map(items.filter((item): item is readonly [string, ResourceDecoration] => Boolean(item))));
    });
    return () => { cancelled = true; };
  }, [entries, documents, workspaceName, workspaceRoot, resourceDecorationRevision, platformSnapshot.plugins]);

  useEffect(() => {
    if (activeDocument?.kind !== "text" || activeResourceEditorProvider || !activeDocument.path || !workspaceRoot) {
      setEditorLineDecorations([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const document = {
        id: activeDocument.id,
        name: activeDocument.name,
        ...(activeDocument.path ? { path: activeDocument.path } : {}),
        workspaceRoot: activeDocument.workspaceRoot ?? workspaceRoot,
        content: activeDocument.content,
        isDirty: activeDocument.content !== activeDocument.savedContent,
      };
      void Promise.all(textEditorLineDecorationProviders().map(async (provider) => {
        try {
          return await provider.provideDecorations(document);
        } catch {
          return [];
        }
      })).then((items) => {
        if (!cancelled) setEditorLineDecorations(items.flat());
      });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeDocument?.id, activeDocument?.kind, activeDocument?.path, activeDocument?.content, activeDocument?.workspaceRoot, activeResourceEditorProvider, workspaceRoot, editorDecorationRevision, platformSnapshot.plugins]);

  useEffect(() => {
    setSelectedEditorLineDecoration(undefined);
  }, [activeDocument?.id]);

  useEffect(() => {
    const next = reconcileToolWindowLayout({
      initialized: platformSnapshot.initialized,
      availableIds: workbenchToolWindows.map((toolWindow) => toolWindow.id),
      current: {
        ...(activeToolWindowId ? { activeToolWindowId } : {}),
        toolWindowVisible,
      },
    });
    if (next.activeToolWindowId !== activeToolWindowId) {
      setActiveToolWindowId(next.activeToolWindowId);
    }
    if (next.toolWindowVisible !== toolWindowVisible) {
      setToolWindowVisible(next.toolWindowVisible);
    }
  }, [platformSnapshot.plugins, platformSnapshot.initialized, activeToolWindowId, toolWindowVisible]);

  useEffect(() => {
    if (!platformSnapshot.initialized) return;
    const builtIn = sidebarView === "explorer" || sidebarView === "plugins" || sidebarView === "environments";
    if (!builtIn && !workbenchSidebars.some((sidebar) => sidebar.id === sidebarView)) {
      setSidebarView("explorer");
    }
  }, [platformSnapshot.initialized, platformSnapshot.plugins, sidebarView, workbenchSidebars]);

  const replaceWorkspaceSettings = useCallback((settings: WorkspaceSettings) => {
    workspaceSettingsRef.current = settings;
    setWorkspaceSettings(settings);
  }, []);

  const persistWorkspaceSettings = useCallback(async (settings: WorkspaceSettings) => {
    if (!workspaceRoot) throw new Error("Abra um workspace antes de salvar configurações locais.");
    const targetWorkspaceRoot = workspaceRoot;
    replaceWorkspaceSettings(settings);
    const write = workspaceSettingsWriteQueueRef.current
      .catch(() => EMPTY_WORKSPACE_SETTINGS)
      .then(() => writeWorkspaceSettings(targetWorkspaceRoot, settings));
    workspaceSettingsWriteQueueRef.current = write;
    const saved = await write;
    if (workspaceSettingsRef.current === settings) replaceWorkspaceSettings(saved);
  }, [workspaceRoot, replaceWorkspaceSettings]);

  const updateWorkspaceSettings = useCallback(async (
    update: (current: WorkspaceSettings) => WorkspaceSettings,
  ) => {
    await persistWorkspaceSettings(update(workspaceSettingsRef.current));
  }, [persistWorkspaceSettings]);

  useEffect(() => {
    if (!activeLanguageProvider) {
      setLintEnabledRuleIds([]);
      return;
    }
    const configured = workspaceSettings.lint?.[activeLanguageProvider.id];
    if (configured) {
      setLintEnabledRuleIds(configured.enabledRuleIds);
      return;
    }
    const legacy = readLegacyLintSettings(workspaceName, activeLanguageProvider);
    const settings = legacy ?? defaultLintSettings(activeLanguageProvider);
    setLintEnabledRuleIds(settings.enabledRuleIds);
    if (legacy && workspaceRoot) {
      void updateWorkspaceSettings((current) => ({
        ...current,
        lint: {
          ...current.lint,
          [activeLanguageProvider.id]: legacy,
        },
      })).then(() => {
        localStorage.removeItem(lintSettingsStorageKey(workspaceName, activeLanguageProvider.id));
      }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }
  }, [workspaceName, workspaceRoot, workspaceSettings.lint, activeLanguageProvider?.id, updateWorkspaceSettings]);

  const invoke = useCallback((operation: () => void | Promise<void>) => {
    setError(undefined);
    Promise.resolve(operation()).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(() => {
    if (!error) return;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    const currentError = error;
    errorTimerRef.current = setTimeout(() => {
      setError((value) => value === currentError ? undefined : value);
    }, 5000);
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [error]);

  useEffect(() => {
    if (!activeDocument || !activeLanguageProvider) {
      setDiagnostics([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void lintDocument(activeDocument, { enabledRuleIds: lintEnabledRuleIds })
        .then((items) => {
          if (!cancelled) setDiagnostics(items);
        })
        .catch((cause) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeDocument?.id, activeDocument?.content, activeLanguageProvider, lintEnabledRuleIds]);

  useEffect(() => {
    return platform.subscribe(() => setPlatformSnapshot(platform.snapshot()));
  }, []);

  const loadLocalWorkspaceSettings = useCallback(async (
    name: string,
    root: string,
    legacySelectedEnvironmentId?: string,
  ): Promise<WorkspaceSettings> => {
    let settings = await readWorkspaceSettings(root);
    let migrated = false;
    const legacyProfiles = settings.executionProfiles ? undefined : readLegacyProfiles(name);
    if (legacyProfiles) {
      settings = { ...settings, executionProfiles: legacyProfiles };
      migrated = true;
    }
    if (!settings.environment?.selectedId && legacySelectedEnvironmentId) {
      settings = { ...settings, environment: { selectedId: legacySelectedEnvironmentId } };
      migrated = true;
    }
    if (migrated) {
      settings = await writeWorkspaceSettings(root, settings);
      if (legacyProfiles) localStorage.removeItem(profileStorageKey(name));
    }
    replaceWorkspaceSettings(settings);
    setProfilesState(settings.executionProfiles ?? { profiles: [] });
    return settings;
  }, [replaceWorkspaceSettings]);

  useEffect(() => {
    platform.initialize()
      .then(async () => {
        const snapshot = await readReactSnapshot();
        let restoredDocuments: readonly OpenDocument[] = [];
        const restoredWorkspaceName = snapshot?.workspaceName ?? initialSession.workspaceName;
        let restoredWorkspaceRoot = snapshot?.workspaceRoot ?? initialSession.workspaceRoot;
        if (restoredWorkspaceName !== "Sem workspace") {
          const hostWorkspace = await setHostWorkspace(restoredWorkspaceName, restoredWorkspaceRoot);
          restoredWorkspaceRoot = hostWorkspace.workspaceRoot;
          setWorkspaceRoot(hostWorkspace.workspaceRoot);
          await loadLocalWorkspaceSettings(
            restoredWorkspaceName,
            hostWorkspace.workspaceRoot,
            initialSession.selectedEnvironmentId,
          );
        }
        if (snapshot) {
          setWorkspaceName(snapshot.workspaceName);
          setWorkspaceHandle(snapshot.workspaceHandle);
          if (snapshot.workspaceHandle) {
            const permission = await snapshot.workspaceHandle.queryPermission?.({ mode: "readwrite" });
            if (permission === "granted" || permission === undefined) {
              const rootEntries = await listDirectory(snapshot.workspaceHandle);
              setEntries(await hydrateExpandedEntries(rootEntries, new Set(initialSession.expandedDirectories)));
              setWorkspaceAccess("ready");
              restoredDocuments = await restoreWorkspaceDocuments(
                snapshot.documents,
                restoredWorkspaceRoot,
                snapshot.workspaceHandle,
              );
            } else {
              setEntries(deserializeEntries(snapshot.workspaceEntries));
              setWorkspaceAccess("permission-required");
              restoredDocuments = await restoreWorkspaceDocuments(snapshot.documents, restoredWorkspaceRoot);
            }
          } else {
            setEntries(deserializeEntries(snapshot.workspaceEntries));
            if (snapshot.workspaceName !== "Sem workspace") setWorkspaceAccess("missing");
            restoredDocuments = await restoreWorkspaceDocuments(snapshot.documents, restoredWorkspaceRoot);
          }
          setDocuments(restoredDocuments);
          setDiagnostics(snapshot.diagnostics);
          setOutput([...snapshot.output]);
          setActiveDocumentId(
            initialSession.activeDocumentId
              && restoredDocuments.some((document) => document.id === initialSession.activeDocumentId)
              ? initialSession.activeDocumentId
              : restoredDocuments[0]?.id,
          );
        }
        const loadedEnvironments = await loadEnvironments();
        setEnvironments(loadedEnvironments);
        const configuredEnvironmentId = workspaceSettingsRef.current.environment?.selectedId;
        const restoredSelectedEnvironmentId = configuredEnvironmentId && loadedEnvironments.some((environment) => environment.id === configuredEnvironmentId)
          ? configuredEnvironmentId
          : loadedEnvironments[0]?.id;
        setSelectedEnvironmentId(restoredSelectedEnvironmentId);
        if (restoredWorkspaceRoot && restoredSelectedEnvironmentId !== configuredEnvironmentId) {
          const nextSettings: WorkspaceSettings = {
            ...workspaceSettingsRef.current,
            environment: restoredSelectedEnvironmentId ? { selectedId: restoredSelectedEnvironmentId } : {},
          };
          replaceWorkspaceSettings(await writeWorkspaceSettings(restoredWorkspaceRoot, nextSettings));
        }
        const restoredActive = restoredDocuments[0];
        const contributions = await loadProfileContributions({
          workspaceName: restoredWorkspaceName,
          ...(restoredWorkspaceRoot ? { workspaceRoot: restoredWorkspaceRoot } : {}),
          ...(restoredActive ? { activeDocument: restoredActive } : {}),
        });
        setExecutableOptions(contributions.executableOptions);
        restoredRef.current = true;
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setRestorationComplete(true));
  }, []);

  useEffect(() => {
    if (!restorationComplete || !workspaceRoot) return;
    let cancelled = false;
    setResumedProcessId(undefined);
    setActiveProcessId(undefined);
    setBusy(false);
    void listHostProcesses()
      .then((processes) => {
        if (cancelled) return;
        const running = processes
          .filter((process) => process.status === "running")
          .sort((left, right) => right.startedAt - left.startedAt)[0];
        if (!running) return;
        setOutput([...hostProcessOutputLines(running)]);
        setBusy(true);
        setActiveProcessId(running.id);
        setResumedProcessId(running.id);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [restorationComplete, workspaceRoot]);

  useEffect(() => {
    if (!resumedProcessId) return;
    let cancelled = false;
    const monitor = async () => {
      try {
        let process = await readHostProcess(resumedProcessId);
        while (!cancelled) {
          setOutput([...hostProcessOutputLines(process)]);
          if (process.status !== "running") break;
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          process = await readHostProcess(resumedProcessId);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) {
          setBusy(false);
          setActiveProcessId((current) => current === resumedProcessId ? undefined : current);
          setResumedProcessId((current) => current === resumedProcessId ? undefined : current);
        }
      }
    };
    void monitor();
    return () => {
      cancelled = true;
    };
  }, [resumedProcessId]);

  useEffect(() => {
    writeSession({
      sidebarView,
      sidebarVisible,
      sidebarWidth,
      panelVisible,
      panelHeight,
      panelTab,
      toolWindowVisible,
      toolWindowHeight,
      ...(activeToolWindowId ? { activeToolWindowId } : {}),
      workspaceName,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(activeDocumentId ? { activeDocumentId } : {}),
      expandedDirectories: [...expanded],
      explorerShowHidden,
    });
  }, [sidebarView, sidebarVisible, sidebarWidth, panelVisible, panelHeight, panelTab, toolWindowVisible, toolWindowHeight, activeToolWindowId, workspaceName, workspaceRoot, activeDocumentId, expanded, explorerShowHidden]);

  useEffect(() => {
    if (!restoredRef.current) return;
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      void writeReactSnapshot({
        workspaceName,
        ...(workspaceRoot ? { workspaceRoot } : {}),
        ...(workspaceHandle ? { workspaceHandle } : {}),
        workspaceEntries: entries,
        documents,
        diagnostics,
        output,
      });
    }, 180);
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    };
  }, [workspaceName, workspaceRoot, workspaceHandle, entries, documents, diagnostics, output]);

  useEffect(() => {
    if (!platformSnapshot.initialized || !restorationComplete) return;
    void loadEnvironments().then((loaded) => {
      setEnvironments(loaded);
      const configured = workspaceSettingsRef.current.environment?.selectedId;
      const nextSelected = configured && loaded.some((environment) => environment.id === configured)
        ? configured
        : loaded[0]?.id;
      setSelectedEnvironmentId(nextSelected);
      if (workspaceRoot && nextSelected !== configured) {
        const nextSettings: WorkspaceSettings = {
          ...workspaceSettingsRef.current,
          environment: nextSelected ? { selectedId: nextSelected } : {},
        };
        replaceWorkspaceSettings(nextSettings);
        void writeWorkspaceSettings(workspaceRoot, nextSettings)
          .then(replaceWorkspaceSettings)
          .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
      }
    });
    void loadProfileContributions({
      workspaceName,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(activeDocument ? { activeDocument } : {}),
    }).then((contributions) => {
      setExecutableOptions(contributions.executableOptions);
    });
  }, [platformSnapshot.plugins, platformSnapshot.initialized, restorationComplete, workspaceName, workspaceRoot, activeDocument?.id, replaceWorkspaceSettings]);

  const updateProfiles = (profiles: readonly ExecutionProfile[], selectedId?: string) => {
    const next = { profiles, ...(selectedId ? { selectedId } : {}) };
    setProfilesState(next);
    void updateWorkspaceSettings((current) => ({
      ...current,
      executionProfiles: next,
    })).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const openFolder = async () => {
    if (!window.showDirectoryPicker) throw new Error("Este navegador não oferece seleção de pastas.");
    const handle = await window.showDirectoryPicker();
    const hostWorkspace = await setHostWorkspace(handle.name);
    const localSettings = await loadLocalWorkspaceSettings(handle.name, hostWorkspace.workspaceRoot);
    setWorkspaceHandle(handle);
    setWorkspaceName(handle.name);
    setWorkspaceRoot(hostWorkspace.workspaceRoot);
    setEntries(await listDirectory(handle));
    setExpanded(new Set());
    setWorkspaceAccess("ready");
    await refreshEnvironments(localSettings.environment?.selectedId, hostWorkspace.workspaceRoot);
  };

  const reconnectWorkspace = async () => {
    if (!workspaceHandle) throw new Error("Nenhum workspace anterior disponível para reconexão.");
    const permission = await workspaceHandle.requestPermission?.({ mode: "readwrite" });
    if (permission !== undefined && permission !== "granted") {
      throw new Error("Acesso ao workspace não foi concedido.");
    }
    const rootEntries = await listDirectory(workspaceHandle);
    const hostWorkspace = await setHostWorkspace(workspaceHandle.name, workspaceRoot);
    const localSettings = await loadLocalWorkspaceSettings(workspaceHandle.name, hostWorkspace.workspaceRoot);
    setEntries(await hydrateExpandedEntries(rootEntries, expanded));
    setWorkspaceName(workspaceHandle.name);
    setWorkspaceRoot(hostWorkspace.workspaceRoot);
    setWorkspaceAccess("ready");
    await refreshEnvironments(localSettings.environment?.selectedId, hostWorkspace.workspaceRoot);
  };

  const openSingleFile = async () => {
    if (!window.showOpenFilePicker) throw new Error("Este navegador não oferece seleção de arquivos.");
    const [handle] = await window.showOpenFilePicker();
    if (!handle) return;
    const document = await readFileDocument(handle);
    setDocuments((current) => current.some((item) => item.id === document.id) ? current : [...current, document]);
    setActiveDocumentId(document.id);
  };

  const openEntry = async (entry: WorkspaceEntry) => {
    if (entry.kind !== "file") return;
    const handle = entry.handle?.kind === "file"
      ? entry.handle
      : workspaceHandle
        ? await resolveFileHandle(workspaceHandle, entry.path)
        : undefined;
    if (!handle) throw new Error("Restaure o acesso ao workspace antes de abrir este arquivo.");
    const document = await readFileDocument(handle, entry.path, workspaceRoot);
    setDocuments((current) => {
      const index = current.findIndex((item) => item.id === document.id);
      return index === -1 ? [...current, document] : current.map((item) => item.id === document.id ? document : item);
    });
    setActiveDocumentId(document.id);
  };

  const resourceContext = (entry: WorkspaceEntry): ResourceContext => ({
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    ...(workspaceName !== "Sem workspace" ? { workspaceName } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(entry.kind === "file" ? {
      isDirty: documents.some((document) => document.path === entry.path && document.kind === "text" && document.content !== document.savedContent),
    } : {}),
  });

  const rootResourceContext = (): ResourceContext => ({
    kind: "directory",
    name: workspaceName,
    path: "",
    ...(workspaceName !== "Sem workspace" ? { workspaceName } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
  });

  const openRootMenu = async (x: number, y: number) => {
    if (!workspaceHandle) return;
    const baseItems: ResourceContextMenuItem[] = [
      {
        id: "core.newFile",
        label: "Novo arquivo",
        command: "core.resource.newFile",
        group: "creation",
        order: 0,
        icon: "file",
      },
      {
        id: "core.newDirectory",
        label: "Nova pasta",
        command: "core.resource.newDirectory",
        group: "creation",
        order: 10,
        icon: "folder",
      },
    ];
    const resource = rootResourceContext();
    const providers = platform.capabilities.getAll<ResourceContextMenuProvider>("resource.contextMenu");
    const contributed = (await Promise.all(providers.map((provider) => provider.provideItems(resource)))).flat();
    const items = [...baseItems, ...contributed]
      .filter((item) => item.enabled !== false)
      .sort((left, right) => (left.group === "creation" ? 0 : 100)
        - (right.group === "creation" ? 0 : 100)
        || (left.order ?? 0) - (right.order ?? 0));
    setContextMenu({ target: { kind: "root" }, x, y, items });
  };

  const openResourceMenu = async (entry: WorkspaceEntry, x: number, y: number) => {
    const baseItems: ResourceContextMenuItem[] = [
      {
        id: "core.open",
        label: entry.kind === "file" ? "Abrir" : expanded.has(entry.path) ? "Recolher" : "Expandir",
        command: "core.resource.open",
        group: "navigation",
        order: 0,
        icon: entry.kind === "file" ? "file" : "folder",
      },
      ...(entry.kind === "directory" ? [
        {
          id: "core.newFile",
          label: "Novo arquivo",
          command: "core.resource.newFile",
          group: "creation",
          order: 0,
          icon: "file" as const,
        },
        {
          id: "core.newDirectory",
          label: "Nova pasta",
          command: "core.resource.newDirectory",
          group: "creation",
          order: 10,
          icon: "folder" as const,
        },
      ] : []),
      {
        id: "core.rename",
        label: "Renomear",
        command: "core.resource.rename",
        group: "file",
        order: 0,
        icon: entry.kind === "directory" ? "folder" : "file",
      },
      {
        id: "core.copyPath",
        label: "Copiar caminho",
        command: "core.resource.copyPath",
        group: "clipboard",
        order: 100,
        icon: "copy",
      },
      {
        id: "core.delete",
        label: entry.kind === "directory" ? "Excluir pasta" : "Excluir arquivo",
        command: "core.resource.delete",
        group: "destructive",
        order: 1000,
        icon: "close",
      },
    ];
    const resource = resourceContext(entry);
    const providers = platform.capabilities.getAll<ResourceContextMenuProvider>("resource.contextMenu");
    const contributed = (await Promise.all(providers.map((provider) => provider.provideItems(resource)))).flat();
    const groupOrder = new Map([
      ["navigation", 0],
      ["creation", 50],
      ["file", 100],
      ["execution", 100],
      ["clipboard", 200],
      ["git", 250],
      ["destructive", 300],
    ]);
    const items = [...baseItems, ...contributed]
      .filter((item) => item.enabled !== false)
      .sort((left, right) => (groupOrder.get(left.group ?? "") ?? 1000) - (groupOrder.get(right.group ?? "") ?? 1000)
        || (left.order ?? 0) - (right.order ?? 0));
    setContextMenu({ target: { kind: "entry", entry }, x, y, items });
  };

  const documentResourceContext = (document: OpenDocument): ResourceContext => ({
    kind: "file",
    name: document.name,
    path: document.path ?? document.name,
    ...(workspaceName !== "Sem workspace" ? { workspaceName } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
  });

  const openDocumentMenu = async (document: OpenDocument, x: number, y: number) => {
    const documentIndex = documents.findIndex((candidate) => candidate.id === document.id);
    const baseItems: ResourceContextMenuItem[] = [
      {
        id: "core.tab.activate",
        label: "Ativar aba",
        command: "core.tab.activate",
        group: "navigation",
        order: 0,
        icon: "file",
        enabled: activeDocumentId !== document.id,
      },
      {
        id: "core.tab.save",
        label: "Salvar",
        command: "core.tab.save",
        group: "file",
        order: 0,
        icon: "save",
        enabled: document.kind === "text" && document.content !== document.savedContent,
      },
      {
        id: "core.tab.close",
        label: "Fechar",
        command: "core.tab.close",
        group: "close",
        order: 0,
        icon: "close",
      },
      {
        id: "core.tab.closeOthers",
        label: "Fechar outras abas",
        command: "core.tab.closeOthers",
        group: "close",
        order: 10,
        icon: "close",
        enabled: documents.length > 1,
      },
      {
        id: "core.tab.closeRight",
        label: "Fechar abas à direita",
        command: "core.tab.closeRight",
        group: "close",
        order: 20,
        icon: "close",
        enabled: documentIndex >= 0 && documentIndex < documents.length - 1,
      },
      {
        id: "core.tab.copyPath",
        label: "Copiar caminho",
        command: "core.tab.copyPath",
        group: "clipboard",
        order: 0,
        icon: "copy",
        enabled: Boolean(document.path),
      },
    ];
    const resource = documentResourceContext(document);
    const providers = platform.capabilities.getAll<ResourceContextMenuProvider>("resource.contextMenu");
    const contributed = (await Promise.all(providers.map((provider) => provider.provideItems(resource)))).flat();
    const groupOrder = new Map([
      ["navigation", 0],
      ["file", 50],
      ["execution", 100],
      ["close", 150],
      ["clipboard", 200],
      ["git", 250],
    ]);
    const items = [...baseItems, ...contributed]
      .filter((item) => item.enabled !== false)
      .sort((left, right) => (groupOrder.get(left.group ?? "") ?? 1000) - (groupOrder.get(right.group ?? "") ?? 1000)
        || (left.order ?? 0) - (right.order ?? 0));
    setContextMenu({ target: { kind: "document", document }, x, y, items });
  };

  const toggleEntry = async (entry: WorkspaceEntry) => {
    if (entry.kind !== "directory") return;
    if (expanded.has(entry.path)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(entry.path);
        return next;
      });
      return;
    }

    const handle = entry.handle?.kind === "directory"
      ? entry.handle
      : workspaceHandle
        ? await resolveDirectoryHandle(workspaceHandle, entry.path)
        : undefined;
    if (!handle) throw new Error("Restaure o acesso ao workspace antes de expandir esta pasta.");
    const children = await listDirectory(handle, entry.path);
    const replaceChildren = (items: readonly WorkspaceEntry[]): readonly WorkspaceEntry[] => items.map((item) => {
      if (item.path === entry.path) return { ...item, handle, children };
      return item.children ? { ...item, children: replaceChildren(item.children) } : item;
    });
    setEntries((current) => replaceChildren(current));
    setExpanded((current) => new Set(current).add(entry.path));
  };

  const updateDocument = (textarea: HTMLTextAreaElement) => {
    if (!activeDocumentId) return;
    const previous = documents.find((document) => document.id === activeDocumentId);
    if (!previous || previous.kind !== "text") return;
    const content = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    setDocuments((current) => current.map((document) => {
      if (document.id !== activeDocumentId) return document;
      const history = editorHistoriesRef.current.get(document.id)
        ?? createEditorHistory({
          content: document.content,
          selectionStart: document.selectionStart,
          selectionEnd: document.selectionEnd,
        });
      editorHistoriesRef.current.set(document.id, recordEditorHistory(history, {
        content,
        selectionStart,
        selectionEnd,
      }));
      return {
        ...document,
        content,
        selectionStart,
        selectionEnd,
      };
    }));
    const changedEvent: TextEditorDocumentChangedEvent = {
      document: {
        id: previous.id,
        name: previous.name,
        ...(previous.path ? { path: previous.path } : {}),
        ...(previous.workspaceRoot ? { workspaceRoot: previous.workspaceRoot } : {}),
        content,
      },
      previousContent: previous.content,
      reason: "edit",
      isDirty: content !== previous.savedContent,
    };
    void platform.events.emit(TEXT_EDITOR_DOCUMENT_CHANGED_EVENT, changedEvent);
    setDiagnostics([]);
  };

  const navigateEditorHistory = (
    direction: "undo" | "redo",
    textarea: HTMLTextAreaElement,
  ) => {
    if (!activeDocumentId) return;
    const document = documents.find((candidate) => candidate.id === activeDocumentId);
    if (!document) return;
    const history = editorHistoriesRef.current.get(document.id)
      ?? createEditorHistory({
        content: document.content,
        selectionStart: document.selectionStart,
        selectionEnd: document.selectionEnd,
      });
    const navigation = direction === "undo"
      ? undoEditorHistory(history)
      : redoEditorHistory(history);
    editorHistoriesRef.current.set(document.id, navigation.history);
    if (!navigation.snapshot) return;

    const { snapshot } = navigation;
    setDocuments((current) => current.map((candidate) => candidate.id === document.id
      ? {
          ...candidate,
          content: snapshot.content,
          selectionStart: snapshot.selectionStart,
          selectionEnd: snapshot.selectionEnd,
        }
      : candidate));
    const changedEvent: TextEditorDocumentChangedEvent = {
      document: {
        id: document.id,
        name: document.name,
        ...(document.path ? { path: document.path } : {}),
        ...(document.workspaceRoot ? { workspaceRoot: document.workspaceRoot } : {}),
        content: snapshot.content,
      },
      previousContent: document.content,
      reason: direction,
      isDirty: snapshot.content !== document.savedContent,
    };
    void platform.events.emit(TEXT_EDITOR_DOCUMENT_CHANGED_EVENT, changedEvent);
    setDiagnostics([]);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    });
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const textarea = event.currentTarget;
      const result = applyEditorTab(
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd,
        event.shiftKey,
      );
      if (result.content === textarea.value
        && result.selectionStart === textarea.selectionStart
        && result.selectionEnd === textarea.selectionEnd) return;
      textarea.value = result.content;
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
      updateDocument(textarea);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLocaleLowerCase();
    const undo = key === "z" && !event.shiftKey;
    const redo = (key === "z" && event.shiftKey) || key === "y";
    if (!undo && !redo) return;
    event.preventDefault();
    navigateEditorHistory(undo ? "undo" : "redo", event.currentTarget);
  };

  const captureEditorState = (
    textarea: HTMLTextAreaElement,
    scrollContainer: HTMLElement = textarea,
  ) => {
    if (!activeDocumentId) return;
    setDocuments((current) => current.map((document) => document.id === activeDocumentId
      ? {
          ...document,
          selectionStart: textarea.selectionStart,
          selectionEnd: textarea.selectionEnd,
          scrollTop: scrollContainer.scrollTop,
          scrollLeft: scrollContainer.scrollLeft,
        }
      : document));
  };

  const syncEditorLineRuler = (scrollTop: number) => {
    if (!editorLineRulerRef.current) return;
    editorLineRulerRef.current.style.transform = `translate3d(0, -${scrollTop}px, 0)`;
  };

  useEffect(() => {
    const textarea = editorRef.current;
    if (!textarea || !activeDocument) return;
    requestAnimationFrame(() => {
      textarea.setSelectionRange(activeDocument.selectionStart, activeDocument.selectionEnd);
      const scrollContainer = highlightedEditorScrollRef.current ?? textarea;
      scrollContainer.scrollTop = activeDocument.scrollTop;
      scrollContainer.scrollLeft = activeDocument.scrollLeft;
      syncEditorLineRuler(activeDocument.scrollTop);
    });
  }, [activeDocumentId, editorSettings.lineNumbers]);

  const downloadDocument = (openDocument: OpenDocument) => {
    const url = URL.createObjectURL(new Blob([openDocument.content], { type: "text/plain;charset=utf-8" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = openDocument.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const saveOpenDocument = async (document: OpenDocument, forceSaveAs = false) => {
    if (document.kind !== "text") {
      throw new Error("Este recurso não é um documento de texto editável.");
    }
    let handle = forceSaveAs ? undefined : document.handle;
    if (!handle) {
      if (!window.showSaveFilePicker) {
        downloadDocument(document);
        return document;
      }
      handle = await window.showSaveFilePicker({ suggestedName: document.name });
    }
    const saved = await writeFileDocument(document, handle);
    const nextDocuments = documentsRef.current.map((item) => item.id === document.id ? saved : item);
    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
    const savedEvent: TextEditorDocumentSavedEvent = {
      document: {
        id: saved.id,
        name: saved.name,
        ...(saved.path ? { path: saved.path } : {}),
        ...(saved.workspaceRoot ? { workspaceRoot: saved.workspaceRoot } : {}),
        content: saved.content,
      },
    };
    await platform.events.emit(TEXT_EDITOR_DOCUMENT_SAVED_EVENT, savedEvent);
    return saved;
  };

  const saveDocument = async (forceSaveAs = false) => {
    if (!activeDocument) return;
    await saveOpenDocument(activeDocument, forceSaveAs);
  };

  const newDocument = () => {
    const sequence = documents.filter((document) => document.name.startsWith("sem-titulo")).length + 1;
    const name = sequence === 1 ? "sem-titulo.py" : `sem-titulo-${sequence}.py`;
    const document: OpenDocument = {
      id: `untitled:${crypto.randomUUID()}`,
      name,
      kind: "text",
      mediaType: "text/plain",
      size: 0,
      content: "",
      savedContent: "",
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      scrollLeft: 0,
    };
    setDocuments((current) => [...current, document]);
    setActiveDocumentId(document.id);
  };

  const refreshExplorer = async (expandedPaths: ReadonlySet<string> = expanded) => {
    if (!workspaceHandle) return;
    const nextEntries = await listDirectory(workspaceHandle);
    setEntries(await hydrateExpandedEntries(nextEntries, expandedPaths));
  };

  useEffect(() => platform.events.on<WorkspaceResourcesChangedEvent>(
    WORKSPACE_RESOURCES_CHANGED_EVENT,
    async (event) => {
      if (!workspaceHandle) return;
      if (event.workspaceRoot && workspaceRoot && event.workspaceRoot !== workspaceRoot) return;
      const nextEntries = await listDirectory(workspaceHandle);
      setEntries(await hydrateExpandedEntries(nextEntries, expanded));
    },
  ).dispose, [platform.events, workspaceHandle, workspaceRoot, expanded]);

  const expandExplorerLevel = async () => {
    if (!workspaceHandle) return;
    const nextExpanded = expandNextExplorerLevel(entries, expanded, explorerShowHidden);
    setExpanded(nextExpanded);
    await refreshExplorer(nextExpanded);
  };

  const collapseExplorerLevel = async () => {
    const nextExpanded = collapseDeepestExplorerLevel(expanded);
    setExpanded(nextExpanded);
    await refreshExplorer(nextExpanded);
  };

  const explorerHiddenEntriesVisible = explorerShowHidden || explorerRevealedHiddenPaths.size > 0;
  const toggleExplorerHiddenEntries = () => {
    const nextVisibility = nextExplorerHiddenVisibility(
      explorerShowHidden,
      explorerRevealedHiddenPaths,
    );
    setExplorerShowHidden(nextVisibility.showHidden);
    setExplorerRevealedHiddenPaths(nextVisibility.revealedHiddenPaths);
  };

  const revealActiveDocumentInExplorer = async () => {
    if (!workspaceHandle || !activeDocument?.path) return;
    const path = activeDocument.path;
    const nextExpanded = new Set([...expanded, ...explorerAncestorDirectoryPaths(path)]);
    if (workspacePathContainsHiddenSegment(path)) setExplorerShowHidden(true);
    setSidebarView("explorer");
    setSidebarVisible(true);
    setExpanded(nextExpanded);
    await refreshExplorer(nextExpanded);
    setSelectedExplorerPath(path);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-explorer-path="${CSS.escape(path)}"]`)
        ?.scrollIntoView({ block: "center" });
    });
  };

  const cancelExplorerCreation = () => {
    setExplorerCreation(undefined);
    setExplorerCreationParentPath("");
    setExplorerCreationName("");
    setExplorerCreationError(undefined);
  };

  const startExplorerCreation = async (kind: "file" | "directory", parentPath?: string) => {
    const targetPath = parentPath ?? explorerTargetDirectoryPath(entries, selectedExplorerPath);
    setExplorerCreation(kind);
    setExplorerCreationParentPath(targetPath);
    setExplorerCreationName("");
    setExplorerCreationError(undefined);
    setExplorerRenamePath(undefined);
    setExplorerRenameError(undefined);
    if (targetPath) {
      const nextExpanded = new Set(expanded).add(targetPath);
      setExpanded(nextExpanded);
      await refreshExplorer(nextExpanded);
    }
  };

  const startExplorerRename = (entry: WorkspaceEntry) => {
    setSelectedExplorerPath(entry.path);
    setExplorerRenamePath(entry.path);
    setExplorerRenameName(entry.name);
    setExplorerRenameError(undefined);
    setExplorerCreation(undefined);
    setExplorerCreationError(undefined);
  };

  const createWorkspaceEntry = async () => {
    setExplorerCreationError(undefined);
    if (!workspaceHandle) {
      setExplorerCreationError("Abra ou reconecte um workspace antes de criar arquivos ou pastas.");
      return;
    }
    const name = explorerCreationName.trim();
    if (!name) {
      setExplorerCreationError("Informe um nome.");
      return;
    }
    if (name.includes("/") || name.includes("\\")) {
      setExplorerCreationError("Use apenas o nome, sem barras ou caminho.");
      return;
    }
    const parentHandle = await resolveDirectoryHandle(workspaceHandle, explorerCreationParentPath);
    const parentEntry = explorerCreationParentPath ? findWorkspaceEntry(entries, explorerCreationParentPath) : undefined;
    const siblings = parentEntry?.children ?? (explorerCreationParentPath ? await listDirectory(parentHandle, explorerCreationParentPath) : entries);
    if (siblings.some((entry) => entry.name === name)) {
      setExplorerCreationError(`Já existe um item chamado “${name}”.`);
      return;
    }

    try {
      if (explorerCreation === "file") {
        const handle = await parentHandle.getFileHandle(name, { create: true });
        const path = joinWorkspacePath(explorerCreationParentPath, name);
        const document = await readFileDocument(handle, path, workspaceRoot);
        setDocuments((current) => current.some((item) => item.id === document.id) ? current : [...current, document]);
        setActiveDocumentId(document.id);
      } else if (explorerCreation === "directory") {
        await parentHandle.getDirectoryHandle(name, { create: true });
      }
    } catch (cause) {
      setExplorerCreationError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    await refreshExplorer();
    const createdPath = joinWorkspacePath(explorerCreationParentPath, name);
    setHighlightedExplorerPath(createdPath);
    if (explorerHighlightTimerRef.current) clearTimeout(explorerHighlightTimerRef.current);
    explorerHighlightTimerRef.current = setTimeout(() => {
      setHighlightedExplorerPath((current) => current === createdPath ? undefined : current);
    }, 5000);
    cancelExplorerCreation();
  };

  const renameSelectedExplorerEntry = async () => {
    if (!workspaceHandle || !explorerRenamePath) return;
    const entry = findWorkspaceEntry(entries, explorerRenamePath);
    if (!entry) return;
    const name = explorerRenameName.trim();
    setExplorerRenameError(undefined);
    if (!name) {
      setExplorerRenameError("Informe um nome.");
      return;
    }
    if (name.includes("/") || name.includes("\\")) {
      setExplorerRenameError("Use apenas o nome, sem barras ou caminho.");
      return;
    }
    const parentPath = workspacePathParent(entry.path);
    const parent = parentPath ? findWorkspaceEntry(entries, parentPath) : undefined;
    const siblings = parent?.children ?? (parentPath ? await listDirectory(await resolveDirectoryHandle(workspaceHandle, parentPath), parentPath) : entries);
    if (siblings.some((candidate) => candidate.name === name && candidate.path !== entry.path)) {
      setExplorerRenameError(`Já existe um item chamado “${name}”.`);
      return;
    }

    try {
      const nextPath = await renameWorkspaceEntry(workspaceHandle, entry.path, name);
      const nextDocuments = await Promise.all(documents.map(async (document) => {
        if (!document.path || (document.path !== entry.path && !document.path.startsWith(`${entry.path}/`))) return document;
        const path = replaceWorkspacePathPrefix(document.path, entry.path, nextPath);
        const handle = await resolveFileHandle(workspaceHandle, path);
        return { ...document, id: path, path, name: workspacePathName(path), handle };
      }));
      setDocuments(nextDocuments);
      const nextActiveDocumentId = activeDocumentId
        ? replaceWorkspacePathPrefix(activeDocumentId, entry.path, nextPath)
        : undefined;
      setActiveDocumentId(nextActiveDocumentId);
      const nextExpanded = new Set([...expanded].map((path) => replaceWorkspacePathPrefix(path, entry.path, nextPath)));
      setExpanded(nextExpanded);
      const movedHistories = [...editorHistoriesRef.current.entries()]
        .filter(([id]) => id === entry.path || id.startsWith(`${entry.path}/`));
      movedHistories.forEach(([id, history]) => {
        editorHistoriesRef.current.delete(id);
        editorHistoriesRef.current.set(replaceWorkspacePathPrefix(id, entry.path, nextPath), history);
      });
      setSelectedExplorerPath(nextPath);
      setExplorerRenamePath(undefined);
      setExplorerRenameName("");
      await refreshExplorer(nextExpanded);
    } catch (cause) {
      setExplorerRenameError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteWorkspaceEntry = async (entry: WorkspaceEntry) => {
    if (!workspaceHandle) throw new Error("Restaure o acesso ao workspace antes de excluir recursos.");
    await removeWorkspaceEntry(workspaceHandle, entry.path, entry.kind === "directory");
    const removedPrefix = `${entry.path}/`;
    const removedIds = documents
      .filter((document) => document.path === entry.path || document.path?.startsWith(removedPrefix))
      .map((document) => document.id);
    const removedIdSet = new Set(removedIds);
    const nextActiveDocumentId = nearestRemainingItemId(
      documents.map((document) => document.id),
      removedIdSet,
      activeDocumentId,
    );
    setDocuments((current) => current.filter((document) => !removedIds.includes(document.id)));
    if (activeDocumentId && removedIdSet.has(activeDocumentId)) setActiveDocumentId(nextActiveDocumentId);
    removedIds.forEach((id) => editorHistoriesRef.current.delete(id));
    setSelectedExplorerPath(undefined);
    setExpanded((current) => new Set([...current].filter((path) => path !== entry.path && !path.startsWith(removedPrefix))));
    setEntries(await listDirectory(workspaceHandle));
  };

  const moveExplorerEntry = async (sourcePath: string, targetDirectoryPath: string) => {
    if (!workspaceHandle) throw new Error("Restaure o acesso ao workspace antes de mover recursos.");
    const sourceEntry = findWorkspaceEntry(entries, sourcePath);
    const targetIsWorkspaceRoot = targetDirectoryPath === "";
    const targetEntry = targetIsWorkspaceRoot ? undefined : findWorkspaceEntry(entries, targetDirectoryPath);
    if (!sourceEntry || (!targetIsWorkspaceRoot && targetEntry?.kind !== "directory")) return;
    const targetHandle = await resolveDirectoryHandle(workspaceHandle, targetDirectoryPath);
    let targetChildren: readonly WorkspaceEntry[];
    if (targetIsWorkspaceRoot) {
      targetChildren = entries;
    } else {
      targetChildren = targetEntry!.children ?? await listDirectory(targetHandle, targetDirectoryPath);
    }
    if (targetChildren.some((entry) => entry.name === sourceEntry.name)) {
      throw new Error(`Já existe um item chamado “${sourceEntry.name}” em ${targetDirectoryPath}.`);
    }
    const nextPath = await moveWorkspaceEntry(workspaceHandle, sourcePath, targetDirectoryPath);
    const nextExpanded = new Set([...expanded].map((path) => replaceWorkspacePathPrefix(path, sourcePath, nextPath)));
    nextExpanded.add(targetDirectoryPath);
    const nextDocuments = await Promise.all(documents.map(async (document) => {
      if (!document.path || (document.path !== sourcePath && !document.path.startsWith(`${sourcePath}/`))) return document;
      const path = replaceWorkspacePathPrefix(document.path, sourcePath, nextPath);
      const handle = await resolveFileHandle(workspaceHandle, path);
      return { ...document, id: path, path, name: workspacePathName(path), handle };
    }));
    const movedHistories = [...editorHistoriesRef.current.entries()]
      .filter(([id]) => id === sourcePath || id.startsWith(`${sourcePath}/`));
    movedHistories.forEach(([id, history]) => {
      editorHistoriesRef.current.delete(id);
      editorHistoriesRef.current.set(replaceWorkspacePathPrefix(id, sourcePath, nextPath), history);
    });
    setDocuments(nextDocuments);
    setActiveDocumentId((current) => current ? replaceWorkspacePathPrefix(current, sourcePath, nextPath) : current);
    setSelectedExplorerPath(nextPath);
    setExpanded(nextExpanded);
    setDraggingExplorerPath(undefined);
    setDropTargetExplorerPath(undefined);
    await refreshExplorer(nextExpanded);
  };

  const runSelectedProfile = async () => {
    if (!selectedProfile) throw new Error("Selecione um perfil de execução.");
    if (!selectedProfile.steps.length) throw new Error("O perfil não possui etapas.");
    if (selectedProfile.saveBeforeRun && activeDocument && activeDocument.content !== activeDocument.savedContent) {
      await saveDocument();
    }

    setBusy(true);
    setToolWindowVisible(false);
    setPanelVisible(true);
    setPanelTab("output");
    try {
      await runExecutionProfile({
        profile: selectedProfile,
        ...(activeDocument ? { activeDocument } : {}),
        workspaceName,
        environments,
        callbacks: {
          onProcessStarted: setActiveProcessId,
          onProcessFinished: () => setActiveProcessId(undefined),
          onOutput: (lines) => setOutput([...lines]),
        },
      });
    } finally {
      setBusy(false);
      setActiveProcessId(undefined);
    }
  };

  const runDocumentScript = async (document: OpenDocument) => {
    const contribution = scriptExecutionFor(document);
    if (!contribution) throw new Error(`Nenhum plugin oferece execução para '${document.name}'.`);
    let executableDocument = document;
    if (document.content !== document.savedContent) {
      if (!document.handle) throw new Error("Salve o arquivo no workspace antes de executar o script.");
      executableDocument = await writeFileDocument(document, document.handle);
      setDocuments((current) => current.map((item) => item.id === document.id ? executableDocument : item));
    }
    const selectedEnvironment = (
      selectedEnvironmentId
        ? environments.find((environment) => environment.id === selectedEnvironmentId)
        : undefined
    ) ?? environments.find((environment) => environment.status === "ready" && environment.executable);
    if (!selectedEnvironment?.executable || selectedEnvironment.status !== "ready") {
      throw new Error("Configure um ambiente de execução pronto antes de executar o arquivo.");
    }
    setBusy(true);
    setToolWindowVisible(false);
    setPanelVisible(true);
    setPanelTab("output");
    try {
      await runScript({
        contribution,
        document: executableDocument,
        environment: selectedEnvironment,
        callbacks: {
          onProcessStarted: setActiveProcessId,
          onProcessFinished: () => setActiveProcessId(undefined),
          onOutput: (lines) => setOutput([...lines]),
        },
      });
    } finally {
      setBusy(false);
      setActiveProcessId(undefined);
    }
  };

  const closeDocument = (documentId: string) => {
    const index = documents.findIndex((document) => document.id === documentId);
    if (index < 0) return;
    const next = documents.filter((document) => document.id !== documentId);
    editorHistoriesRef.current.delete(documentId);
    setDocuments(next);
    if (activeDocumentId === documentId) {
      setActiveDocumentId(next[index]?.id ?? next[index - 1]?.id);
    }
  };

  const executeContextMenuItem = async (item: ResourceContextMenuItem, target: ContextMenuTarget) => {
    setContextMenu(undefined);
    if (target.kind === "root") {
      if (item.command === "core.resource.newFile") {
        await startExplorerCreation("file", "");
        return;
      }
      if (item.command === "core.resource.newDirectory") {
        await startExplorerCreation("directory", "");
        return;
      }
      if (!item.command) throw new Error(`A ação '${item.id}' não possui executor.`);
      await platform.commands.execute(item.command, rootResourceContext());
      return;
    }
    if (target.kind === "entry") {
      const { entry } = target;
      if (item.action === "runScript") {
        if (entry.kind !== "file") throw new Error("O recurso selecionado não é um arquivo executável.");
        const openDocument = documents.find((candidate) => candidate.path === entry.path);
        const document = openDocument
          ?? (entry.handle
            ? await readFileDocument(entry.handle as BrowserFileHandle, entry.path)
            : {
                id: entry.path,
                name: entry.name,
                path: entry.path,
                kind: "text",
                mediaType: "text/plain",
                size: 0,
                content: "",
                savedContent: "",
                selectionStart: 0,
                selectionEnd: 0,
                scrollTop: 0,
                scrollLeft: 0,
              });
        await runDocumentScript(document);
        return;
      }
      if (item.command === "core.resource.open") {
        await (entry.kind === "file" ? openEntry(entry) : toggleEntry(entry));
        return;
      }
      if (item.command === "core.resource.copyPath") {
        await navigator.clipboard?.writeText(entry.path);
        return;
      }
      if (item.command === "core.resource.newFile") {
        await startExplorerCreation("file", entry.path);
        return;
      }
      if (item.command === "core.resource.newDirectory") {
        await startExplorerCreation("directory", entry.path);
        return;
      }
      if (item.command === "core.resource.rename") {
        startExplorerRename(entry);
        return;
      }
      if (item.command === "core.resource.delete") {
        setExplorerPendingDeletion(entry);
        return;
      }
      if (!item.command) throw new Error(`A ação '${item.id}' não possui executor.`);
      await platform.commands.execute(item.command, resourceContext(entry));
      return;
    }

    const { document } = target;
    if (item.action === "runScript") {
      await runDocumentScript(document);
      return;
    }
    if (item.command === "core.tab.activate") {
      setActiveDocumentId(document.id);
      return;
    }
    if (item.command === "core.tab.save") {
      await saveOpenDocument(document);
      return;
    }
    if (item.command === "core.tab.close") {
      closeDocument(document.id);
      return;
    }
    if (item.command === "core.tab.closeOthers") {
      setDocuments([document]);
      setActiveDocumentId(document.id);
      return;
    }
    if (item.command === "core.tab.closeRight") {
      const index = documents.findIndex((candidate) => candidate.id === document.id);
      const next = documents.slice(0, index + 1);
      setDocuments(next);
      if (activeDocumentId && !next.some((candidate) => candidate.id === activeDocumentId)) {
        setActiveDocumentId(document.id);
      }
      return;
    }
    if (item.command === "core.tab.copyPath") {
      if (document.path) await navigator.clipboard?.writeText(document.path);
      return;
    }
    if (!item.command) throw new Error(`A ação '${item.id}' não possui executor.`);
    await platform.commands.execute(item.command, documentResourceContext(document));
  };

  const stopExecution = async () => {
    if (!activeProcessId) return;
    await stopHostProcess(activeProcessId);
  };

  const selectEnvironment = (environmentId: string | undefined) => {
    setSelectedEnvironmentId(environmentId);
    void updateWorkspaceSettings((current) => ({
      ...current,
      environment: environmentId ? { selectedId: environmentId } : {},
    })).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const refreshEnvironments = async (
    preferredId = workspaceSettingsRef.current.environment?.selectedId,
    targetWorkspaceRoot = workspaceRoot,
  ) => {
    const loaded = await loadEnvironments();
    setEnvironments(loaded);
    const nextSelectedId = preferredId && loaded.some((environment) => environment.id === preferredId)
      ? preferredId
      : loaded[0]?.id;
    setSelectedEnvironmentId(nextSelectedId);
    if (nextSelectedId && nextSelectedId !== workspaceSettingsRef.current.environment?.selectedId && targetWorkspaceRoot) {
      const nextSettings: WorkspaceSettings = {
        ...workspaceSettingsRef.current,
        environment: { selectedId: nextSelectedId },
      };
      replaceWorkspaceSettings(nextSettings);
      replaceWorkspaceSettings(await writeWorkspaceSettings(targetWorkspaceRoot, nextSettings));
    }
  };

  const loadEnvironmentBrowser = async (
    mode: "directory" | "file",
    path?: string,
    includeHidden = environmentBrowserHidden,
  ) => {
    const provider = environmentProvider();
    if (!provider?.browse) throw new Error("O gerenciador não oferece navegação de arquivos.");
    setEnvironmentListing(await provider.browse({
      ...(path ? { path } : {}),
      mode,
      includeHidden,
      filter: "",
    }));
  };

  const pickHostPath = async (mode: "directory" | "file", executableOnly = false): Promise<string | undefined> => {
    setEnvironmentBrowserMode(mode);
    setEnvironmentBrowserExecutableOnly(executableOnly);
    setEnvironmentBrowserSelection(undefined);
    setEnvironmentBrowserFilter("");
    const { workspaceRoot } = await readHostContext();
    await loadEnvironmentBrowser(mode, workspaceRoot);
    return new Promise((resolve) => {
      browserResolverRef.current = resolve;
    });
  };

  const navigateEnvironmentBrowser = async (path?: string) => {
    if (!environmentBrowserMode) return;
    setEnvironmentBrowserSelection(undefined);
    await loadEnvironmentBrowser(environmentBrowserMode, path);
  };

  const confirmEnvironmentBrowser = async () => {
    const selection = environmentBrowserSelection;
    const mode = environmentBrowserMode;
    if (!selection || !mode) return;
    const provider = environmentProvider();
    if (mode === "file" && environmentBrowserExecutableOnly) {
      if (!provider?.validateExecutable) throw new Error("O gerenciador não valida executáveis deste tipo.");
      await provider.validateExecutable(selection);
    }
    setEnvironmentPath(selection);
    browserResolverRef.current?.(selection);
    browserResolverRef.current = undefined;
    setEnvironmentBrowserMode(undefined);
    setEnvironmentListing(undefined);
  };

  const cancelEnvironmentBrowser = () => {
    browserResolverRef.current?.(undefined);
    browserResolverRef.current = undefined;
    setEnvironmentBrowserMode(undefined);
    setEnvironmentListing(undefined);
    setEnvironmentBrowserSelection(undefined);
  };

  const submitEnvironmentForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const provider = environmentProvider();
    if (!provider || !environmentForm) throw new Error("Nenhum gerenciador de ambientes instalado.");
    const data = new FormData(event.currentTarget);
    setEnvironmentBusy(true);
    try {
      if (environmentForm === "addExecutable") {
        const name = String(data.get("name") ?? "").trim();
        if (!name || !environmentPath) throw new Error("Informe o nome e selecione o executável.");
        const created = await provider.addExecutable({ name, executable: environmentPath });
        await refreshEnvironments(created.id);
      } else if (environmentForm === "importEnvironment") {
        if (!environmentPath) throw new Error("Selecione a pasta do ambiente.");
        const name = String(data.get("name") ?? "").trim();
        const created = await provider.importEnvironment({
          path: environmentPath,
          ...(name ? { name } : {}),
        });
        await refreshEnvironments(created.id);
      } else if (environmentForm === "createEnvironment") {
        const name = String(data.get("name") ?? "").trim();
        const baseExecutable = String(data.get("baseExecutable") ?? "").trim();
        const path = String(data.get("path") ?? "").trim();
        if (!name || !baseExecutable) throw new Error("Informe o nome e o executável de origem.");
        const created = await provider.create({
          name,
          baseExecutable,
          ...(path ? { path } : {}),
        });
        await refreshEnvironments(created.id);
      } else if (environmentForm === "edit") {
        if (!editingEnvironmentId || !provider.update) throw new Error("Este gerenciador não permite editar ambientes.");
        const current = environments.find((environment) => environment.id === editingEnvironmentId);
        if (!current) throw new Error("Ambiente não encontrado.");
        const name = String(data.get("name") ?? "").trim();
        if (!name) throw new Error("Informe o nome do ambiente.");
        const currentLocation = current.type === "venv" ? current.path : current.executable;
        const location = environmentPath || currentLocation;
        if (!location) throw new Error("Informe o local do ambiente.");
        const updated = await provider.update(editingEnvironmentId, current.type === "venv"
          ? { name, path: location }
          : { name, executable: location });
        await refreshEnvironments(updated.id);
      } else {
        if (!selectedEnvironmentId) throw new Error("Selecione um ambiente.");
        const dependencies = String(data.get("dependencies") ?? "").trim().split(/\s+/).filter(Boolean);
        if (!dependencies.length) throw new Error("Informe ao menos uma dependência.");
        await provider.installDependencies(selectedEnvironmentId, dependencies);
        await refreshEnvironments();
      }
      setEnvironmentForm(undefined);
      setEditingEnvironmentId(undefined);
      setEnvironmentPath("");
    } finally {
      setEnvironmentBusy(false);
    }
  };

  const removeEnvironment = async (id: string) => {
    const provider = environmentProvider();
    if (!provider) throw new Error("Nenhum gerenciador de ambientes instalado.");
    setEnvironmentBusy(true);
    try {
      await provider.remove(id);
      await refreshEnvironments();
    } finally {
      setEnvironmentBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || Boolean(target?.isContentEditable);
      if (!editing && sidebarView === "explorer") {
        const visibleEntries = flattenVisibleEntries(entries, expanded, explorerShowHidden);
        const selectedIndex = selectedExplorerPath
          ? visibleEntries.findIndex((entry) => entry.path === selectedExplorerPath)
          : -1;
        const selectedEntry = selectedIndex >= 0 ? visibleEntries[selectedIndex] : undefined;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex = selectedIndex < 0
            ? (direction > 0 ? 0 : visibleEntries.length - 1)
            : Math.min(visibleEntries.length - 1, Math.max(0, selectedIndex + direction));
          const next = visibleEntries[nextIndex];
          if (next) setSelectedExplorerPath(next.path);
          return;
        }
        if (event.key === "Enter" && selectedEntry) {
          event.preventDefault();
          invoke(() => selectedEntry.kind === "directory" ? toggleEntry(selectedEntry) : openEntry(selectedEntry));
          return;
        }
        if (event.key === "ArrowRight" && selectedEntry?.kind === "directory") {
          event.preventDefault();
          if (!expanded.has(selectedEntry.path)) {
            invoke(() => toggleEntry(selectedEntry));
          } else {
            const firstChild = selectedEntry.children?.find((entry) => explorerShowHidden || !entry.name.startsWith("."));
            if (firstChild) setSelectedExplorerPath(firstChild.path);
          }
          return;
        }
        if (event.key === "ArrowLeft" && selectedEntry) {
          event.preventDefault();
          if (selectedEntry.kind === "directory" && expanded.has(selectedEntry.path)) {
            invoke(() => toggleEntry(selectedEntry));
          } else {
            const parentPath = parentEntryPath(selectedEntry.path);
            if (parentPath) setSelectedExplorerPath(parentPath);
          }
          return;
        }
        if (event.key === "F2" && selectedEntry) {
          event.preventDefault();
          startExplorerRename(selectedEntry);
          return;
        }
        if (event.key === "Escape") {
          setExplorerCreation(undefined);
          setExplorerCreationError(undefined);
          setExplorerRenamePath(undefined);
          setExplorerRenameError(undefined);
          return;
        }
      }
      if ((event.key === "Delete" || event.key === "Backspace")
        && !editing
        && sidebarView === "explorer"
        && selectedExplorerPath) {
        const selectedEntry = findWorkspaceEntry(entries, selectedExplorerPath);
        if (selectedEntry) {
          event.preventDefault();
          setExplorerPendingDeletion(selectedEntry);
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "n") {
        event.preventDefault();
        newDocument();
      } else if (key === "o") {
        event.preventDefault();
        invoke(openSingleFile);
      } else if (key === "s") {
        event.preventDefault();
        invoke(() => saveDocument(event.shiftKey));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newDocument, openSingleFile, saveDocument, invoke, sidebarView, selectedExplorerPath, entries, expanded, explorerShowHidden, workspaceHandle, documents, activeDocumentId]);

  const beginSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const move = (pointerEvent: PointerEvent) => setSidebarWidth(Math.min(720, Math.max(180, startWidth + pointerEvent.clientX - startX)));
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  const beginPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panelHeight;
    const move = (pointerEvent: PointerEvent) => setPanelHeight(Math.min(640, Math.max(96, startHeight + startY - pointerEvent.clientY)));
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  const beginToolWindowResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = toolWindowHeight;
    const move = (pointerEvent: PointerEvent) => setToolWindowHeight(Math.min(640, Math.max(120, startHeight + startY - pointerEvent.clientY)));
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  const toggleToolWindow = (toolWindowId: string) => {
    if (activeToolWindowId === toolWindowId) {
      setToolWindowVisible((visible) => {
        const next = !visible;
        if (next) setPanelVisible(false);
        return next;
      });
      return;
    }
    setActiveToolWindowId(toolWindowId);
    setPanelVisible(false);
    setToolWindowVisible(true);
  };

  const togglePluginSidebar = (sidebarId: string) => {
    if (sidebarView === sidebarId && sidebarVisible) {
      setSidebarVisible(false);
      return;
    }
    setSidebarView(sidebarId);
    setSidebarVisible(true);
  };

  const toggleOutputPanel = () => {
    setPanelVisible((visible) => {
      const next = !visible;
      if (next) setToolWindowVisible(false);
      return next;
    });
  };

  const closeToolWindow = useCallback(() => setToolWindowVisible(false), []);
  const closeSidebar = useCallback(() => setSidebarVisible(false), []);

  const installedIds = useMemo(() => new Set(platformSnapshot.plugins.map((plugin) => plugin.manifest.id)), [platformSnapshot.plugins]);
  const pluginPendingRemoval = platformSnapshot.plugins.find((plugin) => plugin.manifest.id === pluginRemovalId);
  const editingEnvironment = editingEnvironmentId
    ? environments.find((environment) => environment.id === editingEnvironmentId)
    : undefined;

  const openSettings = (sectionId = "editor") => {
    setSettingsSectionId(sectionId);
    const provider = settingsProviders.find((candidate) => candidate.pluginId === sectionId);
    setPluginSettingsDraft(provider
      ? resolvePluginSettingValues(provider, workspaceSettings.plugins?.[provider.pluginId])
      : {});
    setSettingsOpen(true);
  };

  const selectSettingsSection = (sectionId: string) => {
    setSettingsSectionId(sectionId);
    const provider = settingsProviders.find((candidate) => candidate.pluginId === sectionId);
    setPluginSettingsDraft(provider
      ? resolvePluginSettingValues(provider, workspaceSettings.plugins?.[provider.pluginId])
      : {});
  };

  const applyEditorLineNumbers = async (lineNumbers: boolean) => {
    await updateWorkspaceSettings((current) => ({
      ...current,
      editor: {
        ...current.editor,
        lineNumbers,
      },
    }));
  };

  const applyPluginSetting = async (settingId: string, value: boolean) => {
    if (!activePluginSettingsProvider) return;
    const values = updatePluginSettingValue(
      resolvePluginSettingValues(activePluginSettingsProvider, pluginSettingsDraft),
      settingId,
      value,
    );
    setPluginSettingsDraft(values);
    await updateWorkspaceSettings((current) => ({
      ...current,
      plugins: {
        ...current.plugins,
        [activePluginSettingsProvider.pluginId]: values,
      },
    }));
  };

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className="ide-shell">
        <header className="titlebar">
          <div className="app-brand"><img src="/icon.png" alt="" /><strong>tinyIde</strong></div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="menu-button" type="button">
                Arquivo <ChevronDown size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu-content" align="start" sideOffset={6}>
                <DropdownMenu.Item className="menu-item" onSelect={newDocument}>
                  <FilePlus2 size={15} /> Novo arquivo
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => invoke(openSingleFile)}>
                  <File size={15} /> Abrir arquivo
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => invoke(openFolder)}>
                  <FolderOpen size={15} /> Abrir pasta
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="menu-separator" />
                <DropdownMenu.Item className="menu-item" onSelect={() => invoke(saveDocument)}>
                  <Save size={15} /> Salvar
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => invoke(() => saveDocument(true))}>
                  <Save size={15} /> Salvar como
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="menu-button" type="button">
                Configurações <ChevronDown size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu-content" align="start" sideOffset={6}>
                <DropdownMenu.Item className="menu-item" onSelect={() => openSettings("editor")}>
                  <Code2 size={15} /> Editor
                </DropdownMenu.Item>
                {settingsProviders.length ? <DropdownMenu.Separator className="menu-separator" /> : null}
                {settingsProviders.map((provider) => (
                  <DropdownMenu.Item
                    className="menu-item"
                    key={provider.pluginId}
                    onSelect={() => openSettings(provider.pluginId)}
                  >
                    <Plug size={15} /> {provider.title}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="menu-button" type="button">
                Help <ChevronDown size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu-content" align="start" sideOffset={6}>
                <DropdownMenu.Item className="menu-item" onSelect={() => setAboutOpen(true)}>
                  <Info size={15} /> Sobre
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <div className="window-title">{workspaceName}</div>
          <div className="titlebar-actions">
            {workbenchTitlebarContributions.map((provider) => (
              <WorkbenchTitlebarHost key={provider.id} provider={provider} state={workbenchState} />
            ))}
            <select
              aria-label="Perfil de execução"
              value={profilesState.selectedId ?? ""}
              onChange={(event) => updateProfiles(profilesState.profiles, event.target.value || undefined)}
            >
              <option value="">Selecionar perfil</option>
              {profilesState.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
            <button className="icon-button small" type="button" aria-label="Gerenciar perfis" onClick={() => setProfilesOpen(true)}><Settings2 size={14} /></button>
            {busy
              ? <button className="button danger compact" type="button" onClick={() => invoke(stopExecution)}><Square size={13} /> Parar</button>
              : <button className="button primary compact" type="button" disabled={!selectedProfile} onClick={() => invoke(runSelectedProfile)}><Play size={13} /> Executar</button>}
          </div>
        </header>

        <div className="workbench" style={{ gridTemplateColumns: `48px ${sidebarVisible ? `${sidebarWidth}px 5px` : "0 0"} minmax(0, 1fr)` }}>
          <aside className="activity-bar">
            <IconButton label="Explorador" active={sidebarView === "explorer" && sidebarVisible} onClick={() => { setSidebarView("explorer"); setSidebarVisible(true); }}>
              <Files size={20} />
            </IconButton>
            {workbenchSidebars.map((sidebar) => (
              <IconButton
                key={sidebar.id}
                label={sidebar.label}
                active={sidebarView === sidebar.id && sidebarVisible}
                onClick={() => togglePluginSidebar(sidebar.id)}
              >
                <WorkbenchActivityIconView icon={sidebar.icon} />
              </IconButton>
            ))}
            <IconButton label="Plugins" active={sidebarView === "plugins" && sidebarVisible} onClick={() => { setSidebarView("plugins"); setSidebarVisible(true); }}>
              <Plug size={20} />
            </IconButton>
            {environmentProvider() ? (
              <IconButton label="Ambientes" active={sidebarView === "environments" && sidebarVisible} onClick={() => { setSidebarView("environments"); setSidebarVisible(true); invoke(refreshEnvironments); }}>
                <Cpu size={20} />
              </IconButton>
            ) : null}
            <div className="activity-spacer" />
            <IconButton label="Saída e problemas" active={panelVisible} onClick={toggleOutputPanel}>
              <PanelBottom size={20} />
            </IconButton>
            {workbenchToolWindows.map((toolWindow) => (
              <IconButton
                key={toolWindow.id}
                label={toolWindow.label}
                active={toolWindowVisible && activeToolWindowId === toolWindow.id}
                onClick={() => toggleToolWindow(toolWindow.id)}
              >
                <WorkbenchActivityIconView icon={toolWindow.icon} />
              </IconButton>
            ))}
          </aside>

          {sidebarVisible ? (
            <aside className="sidebar">
              <div className="sidebar-heading">
                <span>{activePluginSidebar?.label.toLocaleUpperCase() ?? (sidebarView === "explorer" ? "EXPLORER" : sidebarView === "plugins" ? "PLUGINS" : "AMBIENTES")}</span>
                <div className="sidebar-heading-actions">
                  {sidebarView === "explorer" ? (
                    <>
                      <button
                        className="icon-button small"
                        type="button"
                        aria-label="Localizar arquivo aberto no Explorer"
                        disabled={!activeDocument?.path || !workspaceHandle}
                        onClick={() => invoke(revealActiveDocumentInExplorer)}
                      ><LocateFixed size={15} /></button>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <button className="icon-button small" type="button" aria-label="Ações do Explorer"><MoreVertical size={15} /></button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content className="menu-content" align="end" sideOffset={6}>
                            <DropdownMenu.Item className="menu-item" disabled={!workspaceHandle} onSelect={() => invoke(() => startExplorerCreation("file"))}>
                              <FilePlus2 size={15} /> Novo arquivo
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="menu-item" disabled={!workspaceHandle} onSelect={() => invoke(() => startExplorerCreation("directory"))}>
                              <FolderOpen size={15} /> Nova pasta
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="menu-separator" />
                            <DropdownMenu.Item className="menu-item" disabled={!workspaceHandle} onSelect={() => invoke(refreshExplorer)}>
                              <RefreshCw size={15} /> Atualizar
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="menu-separator" />
                            <DropdownMenu.Item className="menu-item" onSelect={toggleExplorerHiddenEntries}>
                              {explorerHiddenEntriesVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                              {explorerHiddenEntriesVisible ? "Ocultar arquivos ocultos" : "Mostrar arquivos ocultos"}
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </>
                  ) : null}
                  <button className="icon-button small" type="button" onClick={() => setSidebarVisible(false)} aria-label="Fechar sidebar"><X size={14} /></button>
                </div>
              </div>

              {sidebarView === "explorer" ? (
                <div
                  className={`sidebar-content explorer-content${dropTargetExplorerPath === "" ? " is-root-drop-target" : ""}`}
                  onDragOver={(event) => {
                    const target = (event.target as Element).closest<HTMLElement>("[data-explorer-path]");
                    if (target?.dataset.explorerKind === "directory") return;
                    const containingDirectoryPath = (event.target as Element)
                      .closest<HTMLElement>("[data-explorer-directory-path]")
                      ?.dataset.explorerDirectoryPath ?? "";
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTargetExplorerPath(explorerDropTargetDirectory(
                      target?.dataset.explorerPath,
                      target?.dataset.explorerKind as WorkspaceEntry["kind"] | undefined,
                      containingDirectoryPath,
                    ));
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetExplorerPath(undefined);
                  }}
                  onDrop={(event) => {
                    const target = (event.target as Element).closest<HTMLElement>("[data-explorer-path]");
                    if (target?.dataset.explorerKind === "directory") return;
                    const containingDirectoryPath = (event.target as Element)
                      .closest<HTMLElement>("[data-explorer-directory-path]")
                      ?.dataset.explorerDirectoryPath ?? "";
                    event.preventDefault();
                    const sourcePath = event.dataTransfer.getData("application/x-tinyide-workspace-path");
                    const targetDirectoryPath = explorerDropTargetDirectory(
                      target?.dataset.explorerPath,
                      target?.dataset.explorerKind as WorkspaceEntry["kind"] | undefined,
                      containingDirectoryPath,
                    );
                    setDropTargetExplorerPath(undefined);
                    if (sourcePath && workspacePathParent(sourcePath) !== targetDirectoryPath) {
                      invoke(() => moveExplorerEntry(sourcePath, targetDirectoryPath));
                    }
                  }}
                >
                  {workspaceName !== "Sem workspace" ? (
                    <div
                      className={`workspace-name${selectedExplorerPath === "" ? " is-selected" : ""}`}
                      data-explorer-root
                      role="treeitem"
                      tabIndex={0}
                      aria-selected={selectedExplorerPath === ""}
                      onClick={(event) => {
                        if ((event.target as Element).closest("button")) return;
                        setSelectedExplorerPath("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setSelectedExplorerPath("");
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setSelectedExplorerPath("");
                        invoke(() => openRootMenu(event.clientX, event.clientY));
                      }}
                    >
                      <span className="workspace-name__label"><FolderRoot size={14} /> {workspaceName}</span>
                      <span className="workspace-name__actions">
                        <button
                          className="icon-button small"
                          type="button"
                          aria-label="Expandir próximo nível"
                          disabled={!workspaceHandle}
                          onClick={() => invoke(expandExplorerLevel)}
                        ><ChevronDown size={14} /></button>
                        <button
                          className="icon-button small"
                          type="button"
                          aria-label="Recolher nível mais profundo"
                          disabled={!expanded.size}
                          onClick={() => invoke(collapseExplorerLevel)}
                        ><ChevronUp size={14} /></button>
                      </span>
                    </div>
                  ) : null}
                  {entries.length || (explorerCreation && explorerCreationParentPath === "") ? (
                    <EntryTree
                      entries={entries}
                      parentPath=""
                      expanded={expanded}
                      showHidden={explorerShowHidden}
                      revealHidden={explorerShowHidden}
                      revealedHiddenPaths={explorerRevealedHiddenPaths}
                      highlightedPath={highlightedExplorerPath}
                      selectedPath={selectedExplorerPath}
                      resourceDecorations={resourceDecorations}
                      onToggle={(entry) => invoke(() => toggleEntry(entry))}
                      onSelect={(entry) => setSelectedExplorerPath(entry.path)}
                      onOpen={(entry) => invoke(() => openEntry(entry))}
                      onContextMenu={(entry, x, y) => invoke(() => openResourceMenu(entry, x, y))}
                      onMove={(sourcePath, targetPath) => invoke(() => moveExplorerEntry(sourcePath, targetPath))}
                      draggingPath={draggingExplorerPath}
                      dropTargetPath={dropTargetExplorerPath}
                      onDraggingPathChange={setDraggingExplorerPath}
                      onDropTargetPathChange={setDropTargetExplorerPath}
                      onShowHiddenDirectory={(path) => setExplorerRevealedHiddenPaths((current) => new Set(current).add(path))}
                      renamePath={explorerRenamePath}
                      renameName={explorerRenameName}
                      renameError={explorerRenameError}
                      onRenameNameChange={(name) => { setExplorerRenameName(name); setExplorerRenameError(undefined); }}
                      onRenameSubmit={() => { void renameSelectedExplorerEntry(); }}
                      onRenameCancel={() => { setExplorerRenamePath(undefined); setExplorerRenameName(""); setExplorerRenameError(undefined); }}
                      creationKind={explorerCreation}
                      creationParentPath={explorerCreationParentPath}
                      creationName={explorerCreationName}
                      creationError={explorerCreationError}
                      onCreationNameChange={(name) => { setExplorerCreationName(name); setExplorerCreationError(undefined); }}
                      onCreationSubmit={() => { void createWorkspaceEntry(); }}
                      onCreationCancel={cancelExplorerCreation}
                      workspaceName={workspaceName}
                      {...(workspaceRoot ? { workspaceRoot } : {})}
                    />
                  ) : (
                    <div className="empty-sidebar">
                      <p>{workspaceAccess === "permission-required"
                        ? "O acesso ao workspace precisa ser restaurado."
                        : workspaceAccess === "missing"
                          ? "O workspace salvo não está mais disponível."
                          : "Nenhum arquivo ou pasta aberto."}</p>
                      {workspaceAccess === "permission-required" && workspaceHandle
                        ? <button className="button primary compact" type="button" onClick={() => invoke(reconnectWorkspace)}>Reconectar pasta</button>
                        : null}
                      {workspaceAccess === "missing"
                        ? <button className="button primary compact" type="button" onClick={() => invoke(openFolder)}>Reabrir pasta</button>
                        : null}
                    </div>
                  )}
                </div>
              ) : null}

              {sidebarView === "plugins" ? (
                <div className="sidebar-content plugins-view">
                  <div className="toolbar-row spread">
                    <span>{platformSnapshot.plugins.length} instalado(s)</span>
                    <button className="icon-button small" type="button" aria-label="Atualizar catálogo" onClick={() => invoke(() => platform.discoverPlugins())}><RefreshCw size={14} /></button>
                  </div>
                  {platformSnapshot.plugins.map((plugin) => {
                    const enabled = plugin.state === "active" || plugin.state === "enabled";
                    return (
                      <article className="plugin-card" key={plugin.manifest.id}>
                        <button className="card-delete" type="button" aria-label={`Remover ${plugin.manifest.name}`} title={`Remover ${plugin.manifest.name}`} onClick={() => setPluginRemovalId(plugin.manifest.id)}><X size={14} /></button>
                        <div className="plugin-card-heading"><Package size={16} /><strong>{plugin.manifest.name}</strong></div>
                        <p>{plugin.manifest.description}</p>
                        <small>{plugin.manifest.id} · {plugin.manifest.version}</small>
                        <div className="plugin-actions">
                          <button className="button secondary compact" type="button" onClick={() => invoke(() => platform.setEnabled(plugin.manifest.id, !enabled))}>{enabled ? "Desativar" : "Ativar"}</button>
                          {settingsProviders.some((provider) => provider.pluginId === plugin.manifest.id) ? (
                            <button
                              className="button secondary compact"
                              type="button"
                              onClick={() => {
                                const provider = settingsProviders.find((candidate) => candidate.pluginId === plugin.manifest.id);
                                if (provider) openSettings(provider.pluginId);
                              }}
                            >
                              <Settings2 size={13} /> Configurar
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                  {platformSnapshot.catalog.filter((entry) => !installedIds.has(entry.manifest.id)).map((entry) => (
                    <article className="plugin-card available" key={entry.manifest.id}>
                      <div className="plugin-card-heading"><Box size={16} /><strong>{entry.manifest.name}</strong></div>
                      <p>{entry.manifest.description}</p>
                      <button className="button primary compact full" type="button" onClick={() => invoke(() => platform.install(entry.manifestUrl))}>Instalar</button>
                    </article>
                  ))}
                </div>
              ) : null}

              {sidebarView === "environments" ? (
                <div className="sidebar-content environment-manager">
                  <div className="environment-manager__intro">
                    <div>
                      <strong>{environmentProvider()?.name ?? "Ambientes de execução"}</strong>
                      <p>Gerencie runtimes e ambientes fornecidos pelo plugin ativo.</p>
                    </div>
                    <button className="icon-button small" type="button" aria-label="Atualizar ambientes" onClick={() => invoke(refreshEnvironments)}><RefreshCw size={14} /></button>
                  </div>
                  <div className="environment-manager__toolbar">
                    <button className="button secondary compact" type="button" onClick={() => { setEnvironmentForm("addExecutable"); setEnvironmentPath(""); }}><Terminal size={14} /> Adicionar executável</button>
                    <button className="button secondary compact" type="button" onClick={() => { setEnvironmentForm("importEnvironment"); setEnvironmentPath(""); }}><FolderOpen size={14} /> Importar ambiente</button>
                    <button className="button primary compact" type="button" onClick={() => { setEnvironmentForm("createEnvironment"); setEnvironmentPath(""); }}><Plus size={14} /> Criar ambiente</button>
                  </div>

                  {environmentForm ? (
                    <form className="environment-form" onSubmit={(event) => invoke(() => submitEnvironmentForm(event))}>
                      <strong>{environmentForm === "addExecutable" ? "Adicionar executável" : environmentForm === "importEnvironment" ? "Importar ambiente existente" : environmentForm === "createEnvironment" ? "Criar ambiente" : environmentForm === "edit" ? "Editar ambiente" : "Instalar dependências"}</strong>
                      {environmentForm === "addExecutable" ? (
                        <>
                          <label>Nome<input name="name" placeholder="Runtime local" /></label>
                          <label>Executável<div className="path-row"><input readOnly value={environmentPath} placeholder="Nenhum executável selecionado" /><button className="button secondary compact" type="button" onClick={() => invoke(async () => { const path = await pickHostPath("file", true); if (path) setEnvironmentPath(path); })}>Procurar</button></div></label>
                        </>
                      ) : null}
                      {environmentForm === "importEnvironment" ? (
                        <>
                          <label>Nome opcional<input name="name" /></label>
                          <label>Pasta<div className="path-row"><input readOnly value={environmentPath} placeholder="Nenhum venv selecionado" /><button className="button secondary compact" type="button" onClick={() => invoke(async () => { const path = await pickHostPath("directory"); if (path) setEnvironmentPath(path); })}>Procurar</button></div></label>
                        </>
                      ) : null}
                      {environmentForm === "createEnvironment" ? (
                        <>
                          <label>Nome<input name="name" defaultValue=".venv" /></label>
                          <label>Executável de origem<select name="baseExecutable" defaultValue={environments.find((environment) => environment.executable)?.executable ?? ""}><option value="">Selecione</option>{environments.filter((environment) => environment.executable).map((environment) => <option key={environment.id} value={environment.executable}>{environment.name}</option>)}</select></label>
                          <label>Diretório opcional<input name="path" /></label>
                        </>
                      ) : null}
                      {environmentForm === "edit" && editingEnvironment ? (
                        <>
                          <label>Nome<input name="name" defaultValue={editingEnvironment.name} /></label>
                          <label>{editingEnvironment.type === "venv" ? "Pasta" : "Executável"}<div className="path-row"><input readOnly value={environmentPath} /><button className="button secondary compact" type="button" onClick={() => invoke(async () => { const path = await pickHostPath(editingEnvironment.type === "venv" ? "directory" : "file", editingEnvironment.type === "process"); if (path) setEnvironmentPath(path); })}>Procurar</button></div></label>
                        </>
                      ) : null}
                      {environmentForm === "dependencies" ? <label>Dependências<input name="dependencies" placeholder="pacote-a pacote-b" /></label> : null}
                      <div className="dialog-actions"><button className="button secondary compact" type="button" onClick={() => setEnvironmentForm(undefined)}>Cancelar</button><button className="button primary compact" disabled={environmentBusy} type="submit">Confirmar</button></div>
                    </form>
                  ) : null}

                  <div className="environment-list">
                    {environments.map((environment) => (
                      <article className={`environment-card${selectedEnvironmentId === environment.id ? " is-active" : ""}`} key={environment.id}>
                        <button className="card-delete" type="button" aria-label={`Remover ${environment.name}`} title={`Remover ${environment.name}`} onClick={() => invoke(() => removeEnvironment(environment.id))}><X size={14} /></button>
                        <div><strong>{environment.name}</strong><span>{environment.type === "venv" ? "Ambiente isolado" : "Executável"}{environment.version ? ` · ${environment.version}` : ""}</span><small>{environment.executable}</small></div>
                        <div className="environment-card__actions">
                          <button className="button secondary compact" disabled={selectedEnvironmentId === environment.id} type="button" onClick={() => selectEnvironment(environment.id)}>{selectedEnvironmentId === environment.id ? "Selecionado" : "Selecionar"}</button>
                          {environmentProvider()?.update ? <button className="button secondary compact" type="button" onClick={() => { setEditingEnvironmentId(environment.id); setEnvironmentPath(environment.type === "venv" ? environment.path ?? "" : environment.executable ?? ""); setEnvironmentForm("edit"); }}>Editar</button> : null}
                          {environment.type === "venv" ? <button className="button secondary compact" type="button" onClick={() => { selectEnvironment(environment.id); setEnvironmentForm("dependencies"); }}>Dependências</button> : null}
                        </div>
                      </article>
                    ))}
                    {!environments.length ? <div className="empty-sidebar"><HardDrive size={26} /><p>Nenhum ambiente cadastrado.</p></div> : null}
                  </div>
                </div>
              ) : null}

              {activePluginSidebar ? (
                <WorkbenchSidebarHost
                  provider={activePluginSidebar}
                  state={workbenchState}
                  onClose={closeSidebar}
                />
              ) : null}
            </aside>
          ) : null}
          {sidebarVisible ? <div className="resize-handle resize-handle--sidebar" role="separator" aria-label="Redimensionar painel lateral" onPointerDown={beginSidebarResize} onDoubleClick={() => setSidebarWidth(DEFAULT_LAYOUT.sidebarWidth)} /> : null}

          <main className="editor-region">
            {documents.length ? (
              <>
                <Tabs.Root className="document-tabs" value={activeDocumentId ?? ""} onValueChange={setActiveDocumentId}>
                  <Tabs.List className="tabs-list">
                    {documents.map((document) => (
                      <Tabs.Trigger
                        className="tab-trigger"
                        key={document.id}
                        value={document.id}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          invoke(() => openDocumentMenu(document, event.clientX, event.clientY));
                        }}
                      >
                        {document.kind === "image"
                          ? <ImageIcon size={14} />
                          : document.kind === "binary"
                            ? <FileWarning size={14} />
                            : <File size={14} />}
                        <span>{document.name}</span>
                        {document.kind === "text" && document.content !== document.savedContent ? <span className="dirty-dot">●</span> : null}
                        <span
                          role="button"
                          tabIndex={0}
                          className="tab-close"
                          onClick={(event) => {
                            event.stopPropagation();
                            closeDocument(document.id);
                          }}
                        ><X size={13} /></span>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Tabs.Root>
                <div className="editor-toolbar">
                  <div className="breadcrumb">{activeDocument?.path ?? activeDocument?.name}</div>
                  <div className="editor-actions">
                    {editorToolbarItems.map((item) => {
                      const icon = item.icon === "undo" ? <Undo2 size={14} />
                        : item.icon === "diff" ? <Code2 size={14} />
                          : item.icon === "plus" ? <Plus size={14} />
                            : <File size={14} />;
                      return (
                        <button
                          key={item.id}
                          className="icon-button small"
                          type="button"
                          aria-label={item.label}
                          title={item.label}
                          onClick={() => invoke(() => {
                            if (!activeDocument) return Promise.resolve();
                            return platform.commands.execute(item.command, editorToolbarDocumentSnapshot(activeDocument));
                          })}
                        >{icon}</button>
                      );
                    })}
                    {activeLanguageProvider?.lintRules?.length ? (
                      <button className="icon-button small" type="button" aria-label="Configurar lint" title="Configurar lint" onClick={() => setLintSettingsOpen(true)}><Code2 size={14} /></button>
                    ) : null}
                    <button
                      className="icon-button small"
                      type="button"
                      aria-label="Salvar arquivo"
                      title="Salvar arquivo"
                      disabled={!activeDocument || activeDocument.kind !== "text" || Boolean(activeResourceEditorProvider)}
                      onClick={() => invoke(saveDocument)}
                    ><Save size={14} /></button>
                  </div>
                </div>
                <div className="editor-stack">
                  {activeDocument && activeResourceEditorProvider ? (
                    <ResourceEditorHost provider={activeResourceEditorProvider} document={activeDocument} />
                  ) : activeDocument?.kind === "image" ? (
                    <NativeImageEditor document={activeDocument} />
                  ) : activeDocument?.kind === "binary" ? (
                    <UnsupportedBinaryEditor document={activeDocument} />
                  ) : (
                    <>
                  <div className={`editor-canvas${showEditorGutter ? " has-editor-gutter" : ""}${editorSettings.lineNumbers ? " has-line-numbers" : ""}`}>
                    {showEditorGutter ? (
                      <div className={`editor-line-ruler${editorSettings.lineNumbers ? "" : " decorations-only"}`}>
                        <pre ref={editorLineRulerRef}>
                          {editorRulerLines.map((lineNumber, index) => {
                            const line = index + 1;
                            const decorations = editorDecorationsByLine.get(line) ?? [];
                            const changeDecoration = decorations.find((decoration) => decoration.change);
                            const tooltip = decorations
                              .map((decoration) => decoration.tooltip ?? decoration.label)
                              .filter((value): value is string => Boolean(value))
                              .join("\n");
                            const content = <>
                              <i className="editor-line-ruler__marker" />
                              {editorSettings.lineNumbers ? <b>{lineNumber}</b> : null}
                            </>;
                            return changeDecoration ? (
                              <button
                                className={`editor-line-ruler__line${lineDecorationClassName(decorations)}`}
                                key={line}
                                type="button"
                                title={tooltip || undefined}
                                aria-label={`${tooltip || "Exibir alteração"}, linha ${line}`}
                                onClick={() => setSelectedEditorLineDecoration((current) => current === changeDecoration ? undefined : changeDecoration)}
                              >
                                {content}
                              </button>
                            ) : (
                              <span className="editor-line-ruler__line" key={line}>{content}</span>
                            );
                          })}
                        </pre>
                      </div>
                    ) : null}
                    {activeLanguageProvider && activeDocument ? (
                      <div
                        ref={highlightedEditorScrollRef}
                        className="highlight-editor"
                        onMouseMove={(event) => {
                          const bounds = event.currentTarget.getBoundingClientRect();
                          const contentY = event.clientY - bounds.top + event.currentTarget.scrollTop - 18;
                          const line = Math.floor(contentY / 21.45) + 1;
                          const nextLine = diagnostics.some((diagnostic) => diagnostic.line === line)
                            ? line
                            : undefined;
                          setHoveredDiagnosticLine((current) => current === nextLine ? current : nextLine);
                        }}
                        onMouseLeave={() => setHoveredDiagnosticLine(undefined)}
                        onScroll={(event) => {
                          syncEditorLineRuler(event.currentTarget.scrollTop);
                          if (editorRef.current) captureEditorState(editorRef.current, event.currentTarget);
                        }}
                      >
                        <div className="highlight-editor__content">
                          <pre className="syntax-layer"><HighlightedSource source={activeDocument.content} provider={activeLanguageProvider} /></pre>
                          <DiagnosticLayer
                            diagnostics={diagnostics}
                            source={activeDocument.content}
                            hoveredLine={hoveredDiagnosticLine}
                          />
                          <textarea
                            ref={editorRef}
                            className="code-editor code-editor--highlighted"
                            spellCheck={false}
                            wrap="off"
                            value={activeDocument.content}
                            onChange={(event) => updateDocument(event.currentTarget)}
                            onKeyDown={handleEditorKeyDown}
                            onSelect={(event) => captureEditorState(event.currentTarget, highlightedEditorScrollRef.current ?? event.currentTarget)}
                          />
                        </div>
                      </div>
                    ) : (
                      <textarea
                        ref={editorRef}
                        className="code-editor"
                        spellCheck={false}
                        value={activeDocument?.content ?? ""}
                        onChange={(event) => updateDocument(event.currentTarget)}
                        onKeyDown={handleEditorKeyDown}
                        onSelect={(event) => captureEditorState(event.currentTarget)}
                        onScroll={(event) => {
                          syncEditorLineRuler(event.currentTarget.scrollTop);
                          captureEditorState(event.currentTarget);
                        }}
                      />
                    )}
                    {selectedEditorLineDecoration?.change && activeDocument ? (
                      <EditorLineDiffPeek
                        decoration={selectedEditorLineDecoration}
                        provider={activeLanguageProvider}
                        top={18 + (selectedEditorLineDecoration.line - 1) * 21.45 - activeDocument.scrollTop + 21.45}
                        onClose={() => setSelectedEditorLineDecoration(undefined)}
                        onAction={(action) => {
                          invoke(async () => {
                            await platform.commands.execute(action.command, {
                              document: {
                                id: activeDocument.id,
                                name: activeDocument.name,
                                ...(activeDocument.path ? { path: activeDocument.path } : {}),
                                ...(activeDocument.workspaceRoot ? { workspaceRoot: activeDocument.workspaceRoot } : {}),
                                content: activeDocument.content,
                                isDirty: activeDocument.content !== activeDocument.savedContent,
                              },
                              decoration: selectedEditorLineDecoration,
                              action,
                            });
                            if (action.closeOnRun) setSelectedEditorLineDecoration(undefined);
                          });
                        }}
                      />
                    ) : null}
                  </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="welcome-screen">
                <span className="welcome-kicker">Bem-vindo</span>
                <h1>tinyIde</h1>
                <p>Crie ou abra um arquivo para começar.</p>
                <div className="welcome-actions">
                  <button className="button primary" type="button" onClick={newDocument}><FilePlus2 size={16} /> Novo arquivo</button>
                  <button className="button secondary" type="button" onClick={() => invoke(openSingleFile)}><File size={16} /> Abrir arquivo</button>
                  <button className="button secondary" type="button" onClick={() => invoke(openFolder)}><FolderOpen size={16} /> Abrir pasta</button>
                </div>
                <small>Atalhos: Ctrl+N, Ctrl+O, Ctrl+S e Ctrl+Shift+S</small>
              </div>
            )}

          </main>

          <div className="workbench-bottom-region">
            {panelVisible ? (
              <section className={`output-panel${panelVisible ? "" : " output-panel--hidden"}`} style={{ height: panelHeight }}>
                <div className="resize-handle resize-handle--panel" role="separator" aria-label="Redimensionar painel inferior" onPointerDown={beginPanelResize} onDoubleClick={() => setPanelHeight(DEFAULT_LAYOUT.panelHeight)} />
                <div className="panel-heading">
                  <div className="panel-tabs">
                    <button className={`panel-tab${panelTab === "output" ? " active" : ""}`} type="button" onClick={() => setPanelTab("output")}>SAÍDA</button>
                    <button className={`panel-tab${panelTab === "problems" ? " active" : ""}`} type="button" onClick={() => setPanelTab("problems")}>PROBLEMAS <span>{diagnostics.length}</span></button>
                    {workbenchPanels.map((panel) => (
                      <button
                        className={`panel-tab${panelTab === panel.id ? " active" : ""}`}
                        type="button"
                        key={panel.id}
                        onClick={() => setPanelTab(panel.id)}
                      >{panel.label}</button>
                    ))}
                  </div>
                  <button className="icon-button small" type="button" aria-label="Fechar painel" onClick={() => setPanelVisible(false)}><X size={14} /></button>
                </div>
                <pre hidden={panelTab !== "output"}>{output.join("\n")}</pre>
                <div className="problems-list" hidden={panelTab !== "problems"}>{diagnostics.length ? diagnostics.map((diagnostic, index) => <button type="button" key={`${diagnostic.line}:${index}`}><strong>{diagnostic.severity}</strong><span>{diagnostic.line}:{diagnostic.column}</span><span>{diagnostic.message}</span></button>) : <p>Nenhum problema detectado.</p>}</div>
                {restorationComplete ? workbenchPanels.map((panel) => (
                  <div className="plugin-panel-container" hidden={panelTab !== panel.id} key={panel.id}>
                    <WorkbenchPanelHost provider={panel} state={workbenchState} />
                  </div>
                )) : null}
              </section>
            ) : null}

            {restorationComplete && activeToolWindow ? (
              <WorkbenchToolWindowHost
                provider={activeToolWindow}
                state={workbenchState}
                visible={toolWindowVisible}
                height={toolWindowHeight}
                onClose={closeToolWindow}
                onResize={beginToolWindowResize}
                onResetHeight={() => setToolWindowHeight(DEFAULT_LAYOUT.toolWindowHeight)}
              />
            ) : null}
          </div>
        </div>

        <footer className="statusbar">
          <button type="button" onClick={() => invoke(openSingleFile)}><File size={13} /> Abrir arquivo</button>
          <span>{platformSnapshot.plugins.length} plugin(s)</span>
          <span className="status-spacer" />
          <span>{activeDocument?.kind === "text" && activeDocument.content !== activeDocument.savedContent ? "Modificado" : "Salvo"}</span>
          <span>{activeDocument?.kind === "text" ? "UTF-8" : activeDocument?.mediaType ?? ""}</span>
          <span>{activeResourceEditorProvider?.id ?? activeLanguageProvider?.name ?? (activeDocument?.kind === "image" ? "Imagem" : activeDocument?.kind === "binary" ? "Binário" : "Texto")}</span>
        </footer>

        <ProfileDialog
          open={profilesOpen}
          onOpenChange={setProfilesOpen}
          profiles={profilesState.profiles}
          selectedId={profilesState.selectedId}
          environments={environments}
          executableOptions={executableOptions}
          onBrowseCommand={() => pickHostPath("file")}
          onChange={updateProfiles}
        />

        <Dialog.Root open={aboutOpen} onOpenChange={setAboutOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content dialog-content--small">
              <div className="dialog-heading">
                <div>
                  <Dialog.Title>Sobre</Dialog.Title>
                  <Dialog.Description>Editor web extensível orientado a plugins.</Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button className="icon-button" type="button" aria-label="Fechar"><X size={16} /></button>
                </Dialog.Close>
              </div>
              <div className="about-content">
                <img className="about-logo" src="/icon.png" alt="Ícone do tinyIde" />
                <span>Versão 0.4.0</span>
                <p>O núcleo permanece um editor de texto básico. Recursos de IDE são fornecidos por plugins independentes.</p>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={Boolean(workbenchDialog)} onOpenChange={(open) => {
          if (!open) setWorkbenchDialog(undefined);
        }}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className={`workbench-plugin-dialog workbench-plugin-dialog--${workbenchDialog?.contribution.size ?? "large"}`}>
              <div className="dialog-heading">
                <div>
                  <span className="eyebrow">PLUGIN</span>
                  <Dialog.Title>{workbenchDialog?.contribution.title ?? "Plugin"}</Dialog.Title>
                  {workbenchDialog?.contribution.description ? (
                    <Dialog.Description>{workbenchDialog.contribution.description}</Dialog.Description>
                  ) : null}
                </div>
                <Dialog.Close asChild>
                  <button className="icon-button" type="button" aria-label="Fechar"><X size={16} /></button>
                </Dialog.Close>
              </div>
              {workbenchDialog ? (
                <WorkbenchDialogHost
                  provider={workbenchDialog.contribution}
                  onClose={() => setWorkbenchDialog(undefined)}
                />
              ) : null}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="settings-dialog">
              <div className="dialog-heading settings-dialog__heading">
                <div className="settings-dialog__identity">
                  <span className="settings-dialog__icon"><Settings2 size={20} /></span>
                  <div>
                    <span className="eyebrow">PREFERÊNCIAS DO PROJETO</span>
                    <Dialog.Title>Configurações</Dialog.Title>
                    <Dialog.Description>
                      Ajustes locais do editor e extensões instaladas.
                    </Dialog.Description>
                  </div>
                </div>
                <div className="settings-dialog__heading-actions">
                  <span className="settings-workspace-badge" title={workspaceRoot ?? "Nenhum workspace aberto"}>
                    <FolderRoot size={13} /> {workspaceName}
                  </span>
                  <Dialog.Close asChild><button className="icon-button" type="button" aria-label="Fechar"><X size={16} /></button></Dialog.Close>
                </div>
              </div>
              <div className="settings-layout">
                <nav className="settings-navigation" aria-label="Seções de configuração">
                  <span className="settings-navigation__label">Geral</span>
                  <button
                    className={settingsSectionId === "editor" ? "is-active" : ""}
                    type="button"
                    onClick={() => selectSettingsSection("editor")}
                  >
                    <Code2 size={15} />
                    <span>Editor</span>
                  </button>
                  {settingsProviders.length ? <span className="settings-navigation__label">Plugins</span> : null}
                  {settingsProviders.map((provider) => (
                    <button
                      className={settingsSectionId === provider.pluginId ? "is-active" : ""}
                      key={provider.pluginId}
                      type="button"
                      onClick={() => selectSettingsSection(provider.pluginId)}
                    >
                      <Plug size={15} />
                      <span>{provider.title}</span>
                    </button>
                  ))}
                </nav>
                <section className="settings-content">
                  {settingsSectionId === "editor" ? (
                    <>
                      <div className="settings-section-heading">
                        <span className="settings-section-heading__icon"><Code2 size={18} /></span>
                        <div>
                          <span className="eyebrow">NATIVO</span>
                          <h3>Editor</h3>
                          <p>Comportamento e apresentação do editor de texto.</p>
                        </div>
                      </div>
                      <div className="plugin-setting-list">
                        <label className="plugin-setting">
                          <span className="plugin-setting__copy">
                            <strong>Régua numérica</strong>
                            <small>Mostra a numeração das linhas e serve como área de indicadores do editor.</small>
                          </span>
                          <span className="settings-switch">
                            <input
                              type="checkbox"
                              checked={editorSettings.lineNumbers}
                              disabled={!workspaceRoot}
                              onChange={(event) => invoke(() => applyEditorLineNumbers(event.target.checked))}
                            />
                            <i aria-hidden="true" />
                          </span>
                        </label>
                      </div>
                    </>
                  ) : activePluginSettingsProvider ? (
                    <>
                      <div className="settings-section-heading">
                        <span className="settings-section-heading__icon"><Plug size={18} /></span>
                        <div>
                          <span className="eyebrow">PLUGIN</span>
                          <h3>{activePluginSettingsProvider.title}</h3>
                          <p>{activePluginSettingsProvider.description ?? "Configurações específicas deste plugin para o workspace."}</p>
                        </div>
                      </div>
                      <div className="plugin-setting-list">
                        {activePluginSettingsProvider.settings.map((setting) => (
                          <label className="plugin-setting" key={setting.id}>
                            <span className="plugin-setting__copy">
                              <strong>{setting.label}</strong>
                              {setting.description ? <small>{setting.description}</small> : null}
                            </span>
                            <span className="settings-switch">
                              <input
                                type="checkbox"
                                checked={pluginSettingsDraft[setting.id] !== false}
                                disabled={!workspaceRoot}
                                onChange={(event) => invoke(() => applyPluginSetting(setting.id, event.target.checked))}
                              />
                              <i aria-hidden="true" />
                            </span>
                          </label>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="settings-empty-state">Esta seção não está mais disponível.</p>
                  )}
                </section>
              </div>
              <div className="settings-dialog__footer">
                {!workspaceRoot ? (
                  <p className="settings-scope-note"><CircleAlert size={14} /> Abra um workspace para alterar configurações locais.</p>
                ) : (
                  <p className="settings-scope-note"><Check size={14} /> Alterações salvas automaticamente em <code>.tinyide/settings.json</code>.</p>
                )}
                <button className="button primary" type="button" onClick={() => setSettingsOpen(false)}>Concluir</button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={lintSettingsOpen} onOpenChange={setLintSettingsOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="lint-settings-dialog">
              <div className="dialog-heading">
                <div>
                  <span className="eyebrow">ANÁLISE</span>
                  <Dialog.Title>Configurar lint</Dialog.Title>
                  <Dialog.Description>
                    Selecione os casos que {activeLanguageProvider?.name ?? "o provider"} deve detectar neste workspace.
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild><button className="icon-button" type="button" aria-label="Fechar"><X size={16} /></button></Dialog.Close>
              </div>
              <div className="lint-rule-list">
                {(activeLanguageProvider?.lintRules ?? []).map((rule) => (
                  <label className="lint-rule" key={rule.id}>
                    <input
                      type="checkbox"
                      checked={lintEnabledRuleIds.includes(rule.id)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...new Set([...lintEnabledRuleIds, rule.id])]
                          : lintEnabledRuleIds.filter((id) => id !== rule.id);
                        setLintEnabledRuleIds(next);
                        if (activeLanguageProvider) {
                          void updateWorkspaceSettings((current) => ({
                            ...current,
                            lint: {
                              ...current.lint,
                              [activeLanguageProvider.id]: { enabledRuleIds: next },
                            },
                          })).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
                        }
                      }}
                    />
                    <span><strong>{rule.label}</strong>{rule.description ? <small>{rule.description}</small> : null}</span>
                  </label>
                ))}
              </div>
              <div className="dialog-actions">
                <Dialog.Close asChild><button className="button primary" type="button">Concluir</button></Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={Boolean(environmentBrowserMode)} onOpenChange={(open) => {
          if (!open) cancelEnvironmentBrowser();
        }}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="file-browser-dialog">
              <div className="file-browser-heading">
                <div><span className="eyebrow">SISTEMA DE ARQUIVOS</span><Dialog.Title>{environmentBrowserMode === "file" ? "Selecionar executável" : "Selecionar ambiente"}</Dialog.Title><Dialog.Description>Navegue pelo host, selecione um item válido e confirme.</Dialog.Description></div>
                <Dialog.Close asChild><button className="icon-button" type="button" aria-label="Fechar"><X size={16} /></button></Dialog.Close>
              </div>
              <div className="file-browser-controls">
                <label className="search-field"><Search size={15} /><input value={environmentBrowserFilter} onChange={(event) => setEnvironmentBrowserFilter(event.target.value)} placeholder="Filtrar nesta pasta" /></label>
                <label className="check-row"><input type="checkbox" checked={environmentBrowserHidden} onChange={(event) => { const checked = event.target.checked; setEnvironmentBrowserHidden(checked); invoke(() => loadEnvironmentBrowser(environmentBrowserMode ?? "directory", environmentListing?.path, checked)); }} /> Mostrar ocultos</label>
              </div>
              <div className="file-browser-path"><button className="button secondary compact" type="button" disabled={!environmentListing?.parentPath} onClick={() => invoke(() => navigateEnvironmentBrowser(environmentListing?.parentPath))}><Upload size={14} /> Pasta pai</button><code>{environmentListing?.path ?? "Carregando..."}</code></div>
              <div className="file-browser-selection">{environmentBrowserSelection ? <><Check size={16} /><strong>{environmentBrowserSelection}</strong></> : <span>Nenhum item selecionado.</span>}</div>
              <div className="file-browser-entries">
                {(environmentListing?.entries ?? [])
                  .filter((entry) => !environmentBrowserFilter.trim() || entry.name.toLocaleLowerCase().includes(environmentBrowserFilter.trim().toLocaleLowerCase()))
                  .map((entry) => {
                    const selectable = environmentBrowserMode === "file"
                      ? entry.kind === "file" && (!environmentBrowserExecutableOnly || entry.executable)
                      : entry.kind === "directory" && entry.isEnvironment;
                    return (
                      <button
                        className={`file-browser-entry${environmentBrowserSelection === entry.path ? " is-selected" : ""}`}
                        type="button"
                        key={entry.path}
                        disabled={entry.kind === "file" && !selectable}
                        onDoubleClick={() => entry.kind === "directory" && !selectable ? invoke(() => navigateEnvironmentBrowser(entry.path)) : undefined}
                        onClick={() => selectable ? setEnvironmentBrowserSelection(entry.path) : entry.kind === "directory" ? invoke(() => navigateEnvironmentBrowser(entry.path)) : undefined}
                      >
                        {entry.kind === "directory" ? <Folder size={17} /> : <File size={17} />}
                        <span><strong>{entry.name}</strong><small>{selectable ? (environmentBrowserMode === "file" ? environmentBrowserExecutableOnly ? "Executável válido" : "Arquivo selecionável" : "Ambiente válido") : entry.kind === "directory" ? "Diretório" : "Arquivo"}</small></span>
                      </button>
                    );
                  })}
              </div>
              <div className="file-browser-footer"><button className="button secondary" type="button" onClick={cancelEnvironmentBrowser}>Cancelar</button><button className="button primary" disabled={!environmentBrowserSelection} type="button" onClick={() => invoke(confirmEnvironmentBrowser)}>Confirmar seleção</button></div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {contextMenu ? (
          <>
            <button
              className="resource-context-menu-backdrop"
              type="button"
              aria-label="Fechar menu de contexto"
              onClick={() => setContextMenu(undefined)}
              onContextMenu={(event) => { event.preventDefault(); setContextMenu(undefined); }}
            />
            <div
              className="menu-content resource-context-menu"
              role="menu"
              aria-label={`Ações de ${contextMenu.target.kind === "root"
                ? workspaceName
                : contextMenu.target.kind === "entry"
                  ? contextMenu.target.entry.name
                  : contextMenu.target.document.name}`}
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              {contextMenu.items.map((item, index) => {
                const previous = contextMenu.items[index - 1];
                const separated = previous && previous.group !== item.group;
                const icon = item.icon === "play" ? <Play size={14} />
                  : item.icon === "folder" ? <FolderOpen size={14} />
                    : item.icon === "copy" ? <Code2 size={14} />
                      : item.icon === "terminal" ? <Terminal size={14} />
                        : item.icon === "save" ? <Save size={14} />
                          : item.icon === "close" ? <X size={14} />
                            : item.icon === "plus" ? <Plus size={14} />
                              : item.icon === "undo" ? <Undo2 size={14} />
                                : item.icon === "diff" ? <Code2 size={14} />
                                  : <File size={14} />;
                return (
                  <div key={item.id}>
                    {separated ? <div className="menu-separator" /> : null}
                    <button
                      className="menu-item resource-context-menu__item"
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={() => invoke(() => executeContextMenuItem(item, contextMenu.target))}
                    >
                      {icon}<span>{item.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {error ? (
          <div className="error-toast" role="alert">
            <span>{error}</span>
            <button className="icon-button small" type="button" aria-label="Fechar erro" onClick={() => setError(undefined)}><X size={14} /></button>
          </div>
        ) : null}

        {pluginPendingRemoval ? (
          <div className="profile-removal-backdrop" role="presentation">
            <section className="profile-removal-dialog" role="alertdialog" aria-modal="true" aria-labelledby="plugin-removal-title">
              <div>
                <span className="eyebrow">CONFIRMAÇÃO</span>
                <h3 id="plugin-removal-title">Remover plugin?</h3>
                <p>O plugin <strong>{pluginPendingRemoval.manifest.name}</strong> será desativado e removido da aplicação.</p>
              </div>
              <div className="dialog-actions">
                <button className="button secondary" type="button" onClick={() => setPluginRemovalId(undefined)}>Cancelar</button>
                <button className="button danger" type="button" onClick={() => invoke(async () => {
                  await platform.uninstall(pluginPendingRemoval.manifest.id);
                  setPluginRemovalId(undefined);
                })}>Remover</button>
              </div>
            </section>
          </div>
        ) : null}

        {explorerPendingDeletion ? (
          <div className="profile-removal-backdrop" role="presentation">
            <section className="profile-removal-dialog" role="alertdialog" aria-modal="true" aria-labelledby="explorer-removal-title">
              <div>
                <span className="eyebrow">CONFIRMAÇÃO</span>
                <h3 id="explorer-removal-title">Excluir {explorerPendingDeletion.kind === "directory" ? "pasta" : "arquivo"}?</h3>
                <p>
                  <strong>{explorerPendingDeletion.name}</strong> será removido do workspace
                  {explorerPendingDeletion.kind === "directory" ? " com todo o conteúdo interno." : "."}
                </p>
              </div>
              <div className="dialog-actions">
                <button className="button secondary" type="button" onClick={() => setExplorerPendingDeletion(undefined)}>Cancelar</button>
                <button className="button danger" type="button" onClick={() => invoke(async () => {
                  const entry = explorerPendingDeletion;
                  await deleteWorkspaceEntry(entry);
                  setExplorerPendingDeletion(undefined);
                })}>Excluir</button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </Tooltip.Provider>
  );
}
