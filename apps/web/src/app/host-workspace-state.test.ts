import { afterEach, describe, expect, it } from "vitest";
import {
  getActiveHostWorkspaceRoot,
  setActiveHostWorkspaceRoot,
} from "./host-workspace-state";

afterEach(() => setActiveHostWorkspaceRoot(undefined));

describe("host workspace state", () => {
  it("não define workspace implicitamente", () => {
    expect(getActiveHostWorkspaceRoot()).toBeUndefined();
  });

  it("acompanha seleção e remoção explícitas", () => {
    setActiveHostWorkspaceRoot("/workspace/a");
    expect(getActiveHostWorkspaceRoot()).toBe("/workspace/a");
    setActiveHostWorkspaceRoot(undefined);
    expect(getActiveHostWorkspaceRoot()).toBeUndefined();
  });
});
