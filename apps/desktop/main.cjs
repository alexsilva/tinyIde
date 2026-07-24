const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { randomUUID } = require("node:crypto");
const { existsSync, statSync } = require("node:fs");
const { mkdir, readFile, readdir, rm, stat, writeFile } = require("node:fs/promises");
const { basename, dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { allowedExternalUrl, safeWorkspacePath: resolveSafeWorkspacePath, sameOriginUrl } = require("./security.cjs");
const { installWindowVisibilityFallback } = require("./startup.cjs");

let runtime;
let mainWindow;
const desktopWorkspaces = new Map();

function registeredWorkspace(token) {
  const root = desktopWorkspaces.get(token);
  if (!root) throw new Error("O workspace desktop não está mais registrado.");
  return root;
}

async function safeWorkspacePath(token, workspacePath = "") {
  const root = registeredWorkspace(token);
  return resolveSafeWorkspacePath(root, workspacePath);
}

function registerDesktopWorkspace(rootPath) {
  const root = resolve(rootPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error("O diretório selecionado não está disponível.");
  }
  const token = randomUUID();
  desktopWorkspaces.clear();
  desktopWorkspaces.set(token, root);
  return { token, name: basename(root), path: root };
}

function installDesktopFileSystemHandlers() {
  ipcMain.handle("tinyide:workspace:pick", async () => {
    const testWorkspace = process.env.TINYIDE_TEST_WORKSPACE_PICKER_PATH?.trim();
    if (testWorkspace) return registerDesktopWorkspace(testWorkspace);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Abrir workspace",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return registerDesktopWorkspace(result.filePaths[0]);
  });

  ipcMain.handle("tinyide:workspace:restore", async (_event, rootPath) => {
    if (typeof rootPath !== "string" || !rootPath.trim()) return undefined;
    return registerDesktopWorkspace(rootPath.trim());
  });

  ipcMain.handle("tinyide:workspace:list", async (_event, token, workspacePath) => {
    const directory = await safeWorkspacePath(token, workspacePath);
    const entries = await readdir(directory, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      let kind = entry.isDirectory() ? "directory" : "file";
      if (entry.isSymbolicLink()) {
        try {
          kind = (await stat(join(directory, entry.name))).isDirectory() ? "directory" : "file";
        } catch {
          kind = "file";
        }
      }
      result.push({ name: entry.name, kind });
    }
    return result;
  });

  ipcMain.handle("tinyide:workspace:ensure-file", async (_event, token, workspacePath, create) => {
    const filePath = await safeWorkspacePath(token, workspacePath);
    if (create && !existsSync(filePath)) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, new Uint8Array());
    }
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("O recurso solicitado não é um arquivo.");
    return true;
  });

  ipcMain.handle("tinyide:workspace:ensure-directory", async (_event, token, workspacePath, create) => {
    const directoryPath = await safeWorkspacePath(token, workspacePath);
    if (create) await mkdir(directoryPath, { recursive: true });
    const info = await stat(directoryPath);
    if (!info.isDirectory()) throw new Error("O recurso solicitado não é um diretório.");
    return true;
  });

  ipcMain.handle("tinyide:workspace:read-file", async (_event, token, workspacePath) => {
    const filePath = await safeWorkspacePath(token, workspacePath);
    const [data, info] = await Promise.all([readFile(filePath), stat(filePath)]);
    return {
      bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      lastModified: info.mtimeMs,
    };
  });

  ipcMain.handle("tinyide:workspace:write-file", async (_event, token, workspacePath, bytes) => {
    const filePath = await safeWorkspacePath(token, workspacePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(bytes));
    return true;
  });

  ipcMain.handle("tinyide:workspace:remove", async (_event, token, workspacePath, recursive) => {
    const target = await safeWorkspacePath(token, workspacePath);
    await rm(target, { recursive: recursive === true, force: false });
    return true;
  });
}

function initialWorkspaceRoot() {
  const configured = process.env.TINYIDE_WORKSPACE?.trim();
  if (!configured) return undefined;
  const candidate = resolve(configured);
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  return undefined;
}

async function startRuntime() {
  const appRoot = app.getAppPath();
  const runtimeModuleUrl = pathToFileURL(join(appRoot, "packages/runtime-server/src/index.mjs")).href;
  const { startTinyIdeRuntime } = await import(runtimeModuleUrl);
  const selectedPort = Number(process.env.TINYIDE_RUNTIME_PORT);
  const initialWorkspace = initialWorkspaceRoot();
  const runtime = await startTinyIdeRuntime({
    hostRoot: appRoot,
    webRoot: join(appRoot, "apps/web/dist"),
    pluginsRoot: join(appRoot, "plugins"),
    workspaceSearchRoot: process.env.TINYIDE_WORKSPACES_ROOT || app.getPath("home"),
    requireWorkspacePath: true,
    workspacePathAllowed(candidate) {
      return [...desktopWorkspaces.values()].some((root) => resolve(root) === resolve(candidate));
    },
    ...(initialWorkspace ? { initialWorkspaceRoot: initialWorkspace } : {}),
    bundledPlugins: true,
    host: "127.0.0.1",
    port: Number.isInteger(selectedPort) && selectedPort > 0 ? selectedPort : 0,
  });
  console.log(`[tinyIde] Runtime disponível em ${runtime.url}`);
  return runtime;
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0e1116",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (allowedExternalUrl(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (sameOriginUrl(target, url)) return;
    event.preventDefault();
    if (allowedExternalUrl(target)) void shell.openExternal(target);
  });
  installWindowVisibilityFallback(window);
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  void window.loadURL(url);
  return window;
}

app.whenReady().then(async () => {
  installDesktopFileSystemHandlers();
  runtime = await startRuntime();
  mainWindow = createWindow(runtime.url);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(runtime.url);
  });
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (runtime) void runtime.close().catch(() => undefined);
});
