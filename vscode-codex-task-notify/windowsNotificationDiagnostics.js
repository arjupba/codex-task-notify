const fs = require("fs/promises");
const path = require("path");

const DIAGNOSTIC_FILE_NAME = "windows-notification-diagnostics.jsonl";
const MAX_DIAGNOSTIC_LINES = 200;

let writeQueue = Promise.resolve();

function getWindowsNotificationDiagnosticsLogPath(context) {
  const basePath =
    (context && context.globalStorageUri && typeof context.globalStorageUri.fsPath === "string"
      ? context.globalStorageUri.fsPath
      : "") || "";

  if (!basePath.trim()) {
    return "";
  }

  return path.join(basePath, DIAGNOSTIC_FILE_NAME);
}

async function appendWindowsNotificationDiagnostic(context, event) {
  const logPath = getWindowsNotificationDiagnosticsLogPath(context);
  if (!logPath) {
    return;
  }

  const normalized = normalizeDiagnosticEvent(event);
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, `${JSON.stringify(normalized)}\n`, "utf8");
      await trimDiagnosticLog(logPath, MAX_DIAGNOSTIC_LINES);
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[codex-task-notify] Failed to append Windows notification diagnostic", detail);
    });

  await writeQueue;
}

async function readWindowsNotificationDiagnostics(context, maxItems = MAX_DIAGNOSTIC_LINES) {
  const logPath = getWindowsNotificationDiagnosticsLogPath(context);
  if (!logPath) {
    return {
      logPath: "",
      entries: []
    };
  }

  try {
    await writeQueue.catch(() => undefined);
    const text = await fs.readFile(logPath, "utf8");
    const entries = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseDiagnosticLine)
      .filter(Boolean);

    return {
      logPath,
      entries: entries.slice(-Math.max(0, maxItems))
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return {
        logPath,
        entries: []
      };
    }

    const detail = error instanceof Error ? error.message : String(error);
    console.error("[codex-task-notify] Failed to read Windows notification diagnostics", detail);
    return {
      logPath,
      entries: []
    };
  }
}

function normalizeDiagnosticEvent(event) {
  const value = event && typeof event === "object" ? event : {};
  return {
    timestamp: normalizeTimestamp(value.timestamp),
    source: typeof value.source === "string" && value.source.trim() ? value.source.trim() : "extension",
    stage: typeof value.stage === "string" && value.stage.trim() ? value.stage.trim() : "unknown",
    notificationId:
      typeof value.notificationId === "string" && value.notificationId.trim()
        ? value.notificationId.trim()
        : "",
    details: copyStructuredValue(value.details) || {}
  };
}

function parseDiagnosticLine(line) {
  try {
    return normalizeDiagnosticEvent(JSON.parse(line.replace(/^\uFEFF/, "")));
  } catch {
    return undefined;
  }
}

async function trimDiagnosticLog(logPath, maxLines) {
  const normalizedMaxLines = Math.max(1, Number(maxLines) || 1);
  const text = await fs.readFile(logPath, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length <= normalizedMaxLines) {
    return;
  }

  const trimmed = lines.slice(-normalizedMaxLines);
  await fs.writeFile(logPath, `${trimmed.join("\n")}\n`, "utf8");
}

function copyStructuredValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return new Date().toISOString();
  }

  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return new Date().toISOString();
  }

  return new Date(timestampMs).toISOString();
}

module.exports = {
  appendWindowsNotificationDiagnostic,
  getWindowsNotificationDiagnosticsLogPath,
  readWindowsNotificationDiagnostics
};
