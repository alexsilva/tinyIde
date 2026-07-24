const { existsSync } = require("node:fs");
const { realpath } = require("node:fs/promises");
const { dirname, isAbsolute, relative, resolve, sep } = require("node:path");

function isPathInside(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function normalizeWorkspaceRelativePath(workspacePath = "") {
  if (typeof workspacePath !== "string" || workspacePath.includes("\0")) {
    throw new Error("Caminho de workspace inválido.");
  }
  if (isAbsolute(workspacePath)) throw new Error("Use um caminho relativo ao workspace.");
  return workspacePath;
}

async function nearestExistingPath(candidate, root) {
  let current = candidate;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current || !isPathInside(root, parent)) return root;
    current = parent;
  }
  return current;
}

async function safeWorkspacePath(root, workspacePath = "") {
  const normalizedPath = normalizeWorkspaceRelativePath(workspacePath);
  const candidate = resolve(root, normalizedPath);
  if (!isPathInside(root, candidate)) throw new Error("O caminho solicitado está fora do workspace.");

  const existing = await nearestExistingPath(candidate, root);
  const [realRoot, realExisting] = await Promise.all([realpath(root), realpath(existing)]);
  if (!isPathInside(realRoot, realExisting)) {
    throw new Error("O caminho solicitado atravessa um link simbólico fora do workspace.");
  }

  return candidate;
}

function allowedExternalUrl(target) {
  try {
    const protocol = new URL(target).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

function sameOriginUrl(target, trustedUrl) {
  try {
    return new URL(target).origin === new URL(trustedUrl).origin;
  } catch {
    return false;
  }
}

module.exports = {
  allowedExternalUrl,
  isPathInside,
  normalizeWorkspaceRelativePath,
  safeWorkspacePath,
  sameOriginUrl,
};
