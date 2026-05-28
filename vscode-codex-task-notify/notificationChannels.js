const http = require("http");
const https = require("https");
const { URL } = require("url");
const childProcess = require("child_process");
const path = require("path");
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

async function deliverExternalNotifications(context, payload) {
  const settings = getNotificationChannelSettings();
  return [
    await sendWebhookNotification(payload, settings.webhook),
    await playSoundNotification(context, payload, settings.sound),
    await sendNtfyNotification(payload, settings.ntfy)
  ];
}

async function sendWebhookNotification(payload, settings) {
  if (!settings.enabled) {
    return createSkippedResult("webhook", "disabled");
  }

  if (!settings.url) {
    return createFailedResult("webhook", "missing-url");
  }

  const body = JSON.stringify(createWebhookPayload(payload));
  try {
    const response = await sendHttpRequest(
      settings.url,
      {
        method: "POST",
        timeoutMs: settings.timeoutMs,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...settings.headers
        }
      },
      body
    );

    return createHttpResult("webhook", response);
  } catch (error) {
    return createFailedResult("webhook", formatError(error));
  }
}

async function sendNtfyNotification(payload, settings) {
  if (!settings.enabled) {
    return createSkippedResult("ntfy", "disabled");
  }

  if (!settings.topicUrl) {
    return createFailedResult("ntfy", "missing-topic-url");
  }

  const title = sanitizeAsciiHeader(payload.title, "Codex task complete");
  const message =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : "Task completed";

  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "Title": title,
    "Priority": String(settings.priority)
  };

  if (settings.tags) {
    headers.Tags = settings.tags;
  }

  if (settings.accessToken) {
    headers.Authorization = `Bearer ${settings.accessToken}`;
  }

  try {
    const response = await sendHttpRequest(
      settings.topicUrl,
      {
        method: "POST",
        timeoutMs: settings.timeoutMs,
        headers
      },
      message
    );

    return createHttpResult("ntfy", response);
  } catch (error) {
    return createFailedResult("ntfy", formatError(error));
  }
}

async function playSoundNotification(context, payload, settings) {
  if (!settings.enabled) {
    return createSkippedResult("sound", "disabled");
  }

  if (process.platform !== "win32") {
    return createSkippedResult("sound", "unsupported-platform");
  }

  const scriptPath = path.join(context.extensionPath, "scripts", "sound.ps1");
  const levelMap = {
    info: "Info",
    warning: "Warning",
    warn: "Warning",
    error: "Error"
  };

  return new Promise((resolve) => {
    childProcess.execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Level",
        levelMap[payload.level] || "Info",
        "-Sound",
        settings.windowsSound
      ],
      {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 64
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve(createFailedResult("sound", summarizeProcessError(error, stdout, stderr)));
          return;
        }

        resolve({
          channel: "sound",
          attempted: true,
          delivered: true,
          status: "delivered",
          detail: typeof stdout === "string" ? stdout.trim() : ""
        });
      }
    );
  });
}

function createWebhookPayload(payload) {
  return {
    title: normalizeString(payload.title, "Codex task complete"),
    message: normalizeString(payload.message, "Task completed"),
    level: normalizeString(payload.level, "info"),
    timestamp: normalizeString(payload.timestamp, new Date().toISOString()),
    source: normalizeString(payload.source, "unknown"),
    sessionId: normalizeString(payload.sessionId, ""),
    turnId: normalizeString(payload.turnId, ""),
    projectName: normalizeString(payload.projectName, ""),
    cwd: normalizeString(payload.cwd, ""),
    sessionFile: normalizeString(payload.sessionFile, ""),
    model: normalizeString(payload.model, ""),
    tokenUsage: copyStructuredValue(payload.tokenUsage),
    costEstimate: copyStructuredValue(payload.costEstimate)
  };
}

function sendHttpRequest(urlValue, options, body) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlValue);
    } catch (error) {
      reject(new Error(`invalid-url: ${formatError(error)}`));
      return;
    }

    const client = selectHttpClient(parsedUrl.protocol);
    if (!client) {
      reject(new Error(`unsupported-protocol: ${parsedUrl.protocol || "(empty)"}`));
      return;
    }

    const bodyBuffer = Buffer.from(typeof body === "string" ? body : "", "utf8");
    const headers = {
      ...options.headers,
      "Content-Length": String(bodyBuffer.byteLength)
    };

    const request = client.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method || "POST",
        headers
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: Number.isFinite(response.statusCode) ? response.statusCode : 0,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    request.setTimeout(options.timeoutMs || DEFAULT_TIMEOUT_MS, () => {
      request.destroy(new Error(`timeout-after-${options.timeoutMs || DEFAULT_TIMEOUT_MS}ms`));
    });
    request.on("error", reject);

    if (bodyBuffer.length) {
      request.write(bodyBuffer);
    }
    request.end();
  });
}

function selectHttpClient(protocol) {
  if (protocol === "https:") {
    return https;
  }
  if (protocol === "http:") {
    return http;
  }
  return undefined;
}

function createHttpResult(channel, response) {
  const delivered = response.statusCode >= 200 && response.statusCode < 300;
  const responseBody = truncateValue(response.body, 300);
  return {
    channel,
    attempted: true,
    delivered,
    status: delivered ? "delivered" : "failed",
    statusCode: response.statusCode,
    statusMessage: typeof response.statusMessage === "string" ? response.statusMessage : "",
    responseBody,
    error: delivered
      ? ""
      : response.statusMessage
        ? `http-${response.statusCode} ${response.statusMessage}`
        : `http-${response.statusCode}`,
    detail: responseBody
  };
}

function createSkippedResult(channel, reason) {
  return {
    channel,
    attempted: false,
    delivered: false,
    status: "skipped",
    reason,
    error: ""
  };
}

function createFailedResult(channel, error) {
  return {
    channel,
    attempted: true,
    delivered: false,
    status: "failed",
    error,
    detail: error
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

function sanitizeAsciiHeader(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const singleLine = value.replace(/[\r\n]+/g, " ").trim();
  if (!singleLine) {
    return fallback;
  }

  if (!/^[\x20-\x7E]+$/.test(singleLine)) {
    return fallback;
  }

  return singleLine;
}

function normalizeString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function copyStructuredValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function truncateValue(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function summarizeProcessError(error, stdout, stderr) {
  const parts = [];
  if (error instanceof Error && error.message) {
    parts.push(error.message);
  }
  if (typeof stdout === "string" && stdout.trim()) {
    parts.push(`stdout=${truncateValue(stdout.trim(), 120)}`);
  }
  if (typeof stderr === "string" && stderr.trim()) {
    parts.push(`stderr=${truncateValue(stderr.trim(), 120)}`);
  }
  return parts.join(" | ") || "process-failed";
}

module.exports = {
  deliverExternalNotifications,
  getNotificationChannelSettings
};
