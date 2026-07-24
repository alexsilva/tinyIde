const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("tinyideDesktop", {
  pickDirectory() {
    return ipcRenderer.invoke("tinyide:workspace:pick");
  },
  restoreDirectory(path) {
    return ipcRenderer.invoke("tinyide:workspace:restore", path);
  },
  listDirectory(token, path) {
    return ipcRenderer.invoke("tinyide:workspace:list", token, path);
  },
  ensureFile(token, path, create) {
    return ipcRenderer.invoke("tinyide:workspace:ensure-file", token, path, create);
  },
  ensureDirectory(token, path, create) {
    return ipcRenderer.invoke("tinyide:workspace:ensure-directory", token, path, create);
  },
  readFile(token, path) {
    return ipcRenderer.invoke("tinyide:workspace:read-file", token, path);
  },
  writeFile(token, path, bytes) {
    return ipcRenderer.invoke("tinyide:workspace:write-file", token, path, bytes);
  },
  removeEntry(token, path, recursive) {
    return ipcRenderer.invoke("tinyide:workspace:remove", token, path, recursive);
  },
  getPathForFile(file) {
    return webUtils.getPathForFile(file);
  },
});
