const vscode = require("vscode");

function resolveWorkspacePathMatch(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) {
    return undefined;
  }

  const normalizedCwd = normalizeComparablePath(cwd);
  if (!normalizedCwd) {
    return undefined;
  }

  const workspaceRoots = getCurrentWorkspaceRoots();
  if (!workspaceRoots.length) {
    return undefined;
  }

  return workspaceRoots.some(
    (workspaceRoot) =>
      isSameOrContainedPath(workspaceRoot, normalizedCwd) ||
      isSameOrContainedPath(normalizedCwd, workspaceRoot)
  );
}

function getCurrentWorkspaceRoots() {
  return (vscode.workspace.workspaceFolders || [])
    .map((folder) => {
      if (!folder || !folder.uri) {
        return "";
      }

      if (folder.uri.scheme === "file") {
        return normalizeComparablePath(folder.uri.fsPath);
      }

      return normalizeComparablePath(folder.uri.path);
    })
    .filter(Boolean);
}

function normalizeComparablePath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return "";
  }

  let normalized = rawPath.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, "");
  }

  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function isSameOrContainedPath(basePath, candidatePath) {
  if (!basePath || !candidatePath) {
    return false;
  }

  return basePath === candidatePath || candidatePath.startsWith(`${basePath}/`);
}

module.exports = {
  resolveWorkspacePathMatch
};
