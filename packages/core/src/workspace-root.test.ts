import { describe, expect, it } from "vitest";
import { inferWorkspaceRoot } from "./workspace-root";

describe("inferWorkspaceRoot", () => {
  it("infers a Unix workspace root from an environment path", () => {
    expect(inferWorkspaceRoot({
      workspaceName: "precocerto",
      pathHints: ["/mnt/Program/PycharmProjects/precocerto/.venv/bin/python"],
    })).toBe("/mnt/Program/PycharmProjects/precocerto");
  });

  it("infers a Windows workspace root from a command path", () => {
    expect(inferWorkspaceRoot({
      workspaceName: "project",
      pathHints: ["C:\\dev\\project\\scripts\\run.py"],
    })).toBe("C:/dev/project");
  });

  it("uses the nearest matching workspace segment", () => {
    expect(inferWorkspaceRoot({
      workspaceName: "project",
      pathHints: ["/srv/project/archive/project/.venv/bin/python"],
    })).toBe("/srv/project/archive/project");
  });

  it("does not silently accept an unrelated host root", () => {
    expect(inferWorkspaceRoot({
      workspaceName: "precocerto",
      pathHints: ["/mnt/Program/PycharmProjects/tinyIde"],
    })).toBeUndefined();
  });

  it("uses the first usable hint without a workspace name", () => {
    expect(inferWorkspaceRoot({ workspaceName: " ", pathHints: [undefined, " C:\\dev\\project\\ "] })).toBe("C:/dev/project");
    expect(inferWorkspaceRoot({ pathHints: [undefined, "  "] })).toBeUndefined();
  });

  it("handles root and ignores templates or empty normalized paths", () => {
    expect(inferWorkspaceRoot({ workspaceName: "", pathHints: ["/"] })).toBe("/");
    expect(inferWorkspaceRoot({ workspaceName: "project", pathHints: ["${workspaceRoot}/project", "   "] })).toBeUndefined();
    expect(inferWorkspaceRoot({ workspaceName: "project", pathHints: ["/project"] })).toBe("/project");
    expect(inferWorkspaceRoot({ workspaceName: "project", pathHints: [undefined, "", "/other"] })).toBeUndefined();
  });
});
