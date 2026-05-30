const vscode = require("vscode");

const DEFAULT_TIMEOUT_MS = 10000;

function getNotificationChannelSettings() {
  const config = vscode.workspace.getConfiguration("codexTaskNotify");

  return {
    webhook: {
      enabled: Boolean(config.get("notificationChannels.webhook.enabled", false)),
      url: String(config.get("notificationChannels.webhook.url", "") || "").trim(),
      timeoutMs: normalizeTimeoutMs(config.get("notificationChannels.webhook.timeoutMs", DEFAULT_TIMEOUT_MS)),
      headers: normalizeHeadersMap(config.get("notificationChannels.webhook.headers", {}))
    },
    sound: {
      enabled: Boolean(config.get("notificationChannels.sound.enabled", false)),
      windowsSound: normalizeWindowsSound(config.get("notificationChannels.sound.windowsSound", "Notification.Default"))
    },
    ntfy: {
      enabled: Boolean(config.get("notificationChannels.ntfy.enabled", false)),
      topicUrl: String(config.get("notificationChannels.ntfy.topicUrl", "") || "").trim(),
      accessToken: String(config.get("notificationChannels.ntfy.accessToken", "") || "").trim(),
      priority: normalizePriority(config.get("notificationChannels.ntfy.priority", 3)),
      tags: normalizeCommaSeparatedList(config.get("notificationChannels.ntfy.tags", "computer")),
      timeoutMs: normalizeTimeoutMs(config.get("notificationChannels.ntfy.timeoutMs", DEFAULT_TIMEOUT_MS))
    }
  };
}

function normalizeTimeoutMs(value) {
  return Number.isFinite(value) && value >= 1000 ? Math.round(value) : DEFAULT_TIMEOUT_MS;
}

function normalizePriority(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 3;
  }

  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function normalizeWindowsSound(value) {
  const allowed = new Set([
    "Notification.Default",
    "SystemAsterisk",
    "SystemExclamation",
    "SystemHand"
  ]);

  const normalized = typeof value === "string" ? value.trim() : "";
  if (allowed.has(normalized)) {
    return normalized;
  }

  return "Notification.Default";
}

function normalizeCommaSeparatedList(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(",");
}

function normalizeHeadersMap(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (typeof rawKey !== "string") {
      continue;
    }

    const key = rawKey.trim();
    if (!key || /[\r\n]/.test(key)) {
      continue;
    }

    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    const stringValue = String(rawValue).trim();
    if (!stringValue || /[\r\n]/.test(stringValue)) {
      continue;
    }

    normalized[key] = stringValue;
  }

  return normalized;
}

module.exports = {
  getNotificationChannelSettings
};
