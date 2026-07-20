import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const pluginsRoot = resolve(configDirectory, "../../plugins");

const contentTypes = {
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function developmentPluginServer() {
  const middleware = (request, response, next) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

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
    port: 5173,
    strictPort: true,
    open: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    open: true,
  },
});
