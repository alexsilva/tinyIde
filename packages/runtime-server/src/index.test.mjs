import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTinyIdeRuntime } from "./index.mjs";

const resources = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ runtime, root }) => {
    await runtime?.close();
    await rm(root, { recursive: true, force: true });
  }));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tinyide-runtime-"));
  const webRoot = join(root, "web");
  const pluginsRoot = join(root, "plugins");
  const workspaceRoot = join(root, "workspace");
  await Promise.all([mkdir(webRoot), mkdir(pluginsRoot), mkdir(workspaceRoot)]);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>tinyIde</title>");
  await writeFile(join(webRoot, "app-AbCdEf12.js"), "export {};");
  const runtime = await startTinyIdeRuntime({
    hostRoot: root,
    webRoot,
    pluginsRoot,
    workspaceSearchRoot: root,
    initialWorkspaceRoot: workspaceRoot,
    host: "127.0.0.1",
    port: 0,
  });
  resources.push({ runtime, root });
  return { root, webRoot, pluginsRoot, workspaceRoot, runtime };
}

describe("runtime server hardening", () => {
  it("sets browser security headers and caches hashed assets immutably", async () => {
    const { runtime } = await fixture();
    const html = await fetch(runtime.url);
    expect(html.status).toBe(200);
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html.headers.get("x-frame-options")).toBe("DENY");
    expect(html.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(html.headers.get("cache-control")).toBe("no-cache");

    const asset = await fetch(`${runtime.url}/app-AbCdEf12.js`);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("limits JSON request bodies before parsing them", async () => {
    const { runtime } = await fixture();
    const response = await fetch(`${runtime.url}/core-api/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "workspace", padding: "x".repeat(1024 * 1024) }),
    });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("limite") });
  });

  it("rejects cross-origin API calls while accepting the runtime origin", async () => {
    const { runtime, workspaceRoot } = await fixture();
    const blocked = await fetch(`${runtime.url}/core-api/workspace`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ name: "workspace", path: workspaceRoot }),
    });
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toEqual({ error: "Origem da requisição não autorizada." });

    const accepted = await fetch(`${runtime.url}/core-api/workspace`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: runtime.url,
      },
      body: JSON.stringify({ name: "workspace", path: workspaceRoot }),
    });
    expect(accepted.status).toBe(200);
  });

  it("rejects malformed or unsafe plugin identifiers without invoking a backend", async () => {
    const { runtime } = await fixture();
    const invalid = await fetch(`${runtime.url}/plugin-api/%2Fetc/status`);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "Identificador de plugin inválido." });
  });

  it("caches plugin directory discovery and supports explicit invalidation", async () => {
    const { runtime, pluginsRoot } = await fixture();
    const initial = await fetch(`${runtime.url}/dev-plugins/index.json`).then((response) => response.json());
    expect(initial.plugins).toEqual([]);

    const pluginRoot = join(pluginsRoot, "sample");
    await mkdir(pluginRoot);
    await writeFile(join(pluginRoot, "plugin.json"), JSON.stringify({ id: "sample", name: "Sample", version: "1.0.0" }));

    const cached = await fetch(`${runtime.url}/dev-plugins/index.json`).then((response) => response.json());
    expect(cached.plugins).toEqual([]);
    runtime.clearManifestCache();
    const refreshed = await fetch(`${runtime.url}/dev-plugins/index.json`).then((response) => response.json());
    expect(refreshed.plugins).toHaveLength(1);
  });

  it("reuses parsed plugin manifests until the cache is invalidated", async () => {
    const { runtime, pluginsRoot } = await fixture();
    const pluginRoot = join(pluginsRoot, "cached");
    await mkdir(pluginRoot);
    await writeFile(join(pluginRoot, "plugin.json"), JSON.stringify({
      id: "cached",
      name: "Cached",
      version: "1.0.0",
    }));
    runtime.clearManifestCache();

    const first = await fetch(`${runtime.url}/dev-plugins/index.json`).then((response) => response.json());
    expect(first.plugins).toHaveLength(1);
    await writeFile(join(pluginRoot, "plugin.json"), "{invalid json");

    const cached = await fetch(`${runtime.url}/dev-plugins/index.json`).then((response) => response.json());
    expect(cached.plugins).toHaveLength(1);
    runtime.clearManifestCache();
    const refreshed = await fetch(`${runtime.url}/dev-plugins/index.json`).then((response) => response.json());
    expect(refreshed.plugins).toEqual([]);
  });

  it("ignores invalid manifests in the catalog", async () => {
    const { runtime, pluginsRoot } = await fixture();
    const pluginRoot = join(pluginsRoot, "invalid");
    await mkdir(pluginRoot);
    await writeFile(join(pluginRoot, "plugin.json"), "{invalid json");
    runtime.clearManifestCache();

    const catalog = await fetch(`${runtime.url}/dev-plugins/index.json`).then((response) => response.json());
    expect(catalog.plugins).toEqual([]);
  });

  it("selects and clears a workspace through the public API", async () => {
    const { runtime, workspaceRoot } = await fixture();
    const selected = await fetch(`${runtime.url}/core-api/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "workspace", path: workspaceRoot }),
    });
    expect(selected.status).toBe(200);
    await expect(selected.json()).resolves.toEqual({ workspaceRoot });
    expect(runtime.workspaceRoot).toBe(workspaceRoot);

    const cleared = await fetch(`${runtime.url}/core-api/workspace`, { method: "DELETE" });
    expect(cleared.status).toBe(204);
    expect(runtime.workspaceRoot).toBeUndefined();
    const pluginRequest = await fetch(`${runtime.url}/plugin-api/sample/status`);
    expect(pluginRequest.status).toBe(409);
  });

  it("rejects invalid workspace selections", async () => {
    const { runtime, root } = await fixture();
    const invalidName = await fetch(`${runtime.url}/core-api/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "../workspace" }),
    });
    expect(invalidName.status).toBe(400);

    const unavailable = await fetch(`${runtime.url}/core-api/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "missing", path: join(root, "missing") }),
    });
    expect(unavailable.status).toBe(400);
  });

  it("loads a plugin backend and reuses it while unchanged", async () => {
    const { runtime, pluginsRoot } = await fixture();
    const pluginRoot = join(pluginsRoot, "sample");
    await mkdir(pluginRoot);
    await writeFile(join(pluginRoot, "plugin.json"), JSON.stringify({
      id: "sample",
      name: "Sample",
      version: "1.0.0",
      entrypoints: { backend: "backend.mjs" },
    }));
    await writeFile(join(pluginRoot, "backend.mjs"), `
      let requests = 0;
      export function createBackend({ workspaceRoot }) {
        return (_request, response, path) => {
          requests += 1;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ path, requests, workspaceRoot }));
        };
      }
    `);
    runtime.clearManifestCache();

    const first = await fetch(`${runtime.url}/plugin-api/sample/ping`).then((response) => response.json());
    const second = await fetch(`${runtime.url}/plugin-api/sample/ping`).then((response) => response.json());
    expect(first).toMatchObject({ path: "/ping", requests: 1 });
    expect(second).toMatchObject({ path: "/ping", requests: 2 });
  });

  it("blocks plugin backends that escape their plugin directory", async () => {
    const { runtime, root, pluginsRoot } = await fixture();
    await writeFile(join(root, "outside-backend.mjs"), "export function createBackend() {}");
    const pluginRoot = join(pluginsRoot, "unsafe");
    await mkdir(pluginRoot);
    await writeFile(join(pluginRoot, "plugin.json"), JSON.stringify({
      id: "unsafe",
      name: "Unsafe",
      version: "1.0.0",
      entrypoints: { backend: "../../outside-backend.mjs" },
    }));
    runtime.clearManifestCache();

    const response = await fetch(`${runtime.url}/plugin-api/unsafe/ping`);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("backend inválido") });
  });

  it("serves the SPA fallback and rejects malformed plugin asset paths", async () => {
    const { runtime } = await fixture();
    const fallback = await fetch(`${runtime.url}/deep/link`);
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain("tinyIde");

    const malformed = await fetch(`${runtime.url}/dev-plugins/%E0%A4%A`);
    expect(malformed.status).toBe(400);
  });

  it("allows direct workspace updates for embedded hosts", async () => {
    const { runtime, workspaceRoot } = await fixture();
    expect(runtime.setWorkspaceRoot(undefined)).toBeUndefined();
    expect(runtime.setWorkspaceRoot(workspaceRoot)).toBe(workspaceRoot);
    expect(() => runtime.clearBackendCache()).not.toThrow();
  });

  it("configures conservative HTTP server limits", async () => {
    const { runtime } = await fixture();
    expect(runtime.server.maxHeadersCount).toBe(100);
    expect(runtime.server.headersTimeout).toBe(10_000);
    expect(runtime.server.requestTimeout).toBe(30_000);
    expect(runtime.server.keepAliveTimeout).toBe(5_000);
  });
});
