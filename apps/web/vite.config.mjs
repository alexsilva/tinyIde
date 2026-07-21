import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig } from "vite";
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
  const executionBackend = createExecutionBackend({ workspaceRoot: resolve(configDirectory, "../..") });

  async function resolveBackend(pluginId) {
    if (backendHandlers.has(pluginId)) return backendHandlers.get(pluginId);

    for (const directoryName of readdirSync(pluginsRoot)) {
      const manifestPath = join(pluginsRoot, directoryName, "plugin.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.id !== pluginId || !manifest.entrypoints?.backend) continue;

      const backendPath = resolve(dirname(manifestPath), manifest.entrypoints.backend);
      const imported = await import(`${pathToFileURL(backendPath).href}?v=${statSync(backendPath).mtimeMs}`);
      if (typeof imported.createBackend !== "function") {
        throw new Error(`Plugin backend must export createBackend(): ${pluginId}`);
      }
      const handler = imported.createBackend({ workspaceRoot: resolve(configDirectory, "../..") });
      backendHandlers.set(pluginId, handler);
      return handler;
    }

    return undefined;
  }

  const middleware = (request, response, next) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

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
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [developmentPluginServer()],
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
