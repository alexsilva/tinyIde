import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createExecutionBackend } from "./execution-backend.mjs";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function writeJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function safeFile(root, path) {
  const normalizedPath = normalize(path).replace(/^([/\\])+/, "");
  const absolutePath = resolve(root, normalizedPath);
  return absolutePath === root || absolutePath.startsWith(`${root}${sep}`) ? absolutePath : undefined;
}

function manifestDirectories(pluginsRoot) {
  if (!existsSync(pluginsRoot)) return [];
  return readdirSync(pluginsRoot)
    .map((name) => join(pluginsRoot, name))
    .filter((directory) => {
      const manifest = join(directory, "plugin.json");
      return existsSync(manifest) && statSync(manifest).isFile();
    });
}

export function createTinyIdeRuntime(options) {
  const hostRoot = resolve(options.hostRoot);
  const pluginsRoot = resolve(options.pluginsRoot ?? join(hostRoot, "plugins"));
  const webRoot = options.webRoot ? resolve(options.webRoot) : undefined;
  const workspaceSearchRoot = resolve(options.workspaceSearchRoot ?? process.env.TINYIDE_WORKSPACES_ROOT ?? dirname(hostRoot));
  const backendHandlers = new Map();
  let activeWorkspaceRoot = options.initialWorkspaceRoot
    ? resolve(options.initialWorkspaceRoot)
    : undefined;
  const executionBackend = createExecutionBackend({ workspaceRoot: () => activeWorkspaceRoot });

  function isInsideWorkspaceSearchRoot(candidate) {
    const relativePath = relative(workspaceSearchRoot, candidate);
    return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  }

  function findWorkspaceByName(name) {
    if (basename(hostRoot) === name) return hostRoot;
    const ignored = new Set([".git", ".venv", "node_modules", "dist", "coverage"]);
    const queue = [{path: workspaceSearchRoot, depth: 0}];
    const matches = [];
    while (queue.length) {
      const current = queue.shift();
      if (!current || current.depth >= 4) continue;
      for (const entry of readdirSync(current.path, {withFileTypes: true})) {
        if (!entry.isDirectory() || ignored.has(entry.name)) continue;
        const directoryPath = join(current.path, entry.name);
        if (entry.name === name) matches.push({path: directoryPath, depth: current.depth + 1});
        queue.push({path: directoryPath, depth: current.depth + 1});
      }
    }
    if (!matches.length) return undefined;
    const minimumDepth = Math.min(...matches.map((match) => match.depth));
    const nearest = matches.filter((match) => match.depth === minimumDepth);
    if (nearest.length > 1) throw new Error(`Há mais de um diretório chamado '${name}' no mesmo nível da raiz de workspaces.`);
    return nearest[0].path;
  }

  function resolveWorkspaceSelection(payload) {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name || name.includes("/") || name.includes("\\") || name.includes("\0")) throw new Error("Nome de workspace inválido.");
    if (typeof payload.path === "string" && payload.path.trim()) {
      const candidate = resolve(payload.path.trim());
      const pathAllowed = typeof options.workspacePathAllowed === "function"
        ? options.workspacePathAllowed(candidate)
        : isInsideWorkspaceSearchRoot(candidate);
      if (!pathAllowed || !existsSync(candidate) || !statSync(candidate).isDirectory()) {
        throw new Error("O workspace salvo não está disponível dentro da raiz configurada para workspaces.");
      }
      if (basename(candidate) !== name) throw new Error("O caminho salvo não corresponde ao workspace selecionado.");
      return candidate;
    }
    if (options.requireWorkspacePath === true) {
      throw new Error("O desktop exige o caminho absoluto do workspace selecionado.");
    }
    const candidate = findWorkspaceByName(name);
    if (!candidate) throw new Error(`Não foi possível vincular o diretório '${name}' à raiz de workspaces '${workspaceSearchRoot}'.`);
    return candidate;
  }

  async function resolveBackend(pluginId) {
    if (!activeWorkspaceRoot) throw new Error("Abra um workspace antes de usar este plugin.");
    for (const directory of manifestDirectories(pluginsRoot)) {
      const manifestPath = join(directory, "plugin.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.id !== pluginId || !manifest.entrypoints?.backend) continue;
      const backendPath = resolve(directory, manifest.entrypoints.backend);
      const backendMtime = statSync(backendPath).mtimeMs;
      const cacheKey = `${pluginId}:${activeWorkspaceRoot}`;
      const cached = backendHandlers.get(cacheKey);
      if (cached?.mtime === backendMtime) return cached.handler;
      const imported = await import(`${pathToFileURL(backendPath).href}?v=${backendMtime}`);
      if (typeof imported.createBackend !== "function") throw new Error(`Plugin backend must export createBackend(): ${pluginId}`);
      const handler = imported.createBackend({workspaceRoot: activeWorkspaceRoot});
      backendHandlers.set(cacheKey, {mtime: backendMtime, handler});
      return handler;
    }
    return undefined;
  }

  function serveFile(response, absolutePath) {
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) return false;
    response.statusCode = 200;
    response.setHeader("Content-Type", CONTENT_TYPES[extname(absolutePath)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    createReadStream(absolutePath).pipe(response);
    return true;
  }

  const middleware = (request, response, next = () => {
    response.statusCode = 404;
    response.end("Not found.");
  }) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "POST" && requestUrl.pathname === "/core-api/workspace") {
      void readJson(request).then((payload) => {
        activeWorkspaceRoot = resolveWorkspaceSelection(payload);
        backendHandlers.clear();
        writeJson(response, 200, {workspaceRoot: activeWorkspaceRoot});
      }).catch((error) => writeJson(response, 400, {error: error instanceof Error ? error.message : String(error)}));
      return;
    }

    if (request.method === "DELETE" && requestUrl.pathname === "/core-api/workspace") {
      activeWorkspaceRoot = undefined;
      backendHandlers.clear();
      writeJson(response, 204, undefined);
      return;
    }

    if (requestUrl.pathname.startsWith("/core-api/")) {
      void executionBackend(request, response, requestUrl.pathname.slice("/core-api".length));
      return;
    }

    if (requestUrl.pathname.startsWith("/plugin-api/")) {
      if (!activeWorkspaceRoot) {
        writeJson(response, 409, {error: "Abra um workspace antes de usar este plugin."});
        return;
      }
      const segments = requestUrl.pathname.slice("/plugin-api/".length).split("/");
      const pluginId = decodeURIComponent(segments.shift() ?? "");
      const relativePath = `/${segments.join("/")}`;
      void resolveBackend(pluginId).then((handler) => {
        if (!handler) {
          writeJson(response, 404, {error: "Plugin backend not found."});
          return;
        }
        return handler(request, response, relativePath);
      }).catch((error) => writeJson(response, 500, {error: error instanceof Error ? error.message : String(error)}));
      return;
    }

    if (requestUrl.pathname === "/dev-plugins/index.json") {
      writeJson(response, 200, {
        plugins: manifestDirectories(pluginsRoot).map((directory) => ({
          manifestUrl: `/dev-plugins/${encodeURIComponent(basename(directory))}/plugin.json`,
          bundled: Boolean(options.bundledPlugins),
        })),
      });
      return;
    }

    if (requestUrl.pathname.startsWith("/dev-plugins/")) {
      const absolutePath = safeFile(pluginsRoot, decodeURIComponent(requestUrl.pathname.slice("/dev-plugins/".length)));
      if (!absolutePath || !serveFile(response, absolutePath)) {
        response.statusCode = 404;
        response.end("Plugin asset not found.");
      }
      return;
    }

    if (webRoot) {
      const requestedPath = requestUrl.pathname === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname.slice(1));
      const absolutePath = safeFile(webRoot, requestedPath);
      if (absolutePath && serveFile(response, absolutePath)) return;
      const indexPath = join(webRoot, "index.html");
      if (serveFile(response, indexPath)) return;
    }

    next();
  };

  return {
    middleware,
    pluginsRoot,
    webRoot,
    get workspaceRoot() { return activeWorkspaceRoot; },
    setWorkspaceRoot(path) {
      activeWorkspaceRoot = path ? resolve(path) : undefined;
      backendHandlers.clear();
      return activeWorkspaceRoot;
    },
    clearBackendCache() { backendHandlers.clear(); },
  };
}

export async function startTinyIdeRuntime(options) {
  const runtime = createTinyIdeRuntime(options);
  const server = createServer((request, response) => runtime.middleware(request, response));
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Não foi possível determinar a porta do runtime.");
  return {
    ...runtime,
    server,
    host: address.address,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}
