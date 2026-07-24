import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import security from "./security.cjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "tinyide-security-"));
  temporaryDirectories.push(path);
  return path;
}

describe("desktop security", () => {
  it("accepts only explicitly supported external URL protocols", () => {
    expect(security.allowedExternalUrl("https://example.com/docs")).toBe(true);
    expect(security.allowedExternalUrl("http://localhost:5173")).toBe(true);
    expect(security.allowedExternalUrl("mailto:team@example.com")).toBe(true);
    expect(security.allowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(security.allowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(security.allowedExternalUrl("not a url")).toBe(false);
  });

  it("compares trusted navigation by exact origin", () => {
    expect(security.sameOriginUrl("http://127.0.0.1:42000/workspace", "http://127.0.0.1:42000")).toBe(true);
    expect(security.sameOriginUrl("http://127.0.0.1:42000.evil.example", "http://127.0.0.1:42000")).toBe(false);
    expect(security.sameOriginUrl("https://example.com", "http://127.0.0.1:42000")).toBe(false);
    expect(security.sameOriginUrl("invalid", "http://127.0.0.1:42000")).toBe(false);
  });

  it("rejects absolute paths, traversal and null bytes", () => {
    expect(() => security.normalizeWorkspaceRelativePath("/etc/passwd")).toThrow("caminho relativo");
    expect(() => security.normalizeWorkspaceRelativePath("file\0.txt")).toThrow("inválido");
    expect(security.normalizeWorkspaceRelativePath("src/main.ts")).toBe("src/main.ts");
  });

  it("keeps existing and newly created resources inside the workspace", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "export {};");

    await expect(security.safeWorkspacePath(root, "src/main.ts")).resolves.toBe(join(root, "src", "main.ts"));
    await expect(security.safeWorkspacePath(root, "src/new.ts")).resolves.toBe(join(root, "src", "new.ts"));
    await expect(security.safeWorkspacePath(root, "../outside.txt")).rejects.toThrow("fora do workspace");
  });

  it("blocks symbolic links that escape the workspace", async () => {
    const base = await temporaryDirectory();
    const root = join(base, "workspace");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(outside, join(root, "linked"));

    await expect(security.safeWorkspacePath(root, "linked/secret.txt"))
      .rejects.toThrow("link simbólico fora do workspace");
    await expect(security.safeWorkspacePath(root, "linked/new.txt"))
      .rejects.toThrow("link simbólico fora do workspace");
  });

  it("allows symbolic links whose resolved target remains inside the workspace", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "main.ts"), "export {};");
    await symlink(source, join(root, "linked"));

    await expect(security.safeWorkspacePath(root, "linked/main.ts"))
      .resolves.toBe(join(root, "linked", "main.ts"));
  });

  it("rejects invalid workspace path types", () => {
    expect(() => security.normalizeWorkspaceRelativePath(42)).toThrow("inválido");
  });
});
