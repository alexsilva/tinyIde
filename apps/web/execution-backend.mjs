import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_OUTPUT_CHARS = 1024 * 1024;

function writeJson(response, statusCode, value) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new Error("Corpo da requisição excede o limite permitido.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`Campo inválido: ${field}`);
  }
  return value;
}

function stringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.includes("\0"))) {
    throw new Error(`Campo inválido: ${field}`);
  }
  return value;
}

function environmentRecord(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Variáveis de ambiente inválidas.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof item !== "string" || item.includes("\0")) {
        throw new Error(`Variável de ambiente inválida: ${name}`);
      }
      return [name, item];
    }),
  );
}

function appendOutput(current, chunk) {
  const next = current + chunk.toString("utf8");
  return next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next;
}

function processSnapshot(record) {
  return {
    id: record.id,
    status: record.status,
    executable: record.executable,
    arguments: record.arguments,
    workingDirectory: record.workingDirectory,
    stdout: record.stdout,
    stderr: record.stderr,
    exitCode: record.exitCode,
    signal: record.signal,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: (record.finishedAt ?? Date.now()) - record.startedAt,
  };
}

export function createExecutionBackend({ workspaceRoot }) {
  const getWorkspaceRoot = typeof workspaceRoot === "function"
    ? workspaceRoot
    : () => workspaceRoot;
  const processes = new Map();

  function resolvedWorkspaceRoot() {
    return resolve(getWorkspaceRoot());
  }

  function startProcess(payload) {
    const workspaceRoot = resolvedWorkspaceRoot();
    const executable = requiredString(payload.executable, "executable");
    const args = stringArray(payload.arguments ?? [], "arguments");
    const workingDirectory = payload.workingDirectory
      ? resolve(workspaceRoot, requiredString(payload.workingDirectory, "workingDirectory"))
      : workspaceRoot;
    const environmentVariables = environmentRecord(payload.environmentVariables);
    const id = randomUUID();
    const startedAt = Date.now();
    const child = spawn(executable, args, {
      cwd: workingDirectory,
      env: { ...process.env, ...environmentVariables },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const record = {
      id,
      child,
      status: "running",
      executable,
      arguments: args,
      workingDirectory,
      stdout: "",
      stderr: "",
      exitCode: undefined,
      signal: undefined,
      startedAt,
      finishedAt: undefined,
    };
    processes.set(id, record);

    child.stdout.on("data", (chunk) => {
      record.stdout = appendOutput(record.stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      record.stderr = appendOutput(record.stderr, chunk);
    });
    child.on("error", (error) => {
      record.stderr = appendOutput(record.stderr, `${error.message}\n`);
      record.status = "exited";
      record.exitCode = -1;
      record.finishedAt = Date.now();
    });
    child.on("close", (exitCode, signal) => {
      record.status = "exited";
      record.exitCode = exitCode ?? (signal ? 128 : -1);
      record.signal = signal ?? undefined;
      record.finishedAt = Date.now();
    });

    return processSnapshot(record);
  }

  return async function executionBackend(request, response, relativePath) {
    try {
      if (request.method === "GET" && relativePath === "/context") {
        writeJson(response, 200, { workspaceRoot: resolvedWorkspaceRoot() });
        return;
      }

      if (request.method === "POST" && relativePath === "/execution/processes") {
        writeJson(response, 201, startProcess(await readJson(request)));
        return;
      }

      const match = /^\/execution\/processes\/([^/]+)$/.exec(relativePath);
      if (match) {
        const record = processes.get(decodeURIComponent(match[1]));
        if (!record) {
          writeJson(response, 404, { error: "Processo não encontrado." });
          return;
        }
        if (request.method === "GET") {
          writeJson(response, 200, processSnapshot(record));
          return;
        }
        if (request.method === "DELETE") {
          if (record.status === "running") {
            record.child.kill("SIGTERM");
            setTimeout(() => {
              if (record.status === "running") record.child.kill("SIGKILL");
            }, 1500).unref();
          }
          writeJson(response, 202, processSnapshot(record));
          return;
        }
      }

      writeJson(response, 404, { error: "Endpoint do core não encontrado." });
    } catch (error) {
      writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
