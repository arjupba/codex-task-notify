const { resolveWorkspacePathMatch } = require("./sessionDiscovery");

function normalizeTokenUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object") {
    return undefined;
  }

  const inputTokens = coerceNumber(rawUsage.input_tokens);
  const cachedInputTokens = coerceNumber(rawUsage.cached_input_tokens);
  const outputTokens = coerceNumber(rawUsage.output_tokens);
  const reasoningOutputTokens = coerceNumber(rawUsage.reasoning_output_tokens);
  const totalTokens = coerceNumber(rawUsage.total_tokens);

  if (
    inputTokens === undefined &&
    cachedInputTokens === undefined &&
    outputTokens === undefined &&
    reasoningOutputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens
  };
}

function buildCompletionTokenUsage(currentTotalUsage, previousTotalUsage) {
  if (!currentTotalUsage || currentTotalUsage.totalTokens === undefined) {
    return undefined;
  }

  if (!previousTotalUsage || previousTotalUsage.totalTokens === undefined) {
    return {
      ...copyStructuredValue(currentTotalUsage),
      source: "session-total-initial"
    };
  }

  if (currentTotalUsage.totalTokens < previousTotalUsage.totalTokens) {
    return undefined;
  }

  const tokenUsage = {
    inputTokens: subtractUsageValue(currentTotalUsage.inputTokens, previousTotalUsage.inputTokens),
    cachedInputTokens: subtractUsageValue(
      currentTotalUsage.cachedInputTokens,
      previousTotalUsage.cachedInputTokens
    ),
    outputTokens: subtractUsageValue(currentTotalUsage.outputTokens, previousTotalUsage.outputTokens),
    reasoningOutputTokens: subtractUsageValue(
      currentTotalUsage.reasoningOutputTokens,
      previousTotalUsage.reasoningOutputTokens
    ),
    totalTokens: subtractUsageValue(currentTotalUsage.totalTokens, previousTotalUsage.totalTokens),
    source: "session-total-delta"
  };

  return tokenUsage.totalTokens !== undefined ? tokenUsage : undefined;
}

function subtractUsageValue(currentValue, previousValue) {
  if (currentValue === undefined) {
    return undefined;
  }

  if (previousValue === undefined) {
    return currentValue;
  }

  if (currentValue < previousValue) {
    return undefined;
  }

  return currentValue - previousValue;
}

function normalizeRateLimits(rawRateLimits) {
  if (!rawRateLimits || typeof rawRateLimits !== "object") {
    return undefined;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(rawRateLimits)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      normalized[key] = value;
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        normalized[key] = trimmed;
      }
      continue;
    }

    if (typeof value === "boolean") {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

function coerceNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function normalizeFlexibleTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }

  return normalizeTimestamp(value);
}

function resolveCompletionTimestampMs(completedAt, eventTimestampIso) {
  if (typeof completedAt === "number" && Number.isFinite(completedAt)) {
    return completedAt * 1000;
  }

  if (typeof completedAt === "string" && completedAt.trim()) {
    const parsed = Date.parse(completedAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (eventTimestampIso) {
    const parsed = Date.parse(eventTimestampIso);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function shouldNotifyCompletionFromInitialScan(completedAtMs, notificationStartMs) {
  if (!Number.isFinite(completedAtMs)) {
    return false;
  }

  return completedAtMs >= notificationStartMs;
}

function createRecentCompletion(fields) {
  return {
    id: fields.id,
    title: fields.title,
    message: fields.message,
    level: fields.level,
    source: fields.source,
    completedAtIso: fields.completedAtIso,
    sessionId: fields.sessionId,
    turnId: fields.turnId,
    projectName: fields.projectName,
    cwd: fields.cwd,
    sessionFile: fields.sessionFile,
    userMessage: fields.userMessage,
    lastAgentMessage: fields.lastAgentMessage,
    errorMessage: fields.errorMessage,
    model: fields.model,
    tokenUsage: copyStructuredValue(fields.tokenUsage),
    rateLimits: copyStructuredValue(fields.rateLimits),
    costEstimate: copyStructuredValue(fields.costEstimate)
  };
}

function copyRecentCompletion(completion) {
  return createRecentCompletion(completion);
}

function normalizeRecentCompletionList(items, maxLength) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      if (typeof item.id !== "string" || !item.id.trim()) {
        return undefined;
      }

      const normalized = createRecentCompletion(item);
      return resolveWorkspacePathMatch(normalized.cwd) === true
        ? normalized
        : undefined;
    })
    .filter(Boolean)
    .slice(0, Math.max(0, maxLength));
}

function pushBounded(items, value, maxLength) {
  items.unshift(value);
  if (items.length > maxLength) {
    items.length = maxLength;
  }
}

function copyStructuredValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

module.exports = {
  buildCompletionTokenUsage,
  copyRecentCompletion,
  copyStructuredValue,
  createRecentCompletion,
  formatError,
  normalizeFlexibleTimestamp,
  normalizeRateLimits,
  normalizeRecentCompletionList,
  normalizeTimestamp,
  normalizeTokenUsage,
  pushBounded,
  resolveCompletionTimestampMs,
  shouldNotifyCompletionFromInitialScan
};
