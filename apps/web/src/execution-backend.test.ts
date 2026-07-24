/// <reference types="node" />

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
// @ts-expect-error The runtime backend is an ESM JavaScript module.
import { createExecutionBackend } from "../../../packages/runtime-server/src/execution-backend.mjs";

interface BackendResponse<Value = unknown> {
  readonly status: number;
  readonly body: Value;
}

async function callBackend<Value>(
  handler: (request: Readable & { method: string; headers: Record<string, string> }, response: unknown, path: string) => Promise<void>,
  method: string,
  path: string,
  body?: unknown,
): Promise<BackendResponse<Value>> {
  const requestBody = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const request = Object.assign(Readable.from(requestBody), {
    method,
    headers: {} as Record<string, string>,
  });
  return new Promise<BackendResponse<Value>>((resolve, reject) => {
    const response = {
      statusCode: 0,
      setHeader() {},
      end(value = "") {
        try {
          resolve({
            status: response.statusCode,
            body: value ? JSON.parse(String(value)) as Value : undefined as Value,
          });
        } catch (error) {
          reject(error);
        }
      },
    };
    Promise.resolve(handler(request, response, path)).catch(reject);
  });
}

describe("execution backend sessions", () => {
  it("lists running processes only in their workspace and preserves presentation for reconnection", async () => {
    const root = await mkdtemp(join(tmpdir(), "tinyide-execution-"));
    const otherRoot = await mkdtemp(join(tmpdir(), "tinyide-execution-other-"));
    let activeRoot = root;
    const backend = createExecutionBackend({ workspaceRoot: () => activeRoot });
    let processId: string | undefined;

    try {
      const started = await callBackend<{
        readonly id: string;
        readonly workspaceRoot: string;
        readonly status: string;
        readonly presentation: { readonly sourceId: string; readonly outputPrefix: readonly string[] };
      }>(backend, "POST", "/execution/processes", {
        executable: process.execPath,
        arguments: ["-e", "console.log('ready'); setInterval(() => console.log('tick'), 50)"],
        workingDirectory: root,
        presentation: {
          kind: "profile",
          sourceId: "profile.runserver",
          sourceName: "Django runserver",
          stepId: "runserver",
          stepName: "Run server",
          outputPrefix: ["[perfil] Django runserver", "$ python manage.py runserver"],
        },
      });
      expect(started.status).toBe(201);
      expect(started.body.status).toBe("running");
      expect(started.body.workspaceRoot).toBe(root);
      expect(started.body.presentation.sourceId).toBe("profile.runserver");
      processId = started.body.id;

      const listed = await callBackend<readonly { readonly id: string; readonly status: string }[]>(
        backend,
        "GET",
        "/execution/processes",
      );
      expect(listed.status).toBe(200);
      expect(listed.body).toEqual([expect.objectContaining({ id: processId, status: "running" })]);

      activeRoot = otherRoot;
      const isolatedList = await callBackend<readonly unknown[]>(backend, "GET", "/execution/processes");
      expect(isolatedList.body).toEqual([]);
      const isolatedRead = await callBackend<{ readonly error: string }>(
        backend,
        "GET",
        `/execution/processes/${processId}`,
      );
      expect(isolatedRead.status).toBe(404);

      activeRoot = root;
      let snapshot: { readonly status: string; readonly stdout: string } | undefined;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        snapshot = (await callBackend<{ readonly status: string; readonly stdout: string }>(
          backend,
          "GET",
          `/execution/processes/${processId}`,
        )).body;
        if (snapshot.stdout.includes("ready")) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(snapshot?.stdout).toContain("ready");

      const stopped = await callBackend(backend, "DELETE", `/execution/processes/${processId}`);
      expect(stopped.status).toBe(202);
      for (let attempt = 0; attempt < 50; attempt += 1) {
        snapshot = (await callBackend<{ readonly status: string; readonly stdout: string }>(
          backend,
          "GET",
          `/execution/processes/${processId}`,
        )).body;
        if (snapshot.status === "exited") break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(snapshot?.status).toBe("exited");
    } finally {
      if (processId) {
        activeRoot = root;
        await callBackend(backend, "DELETE", `/execution/processes/${processId}`).catch(() => undefined);
      }
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(otherRoot, { recursive: true, force: true }),
      ]);
    }
  }, 10_000);
});
