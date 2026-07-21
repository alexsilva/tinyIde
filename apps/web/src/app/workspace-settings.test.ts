import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_WORKSPACE_SETTINGS, readWorkspaceSettings, writeWorkspaceSettings } from "./workspace-settings";

afterEach(() => vi.unstubAllGlobals());

describe("workspace settings", () => {
  it("reads settings with workspace headers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(EMPTY_WORKSPACE_SETTINGS), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readWorkspaceSettings("/workspace")).resolves.toEqual(EMPTY_WORKSPACE_SETTINGS);
    expect(fetchMock).toHaveBeenCalledWith("/core-api/workspace/settings", {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-TinyIde-Workspace-Root": "/workspace",
      },
    });
  });

  it("writes settings", async () => {
    const settings = { version: 1 as const, environment: { selectedId: "python" } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(settings), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(writeWorkspaceSettings("/workspace", settings)).resolves.toEqual(settings);
    expect(fetchMock).toHaveBeenCalledWith("/core-api/workspace/settings", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify(settings),
    }));
  });

  it("uses server and fallback errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "read failed" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "write failed" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 })));
    await expect(readWorkspaceSettings("/workspace")).rejects.toThrow("read failed");
    await expect(readWorkspaceSettings("/workspace")).rejects.toThrow("Não foi possível ler");
    await expect(writeWorkspaceSettings("/workspace", EMPTY_WORKSPACE_SETTINGS)).rejects.toThrow("write failed");
    await expect(writeWorkspaceSettings("/workspace", EMPTY_WORKSPACE_SETTINGS)).rejects.toThrow("Não foi possível salvar");
  });
});
