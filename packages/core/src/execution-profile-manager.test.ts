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
});
