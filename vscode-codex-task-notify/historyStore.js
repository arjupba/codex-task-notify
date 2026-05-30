const {
  copyStructuredValue,
  normalizeGlobalHistoryStore,
  normalizeHistoryBucket,
  normalizeNotificationRecord,
  normalizeTimestamp
} = require("./historyRecordNormalizer");
const { getCurrentWorkspaceHistoryDescriptor } = require("./workspaceHistoryDescriptor");

const DEFAULT_MAX_HISTORY_ITEMS = 20;
const RECENT_COMPLETIONS_STATE_KEY = "recentCompletions";
const RECENT_NOTIFICATIONS_STATE_KEY = "recentNotifications";
const GLOBAL_HISTORY_STATE_KEY = "recentHistoryByWorkspace";

function recordRecentNotification(recentNotifications, payload, maxLength = DEFAULT_MAX_HISTORY_ITEMS) {
  const normalized = normalizeNotificationRecord(payload);
  recentNotifications.unshift(normalized);
  if (recentNotifications.length > maxLength) {
    recentNotifications.length = maxLength;
  }
}

function restorePersistedState(context, sessionMonitor, recentNotifications) {
  const historyBucket = readCurrentWorkspaceHistoryBucket(context);

  sessionMonitor.restoreRecentCompletions(historyBucket.recentCompletions);

  recentNotifications.length = 0;
  recentNotifications.push(...historyBucket.recentNotifications);
}

async function persistWorkspaceHistory(
  context,
  sessionMonitor,
  recentNotifications,
  maxLength = DEFAULT_MAX_HISTORY_ITEMS
) {
  const workspaceHistory = getCurrentWorkspaceHistoryDescriptor();
  const store = readGlobalHistoryStore(context, maxLength);
  store.workspaces[workspaceHistory.key] = {
    workspaceLabel: workspaceHistory.label,
    workspaceRoots: workspaceHistory.roots,
    updatedAt: new Date().toISOString(),
    recentCompletions: sessionMonitor.getRecentCompletions().slice(0, maxLength),
    recentNotifications: copyStructuredValue(recentNotifications.slice(0, maxLength))
  };

  await context.globalState.update(GLOBAL_HISTORY_STATE_KEY, store);
}

function readCurrentWorkspaceHistoryBucket(context, maxLength = DEFAULT_MAX_HISTORY_ITEMS) {
  const workspaceHistory = getCurrentWorkspaceHistoryDescriptor();
  const store = readGlobalHistoryStore(context, maxLength);
  const currentBucket = store.workspaces[workspaceHistory.key];
  if (currentBucket) {
    return normalizeHistoryBucket(currentBucket, maxLength);
  }

  return normalizeHistoryBucket(
    {
      workspaceLabel: workspaceHistory.label,
      workspaceRoots: workspaceHistory.roots,
      recentCompletions: context.workspaceState.get(RECENT_COMPLETIONS_STATE_KEY, []),
      recentNotifications: context.workspaceState.get(RECENT_NOTIFICATIONS_STATE_KEY, [])
    },
    maxLength
  );
}

function readGlobalHistoryStore(context, maxLength = DEFAULT_MAX_HISTORY_ITEMS) {
  return normalizeGlobalHistoryStore(context.globalState.get(GLOBAL_HISTORY_STATE_KEY), maxLength);
}

module.exports = {
  DEFAULT_MAX_HISTORY_ITEMS,
  getCurrentWorkspaceHistoryDescriptor,
  normalizeNotificationRecord,
  normalizeTimestamp,
  persistWorkspaceHistory,
  readCurrentWorkspaceHistoryBucket,
  readGlobalHistoryStore,
  recordRecentNotification,
  restorePersistedState
};
