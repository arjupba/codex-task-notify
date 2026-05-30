const vscode = require("vscode");
const { getNotificationChannelSettings } = require("./notificationChannels");
const {
  formatCostEstimate,
  getBuiltInPricingReference,
  getCostSettings
} = require("./pricing");

function appendHistoryEntry(output, completion) {
  output.appendLine(`- ${formatDisplayTimestamp(completion.completedAtIso || completion.timestamp, "(unknown time)")} | ${completion.title}`);
  output.appendLine(`  source: ${completion.source || "unknown"} | level: ${completion.level || "info"}`);

  if (completion.projectName) {
    output.appendLine(`  project: ${completion.projectName}`);
  }
  if (completion.sessionId) {
    output.appendLine(`  session: ${completion.sessionId}`);
  }
  if (completion.turnId) {
    output.appendLine(`  turn: ${completion.turnId}`);
  }
  if (completion.sessionFile) {
    output.appendLine(`  file: ${completion.sessionFile}`);
  }

  output.appendLine(`  message: ${completion.message || "(none)"}`);

  const tokenSummary = formatTokenUsageSummary(completion.tokenUsage);
  if (tokenSummary) {
    output.appendLine(`  tokens: ${tokenSummary}`);
  }

  if (completion.model) {
    output.appendLine(`  model: ${completion.model}`);
  }

  const costSummary = formatCostSummary(completion.costEstimate);
  if (costSummary) {
    output.appendLine(`  cost: ${costSummary}`);
  }

  const deliverySummary = formatDeliverySummary(completion.delivery);
  if (deliverySummary) {
    output.appendLine(`  delivery: ${deliverySummary}`);
    const deliveryFailure = formatDeliveryFailureDetail(completion.delivery);
    if (deliveryFailure) {
      output.appendLine(`  deliveryDetail: ${deliveryFailure}`);
    }
  }

  if (completion.errorMessage) {
    output.appendLine(`  error: ${completion.errorMessage}`);
  }
}

function formatTokenUsageSummary(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== "object") {
    return "";
  }

  const parts = [];
  if (typeof tokenUsage.totalTokens === "number") {
    parts.push(`total=${tokenUsage.totalTokens}`);
  }
  if (typeof tokenUsage.outputTokens === "number") {
    parts.push(`output=${tokenUsage.outputTokens}`);
  }
  if (typeof tokenUsage.inputTokens === "number") {
    parts.push(`input=${tokenUsage.inputTokens}`);
  }
  if (typeof tokenUsage.cachedInputTokens === "number") {
    parts.push(`cached=${tokenUsage.cachedInputTokens}`);
  }
  if (typeof tokenUsage.reasoningOutputTokens === "number") {
    parts.push(`reasoning=${tokenUsage.reasoningOutputTokens}`);
  }
  return parts.join(", ");
}

function appendCostDiagnostics(output, completion) {
  const settings = getCostSettings();
  const notificationSettings = getNotificationChannelSettings();
  output.appendLine("");
  output.appendLine("Cost estimation:");
  output.appendLine(`  enabled: ${settings.enabled}`);
  output.appendLine(`  currency: ${settings.outputCurrency}`);
  output.appendLine(`  exchangeRate: ${settings.exchangeRate}`);
  output.appendLine(`  builtInOpenAI: ${settings.useBuiltInOpenAIPricing}`);
  output.appendLine(`  includeInNotifications: ${settings.includeInNotifications}`);
  output.appendLine(`  customModels: ${Object.keys(settings.customModelPricing).length}`);

  const builtInReference = getBuiltInPricingReference();
  output.appendLine(`  builtInReferenceVerifiedAt: ${builtInReference.verifiedAt}`);
  output.appendLine(`  builtInReferenceSources: ${builtInReference.sourceUrls.join(", ")}`);

  if (completion?.costEstimate?.available) {
    output.appendLine(`  latestCost: ${formatCostSummary(completion.costEstimate)}`);
  } else {
    const reason = completion?.costEstimate?.reason || "missing-or-disabled";
    output.appendLine(`  latestCost: (unavailable: ${reason})`);
  }

  output.appendLine("");
  output.appendLine("External notifications:");
  output.appendLine(`  webhookEnabled: ${notificationSettings.webhook.enabled}`);
  output.appendLine(`  webhookUrl: ${notificationSettings.webhook.url || "(none)"}`);
  output.appendLine(`  soundEnabled: ${notificationSettings.sound.enabled}`);
  output.appendLine(`  sound: ${notificationSettings.sound.windowsSound}`);
  output.appendLine(`  ntfyEnabled: ${notificationSettings.ntfy.enabled}`);
  output.appendLine(`  ntfyTopicUrl: ${notificationSettings.ntfy.topicUrl || "(none)"}`);
  output.appendLine(`  ntfyPriority: ${notificationSettings.ntfy.priority}`);
  output.appendLine(`  ntfyTags: ${notificationSettings.ntfy.tags || "(none)"}`);

  const deliverySummary = formatDeliverySummary(completion?.delivery);
  output.appendLine(`  latestDelivery: ${deliverySummary || "(none)"}`);
}

function formatCostSummary(costEstimate) {
  if (!costEstimate || !costEstimate.available) {
    return "";
  }

  return formatCostEstimate(costEstimate, { includeUsd: true, includeSource: false });
}

function formatDeliverySummary(delivery) {
  if (!Array.isArray(delivery) || !delivery.length) {
    return "";
  }

  return delivery
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }

      const channel = typeof entry.channel === "string" ? entry.channel : "unknown";
      const status = typeof entry.status === "string" ? entry.status : "unknown";
      if (status === "delivered" && Number.isFinite(entry.statusCode)) {
        return `${channel}=ok(${entry.statusCode})`;
      }
      if (status === "failed") {
        return `${channel}=failed(${entry.error || "error"})`;
      }
      if (status === "skipped") {
        return `${channel}=skipped(${entry.reason || "disabled"})`;
      }
      return `${channel}=${status}`;
    })
    .filter(Boolean)
    .join(", ");
}

function formatDeliveryFailureDetail(delivery) {
  if (!Array.isArray(delivery) || !delivery.length) {
    return "";
  }

  const failures = delivery.filter((entry) => entry && entry.delivered === false && entry.status !== "skipped");
  if (!failures.length) {
    return "";
  }

  return failures
    .map((entry) => {
      const channel = typeof entry.channel === "string" ? entry.channel : "unknown";
      const reason = entry.reason || entry.error || entry.detail || "failed";
      return `${channel}:${reason}`;
    })
    .join(" | ");
}

function buildRecentEventList(diagnostics, completions, notifications) {
  const events = [];
  if (diagnostics?.latestCompletion) {
    events.push({
      at: formatDisplayTimestamp(diagnostics.latestCompletion.completedAtIso || diagnostics.lastNotificationAtIso || diagnostics.lastTaskCompleteAtIso, "(unknown)"),
      type: "latestCompletion",
      summary: diagnostics.latestCompletion.title || diagnostics.latestCompletion.message || "(none)",
      data: diagnostics.latestCompletion
    });
  }

  if (Array.isArray(completions)) {
    for (const completion of completions.slice(-5)) {
      events.push({
        at: formatDisplayTimestamp(completion.completedAtIso || completion.timestamp, "(unknown)"),
        type: "completion",
        summary: completion.title || completion.message || "(none)",
        data: completion
      });
    }
  }

  if (Array.isArray(notifications)) {
    for (const notification of notifications.slice(-5)) {
      events.push({
        at: formatDisplayTimestamp(notification.timestamp, "(unknown)"),
        type: "notification",
        summary: notification.title || notification.message || "(none)",
        data: notification
      });
    }
  }

  return events.reverse();
}

function getChronologicalEntries(entries) {
  return Array.isArray(entries) ? [...entries].reverse() : [];
}

function formatTinyDecimal(value) {
  if (!Number.isFinite(value)) {
    return "0.000";
  }

  return (Math.round((value + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

function getOutputChannel() {
  if (!getOutputChannel.channel) {
    getOutputChannel.channel = vscode.window.createOutputChannel("Codex Task Notify");
  }

  return getOutputChannel.channel;
}

function formatDisplayTimestamp(value, fallback = "(none)") {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return value;
  }

  return new Date(timestampMs).toLocaleString();
}

module.exports = {
  appendCostDiagnostics,
  appendHistoryEntry,
  buildRecentEventList,
  formatCostSummary,
  formatDisplayTimestamp,
  formatTinyDecimal,
  formatTokenUsageSummary,
  getChronologicalEntries,
  getOutputChannel
};
