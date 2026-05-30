const {
  createFailedResult,
  createHttpResult,
  createSkippedResult,
  sendHttpRequest
} = require("./httpRequestClient");

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

function normalizeString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function copyStructuredValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

module.exports = {
  sendWebhookNotification
};
