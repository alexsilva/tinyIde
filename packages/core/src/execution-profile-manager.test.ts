import { describe, expect, it } from "vitest";
import type { ExecutionProfile } from "@tinyide/plugin-api";
import {
  ExecutionProfileManager,
  expandExecutionVariables,
  resolveExecutionProfile,
} from "./execution-profile-manager";

const profile: ExecutionProfile = {
  id: "tool-runner",
  name: "Executar ferramenta",
  environment: { mode: "fixed", environmentId: "python-venv" },
  steps: [
    {
      id: "run",
      name: "Executar processo",
      executable: "${environmentExecutable}",
      command: "scripts/server.py",
      parameters: ["--port", "8000"],
      workingDirectory: "${workspaceRoot}",
      environmentVariables: { ACTIVE_FILE: "${activeFile}" },
    },
  ],
};

describe("ExecutionProfileManager", () => {
  it("stores, selects and removes profiles", () => {
    const manager = new ExecutionProfileManager();
    manager.upsert(profile);
    manager.select(profile.id);
    expect(manager.selected()?.name).toBe("Executar ferramenta");
    expect(manager.remove(profile.id)).toBe(true);
    expect(manager.selected()).toBeUndefined();
  });

  it("returns defensive copies", () => {
    const manager = new ExecutionProfileManager([profile]);
    const listed = manager.list();
    const listedProfile = listed[0];
    const listedStep = listedProfile?.steps[0];
    expect(listedProfile).toBeDefined();
    expect(listedStep).toBeDefined();
    (listedStep?.parameters as string[]).push("mutated");
    expect(manager.get(profile.id)?.steps[0]?.parameters).toHaveLength(2);
    const { environmentVariables: _environmentVariables, ...stepWithoutEnvironmentVariables } = profile.steps[0]!;
    const withoutEnvironmentVariables = new ExecutionProfileManager([{
      ...profile,
      steps: [stepWithoutEnvironmentVariables],
    }]);
    expect(withoutEnvironmentVariables.list()[0]?.steps[0]?.environmentVariables).toBeUndefined();
  });

  it("handles selection and removal edge cases", () => {
    const manager = new ExecutionProfileManager([profile], "missing");
    expect(manager.selectedId()).toBeUndefined();
    expect(manager.remove("missing")).toBe(false);
    expect(() => manager.select("missing")).toThrow("Perfil não encontrado");
    manager.select(profile.id);
    expect(manager.selectedId()).toBe(profile.id);
    manager.select(undefined);
    expect(manager.selected()).toBeUndefined();
    expect(() => manager.upsert({ ...profile, id: " " })).toThrow("identificador");
    const selected = new ExecutionProfileManager([profile], profile.id);
    expect(selected.selectedId()).toBe(profile.id);
    expect(selected.get("missing")).toBeUndefined();
  });
});

describe("execution profile resolution", () => {
  it("expands generic workspace, file and environment variables", () => {
    const resolved = resolveExecutionProfile(profile, {
      workspaceRoot: "/project",
      activeFile: "/project/app/views.py",
      activeFileDirectory: "/project/app",
      activeFileName: "views.py",
      environmentExecutable: "/project/.venv/bin/python",
      environmentPath: "/project/.venv",
    });

    expect(resolved[0]).toMatchObject({
      executable: "/project/.venv/bin/python",
      arguments: ["scripts/server.py", "--port", "8000"],
      workingDirectory: "/project",
      environmentVariables: { ACTIVE_FILE: "/project/app/views.py" },
      continueOnError: false,
    });
  });

  it("rejects variables unavailable in the current context", () => {
    expect(() => expandExecutionVariables("${environmentExecutable}", {})).toThrow(
      "Variável de execução não disponível",
    );
  });

  it("trims command boundaries without changing parameter contents", () => {
    const resolved = resolveExecutionProfile({
      ...profile,
      steps: [{
        ...profile.steps[0]!,
        command: "  backend/manage.py  ",
        parameters: ["runserver", "localhost:8022", "value with spaces"],
      }],
    }, {
      workspaceRoot: "/project",
      activeFile: "/project/backend/manage.py",
      environmentExecutable: "/project/.venv/bin/python",
    });

    expect(resolved[0]?.arguments).toEqual([
      "backend/manage.py",
      "runserver",
      "localhost:8022",
      "value with spaces",
    ]);
  });

  it("validates profile and step fields and optional branches", () => {
    expect(() => resolveExecutionProfile({ ...profile, name: " " }, {})).toThrow("perfil precisa de um nome");
    expect(() => resolveExecutionProfile({ ...profile, steps: [] }, {})).toThrow("ao menos uma etapa");
    expect(() => resolveExecutionProfile({ ...profile, steps: [{ ...profile.steps[0]!, id: " " }] }, {})).toThrow("identificador");
    expect(() => resolveExecutionProfile({ ...profile, steps: [{ ...profile.steps[0]!, name: " " }] }, {})).toThrow("precisa de um nome");
    expect(() => resolveExecutionProfile({ ...profile, steps: [{ ...profile.steps[0]!, executable: " " }] }, {})).toThrow("executável");

    const {
      workingDirectory: _workingDirectory,
      environmentVariables: _optionalEnvironmentVariables,
      ...minimalStep
    } = profile.steps[0]!;
    const resolved = resolveExecutionProfile({
      ...profile,
      steps: [{
        ...minimalStep,
        executable: "python",
        command: " ",
        parameters: [],
        continueOnError: true,
      }],
    }, {});
    expect(resolved[0]).toEqual({
      id: "run",
      name: "Executar processo",
      executable: "python",
      arguments: [],
      continueOnError: true,
    });
  });
});
