const os = require("os");
const path = require("path");
const vscode = require("vscode");

const DEFAULT_SESSION_POLL_MS = 1500;
const DEFAULT_SESSION_LOOKBACK_DAYS = 7;
const DEFAULT_SESSION_SEGMENTS = [".codex", "sessions"];
const REMOTE_HOME_CANDIDATE_ROOTS = ["/home", "/Users"];

async function resolveSessionsRootUri() {
  const configuredRoot = String(vscode.workspace.getConfiguration("codexTaskNotify").get("sessionsRoot", "") || "").trim();
  if (configuredRoot) {
    return resolveConfiguredSessionsRootUri(configuredRoot);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder && workspaceFolder.uri.scheme !== "file") {
    return resolveRemoteSessionsRootUri(workspaceFolder.uri);
  }

  return vscode.Uri.file(path.join(os.homedir(), ...DEFAULT_SESSION_SEGMENTS));
}

async function resolveConfiguredSessionsRootUri(configuredRoot) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder && workspaceFolder.uri.scheme !== "file") {
    if (configuredRoot.startsWith("~")) {
      const remoteHomeUri = await resolveRemoteHomeUri(workspaceFolder.uri);
      if (!remoteHomeUri) {
        return undefined;
      }

      const relativeSegments = splitPathSegments(configuredRoot.slice(1));
      return relativeSegments.length
        ? vscode.Uri.joinPath(remoteHomeUri, ...relativeSegments)
        : remoteHomeUri;
    }

    if (isPosixAbsolutePath(configuredRoot)) {
      return workspaceFolder.uri.with({ path: normalizePosixPath(configuredRoot) });
    }

    return vscode.Uri.joinPath(workspaceFolder.uri, ...splitPathSegments(configuredRoot));
  }

  if (configuredRoot.startsWith("~")) {
    return vscode.Uri.file(path.join(os.homedir(), configuredRoot.slice(1)));
  }

  if (path.isAbsolute(configuredRoot)) {
    return vscode.Uri.file(configuredRoot);
  }

  if (workspaceFolder && workspaceFolder.uri.scheme === "file") {
    return vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, configuredRoot));
  }

  return vscode.Uri.file(path.resolve(configuredRoot));
}

async function resolveRemoteSessionsRootUri(referenceUri) {
  const directHomeUri = await resolveRemoteHomeUri(referenceUri);
  if (directHomeUri) {
    return vscode.Uri.joinPath(directHomeUri, ...DEFAULT_SESSION_SEGMENTS);
  }

  return undefined;
}

async function resolveRemoteHomeUri(referenceUri) {
  const candidatePaths = new Set();
  const inferredHomePath = inferHomePathFromWorkspace(referenceUri.path);
  if (inferredHomePath) {
    candidatePaths.add(inferredHomePath);
  }

  candidatePaths.add("/root");

  for (const basePath of REMOTE_HOME_CANDIDATE_ROOTS) {
    const baseUri = referenceUri.with({ path: normalizePosixPath(basePath) });
    const entries = await readDirectorySafe(baseUri);
    for (const [name, type] of entries) {
      if ((type & vscode.FileType.Directory) === 0) {
        continue;
      }

      candidatePaths.add(normalizePosixPath(path.posix.join(basePath, name)));
    }
  }

  for (const candidatePath of candidatePaths) {
    const candidateHomeUri = referenceUri.with({ path: normalizePosixPath(candidatePath) });
    const sessionsUri = vscode.Uri.joinPath(candidateHomeUri, ...DEFAULT_SESSION_SEGMENTS);
    if (await directoryExists(sessionsUri)) {
      return candidateHomeUri;
    }
  }

  return undefined;
}

function inferHomePathFromWorkspace(workspacePath) {
  if (!workspacePath) {
    return undefined;
  }

  const homeMatch = workspacePath.match(/^\/(home|Users)\/([^/]+)/);
  if (homeMatch) {
    return `/${homeMatch[1]}/${homeMatch[2]}`;
  }

  if (workspacePath === "/root" || workspacePath.startsWith("/root/")) {
    return "/root";
  }

  return undefined;
}

async function collectRecentSessionFiles(sessionsRootUri, lookbackDays) {
  const files = new Map();
  for (let dayOffset = 0; dayOffset < lookbackDays; dayOffset += 1) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - dayOffset);

    const directoryUri = vscode.Uri.joinPath(
      sessionsRootUri,
      String(targetDate.getFullYear()),
      String(targetDate.getMonth() + 1).padStart(2, "0"),
      String(targetDate.getDate()).padStart(2, "0")
    );

    for (const fileUri of await collectJsonlFiles(directoryUri)) {
      files.set(fileUri.toString(), fileUri);
    }
  }

  return Array.from(files.values()).sort((left, right) => left.toString().localeCompare(right.toString()));
}

async function collectJsonlFiles(directoryUri) {
  const files = [];
  const entries = await readDirectorySafe(directoryUri);
  for (const [name, type] of entries) {
    const childUri = vscode.Uri.joinPath(directoryUri, name);
    if ((type & vscode.FileType.Directory) !== 0) {
      files.push(...await collectJsonlFiles(childUri));
      continue;
    }

    if ((type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith(".jsonl")) {
      files.push(childUri);
    }
  }

  return files;
}

async function readDirectorySafe(directoryUri) {
  try {
    return await vscode.workspace.fs.readDirectory(directoryUri);
  } catch {
    return [];
  }
}

async function directoryExists(uri) {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

function splitPathSegments(rawPath) {
  return rawPath.split(/[\\/]+/).filter(Boolean);
}

function isPosixAbsolutePath(rawPath) {
  return rawPath.startsWith("/");
}

function normalizePosixPath(rawPath) {
  return rawPath.replace(/\\/g, "/");
}

function inferSessionIdFromUri(uri) {
  const match = uri.path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl)?$/i);
  return match ? match[1] : path.basename(uri.path, path.extname(uri.path));
}

function getSessionPollMs() {
  const rawValue = Number(vscode.workspace.getConfiguration("codexTaskNotify").get("sessionPollMs", DEFAULT_SESSION_POLL_MS));
  return Number.isFinite(rawValue) ? Math.max(500, rawValue) : DEFAULT_SESSION_POLL_MS;
}

function getSessionLookbackDays() {
  const rawValue = Number(vscode.workspace.getConfiguration("codexTaskNotify").get("sessionLookbackDays", DEFAULT_SESSION_LOOKBACK_DAYS));
  return Number.isFinite(rawValue) ? Math.max(1, Math.min(7, Math.floor(rawValue))) : DEFAULT_SESSION_LOOKBACK_DAYS;
}

function isFileMissing(error) {
  return Boolean(error && typeof error === "object" && error.code === "FileNotFound");
}

module.exports = {
  collectRecentSessionFiles,
  getSessionLookbackDays,
  getSessionPollMs,
  inferSessionIdFromUri,
  isFileMissing,
  resolveSessionsRootUri
};
