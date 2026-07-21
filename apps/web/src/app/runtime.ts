import { resolveExecutionProfile } from "@tinyide/core";
import type {
  ExecutionEnvironment,
  ExecutionEnvironmentProvider,
  ExecutionProfile,
  ExecutionProfileContributionProvider,
  ExecutionProfileExecutableOption,
  ExecutionProfileVariableContribution,
  LanguageProvider,
  LanguageLintSettings,
  ProcessExecutionRequest,
  ScriptExecutionContribution,
  TextDiagnostic,
} from "@tinyide/plugin-api";
import type { OpenDocument } from "../browser-filesystem";
import { platform } from "./platform";

export interface HostProcessSnapshot {
  readonly id: string;
  readonly status: "running" | "exited";
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly durationMs: number;
}

export interface ProfileContributions {
  readonly executableOptions: readonly ExecutionProfileExecutableOption[];
  readonly variables: readonly ExecutionProfileVariableContribution[];
}

export interface RunProfileCallbacks {
  readonly onProcessStarted: (processId: string) => void;
  readonly onProcessFinished: () => void;
  readonly onOutput: (lines: readonly string[]) => void;
}

export function languageProviderFor(document: OpenDocument | undefined): LanguageProvider | undefined {
  if (!document) return undefined;
  const lowerName = document.name.toLocaleLowerCase();
  return platform.capabilities
    .getAll<LanguageProvider>("language.provider")
    .find((provider) => provider.extensions.some((extension) => lowerName.endsWith(extension)));
}

export function scriptExecutionFor(document: OpenDocument | undefined): ScriptExecutionContribution | undefined {
  if (!document) return undefined;
  const lowerName = document.name.toLocaleLowerCase();
  return platform.capabilities
    .getAll<ScriptExecutionContribution>("execution.script")
    .find((provider) => provider.extensions.some((extension) => lowerName.endsWith(extension)));
}

export function environmentProvider(): ExecutionEnvironmentProvider | undefined {
  return platform.capabilities.getAll<ExecutionEnvironmentProvider>("execution.environment")[0];
}

export function environmentProviderFor(document: OpenDocument | undefined): ExecutionEnvironmentProvider | undefined {
  if (!document) return undefined;
  const lowerName = document.name.toLocaleLowerCase();
  return platform.capabilities
    .getAll<ExecutionEnvironmentProvider>("execution.environment")
    .find((provider) => provider.extensions.some((extension) => lowerName.endsWith(extension)));
}

export async function loadEnvironments(): Promise<readonly ExecutionEnvironment[]> {
  const provider = environmentProvider();
  return provider ? provider.list() : [];
}

export async function loadProfileContributions(input: {
  readonly workspaceName?: string;
  readonly workspaceRoot?: string;
  readonly activeDocument?: OpenDocument;
}): Promise<ProfileContributions> {
  const providers = platform.capabilities.getAll<ExecutionProfileContributionProvider>(
    "execution.profile.contribution",
  );
  const context = {
    ...(input.workspaceName && input.workspaceName !== "Sem workspace"
      ? { workspaceName: input.workspaceName }
      : {}),
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(input.activeDocument?.name ? { activeFileName: input.activeDocument.name } : {}),
    ...(input.activeDocument?.path ? { activeFilePath: input.activeDocument.path } : {}),
  };
  const executableOptions = await Promise.all(
    providers.map((provider) => provider.executableOptions?.(context) ?? []),
  );
  const variables = await Promise.all(
    providers.map((provider) => provider.variables?.(context) ?? []),
  );
  return {
    executableOptions: executableOptions.flat(),
    variables: variables.flat(),
  };
}

export async function lintDocument(
  document: OpenDocument,
  settings?: LanguageLintSettings,
): Promise<readonly TextDiagnostic[]> {
  const provider = languageProviderFor(document);
  if (!provider) throw new Error("Nenhum provider de linguagem disponível para este arquivo.");
  return provider.lint(document.content, document.name, settings);
}

export async function readHostContext(): Promise<{ readonly workspaceRoot: string }> {
  const response = await fetch("/core-api/context", { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível obter o contexto de execução do host.");
  return response.json() as Promise<{ readonly workspaceRoot: string }>;
}

export async function setHostWorkspace(
  workspaceName: string,
  workspaceRootHint?: string,
): Promise<{ readonly workspaceRoot: string }> {
  const response = await fetch("/core-api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: workspaceName,
      ...(workspaceRootHint ? { path: workspaceRootHint } : {}),
    }),
  });
  const payload = await response.json() as { readonly workspaceRoot?: string; readonly error?: string };
  if (!response.ok || !payload.workspaceRoot) {
    throw new Error(payload.error ?? "Não foi possível definir a raiz do workspace no host.");
  }
  return { workspaceRoot: payload.workspaceRoot };
}

export async function startHostProcess(request: ProcessExecutionRequest): Promise<HostProcessSnapshot> {
  const response = await fetch("/core-api/execution/processes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json() as HostProcessSnapshot | { readonly error?: string };
  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "Falha ao iniciar processo.");
  }
  return payload as HostProcessSnapshot;
}

export async function readHostProcess(id: string): Promise<HostProcessSnapshot> {
  const response = await fetch(`/core-api/execution/processes/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const payload = await response.json() as HostProcessSnapshot | { readonly error?: string };
  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "Falha ao consultar processo.");
  }
  return payload as HostProcessSnapshot;
}

export async function stopHostProcess(id: string): Promise<void> {
  const response = await fetch(`/core-api/execution/processes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error("Falha ao interromper processo.");
  }
}

function activeFileDirectory(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const normalized = path.replaceAll("\\", "/");
  const separator = normalized.lastIndexOf("/");
  return separator >= 0 ? normalized.slice(0, separator) || "/" : undefined;
}

export async function runExecutionProfile(input: {
  readonly profile: ExecutionProfile;
  readonly activeDocument?: OpenDocument;
  readonly workspaceName: string;
  readonly environments: readonly ExecutionEnvironment[];
  readonly callbacks: RunProfileCallbacks;
}): Promise<void> {
  const { profile, activeDocument, environments, callbacks } = input;
  const environmentId = profile.environment.mode === "fixed"
    ? profile.environment.environmentId
    : undefined;
  const environment = environmentId
    ? environments.find((candidate) => candidate.id === environmentId)
    : undefined;
  if (profile.environment.mode === "fixed" && !environment?.executable) {
    throw new Error("O perfil exige um ambiente com executável disponível.");
  }

  const { workspaceRoot } = await readHostContext();

  const activePath = activeDocument?.path
    ? `${workspaceRoot}/${activeDocument.path.replace(/^\/+/, "")}`
    : activeDocument?.name;
  const activeDirectory = activeFileDirectory(activePath);
  const resolvedSteps = resolveExecutionProfile(profile, {
    workspaceRoot,
    ...(activePath ? { activeFile: activePath } : {}),
    ...(activeDirectory ? { activeFileDirectory: activeDirectory } : {}),
    ...(activeDocument?.name ? { activeFileName: activeDocument.name } : {}),
    ...(environment?.executable ? { environmentExecutable: environment.executable } : {}),
    ...(environment?.path ? { environmentPath: environment.path } : {}),
  });

  const completedOutput: string[] = [`[perfil] ${profile.name}`];
  callbacks.onOutput(completedOutput);
  for (const step of resolvedSteps) {
    const workingDirectory = step.workingDirectory ?? workspaceRoot;
    const heading = [
      `\n[etapa] ${step.name}`,
      `[diretório] ${workingDirectory}`,
      `$ ${step.executable} ${step.arguments.join(" ")}`,
    ];
    callbacks.onOutput([...completedOutput, ...heading]);
    let process = await startHostProcess({
      executable: step.executable,
      arguments: step.arguments,
      workingDirectory,
      ...(step.environmentVariables ? { environmentVariables: step.environmentVariables } : {}),
    });
    callbacks.onProcessStarted(process.id);
    while (process.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      process = await readHostProcess(process.id);
      callbacks.onOutput([
        ...completedOutput,
        ...heading,
        process.stdout,
        process.stderr,
        process.status === "running" ? "[executando...]" : `[exit] ${process.exitCode ?? -1}`,
      ].filter(Boolean));
    }
    callbacks.onProcessFinished();
    completedOutput.push(...heading, process.stdout, process.stderr, `[exit] ${process.exitCode ?? -1}`);
    if (process.exitCode !== 0 && !step.continueOnError) {
      throw new Error(`A etapa '${step.name}' terminou com código ${process.exitCode}.`);
    }
  }
  callbacks.onOutput(completedOutput.filter(Boolean));
}

export async function runScript(input: {
  readonly contribution: ScriptExecutionContribution;
  readonly document: OpenDocument;
  readonly environment?: ExecutionEnvironment;
  readonly callbacks: RunProfileCallbacks;
}): Promise<void> {
  const { contribution, document, environment, callbacks } = input;
  if (!document.path) throw new Error("Salve o arquivo no workspace antes de executar o script.");
  const host = await readHostContext();
  const scriptPath = `${host.workspaceRoot}/${document.path.replace(/^\/+/, "")}`;
  const executable = environment?.executable ?? contribution.executable;
  if (!executable) throw new Error("O plugin não forneceu um executável para este script.");
  const heading = [
    `[script] ${document.name}`,
    `$ ${executable} ${[...(contribution.arguments ?? []), scriptPath].join(" ")}`,
  ];
  callbacks.onOutput(heading);
  let process = await startHostProcess({
    executable,
    arguments: [...(contribution.arguments ?? []), scriptPath],
    workingDirectory: activeFileDirectory(scriptPath) ?? host.workspaceRoot,
  });
  callbacks.onProcessStarted(process.id);
  while (process.status === "running") {
    await new Promise((resolve) => setTimeout(resolve, 250));
    process = await readHostProcess(process.id);
    callbacks.onOutput([
      ...heading,
      process.stdout,
      process.stderr,
      process.status === "running" ? "[executando...]" : `[exit] ${process.exitCode ?? -1}`,
    ].filter(Boolean));
  }
  callbacks.onProcessFinished();
  if (process.exitCode !== 0) throw new Error(`O script terminou com código ${process.exitCode}.`);
}
