const path = require("path");
const { getCostSettings } = require("./pricing");

function buildNotificationTitle(tracker, turn, level) {
  const projectName = projectNameFromCwd(turn?.cwd || tracker.cwd);
  const baseTitle = level === "error" ? "Codex task error" : "Codex task complete";
  return projectName ? `${baseTitle} (${projectName})` : baseTitle;
}

function buildNotificationMessage(payload, turn, tokenUsage, costEstimate) {
  const promptText =
    turn?.userMessage ||
    payload.last_agent_message ||
    turn?.lastAgentMessage ||
    turn?.errorMessage ||
    "Task completed";
  const summary = previewText(promptText, 140);
  const tokenSummary = formatTokenUsage(tokenUsage);
  const includeCostInNotifications = getCostSettings().includeInNotifications;
  const costSummary =
    includeCostInNotifications && costEstimate?.available
      ? formatCostEstimateBrief(costEstimate)
      : "";
  if (costSummary) {
    return `${costSummary} | ${summary}`;
  }

  return tokenSummary ? `${summary} [${tokenSummary}]` : summary;
}

function previewText(value, maxLength) {
  if (typeof value !== "string") {
    return "Task completed";
  }

  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "Task completed";
  }

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatTokenUsage(tokenUsage) {
  if (!tokenUsage || tokenUsage.totalTokens === undefined) {
    return "";
  }

  const parts = [`${formatCompactNumber(tokenUsage.totalTokens)} tok`];
  if (tokenUsage.outputTokens !== undefined) {
    parts.push(`${formatCompactNumber(tokenUsage.outputTokens)} out`);
  }
  if (tokenUsage.inputTokens !== undefined) {
    parts.push(`${formatCompactNumber(tokenUsage.inputTokens)} in`);
  }
  return parts.join(" | ");
}

function formatCompactNumber(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }

  return String(value);
}

function formatCostEstimateBrief(costEstimate) {
  if (!costEstimate || !costEstimate.available) {
    return "";
  }

  if (costEstimate.currency === "USD") {
    return `$${formatTinyDecimal(costEstimate.usdTotal)}`;
  }

  return `${costEstimate.currency} ${formatTinyDecimal(costEstimate.convertedTotal)}`;
}

function formatTinyDecimal(value) {
  if (!Number.isFinite(value)) {
    return "0.000";
  }

  return (Math.round((value + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

function projectNameFromCwd(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) {
    return "";
  }

  const normalized = cwd.replace(/[\\/]+$/, "");
  if (!normalized) {
    return "";
  }

  if (/^[A-Za-z]:/.test(normalized)) {
    return path.win32.basename(normalized);
  }

  return path.posix.basename(normalized);
}

module.exports = {
  buildNotificationMessage,
  buildNotificationTitle,
  projectNameFromCwd
};
