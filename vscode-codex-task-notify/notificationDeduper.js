const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const NOTIFICATION_DEDUPE_DIR_NAME = "notification-dedupe";
const NOTIFICATION_DEDUPE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

async function claimNotificationDelivery(context, payload) {
  const dedupeKey = buildNotificationDedupeKey(payload);
  if (!dedupeKey) {
    return true;
  }

  const dedupeDir = getNotificationDedupeDir(context);
  const claimFileName = `${crypto.createHash("sha1").update(dedupeKey).digest("hex")}.json`;
  const claimPath = path.join(dedupeDir, claimFileName);

  try {
    await fs.mkdir(dedupeDir, { recursive: true });
    void pruneNotificationClaims(dedupeDir);
    await fs.writeFile(
      claimPath,
      JSON.stringify(
        {
          key: dedupeKey,
          id: typeof payload.id === "string" ? payload.id : "",
          source: typeof payload.source === "string" ? payload.source : "",
          title: typeof payload.title === "string" ? payload.title : "",
          timestamp: normalizeTimestamp(payload.timestamp) || new Date().toISOString()
        },
        null,
        2
      ),
      { encoding: "utf8", flag: "wx" }
    );
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      console.log("[codex-task-notify] Skipped duplicate notification", dedupeKey);
      return false;
    }

    console.error("[codex-task-notify] Failed to claim notification delivery", error);
    return true;
  }
}

function buildNotificationDedupeKey(payload) {
  if (payload && typeof payload === "object") {
    if (typeof payload.sessionId === "string" && payload.sessionId &&
        typeof payload.turnId === "string" && payload.turnId) {
      return `session:${payload.sessionId}:${payload.turnId}`;
    }

    if (typeof payload.id === "string" && payload.id.trim()) {
      return `id:${payload.id.trim()}`;
    }

    const eventFile = typeof payload.eventFile === "string" ? payload.eventFile.trim() : "";
    const timestamp = normalizeTimestamp(payload.timestamp) || normalizeTimestamp(payload.createdAt);
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (eventFile && timestamp && message) {
      return `event:${eventFile}:${timestamp}:${message}`;
    }
  }

  return "";
}

function getNotificationDedupeDir(context) {
  if (context.globalStorageUri && context.globalStorageUri.scheme === "file") {
    return path.join(context.globalStorageUri.fsPath, NOTIFICATION_DEDUPE_DIR_NAME);
  }

  return path.join(os.tmpdir(), "codex-task-notify", NOTIFICATION_DEDUPE_DIR_NAME);
}

async function pruneNotificationClaims(dedupeDir) {
  try {
    const entries = await fs.readdir(dedupeDir, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(dedupeDir, entry.name);
          try {
            const stat = await fs.stat(filePath);
            if (now - stat.mtimeMs > NOTIFICATION_DEDUPE_MAX_AGE_MS) {
              await fs.unlink(filePath);
            }
          } catch {
            // Ignore races with other windows pruning the same old claim file.
          }
        })
    );
  } catch {
    // Ignore cleanup failures so notification delivery is not blocked.
  }
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

module.exports = {
  claimNotificationDelivery,
  getNotificationDedupeDir
};
