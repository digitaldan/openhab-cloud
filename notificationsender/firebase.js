const system = require('../system');
const logger = require('../logger.js');
const firebase = require('firebase-admin');
//need to move to system config, make optional
const serviceAccount = require("../certs/serviceAccountKey.json");
//remove databaseURL ???
//need to move to system config
firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount)
});

const messagingOptions = {
    priority: 'high'
};

function sendNotificationWithData(registrationIds, data) {
    logger.info(`Sending ${registrationIds} with data ${data}`)
    redis.incr("androidNotificationId", function (error, androidNotificationId) {
        if (error) {
            return;
        }

        data.type = 'notification';
        data.notificationId = androidNotificationId.toString();
        firebase.messaging().sendToDevice(registrationIds, {data: data}, messagingOptions)
            .then((response) => {
                logger.info("Response: " + JSON.stringify(response));
            })
            .catch(error => {
                logger.error("GCM send error: ", error);
            });
    });
};

exports.sendMessageNotification = function (registrationIds, message) {
    var data = {
        message: message,
        timestamp: Date.now().toString()
    };
    sendNotificationWithData(registrationIds, data);
};

exports.sendNotification = function (registrationIds, notification) {
    var data = {
        message: notification.message,
        severity: notification.severity,
        icon: notification.icon,
        persistedId: notification._id.toString(),
        timestamp: notification.created.getTime().toString()
    };
    sendNotificationWithData(registrationIds, data);
};

exports.hideNotification = function (registrationIds, notificationId) {
    const data = {
        type: 'hideNotification',
        notificationId: notificationId.toString()
    };
    firebase.messaging().sendToDevice(registrationIds, {data: data}, messagingOptions)
        .catch(error => {
            logger.error("GCM send error: ", error);
        });
};
