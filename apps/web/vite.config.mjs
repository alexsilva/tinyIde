import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createExecutionBackend } from "./execution-backend.mjs";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const pluginsRoot = resolve(configDirectory, "../../plugins");

const contentTypes = {
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function developmentPluginServer() {
  const backendHandlers = new Map();
  const hostRoot = resolve(configDirectory, "../..");
  const workspaceSearchRoot = resolve(process.env.TINYIDE_WORKSPACES_ROOT ?? dirname(hostRoot));
  let activeWorkspaceRoot = hostRoot;
  const executionBackend = createExecutionBackend({ workspaceRoot: () => activeWorkspaceRoot });

  async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  }

  function isInsideWorkspaceSearchRoot(candidate) {
    const relativePath = relative(workspaceSearchRoot, candidate);
    return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  }

  function findWorkspaceByName(name) {
    if (basename(hostRoot) === name) return hostRoot;
    const ignored = new Set([".git", ".venv", "node_modules", "dist", "coverage"]);
    const queue = [{ path: workspaceSearchRoot, depth: 0 }];
    const matches = [];
    while (queue.length) {
      const current = queue.shift();
      if (!current || current.depth >= 4) continue;
      for (const entry of readdirSync(current.path, { withFileTypes: true })) {
        if (!entry.isDirectory() || ignored.has(entry.name)) continue;
        const directoryPath = join(current.path, entry.name);
        if (entry.name === name) matches.push({ path: directoryPath, depth: current.depth + 1 });
        queue.push({ path: directoryPath, depth: current.depth + 1 });
      }
    }
    if (matches.length) {
      const minimumDepth = Math.min(...matches.map((match) => match.depth));
      const nearestMatches = matches.filter((match) => match.depth === minimumDepth);
      if (nearestMatches.length > 1) {
        throw new Error(`Há mais de um diretório chamado '${name}' no mesmo nível da raiz de workspaces.`);
      }
      return nearestMatches[0].path;
    }
    return undefined;
  }

  function resolveWorkspaceSelection(payload) {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name || name.includes("/") || name.includes("\\") || name.includes("\0")) {
      throw new Error("Nome de workspace inválido.");
    }
    if (typeof payload.path === "string" && payload.path.trim()) {
      const candidate = resolve(payload.path.trim());
      if (!isInsideWorkspaceSearchRoot(candidate) || !existsSync(candidate) || !statSync(candidate).isDirectory()) {
        throw new Error("O workspace salvo não está disponível dentro da raiz configurada para workspaces.");
      }
      if (basename(candidate) !== name) throw new Error("O caminho salvo não corresponde ao workspace selecionado.");
      return candidate;
    }
    const candidate = findWorkspaceByName(name);
    if (!candidate) {
      throw new Error(`Não foi possível vincular o diretório '${name}' à raiz de workspaces '${workspaceSearchRoot}'.`);
    }
    return candidate;
  }

  async function resolveBackend(pluginId) {
    for (const directoryName of readdirSync(pluginsRoot)) {
      const manifestPath = join(pluginsRoot, directoryName, "plugin.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.id !== pluginId || !manifest.entrypoints?.backend) continue;

      const backendPath = resolve(dirname(manifestPath), manifest.entrypoints.backend);
      const backendMtime = statSync(backendPath).mtimeMs;
      const cacheKey = `${pluginId}:${activeWorkspaceRoot}`;
      const cached = backendHandlers.get(cacheKey);
      if (cached?.mtime === backendMtime) return cached.handler;

      const imported = await import(`${pathToFileURL(backendPath).href}?v=${backendMtime}`);
      if (typeof imported.createBackend !== "function") {
        throw new Error(`Plugin backend must export createBackend(): ${pluginId}`);
      }
      const handler = imported.createBackend({ workspaceRoot: activeWorkspaceRoot });
      backendHandlers.set(cacheKey, { mtime: backendMtime, handler });
      return handler;
    }

    return undefined;
  }

  const middleware = (request, response, next) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "POST" && requestUrl.pathname === "/core-api/workspace") {
      void readJson(request)
        .then((payload) => {
          activeWorkspaceRoot = resolveWorkspaceSelection(payload);
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ workspaceRoot: activeWorkspaceRoot }));
        })
        .catch((error) => {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        });
      return;
    }

    if (requestUrl.pathname.startsWith("/core-api/")) {
      const relativePath = requestUrl.pathname.slice("/core-api".length);
      void executionBackend(request, response, relativePath);
      return;
    }

    if (requestUrl.pathname.startsWith("/plugin-api/")) {
      const segments = requestUrl.pathname.slice("/plugin-api/".length).split("/");
      const pluginId = decodeURIComponent(segments.shift() ?? "");
      const relativePath = `/${segments.join("/")}`;
      void resolveBackend(pluginId)
        .then((handler) => {
          if (!handler) {
            response.statusCode = 404;
            response.end("Plugin backend not found.");
            return;
          }
          return handler(request, response, relativePath);
        })
        .catch((error) => {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        });
      return;
    }

    if (requestUrl.pathname === "/dev-plugins/index.json") {
      const plugins = existsSync(pluginsRoot)
        ? readdirSync(pluginsRoot)
            .filter((name) => {
              const manifestPath = join(pluginsRoot, name, "plugin.json");
              return existsSync(manifestPath) && statSync(manifestPath).isFile();
            })
            .map((name) => ({ manifestUrl: `/dev-plugins/${encodeURIComponent(name)}/plugin.json` }))
        : [];

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ plugins }));
      return;
    }

    if (!requestUrl.pathname.startsWith("/dev-plugins/")) {
      next();
      return;
    }

    const relativePath = decodeURIComponent(requestUrl.pathname.slice("/dev-plugins/".length));
    const normalizedPath = normalize(relativePath).replace(/^([/\\])+/, "");
    const absolutePath = resolve(pluginsRoot, normalizedPath);

    if (!absolutePath.startsWith(`${pluginsRoot}${sep}`) || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      response.statusCode = 404;
      response.end("Plugin asset not found.");
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypes[extname(absolutePath)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    createReadStream(absolutePath).pipe(response);
  };

  return {
    name: "tinyide-development-plugin-server",
    configureServer(server) {
      server.middlewares.use(middleware);
      const watchedPluginFiles = readdirSync(pluginsRoot).flatMap((directoryName) => [
        join(pluginsRoot, directoryName, "plugin.json"),
        join(pluginsRoot, directoryName, "dist/frontend.js"),
        join(pluginsRoot, directoryName, "src/backend.mjs"),
      ]).filter(existsSync);
      server.watcher.add(watchedPluginFiles);
      server.watcher.on("all", (eventName, changedPath) => {
        if (!["add", "change", "unlink"].includes(eventName)) return;
        const normalizedChangedPath = normalize(changedPath);
        if (!normalizedChangedPath.startsWith(`${pluginsRoot}${sep}`)) return;
        if (
          normalizedChangedPath.endsWith(`${sep}plugin.json`)
          || normalizedChangedPath.endsWith(`${sep}dist${sep}frontend.js`)
          || normalizedChangedPath.endsWith(`${sep}src${sep}backend.mjs`)
        ) {
          backendHandlers.clear();
          server.ws.send({ type: "full-reload", path: "*" });
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), developmentPluginServer()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: false,
    open: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    open: true,
  },
});
