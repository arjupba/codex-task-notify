const crypto = require("crypto");
const path = require("path");
const vscode = require("vscode");

const NO_WORKSPACE_HISTORY_KEY = "workspace:none";

function getCurrentWorkspaceHistoryDescriptor() {
  const folders = vscode.workspace.workspaceFolders || [];
  const workspaceRoots = folders
    .map((folder) => folder?.uri?.toString())
    .filter((entry) => typeof entry === "string" && entry.trim())
    .sort();

  if (!workspaceRoots.length) {
    return {
      key: NO_WORKSPACE_HISTORY_KEY,
      label: "(no workspace)",
      roots: []
    };
  }

  const workspaceNames = folders
    .map((folder) => {
      if (folder && typeof folder.name === "string" && folder.name.trim()) {
        return folder.name.trim();
      }

      return workspaceFolderLabelFromUri(folder?.uri);
    })
    .filter(Boolean)
    .sort();

  return {
    key: `workspace:${crypto.createHash("sha1").update(JSON.stringify(workspaceRoots)).digest("hex")}`,
    label: workspaceNames.join(", "),
    roots: workspaceRoots
  };
}

function workspaceFolderLabelFromUri(uri) {
  if (!uri) {
    return "";
  }

  if (uri.scheme === "file" && uri.fsPath) {
    const trimmed = uri.fsPath.replace(/[\\/]+$/, "");
    return path.basename(trimmed) || trimmed;
  }

  const trimmedPath = typeof uri.path === "string" ? uri.path.replace(/\/+$/, "") : "";
  return path.posix.basename(trimmedPath) || uri.toString();
}

module.exports = {
  getCurrentWorkspaceHistoryDescriptor
};
