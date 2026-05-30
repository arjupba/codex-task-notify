const { sendNtfyNotification, sendWebhookNotification } = require("./httpNotificationChannels");
const { getNotificationChannelSettings } = require("./notificationChannelSettings");
const { playSoundNotification } = require("./soundNotificationChannel");

async function deliverExternalNotifications(context, payload) {
  const settings = getNotificationChannelSettings();
  return [
    await sendWebhookNotification(payload, settings.webhook),
    await playSoundNotification(context, payload, settings.sound),
    await sendNtfyNotification(payload, settings.ntfy)
  ];
}

module.exports = {
  deliverExternalNotifications,
  getNotificationChannelSettings
};
