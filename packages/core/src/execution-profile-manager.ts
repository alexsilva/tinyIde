import type {
  ExecutionProfile,
  ExecutionProfileVariableContext,
  ResolvedExecutionProfileStep,
} from "@tinyide/plugin-api";

const VARIABLE_PATTERN = /\$\{([A-Za-z][A-Za-z0-9]*)\}/g;

function cloneProfile(profile: ExecutionProfile): ExecutionProfile {
  return {
    ...profile,
    environment: { ...profile.environment },
    steps: profile.steps.map((step) => ({
      ...step,
      parameters: [...step.parameters],
      ...(step.environmentVariables
        ? { environmentVariables: { ...step.environmentVariables } }
        : {}),
    })),
  };
}

export function expandExecutionVariables(
  value: string,
  context: ExecutionProfileVariableContext,
): string {
  return value.replace(VARIABLE_PATTERN, (_match, variableName: string) => {
    const replacement = context[variableName as keyof ExecutionProfileVariableContext];
    if (typeof replacement !== "string" || !replacement) {
      throw new Error(`Variável de execução não disponível: \${${variableName}}`);
    }
    return replacement;
  });
}

export function resolveExecutionProfile(
  profile: ExecutionProfile,
  context: ExecutionProfileVariableContext,
): readonly ResolvedExecutionProfileStep[] {
  if (!profile.name.trim()) throw new Error("O perfil precisa de um nome.");
  if (!profile.steps.length) throw new Error("O perfil precisa de ao menos uma etapa.");

  return profile.steps.map((step, index) => {
    if (!step.id.trim()) throw new Error(`A etapa ${index + 1} precisa de um identificador.`);
    if (!step.name.trim()) throw new Error(`A etapa ${index + 1} precisa de um nome.`);
    if (!step.executable.trim()) throw new Error(`A etapa '${step.name}' precisa de um executável.`);

    const environmentVariables = step.environmentVariables
      ? Object.fromEntries(
          Object.entries(step.environmentVariables).map(([name, value]) => [
            name,
            expandExecutionVariables(value, context),
          ]),
        )
      : undefined;

    return {
      id: step.id,
      name: step.name,
      executable: expandExecutionVariables(step.executable.trim(), context),
      arguments: [
        ...(step.command.trim()
          ? [expandExecutionVariables(step.command.trim(), context)]
          : []),
        ...step.parameters.map((parameter) => expandExecutionVariables(parameter, context)),
      ],
      ...(step.workingDirectory
        ? { workingDirectory: expandExecutionVariables(step.workingDirectory.trim(), context) }
        : {}),
      ...(environmentVariables ? { environmentVariables } : {}),
      continueOnError: step.continueOnError === true,
    };
  });
}

export class ExecutionProfileManager {
  readonly #profiles = new Map<string, ExecutionProfile>();
  #selectedProfileId: string | undefined;

  constructor(profiles: readonly ExecutionProfile[] = [], selectedProfileId?: string) {
    for (const profile of profiles) this.upsert(profile);
    if (selectedProfileId && this.#profiles.has(selectedProfileId)) {
      this.#selectedProfileId = selectedProfileId;
    }
  }

  list(): readonly ExecutionProfile[] {
    return [...this.#profiles.values()].map(cloneProfile);
  }

  get(id: string): ExecutionProfile | undefined {
    const profile = this.#profiles.get(id);
    return profile ? cloneProfile(profile) : undefined;
  }

  upsert(profile: ExecutionProfile): ExecutionProfile {
    if (!profile.id.trim()) throw new Error("O perfil precisa de um identificador.");
    const normalized = cloneProfile(profile);
    resolveExecutionProfile(normalized, {
      workspaceRoot: "/workspace",
      activeFile: "/workspace/file",
      activeFileDirectory: "/workspace",
      activeFileName: "file",
      environmentExecutable: "/environment/executable",
      environmentPath: "/environment",
    });
    this.#profiles.set(normalized.id, normalized);
    return cloneProfile(normalized);
  }

  remove(id: string): boolean {
    const removed = this.#profiles.delete(id);
    if (this.#selectedProfileId === id) this.#selectedProfileId = undefined;
    return removed;
  }

  select(id: string | undefined): void {
    if (id && !this.#profiles.has(id)) throw new Error(`Perfil não encontrado: ${id}`);
    this.#selectedProfileId = id;
  }

  selected(): ExecutionProfile | undefined {
    return this.#selectedProfileId ? this.get(this.#selectedProfileId) : undefined;
  }

  selectedId(): string | undefined {
    return this.#selectedProfileId;
  }
}
