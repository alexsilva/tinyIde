import { existsSync, readdirSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createTinyIdeRuntime } from "../../packages/runtime-server/src/index.mjs";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const hostRoot = resolve(configDirectory, "../..");
const pluginsRoot = resolve(hostRoot, "plugins");

function runtimePlugin() {
  const runtime = createTinyIdeRuntime({
    hostRoot,
    pluginsRoot,
    workspaceSearchRoot: process.env.TINYIDE_WORKSPACES_ROOT ?? dirname(hostRoot),
  });

  function install(server) {
    server.middlewares.use(runtime.middleware);
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
        runtime.clearBackendCache();
        server.ws.send({type: "full-reload", path: "*"});
      }
    });
  }

  return {
    name: "tinyide-runtime-server",
    configureServer: install,
    configurePreviewServer(server) {
      server.middlewares.use(runtime.middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), runtimePlugin()],
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
