import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Code2,
  File,
  FilePlus2,
  Files,
  Folder,
  FolderOpen,
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
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ExecutionProfile } from "@tinyide/plugin-api";
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

const PROFILE_KEY = "tinyide.react.executionProfiles.v1";

type SidebarView = "explorer" | "plugins" | "search";

interface StoredProfiles {
  readonly profiles: readonly ExecutionProfile[];
  readonly selectedId?: string;
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

function readProfiles(): StoredProfiles {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { profiles: [] };
    const parsed = JSON.parse(raw) as StoredProfiles;
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      ...(typeof parsed.selectedId === "string" ? { selectedId: parsed.selectedId } : {}),
    };
  } catch {
    return { profiles: [] };
  }
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
  onToggle,
  onOpen,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (entry: WorkspaceEntry) => void;
  readonly onOpen: (entry: WorkspaceEntry) => void;
}) {
  return (
    <div className="tree">
      {entries.map((entry) => (
        <div key={entry.path}>
          <button
            type="button"
            className="tree-entry"
            onClick={() => (entry.kind === "directory" ? onToggle(entry) : onOpen(entry))}
          >
            {entry.kind === "directory" ? (
              expanded.has(entry.path) ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : (
              <span className="tree-spacer" />
            )}
            {entry.kind === "directory" ? (
              expanded.has(entry.path) ? <FolderOpen size={15} /> : <Folder size={15} />
            ) : (
              <File size={15} />
            )}
            <span>{entry.name}</span>
          </button>
          {entry.kind === "directory" && expanded.has(entry.path) && entry.children ? (
            <div className="tree-children">
              <EntryTree entries={entry.children} expanded={expanded} onToggle={onToggle} onOpen={onOpen} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ProfileDialog({
  open,
  onOpenChange,
  profiles,
  selectedId,
  onChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly profiles: readonly ExecutionProfile[];
  readonly selectedId: string | undefined;
  readonly onChange: (profiles: readonly ExecutionProfile[], selectedId?: string) => void;
}) {
  const [drafts, setDrafts] = useState<readonly ExecutionProfile[]>(profiles);
  const [editingId, setEditingId] = useState<string | undefined>(selectedId ?? profiles[0]?.id);

  useEffect(() => {
    if (!open) return;
    setDrafts(profiles);
    setEditingId(selectedId ?? profiles[0]?.id);
  }, [open, profiles, selectedId]);

  const editing = drafts.find((profile) => profile.id === editingId);
  const step = editing?.steps[0];

  const updateEditing = (update: (profile: ExecutionProfile) => ExecutionProfile) => {
    if (!editingId) return;
    setDrafts((current) => current.map((profile) => (profile.id === editingId ? update(profile) : profile)));
  };

  const addProfile = () => {
    const profile = makeProfile();
    setDrafts((current) => [...current, profile]);
    setEditingId(profile.id);
  };

  const removeProfile = (id: string) => {
    setDrafts((current) => current.filter((profile) => profile.id !== id));
    if (editingId === id) setEditingId(undefined);
  };

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
                  <button
                    key={profile.id}
                    type="button"
                    className={`profile-card${editingId === profile.id ? " is-active" : ""}`}
                    onClick={() => setEditingId(profile.id)}
                  >
                    <Terminal size={16} />
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.steps.length} etapa(s)</small>
                    </span>
                    <span
                      className="profile-remove"
                      role="button"
                      tabIndex={0}
                      aria-label={`Remover ${profile.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeProfile(profile.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </span>
                  </button>
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
                      <select disabled>
                        <option>Nenhum ambiente</option>
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
                        value={step.executable}
                        onChange={(event) => updateEditing((profile) => ({
                          ...profile,
                          steps: profile.steps.map((item, index) => index === 0 ? { ...item, executable: event.target.value } : item),
                        }))}
                      />
                    </label>
                    <label>
                      Comando ou arquivo
                      <input
                        value={step.command}
                        placeholder="manage.py"
                        onChange={(event) => updateEditing((profile) => ({
                          ...profile,
                          steps: profile.steps.map((item, index) => index === 0 ? { ...item, command: event.target.value } : item),
                        }))}
                      />
                    </label>
                    <label>
                      Parâmetros
                      <textarea
                        rows={5}
                        value={step.parameters.join(" ")}
                        placeholder="runserver localhost:8000"
                        onChange={(event) => updateEditing((profile) => ({
                          ...profile,
                          steps: profile.steps.map((item, index) => index === 0 ? {
                            ...item,
                            parameters: event.target.value.trim() ? event.target.value.trim().split(/\s+/) : [],
                          } : item),
                        }))}
                      />
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
                        onClick={() => {
                          onChange(drafts, editing.id);
                          onOpenChange(false);
                        }}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function App() {
  const [platformSnapshot, setPlatformSnapshot] = useState(() => platform.snapshot());
  const [sidebarView, setSidebarView] = useState<SidebarView>("explorer");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [panelVisible, setPanelVisible] = useState(true);
  const [workspaceHandle, setWorkspaceHandle] = useState<BrowserDirectoryHandle>();
  const [workspaceName, setWorkspaceName] = useState("Sem workspace");
  const [entries, setEntries] = useState<readonly WorkspaceEntry[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [documents, setDocuments] = useState<readonly OpenDocument[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string>();
  const [output, setOutput] = useState<string[]>(["tinyIde React shell inicializado."]);
  const [busy, setBusy] = useState(false);
  const [profilesState, setProfilesState] = useState<StoredProfiles>(() => readProfiles());
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [error, setError] = useState<string>();

  const activeDocument = documents.find((document) => document.id === activeDocumentId);
  const selectedProfile = profilesState.profiles.find((profile) => profile.id === profilesState.selectedId);

  useEffect(() => {
    return platform.subscribe(() => setPlatformSnapshot(platform.snapshot()));
  }, []);

  useEffect(() => {
    platform.initialize().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const updateProfiles = (profiles: readonly ExecutionProfile[], selectedId?: string) => {
    const next = { profiles, ...(selectedId ? { selectedId } : {}) };
    setProfilesState(next);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  };

  const openFolder = async () => {
    if (!window.showDirectoryPicker) throw new Error("Este navegador não oferece seleção de pastas.");
    const handle = await window.showDirectoryPicker();
    setWorkspaceHandle(handle);
    setWorkspaceName(handle.name);
    setEntries(await listDirectory(handle));
    setExpanded(new Set());
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
  };

  const saveDocument = async () => {
    if (!activeDocument) return;
    let handle = activeDocument.handle;
    if (!handle) {
      if (!window.showSaveFilePicker) throw new Error("Este navegador não oferece salvar arquivo.");
      handle = await window.showSaveFilePicker({ suggestedName: activeDocument.name });
    }
    const saved = await writeFileDocument(activeDocument, handle);
    setDocuments((current) => current.map((document) => document.id === activeDocument.id ? saved : document));
  };

  const runSelectedProfile = async () => {
    if (!selectedProfile) throw new Error("Selecione um perfil de execução.");
    const step = selectedProfile.steps[0];
    if (!step) throw new Error("O perfil não possui etapas.");
    if (selectedProfile.saveBeforeRun && activeDocument && activeDocument.content !== activeDocument.savedContent) {
      await saveDocument();
    }

    setBusy(true);
    setPanelVisible(true);
    setOutput([`[perfil] ${selectedProfile.name}`, `$ ${step.executable} ${[step.command, ...step.parameters].filter(Boolean).join(" ")}`]);
    try {
      const contextResponse = await fetch("/core-api/context", { cache: "no-store" });
      if (!contextResponse.ok) throw new Error("Não foi possível obter o contexto do host.");
      const context = await contextResponse.json() as { readonly workspaceRoot: string };
      const response = await fetch("/core-api/execution/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executable: step.executable,
          arguments: [step.command, ...step.parameters].filter(Boolean),
          workingDirectory: context.workspaceRoot,
          environmentVariables: step.environmentVariables ?? {},
        }),
      });
      const process = await response.json() as { readonly id?: string; readonly error?: string };
      if (!response.ok || !process.id) throw new Error(process.error ?? "Falha ao iniciar processo.");

      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const pollResponse = await fetch(`/core-api/execution/processes/${encodeURIComponent(process.id)}`, { cache: "no-store" });
        const snapshot = await pollResponse.json() as {
          readonly status: "running" | "exited";
          readonly stdout: string;
          readonly stderr: string;
          readonly exitCode?: number;
        };
        setOutput([
          `[perfil] ${selectedProfile.name}`,
          `$ ${step.executable} ${[step.command, ...step.parameters].filter(Boolean).join(" ")}`,
          snapshot.stdout,
          snapshot.stderr,
          snapshot.status === "exited" ? `[exit] ${snapshot.exitCode ?? -1}` : "[executando...]",
        ].filter(Boolean));
        if (snapshot.status === "exited") break;
      }
    } finally {
      setBusy(false);
    }
  };

  const invoke = useCallback((operation: () => void | Promise<void>) => {
    setError(undefined);
    Promise.resolve(operation()).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const installedIds = useMemo(() => new Set(platformSnapshot.plugins.map((plugin) => plugin.manifest.id)), [platformSnapshot.plugins]);

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className="ide-shell">
        <header className="titlebar">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="brand-button" type="button">
                <Code2 size={17} /> <strong>tinyIde</strong> <ChevronDown size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu-content" align="start" sideOffset={6}>
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
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <div className="window-title">{workspaceName} — tinyIde</div>
          <div className="titlebar-actions">
            <button className="button ghost compact" type="button" onClick={() => setProfilesOpen(true)}>
              <Settings2 size={15} /> Perfis
            </button>
            {busy ? (
              <button className="button danger compact" type="button" disabled>
                <Square size={14} /> Executando
              </button>
            ) : (
              <button className="button primary compact" type="button" disabled={!selectedProfile} onClick={() => invoke(runSelectedProfile)}>
                <Play size={14} /> Executar
              </button>
            )}
          </div>
        </header>

        <div className="workbench">
          <aside className="activity-bar">
            <IconButton label="Explorer" active={sidebarView === "explorer" && sidebarVisible} onClick={() => { setSidebarView("explorer"); setSidebarVisible(true); }}>
              <Files size={20} />
            </IconButton>
            <IconButton label="Pesquisar" active={sidebarView === "search" && sidebarVisible} onClick={() => { setSidebarView("search"); setSidebarVisible(true); }}>
              <Search size={20} />
            </IconButton>
            <IconButton label="Plugins" active={sidebarView === "plugins" && sidebarVisible} onClick={() => { setSidebarView("plugins"); setSidebarVisible(true); }}>
              <Plug size={20} />
            </IconButton>
          </aside>

          {sidebarVisible ? (
            <aside className="sidebar">
              <div className="sidebar-heading">
                <span>{sidebarView === "explorer" ? "EXPLORER" : sidebarView === "plugins" ? "PLUGINS" : "PESQUISA"}</span>
                <button className="icon-button small" type="button" onClick={() => setSidebarVisible(false)} aria-label="Fechar sidebar"><X size={14} /></button>
              </div>

              {sidebarView === "explorer" ? (
                <div className="sidebar-content">
                  <div className="toolbar-row">
                    <button className="button secondary compact" type="button" onClick={() => invoke(openSingleFile)}><FilePlus2 size={14} /> Arquivo</button>
                    <button className="button secondary compact" type="button" onClick={() => invoke(openFolder)}><FolderOpen size={14} /> Pasta</button>
                  </div>
                  <div className="workspace-name"><ChevronDown size={14} /> {workspaceName}</div>
                  {entries.length ? (
                    <EntryTree entries={entries} expanded={expanded} onToggle={(entry) => invoke(() => toggleEntry(entry))} onOpen={(entry) => invoke(() => openEntry(entry))} />
                  ) : (
                    <div className="empty-sidebar"><Folder size={26} /><p>Abra uma pasta para navegar pelos arquivos.</p></div>
                  )}
                </div>
              ) : null}

              {sidebarView === "search" ? (
                <div className="sidebar-content">
                  <label className="search-field"><Search size={15} /><input placeholder="Pesquisar no workspace" /></label>
                  <div className="empty-sidebar"><Search size={26} /><p>A pesquisa textual será conectada ao workspace nesta branch.</p></div>
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
                        <div className="plugin-card-heading"><Package size={16} /><strong>{plugin.manifest.name}</strong></div>
                        <p>{plugin.manifest.description}</p>
                        <small>{plugin.manifest.id} · {plugin.manifest.version}</small>
                        <div className="plugin-actions">
                          <button className="button secondary compact" type="button" onClick={() => invoke(() => platform.setEnabled(plugin.manifest.id, !enabled))}>{enabled ? "Desativar" : "Ativar"}</button>
                          <button className="icon-button small danger" type="button" aria-label="Remover plugin" onClick={() => invoke(() => platform.uninstall(plugin.manifest.id))}><Trash2 size={14} /></button>
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
            </aside>
          ) : null}

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
                    <button className="icon-button small" type="button" aria-label="Salvar" onClick={() => invoke(saveDocument)}><Save size={15} /></button>
                    <button className="icon-button small" type="button" aria-label="Mais ações"><MoreHorizontal size={15} /></button>
                  </div>
                </div>
                <textarea
                  className="code-editor"
                  spellCheck={false}
                  value={activeDocument?.content ?? ""}
                  onChange={(event) => updateDocument(event.target.value)}
                />
              </>
            ) : (
              <div className="welcome-screen">
                <div className="welcome-mark"><Code2 size={44} /></div>
                <h1>tinyIde</h1>
                <p>Uma IDE web, agnóstica de linguagem e orientada a plugins.</p>
                <div className="welcome-actions">
                  <button className="button primary" type="button" onClick={() => invoke(openFolder)}><FolderOpen size={16} /> Abrir pasta</button>
                  <button className="button secondary" type="button" onClick={() => invoke(openSingleFile)}><File size={16} /> Abrir arquivo</button>
                </div>
                <div className="architecture-note">
                  <strong>Nova fundação</strong>
                  <span>React + Radix UI + CSS próprio</span>
                </div>
              </div>
            )}

            {panelVisible ? (
              <section className="output-panel">
                <div className="panel-heading">
                  <div><Terminal size={15} /><strong>SAÍDA</strong></div>
                  <button className="icon-button small" type="button" aria-label="Fechar painel" onClick={() => setPanelVisible(false)}><X size={14} /></button>
                </div>
                <pre>{output.join("\n")}</pre>
              </section>
            ) : null}
          </main>
        </div>

        <footer className="statusbar">
          <button type="button" onClick={() => setPanelVisible((visible) => !visible)}><Terminal size={13} /> Saída</button>
          <span>{workspaceName}</span>
          <span className="status-spacer" />
          <span>{platformSnapshot.initialized ? "Plugins prontos" : "Inicializando plugins"}</span>
          <span>React</span>
        </footer>

        <ProfileDialog
          open={profilesOpen}
          onOpenChange={setProfilesOpen}
          profiles={profilesState.profiles}
          selectedId={profilesState.selectedId}
          onChange={updateProfiles}
        />

        {error ? (
          <div className="error-toast" role="alert">
            <span>{error}</span>
            <button className="icon-button small" type="button" aria-label="Fechar erro" onClick={() => setError(undefined)}><X size={14} /></button>
          </div>
        ) : null}
      </div>
    </Tooltip.Provider>
  );
}
