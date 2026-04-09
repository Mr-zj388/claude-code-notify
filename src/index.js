const { sendNotification, EVENT_CONFIG } = require("./notify");
const { setup, uninstall } = require("./setup");

module.exports = { sendNotification, EVENT_CONFIG, setup, uninstall };
