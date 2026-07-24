import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  installWindowVisibilityFallback,
} = require("./startup.cjs");

function createWindow() {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.isDestroyed = vi.fn(() => false);
  window.isVisible = vi.fn(() => false);
  window.show = vi.fn();
  return window;
}

function extractInstalledLauncher() {
  const source = readFileSync(new URL("../../build/after-install.sh", import.meta.url), "utf8");
  const match = source.match(/cat > \/usr\/bin\/tinyide <<'EOF'\n([\s\S]*?)\nEOF/);
  if (!match) throw new Error("tinyIde launcher was not found in after-install.sh");
  return match[1];
}

function runInstalledLauncher(ozonePlatform) {
  const directory = mkdtempSync(join(tmpdir(), "tinyide-launcher-"));
  const launcherPath = join(directory, "tinyide");
  const executablePath = join(directory, "electron-stub");
  const capturePath = join(directory, "arguments.txt");
  writeFileSync(launcherPath, extractInstalledLauncher(), "utf8");
  writeFileSync(executablePath, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$TINYIDE_CAPTURE\"\n", "utf8");
  chmodSync(launcherPath, 0o755);
  chmodSync(executablePath, 0o755);

  const env = {
    ...process.env,
    TINYIDE_EXECUTABLE: executablePath,
    TINYIDE_CAPTURE: capturePath,
  };
  if (ozonePlatform === undefined) delete env.TINYIDE_OZONE_PLATFORM;
  else env.TINYIDE_OZONE_PLATFORM = ozonePlatform;

  const result = spawnSync(launcherPath, ["--example"], {
    env,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return readFileSync(capturePath, "utf8").trim().split("\n");
}

describe("desktop startup", () => {
  it("uses x11 when the installed launcher has no ozone environment override", () => {
    expect(runInstalledLauncher(undefined)).toEqual([
      "--ozone-platform=x11",
      "--example",
    ]);
  });

  it("passes explicit ozone choices without producing an empty platform argument", () => {
    expect(runInstalledLauncher("wayland")).toEqual([
      "--ozone-platform=wayland",
      "--example",
    ]);
    expect(runInstalledLauncher("auto")).toEqual(["--example"]);
  });

  it("shows the window when the renderer finishes loading", () => {
    const window = createWindow();
    const clearTimeoutFunction = vi.fn();
    installWindowVisibilityFallback(window, {
      setTimeoutFunction: vi.fn(() => ({ unref: vi.fn() })),
      clearTimeoutFunction,
    });
    window.webContents.emit("did-finish-load");
    window.emit("ready-to-show");
    expect(window.show).toHaveBeenCalledOnce();
    window.emit("closed");
    expect(clearTimeoutFunction).toHaveBeenCalledOnce();
  });

  it("uses the timeout when neither Electron visibility event arrives", () => {
    const window = createWindow();
    let timeoutCallback;
    const timer = { unref: vi.fn() };
    installWindowVisibilityFallback(window, {
      setTimeoutFunction: vi.fn((callback) => {
        timeoutCallback = callback;
        return timer;
      }),
    });
    expect(timer.unref).toHaveBeenCalledOnce();
    timeoutCallback();
    expect(window.show).toHaveBeenCalledOnce();
  });

  it("logs main-frame load and renderer failures without reopening destroyed windows", () => {
    const window = createWindow();
    const logger = { error: vi.fn() };
    installWindowVisibilityFallback(window, {
      setTimeoutFunction: vi.fn(() => ({ unref: vi.fn() })),
      logger,
    });
    window.webContents.emit("did-fail-load", {}, -2, "ERR_FAILED", "http://127.0.0.1/", true);
    window.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(window.show).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledTimes(2);

    const destroyed = createWindow();
    destroyed.isDestroyed.mockReturnValue(true);
    installWindowVisibilityFallback(destroyed, {
      setTimeoutFunction: vi.fn((callback) => {
        callback();
        return undefined;
      }),
    });
    expect(destroyed.show).not.toHaveBeenCalled();
  });
});
