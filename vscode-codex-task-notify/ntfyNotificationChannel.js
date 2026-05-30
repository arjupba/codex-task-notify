const {
  createFailedResult,
  createHttpResult,
  createSkippedResult,
  sendHttpRequest
} = require("./httpRequestClient");

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
    Title: title,
    Priority: String(settings.priority)
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

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

module.exports = {
  sendNtfyNotification
};
