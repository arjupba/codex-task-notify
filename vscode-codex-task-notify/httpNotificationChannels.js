const { sendNtfyNotification } = require("./ntfyNotificationChannel");
const { sendWebhookNotification } = require("./webhookNotificationChannel");

module.exports = {
  sendNtfyNotification,
  sendWebhookNotification
};
