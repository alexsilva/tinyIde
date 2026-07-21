import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Cpu,
  Eye,
  EyeOff,
  File,
  FilePlus2,
  Files,
  Folder,
  FolderOpen,
  HardDrive,
  MoreHorizontal,
  Package,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Square,
  Terminal,
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
import type {
  ExecutionEnvironment,
  ExecutionEnvironmentDirectoryListing,
  ExecutionEnvironmentProvider,
  ExecutionProfile,
  ExecutionProfileExecutableOption,
  LanguageLintSettings,
  LanguageProvider,
  TextDiagnostic,
} from "@tinyide/plugin-api";
import {
  listDirectory,
  readFileDocument,
  writeFileDocument,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type OpenDocument,
  type WorkspaceEntry,
} from "../browser-filesystem";
import { platform } from "./platform";
import {
  DEFAULT_LAYOUT,
  deserializeEntries,
  readReactSnapshot,
  readSession,
  writeReactSnapshot,
  writeSession,
  type PersistedSidebarView,
} from "./persistence";
import {
  environmentProvider,
  languageProviderFor,
  lintDocument,
  loadEnvironments,
  loadProfileContributions,
  readHostContext,
  runExecutionProfile,
  runScript,
  scriptExecutionFor,
  setHostWorkspace,
  stopHostProcess,
} from "./runtime";

const PROFILE_KEY = "tinyide.react.executionProfiles.v1";
const LINT_SETTINGS_KEY = "tinyide.react.lintSettings.v1";

type SidebarView = PersistedSidebarView;

interface StoredProfiles {
  readonly profiles: readonly ExecutionProfile[];
  readonly selectedId?: string;
}

function lintSettingsStorageKey(workspaceName: string, providerId: string): string {
  return `${LINT_SETTINGS_KEY}:${encodeURIComponent(workspaceName)}:${encodeURIComponent(providerId)}`;
}

function readLintSettings(workspaceName: string, provider: LanguageProvider): LanguageLintSettings {
  const defaults = (provider.lintRules ?? [])
    .filter((rule) => rule.defaultEnabled)
    .map((rule) => rule.id);
  try {
    const raw = localStorage.getItem(lintSettingsStorageKey(workspaceName, provider.id));
    if (!raw) return { enabledRuleIds: defaults };
    const parsed = JSON.parse(raw) as Partial<LanguageLintSettings>;
    return {
      enabledRuleIds: Array.isArray(parsed.enabledRuleIds)
        ? parsed.enabledRuleIds.filter((value): value is string => typeof value === "string")
        : defaults,
    };
  } catch {
    return { enabledRuleIds: defaults };
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
        executable: "python",
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

function readProfiles(workspaceName: string): StoredProfiles {
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
    if (!raw) return { profiles: [] };
    const parsed = JSON.parse(raw) as StoredProfiles;
    const result = {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      ...(typeof parsed.selectedId === "string" ? { selectedId: parsed.selectedId } : {}),
    };
    if (!localStorage.getItem(scopedKey)) localStorage.setItem(scopedKey, JSON.stringify(result));
    return result;
  } catch {
    return { profiles: [] };
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

function EntryTree({
  entries,
  expanded,
  showHidden,
  highlightedPath,
  onToggle,
  onOpen,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly expanded: ReadonlySet<string>;
  readonly showHidden: boolean;
  readonly highlightedPath: string | undefined;
  readonly onToggle: (entry: WorkspaceEntry) => void;
  readonly onOpen: (entry: WorkspaceEntry) => void;
}) {
  const visibleEntries = showHidden
    ? entries
    : entries.filter((entry) => !entry.name.startsWith("."));

  return (
    <div className="tree">
      {visibleEntries.map((entry) => (
        <div key={entry.path}>
          <div className="tree-entry-row">
            <button
              type="button"
              className={`tree-entry tree-entry--${entry.kind}${highlightedPath === entry.path ? " is-new" : ""}`}
              onClick={() => {
                if (entry.kind === "directory") onToggle(entry);
              }}
              onDoubleClick={() => {
                if (entry.kind === "file") onOpen(entry);
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
              ) : (
                <File className="tree-entry__icon tree-entry__icon--file" size={15} />
              )}
              <span className="tree-entry__name">{entry.name}</span>
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="tree-entry-menu" type="button" aria-label={`Ações de ${entry.name}`}>
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu-content" align="start" sideOffset={4}>
                  <DropdownMenu.Item className="menu-item" onSelect={() => entry.kind === "file" ? onOpen(entry) : onToggle(entry)}>
                    {entry.kind === "file" ? <File size={14} /> : <FolderOpen size={14} />}
                    {entry.kind === "file" ? "Abrir" : expanded.has(entry.path) ? "Recolher" : "Expandir"}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="menu-item" onSelect={() => void navigator.clipboard?.writeText(entry.path)}>
                    <Code2 size={14} /> Copiar caminho
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
          {entry.kind === "directory" && expanded.has(entry.path) && entry.children ? (
            <div className="tree-children">
              <EntryTree
                entries={entry.children}
                expanded={expanded}
                showHidden={showHidden}
                highlightedPath={highlightedPath}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            </div>
          ) : null}
        </div>
      ))}
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

function DiagnosticLayer({ diagnostics }: { readonly diagnostics: readonly TextDiagnostic[] }) {
  return (
    <div className="diagnostic-layer" aria-hidden="true">
      {diagnostics.map((diagnostic, index) => {
        const endColumn = diagnostic.endLine === diagnostic.line
          ? diagnostic.endColumn ?? diagnostic.column + 1
          : diagnostic.column + 1;
        const width = Math.max(1, endColumn - diagnostic.column);
        return (
          <span
            className={`diagnostic-marker diagnostic-marker--${diagnostic.severity}`}
            key={`${diagnostic.line}:${diagnostic.column}:${diagnostic.code ?? index}`}
            style={{
              "--diagnostic-line": diagnostic.line,
              "--diagnostic-column": diagnostic.column,
              "--diagnostic-width": width,
            } as React.CSSProperties}
            title={diagnostic.message}
          />
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
                          placeholder="comando-ou-arquivo"
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
                        placeholder="argumento-1 argumento-2"
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
                        placeholder="${workspaceRoot}"
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
                        placeholder="DEBUG=1"
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

export function App() {
  const initialSession = useMemo(() => readSession(), []);
  const [platformSnapshot, setPlatformSnapshot] = useState(() => platform.snapshot());
  const [sidebarView, setSidebarView] = useState<SidebarView>(initialSession.sidebarView);
  const [sidebarVisible, setSidebarVisible] = useState(initialSession.sidebarVisible);
  const [sidebarWidth, setSidebarWidth] = useState(initialSession.sidebarWidth);
  const [panelVisible, setPanelVisible] = useState(initialSession.panelVisible);
  const [panelHeight, setPanelHeight] = useState(initialSession.panelHeight);
  const [panelTab, setPanelTab] = useState<"output" | "problems">(initialSession.panelTab);
  const [workspaceHandle, setWorkspaceHandle] = useState<BrowserDirectoryHandle>();
  const [workspaceName, setWorkspaceName] = useState(initialSession.workspaceName);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | undefined>(initialSession.workspaceRoot);
  const [entries, setEntries] = useState<readonly WorkspaceEntry[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(initialSession.expandedDirectories));
  const [explorerShowHidden, setExplorerShowHidden] = useState(initialSession.explorerShowHidden);
  const [documents, setDocuments] = useState<readonly OpenDocument[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | undefined>(initialSession.activeDocumentId);
  const [output, setOutput] = useState<string[]>(["tinyIde React shell inicializado."]);
  const [diagnostics, setDiagnostics] = useState<readonly TextDiagnostic[]>([]);
  const [environments, setEnvironments] = useState<readonly ExecutionEnvironment[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | undefined>(initialSession.selectedEnvironmentId);
  const [environmentBusy, setEnvironmentBusy] = useState(false);
  const [environmentForm, setEnvironmentForm] = useState<"addProcess" | "addVenv" | "createVenv" | "packages" | "edit">();
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
  const [profilesState, setProfilesState] = useState<StoredProfiles>(() => readProfiles(initialSession.workspaceName));
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [lintSettingsOpen, setLintSettingsOpen] = useState(false);
  const [lintEnabledRuleIds, setLintEnabledRuleIds] = useState<readonly string[]>([]);
  const [pluginRemovalId, setPluginRemovalId] = useState<string>();
  const [error, setError] = useState<string>();
  const [workspaceAccess, setWorkspaceAccess] = useState<"ready" | "permission-required" | "missing">("ready");
  const [explorerCreation, setExplorerCreation] = useState<"file" | "directory">();
  const [explorerCreationName, setExplorerCreationName] = useState("");
  const [highlightedExplorerPath, setHighlightedExplorerPath] = useState<string>();
  const restoredRef = useRef(false);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const explorerHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const browserResolverRef = useRef<((path: string | undefined) => void) | undefined>(undefined);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const activeDocument = documents.find((document) => document.id === activeDocumentId);
  const activeLanguageProvider = languageProviderFor(activeDocument);
  const activeScriptExecution = scriptExecutionFor(activeDocument);
  const selectedProfile = profilesState.profiles.find((profile) => profile.id === profilesState.selectedId);

  useEffect(() => {
    if (!activeLanguageProvider) {
      setLintEnabledRuleIds([]);
      return;
    }
    setLintEnabledRuleIds(readLintSettings(workspaceName, activeLanguageProvider).enabledRuleIds);
  }, [workspaceName, activeLanguageProvider?.id]);

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

  useEffect(() => {
    platform.initialize()
      .then(async () => {
        const snapshot = await readReactSnapshot();
        const restoredWorkspaceName = snapshot?.workspaceName ?? initialSession.workspaceName;
        let restoredWorkspaceRoot = snapshot?.workspaceRoot ?? initialSession.workspaceRoot;
        if (restoredWorkspaceName !== "Sem workspace") {
          const hostWorkspace = await setHostWorkspace(restoredWorkspaceName, restoredWorkspaceRoot);
          restoredWorkspaceRoot = hostWorkspace.workspaceRoot;
          setWorkspaceRoot(hostWorkspace.workspaceRoot);
          setProfilesState(readProfiles(restoredWorkspaceName));
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
            } else {
              setEntries(deserializeEntries(snapshot.workspaceEntries));
              setWorkspaceAccess("permission-required");
            }
          } else {
            setEntries(deserializeEntries(snapshot.workspaceEntries));
            if (snapshot.workspaceName !== "Sem workspace") setWorkspaceAccess("missing");
          }
          setDocuments(snapshot.documents);
          setDiagnostics(snapshot.diagnostics);
          setOutput([...snapshot.output]);
          setActiveDocumentId((current) => current && snapshot.documents.some((document) => document.id === current)
            ? current
            : snapshot.documents[0]?.id);
        }
        const loadedEnvironments = await loadEnvironments();
        setEnvironments(loadedEnvironments);
        setSelectedEnvironmentId((current) => current && loadedEnvironments.some((environment) => environment.id === current)
          ? current
          : loadedEnvironments[0]?.id);
        const restoredActive = snapshot?.documents[0] as OpenDocument | undefined;
        const contributions = await loadProfileContributions({
          workspaceName: restoredWorkspaceName,
          ...(restoredWorkspaceRoot ? { workspaceRoot: restoredWorkspaceRoot } : {}),
          ...(restoredActive ? { activeDocument: restoredActive } : {}),
        });
        setExecutableOptions(contributions.executableOptions);
        restoredRef.current = true;
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(() => {
    writeSession({
      sidebarView,
      sidebarVisible,
      sidebarWidth,
      panelVisible,
      panelHeight,
      panelTab,
      workspaceName,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(activeDocumentId ? { activeDocumentId } : {}),
      expandedDirectories: [...expanded],
      explorerShowHidden,
      ...(selectedEnvironmentId ? { selectedEnvironmentId } : {}),
    });
  }, [sidebarView, sidebarVisible, sidebarWidth, panelVisible, panelHeight, panelTab, workspaceName, workspaceRoot, activeDocumentId, expanded, explorerShowHidden, selectedEnvironmentId]);

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
    if (!platformSnapshot.initialized) return;
    void loadEnvironments().then((loaded) => {
      setEnvironments(loaded);
      setSelectedEnvironmentId((current) => current && loaded.some((environment) => environment.id === current)
        ? current
        : loaded[0]?.id);
    });
    void loadProfileContributions({
      workspaceName,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(activeDocument ? { activeDocument } : {}),
    }).then((contributions) => {
      setExecutableOptions(contributions.executableOptions);
    });
  }, [platformSnapshot.plugins, platformSnapshot.initialized, workspaceName, workspaceRoot, activeDocument?.id]);

  const updateProfiles = (profiles: readonly ExecutionProfile[], selectedId?: string) => {
    const next = { profiles, ...(selectedId ? { selectedId } : {}) };
    setProfilesState(next);
    localStorage.setItem(profileStorageKey(workspaceName), JSON.stringify(next));
  };

  const openFolder = async () => {
    if (!window.showDirectoryPicker) throw new Error("Este navegador não oferece seleção de pastas.");
    const handle = await window.showDirectoryPicker();
    const hostWorkspace = await setHostWorkspace(handle.name);
    setWorkspaceHandle(handle);
    setWorkspaceName(handle.name);
    setWorkspaceRoot(hostWorkspace.workspaceRoot);
    setProfilesState(readProfiles(handle.name));
    setEntries(await listDirectory(handle));
    setExpanded(new Set());
    setWorkspaceAccess("ready");
    await refreshEnvironments();
  };

  const reconnectWorkspace = async () => {
    if (!workspaceHandle) throw new Error("Nenhum workspace anterior disponível para reconexão.");
    const permission = await workspaceHandle.requestPermission?.({ mode: "readwrite" });
    if (permission !== undefined && permission !== "granted") {
      throw new Error("Acesso ao workspace não foi concedido.");
    }
    const rootEntries = await listDirectory(workspaceHandle);
    const hostWorkspace = await setHostWorkspace(workspaceHandle.name, workspaceRoot);
    setEntries(await hydrateExpandedEntries(rootEntries, expanded));
    setWorkspaceName(workspaceHandle.name);
    setWorkspaceRoot(hostWorkspace.workspaceRoot);
    setProfilesState(readProfiles(workspaceHandle.name));
    setWorkspaceAccess("ready");
    await refreshEnvironments();
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
    if (!entry.handle) throw new Error("Restaure o acesso ao workspace antes de abrir este arquivo.");
    const document = await readFileDocument(entry.handle as BrowserFileHandle, entry.path);
    setDocuments((current) => {
      const index = current.findIndex((item) => item.id === document.id);
      return index === -1 ? [...current, document] : current.map((item) => item.id === document.id ? document : item);
    });
    setActiveDocumentId(document.id);
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

    if (!entry.handle) throw new Error("Restaure o acesso ao workspace antes de expandir esta pasta.");
    const children = await listDirectory(entry.handle as BrowserDirectoryHandle, entry.path);
    const replaceChildren = (items: readonly WorkspaceEntry[]): readonly WorkspaceEntry[] => items.map((item) => {
      if (item.path === entry.path) return { ...item, children };
      return item.children ? { ...item, children: replaceChildren(item.children) } : item;
    });
    setEntries((current) => replaceChildren(current));
    setExpanded((current) => new Set(current).add(entry.path));
  };

  const updateDocument = (content: string) => {
    if (!activeDocumentId) return;
    setDocuments((current) => current.map((document) => document.id === activeDocumentId ? { ...document, content } : document));
    setDiagnostics([]);
  };

  const captureEditorState = (textarea: HTMLTextAreaElement) => {
    if (!activeDocumentId) return;
    setDocuments((current) => current.map((document) => document.id === activeDocumentId
      ? {
          ...document,
          selectionStart: textarea.selectionStart,
          selectionEnd: textarea.selectionEnd,
          scrollTop: textarea.scrollTop,
          scrollLeft: textarea.scrollLeft,
        }
      : document));
  };

  useEffect(() => {
    const textarea = editorRef.current;
    if (!textarea || !activeDocument) return;
    requestAnimationFrame(() => {
      textarea.setSelectionRange(activeDocument.selectionStart, activeDocument.selectionEnd);
      textarea.scrollTop = activeDocument.scrollTop;
      textarea.scrollLeft = activeDocument.scrollLeft;
    });
  }, [activeDocumentId]);

  const downloadDocument = (openDocument: OpenDocument) => {
    const url = URL.createObjectURL(new Blob([openDocument.content], { type: "text/plain;charset=utf-8" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = openDocument.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const saveDocument = async (forceSaveAs = false) => {
    if (!activeDocument) return;
    let handle = forceSaveAs ? undefined : activeDocument.handle;
    if (!handle) {
      if (!window.showSaveFilePicker) {
        downloadDocument(activeDocument);
        return;
      }
      handle = await window.showSaveFilePicker({ suggestedName: activeDocument.name });
    }
    const saved = await writeFileDocument(activeDocument, handle);
    setDocuments((current) => current.map((document) => document.id === activeDocument.id ? saved : document));
  };

  const newDocument = () => {
    const sequence = documents.filter((document) => document.name.startsWith("sem-titulo")).length + 1;
    const name = sequence === 1 ? "sem-titulo.py" : `sem-titulo-${sequence}.py`;
    const document: OpenDocument = {
      id: `untitled:${crypto.randomUUID()}`,
      name,
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

  const createWorkspaceEntry = async () => {
    if (!workspaceHandle) throw new Error("Abra ou reconecte um workspace antes de criar arquivos ou pastas.");
    const name = explorerCreationName.trim();
    if (!name) throw new Error("Informe um nome.");

    if (explorerCreation === "file") {
      const handle = await workspaceHandle.getFileHandle(name, { create: true });
      const document = await readFileDocument(handle, name);
      setDocuments((current) => current.some((item) => item.id === document.id) ? current : [...current, document]);
      setActiveDocumentId(document.id);
    } else if (explorerCreation === "directory") {
      await workspaceHandle.getDirectoryHandle(name, { create: true });
    }

    setEntries(await listDirectory(workspaceHandle));
    setHighlightedExplorerPath(name);
    if (explorerHighlightTimerRef.current) clearTimeout(explorerHighlightTimerRef.current);
    explorerHighlightTimerRef.current = setTimeout(() => {
      setHighlightedExplorerPath((current) => current === name ? undefined : current);
    }, 5000);
    setExplorerCreation(undefined);
    setExplorerCreationName("");
  };

  const runSelectedProfile = async () => {
    if (!selectedProfile) throw new Error("Selecione um perfil de execução.");
    if (!selectedProfile.steps.length) throw new Error("O perfil não possui etapas.");
    if (selectedProfile.saveBeforeRun && activeDocument && activeDocument.content !== activeDocument.savedContent) {
      await saveDocument();
    }

    setBusy(true);
    setPanelVisible(true);
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

  const runActiveScript = async () => {
    if (!activeDocument || !activeScriptExecution) throw new Error("Nenhum executor de script disponível para o arquivo atual.");
    if (activeDocument.content !== activeDocument.savedContent) await saveDocument();
    const selectedEnvironment = selectedEnvironmentId
      ? environments.find((environment) => environment.id === selectedEnvironmentId)
      : undefined;
    setBusy(true);
    setPanelVisible(true);
    setPanelTab("output");
    try {
      await runScript({
        contribution: activeScriptExecution,
        document: activeDocument,
        ...(selectedEnvironment ? { environment: selectedEnvironment } : {}),
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

  const stopExecution = async () => {
    if (!activeProcessId) return;
    await stopHostProcess(activeProcessId);
  };

  const refreshEnvironments = async () => {
    const loaded = await loadEnvironments();
    setEnvironments(loaded);
    setSelectedEnvironmentId((current) => current && loaded.some((environment) => environment.id === current)
      ? current
      : loaded[0]?.id);
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
      if (!provider?.validatePythonExecutable) throw new Error("O gerenciador não valida executáveis Python.");
      await provider.validatePythonExecutable(selection);
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
      if (environmentForm === "addProcess") {
        const name = String(data.get("name") ?? "").trim();
        if (!name || !environmentPath) throw new Error("Informe o nome e selecione o executável Python.");
        const created = await provider.addProcess({ name, executable: environmentPath });
        await refreshEnvironments();
        setSelectedEnvironmentId(created.id);
      } else if (environmentForm === "addVenv") {
        if (!environmentPath) throw new Error("Selecione a pasta do ambiente virtual.");
        const name = String(data.get("name") ?? "").trim();
        const created = await provider.addVenv({
          path: environmentPath,
          ...(name ? { name } : {}),
        });
        await refreshEnvironments();
        setSelectedEnvironmentId(created.id);
      } else if (environmentForm === "createVenv") {
        const name = String(data.get("name") ?? "").trim();
        const pythonExecutable = String(data.get("pythonExecutable") ?? "").trim();
        const path = String(data.get("path") ?? "").trim();
        if (!name || !pythonExecutable) throw new Error("Informe o nome e o Python de origem.");
        const created = await provider.createVenv({
          name,
          pythonExecutable,
          ...(path ? { path } : {}),
        });
        await refreshEnvironments();
        setSelectedEnvironmentId(created.id);
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
        await refreshEnvironments();
        setSelectedEnvironmentId(updated.id);
      } else {
        if (!selectedEnvironmentId) throw new Error("Selecione um ambiente virtual.");
        const packages = String(data.get("packages") ?? "").trim().split(/\s+/).filter(Boolean);
        if (!packages.length) throw new Error("Informe ao menos um pacote.");
        await provider.installPackages(selectedEnvironmentId, packages);
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
  }, [newDocument, openSingleFile, saveDocument, invoke]);

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

  const installedIds = useMemo(() => new Set(platformSnapshot.plugins.map((plugin) => plugin.manifest.id)), [platformSnapshot.plugins]);
  const pluginPendingRemoval = platformSnapshot.plugins.find((plugin) => plugin.manifest.id === pluginRemovalId);
  const editingEnvironment = editingEnvironmentId
    ? environments.find((environment) => environment.id === editingEnvironmentId)
    : undefined;

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className="ide-shell">
        <header className="titlebar">
          <div className="app-brand"><Code2 size={17} /><strong>tinyIde</strong></div>
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
                Executar <ChevronDown size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu-content" align="start" sideOffset={6}>
                <DropdownMenu.Item
                  className="menu-item"
                  disabled={!activeScriptExecution || busy}
                  onSelect={() => invoke(runActiveScript)}
                >
                  <Play size={15} /> Executar script atual
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="menu-item"
                  disabled={!selectedProfile || busy}
                  onSelect={() => invoke(runSelectedProfile)}
                >
                  <Terminal size={15} /> Executar perfil selecionado
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <div className="window-title">{workspaceName}</div>
          <div className="titlebar-actions">
            <span className="version-label">v0.4.0</span>
          </div>
        </header>

        <div className="workbench" style={{ gridTemplateColumns: `48px ${sidebarVisible ? `${sidebarWidth}px 5px` : "0 0"} minmax(0, 1fr)` }}>
          <aside className="activity-bar">
            <IconButton label="Explorador" active={sidebarView === "explorer" && sidebarVisible} onClick={() => { setSidebarView("explorer"); setSidebarVisible(true); }}>
              <Files size={20} />
            </IconButton>
            <IconButton label="Plugins" active={sidebarView === "plugins" && sidebarVisible} onClick={() => { setSidebarView("plugins"); setSidebarVisible(true); }}>
              <Plug size={20} />
            </IconButton>
            {environmentProvider() ? (
              <IconButton label="Ambientes" active={sidebarView === "environments" && sidebarVisible} onClick={() => { setSidebarView("environments"); setSidebarVisible(true); invoke(refreshEnvironments); }}>
                <Cpu size={20} />
              </IconButton>
            ) : null}
            <div className="activity-spacer" />
            <IconButton label="Painel inferior" active={panelVisible} onClick={() => setPanelVisible((visible) => !visible)}>
              <Terminal size={20} />
            </IconButton>
          </aside>

          {sidebarVisible ? (
            <aside className="sidebar">
              <div className="sidebar-heading">
                <span>{sidebarView === "explorer" ? "EXPLORER" : sidebarView === "plugins" ? "PLUGINS" : "AMBIENTES"}</span>
                <button className="icon-button small" type="button" onClick={() => setSidebarVisible(false)} aria-label="Fechar sidebar"><X size={14} /></button>
              </div>

              {sidebarView === "explorer" ? (
                <div className="sidebar-content explorer-content">
                  <div className="explorer-actions-sticky">
                    <div className="toolbar-row">
                    <button className="button secondary compact explorer-action-button" type="button" aria-label="Criar arquivo" title="Criar arquivo" disabled={!workspaceHandle} onClick={() => { setExplorerCreation("file"); setExplorerCreationName(""); }}><FilePlus2 size={14} /><span>Arquivo</span></button>
                    <button className="button secondary compact explorer-action-button" type="button" aria-label="Criar pasta" title="Criar pasta" disabled={!workspaceHandle} onClick={() => { setExplorerCreation("directory"); setExplorerCreationName(""); }}><FolderOpen size={14} /><span>Pasta</span></button>
                    <button
                      className={`icon-button small${explorerShowHidden ? " is-active" : ""}`}
                      type="button"
                      aria-label={explorerShowHidden ? "Ocultar arquivos ocultos" : "Mostrar arquivos ocultos"}
                      title={explorerShowHidden ? "Ocultar arquivos ocultos" : "Mostrar arquivos ocultos"}
                      onClick={() => setExplorerShowHidden((visible) => !visible)}
                    >
                      {explorerShowHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    </div>
                    {explorerCreation ? (
                      <form className="explorer-inline-create" onSubmit={(event) => { event.preventDefault(); invoke(createWorkspaceEntry); }}>
                      {explorerCreation === "directory" ? <Folder size={14} /> : <File size={14} />}
                      <input
                        autoFocus
                        value={explorerCreationName}
                        aria-label={explorerCreation === "directory" ? "Nome da nova pasta" : "Nome do novo arquivo"}
                        placeholder={explorerCreation === "directory" ? "nova-pasta" : "arquivo.py"}
                        onChange={(event) => setExplorerCreationName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setExplorerCreation(undefined);
                            setExplorerCreationName("");
                          }
                        }}
                      />
                      <button className="icon-button small" type="submit" aria-label="Confirmar criação"><Check size={14} /></button>
                      <button className="icon-button small" type="button" aria-label="Cancelar criação" onClick={() => { setExplorerCreation(undefined); setExplorerCreationName(""); }}><X size={14} /></button>
                      </form>
                    ) : null}
                  </div>
                  {workspaceName !== "Sem workspace" ? <div className="workspace-name"><ChevronDown size={14} /> {workspaceName}</div> : null}
                  {entries.length ? (
                    <EntryTree
                      entries={entries}
                      expanded={expanded}
                      showHidden={explorerShowHidden}
                      highlightedPath={highlightedExplorerPath}
                      onToggle={(entry) => invoke(() => toggleEntry(entry))}
                      onOpen={(entry) => invoke(() => openEntry(entry))}
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
                      <strong>Ambientes Python</strong>
                      <p>Cadastre interpretadores e ambientes virtuais disponíveis.</p>
                    </div>
                    <button className="icon-button small" type="button" aria-label="Atualizar ambientes" onClick={() => invoke(refreshEnvironments)}><RefreshCw size={14} /></button>
                  </div>
                  <div className="environment-manager__toolbar">
                    <button className="button secondary compact" type="button" onClick={() => { setEnvironmentForm("addProcess"); setEnvironmentPath(""); }}><Terminal size={14} /> Adicionar Python</button>
                    <button className="button secondary compact" type="button" onClick={() => { setEnvironmentForm("addVenv"); setEnvironmentPath(""); }}><FolderOpen size={14} /> Adicionar venv</button>
                    <button className="button primary compact" type="button" onClick={() => { setEnvironmentForm("createVenv"); setEnvironmentPath(""); }}><Plus size={14} /> Criar venv</button>
                  </div>

                  {environmentForm ? (
                    <form className="environment-form" onSubmit={(event) => invoke(() => submitEnvironmentForm(event))}>
                      <strong>{environmentForm === "addProcess" ? "Adicionar Python" : environmentForm === "addVenv" ? "Adicionar venv existente" : environmentForm === "createVenv" ? "Criar ambiente virtual" : environmentForm === "edit" ? "Editar ambiente" : "Instalar pacotes"}</strong>
                      {environmentForm === "addProcess" ? (
                        <>
                          <label>Nome<input name="name" placeholder="Python 3.12" /></label>
                          <label>Executável<div className="path-row"><input readOnly value={environmentPath} placeholder="Nenhum executável selecionado" /><button className="button secondary compact" type="button" onClick={() => invoke(async () => { const path = await pickHostPath("file", true); if (path) setEnvironmentPath(path); })}>Procurar</button></div></label>
                        </>
                      ) : null}
                      {environmentForm === "addVenv" ? (
                        <>
                          <label>Nome opcional<input name="name" /></label>
                          <label>Pasta<div className="path-row"><input readOnly value={environmentPath} placeholder="Nenhum venv selecionado" /><button className="button secondary compact" type="button" onClick={() => invoke(async () => { const path = await pickHostPath("directory"); if (path) setEnvironmentPath(path); })}>Procurar</button></div></label>
                        </>
                      ) : null}
                      {environmentForm === "createVenv" ? (
                        <>
                          <label>Nome<input name="name" defaultValue=".venv" /></label>
                          <label>Python de origem<select name="pythonExecutable" defaultValue={environments.find((environment) => environment.executable)?.executable ?? ""}><option value="">Selecione</option>{environments.filter((environment) => environment.executable).map((environment) => <option key={environment.id} value={environment.executable}>{environment.name}</option>)}</select></label>
                          <label>Diretório opcional<input name="path" /></label>
                        </>
                      ) : null}
                      {environmentForm === "edit" && editingEnvironment ? (
                        <>
                          <label>Nome<input name="name" defaultValue={editingEnvironment.name} /></label>
                          <label>{editingEnvironment.type === "venv" ? "Pasta" : "Executável"}<div className="path-row"><input readOnly value={environmentPath} /><button className="button secondary compact" type="button" onClick={() => invoke(async () => { const path = await pickHostPath(editingEnvironment.type === "venv" ? "directory" : "file", editingEnvironment.type === "process"); if (path) setEnvironmentPath(path); })}>Procurar</button></div></label>
                        </>
                      ) : null}
                      {environmentForm === "packages" ? <label>Pacotes<input name="packages" placeholder="django requests" /></label> : null}
                      <div className="dialog-actions"><button className="button secondary compact" type="button" onClick={() => setEnvironmentForm(undefined)}>Cancelar</button><button className="button primary compact" disabled={environmentBusy} type="submit">Confirmar</button></div>
                    </form>
                  ) : null}

                  <div className="environment-list">
                    {environments.map((environment) => (
                      <article className={`environment-card${selectedEnvironmentId === environment.id ? " is-active" : ""}`} key={environment.id}>
                        <button className="card-delete" type="button" aria-label={`Remover ${environment.name}`} title={`Remover ${environment.name}`} onClick={() => invoke(() => removeEnvironment(environment.id))}><X size={14} /></button>
                        <div><strong>{environment.name}</strong><span>{environment.type === "venv" ? "Ambiente virtual" : "Executável Python"}{environment.version ? ` · ${environment.version}` : ""}</span><small>{environment.executable}</small></div>
                        <div className="environment-card__actions">
                          <button className="button secondary compact" disabled={selectedEnvironmentId === environment.id} type="button" onClick={() => setSelectedEnvironmentId(environment.id)}>{selectedEnvironmentId === environment.id ? "Selecionado" : "Selecionar"}</button>
                          {environmentProvider()?.update ? <button className="button secondary compact" type="button" onClick={() => { setEditingEnvironmentId(environment.id); setEnvironmentPath(environment.type === "venv" ? environment.path ?? "" : environment.executable ?? ""); setEnvironmentForm("edit"); }}>Editar</button> : null}
                          {environment.type === "venv" ? <button className="button secondary compact" type="button" onClick={() => { setSelectedEnvironmentId(environment.id); setEnvironmentForm("packages"); }}>Pacotes</button> : null}
                        </div>
                      </article>
                    ))}
                    {!environments.length ? <div className="empty-sidebar"><HardDrive size={26} /><p>Nenhum ambiente cadastrado.</p></div> : null}
                  </div>
                </div>
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
                      <Tabs.Trigger className="tab-trigger" key={document.id} value={document.id}>
                        <File size={14} />
                        <span>{document.name}</span>
                        {document.content !== document.savedContent ? <span className="dirty-dot">●</span> : null}
                        <span
                          role="button"
                          tabIndex={0}
                          className="tab-close"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDocuments((current) => current.filter((item) => item.id !== document.id));
                            if (activeDocumentId === document.id) setActiveDocumentId(documents.find((item) => item.id !== document.id)?.id);
                          }}
                        ><X size={13} /></span>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Tabs.Root>
                <div className="editor-toolbar">
                  <div className="breadcrumb">{activeDocument?.path ?? activeDocument?.name}</div>
                  <div className="editor-actions">
                    <select
                      aria-label="Perfil de execução"
                      value={profilesState.selectedId ?? ""}
                      onChange={(event) => updateProfiles(profilesState.profiles, event.target.value || undefined)}
                    >
                      <option value="">Selecionar perfil</option>
                      {profilesState.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </select>
                    <button className="icon-button small" type="button" aria-label="Gerenciar perfis" onClick={() => setProfilesOpen(true)}><Settings2 size={14} /></button>
                    {activeLanguageProvider?.lintRules?.length ? (
                      <button className="icon-button small" type="button" aria-label="Configurar lint" title="Configurar lint" onClick={() => setLintSettingsOpen(true)}><Code2 size={14} /></button>
                    ) : null}
                    {busy
                      ? <button className="button danger compact" type="button" onClick={() => invoke(stopExecution)}><Square size={13} /> Parar</button>
                      : <button className="button primary compact" type="button" disabled={!selectedProfile} onClick={() => invoke(runSelectedProfile)}><Play size={13} /> Executar</button>}
                    <button className="icon-button small" type="button" aria-label="Salvar arquivo" title="Salvar arquivo" disabled={!activeDocument} onClick={() => invoke(saveDocument)}><Save size={14} /></button>
                  </div>
                </div>
                <div className="editor-stack">
                  {diagnostics.length ? (
                    <div className="diagnostics-strip">
                      {diagnostics.map((diagnostic, index) => (
                        <button type="button" key={`${diagnostic.line}:${diagnostic.column}:${index}`}>
                          <strong>{diagnostic.severity}</strong> {diagnostic.line}:{diagnostic.column} {diagnostic.message}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {activeLanguageProvider && activeDocument ? (
                    <div className="highlight-editor">
                      <pre className="syntax-layer"><HighlightedSource source={activeDocument.content} provider={activeLanguageProvider} /></pre>
                      <DiagnosticLayer diagnostics={diagnostics} />
                      <textarea
                        ref={editorRef}
                        className="code-editor code-editor--highlighted"
                        spellCheck={false}
                        value={activeDocument.content}
                        onChange={(event) => updateDocument(event.target.value)}
                        onSelect={(event) => captureEditorState(event.currentTarget)}
                        onScroll={(event) => {
                          const syntax = event.currentTarget.parentElement?.querySelector<HTMLElement>(".syntax-layer") ?? null;
                          const diagnosticLayer = event.currentTarget.parentElement?.querySelector<HTMLElement>(".diagnostic-layer") ?? null;
                          if (syntax) {
                            syntax.scrollTop = event.currentTarget.scrollTop;
                            syntax.scrollLeft = event.currentTarget.scrollLeft;
                          }
                          if (diagnosticLayer) {
                            diagnosticLayer.scrollTop = event.currentTarget.scrollTop;
                            diagnosticLayer.scrollLeft = event.currentTarget.scrollLeft;
                          }
                          captureEditorState(event.currentTarget);
                        }}
                      />
                    </div>
                  ) : (
                    <textarea
                      ref={editorRef}
                      className="code-editor"
                      spellCheck={false}
                      value={activeDocument?.content ?? ""}
                      onChange={(event) => updateDocument(event.target.value)}
                      onSelect={(event) => captureEditorState(event.currentTarget)}
                      onScroll={(event) => captureEditorState(event.currentTarget)}
                    />
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

            {panelVisible ? (
              <section className="output-panel" style={{ height: panelHeight }}>
                <div className="resize-handle resize-handle--panel" role="separator" aria-label="Redimensionar painel inferior" onPointerDown={beginPanelResize} onDoubleClick={() => setPanelHeight(DEFAULT_LAYOUT.panelHeight)} />
                <div className="panel-heading">
                  <div className="panel-tabs"><button className={`panel-tab${panelTab === "output" ? " active" : ""}`} type="button" onClick={() => setPanelTab("output")}>SAÍDA</button><button className={`panel-tab${panelTab === "problems" ? " active" : ""}`} type="button" onClick={() => setPanelTab("problems")}>PROBLEMAS <span>{diagnostics.length}</span></button></div>
                  <button className="icon-button small" type="button" aria-label="Fechar painel" onClick={() => setPanelVisible(false)}><X size={14} /></button>
                </div>
                {panelTab === "output" ? <pre>{output.join("\n")}</pre> : <div className="problems-list">{diagnostics.length ? diagnostics.map((diagnostic, index) => <button type="button" key={`${diagnostic.line}:${index}`}><strong>{diagnostic.severity}</strong><span>{diagnostic.line}:{diagnostic.column}</span><span>{diagnostic.message}</span></button>) : <p>Nenhum problema detectado.</p>}</div>}
              </section>
            ) : null}
          </main>
        </div>

        <footer className="statusbar">
          <button type="button" onClick={() => invoke(openSingleFile)}><File size={13} /> Abrir arquivo</button>
          <span>{platformSnapshot.plugins.length} plugin(s)</span>
          <span className="status-spacer" />
          <span>{activeDocument?.content !== activeDocument?.savedContent ? "Modificado" : "Salvo"}</span>
          <span>UTF-8</span>
          <span>{activeDocument?.name.endsWith(".py") ? "Python" : "Texto"}</span>
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
                          localStorage.setItem(
                            lintSettingsStorageKey(workspaceName, activeLanguageProvider.id),
                            JSON.stringify({ enabledRuleIds: next }),
                          );
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
                <div><span className="eyebrow">SISTEMA DE ARQUIVOS</span><Dialog.Title>{environmentBrowserMode === "file" ? "Selecionar executável Python" : "Selecionar ambiente virtual"}</Dialog.Title><Dialog.Description>Navegue pelo host, selecione um item válido e confirme.</Dialog.Description></div>
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
                        <span><strong>{entry.name}</strong><small>{selectable ? (environmentBrowserMode === "file" ? environmentBrowserExecutableOnly ? "Executável Python" : "Arquivo selecionável" : "Venv válido") : entry.kind === "directory" ? "Diretório" : "Arquivo"}</small></span>
                      </button>
                    );
                  })}
              </div>
              <div className="file-browser-footer"><button className="button secondary" type="button" onClick={cancelEnvironmentBrowser}>Cancelar</button><button className="button primary" disabled={!environmentBrowserSelection} type="button" onClick={() => invoke(confirmEnvironmentBrowser)}>Confirmar seleção</button></div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

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
      </div>
    </Tooltip.Provider>
  );
}
