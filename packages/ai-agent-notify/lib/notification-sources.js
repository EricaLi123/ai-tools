"use strict";

const notificationDisplay = require("./notification-source-display");
const notificationParsers = require("./notification-source-parsers");

module.exports = {
  createNotificationSpec: notificationDisplay.createNotificationSpec,
  getIncomingPayloadCandidates: notificationParsers.getIncomingPayloadCandidates,
  getSourceFamily: notificationDisplay.getSourceFamily,
  normalizeIncomingNotification: notificationParsers.normalizeIncomingNotification,
  parseJsonMaybe: notificationParsers.parseJsonMaybe,
};
