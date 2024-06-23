var Notification = require('../models/notification');
var UserDevice = require('../models/userdevice');
var logger = require('../logger');
var system = require('../system');
var firebase = require('../notificationsender/firebase');

exports.notificationsget = function (req, res) {
    var limit = req.query.limit > 0 ? parseInt(req.query.limit) : 10,
        skip = req.query.skip > 0 ? parseInt(req.query.skip) : 0;
    Notification.find({ user: req.user.id }, '-user')
        .limit(limit)
        .skip(skip)
        .sort({ created: 'desc' })
        .exec(function (error, notifications) {
            if (!error) {
                res.status(200).json(notifications);
            } else {
                return res.status(500).json({
                    errors: [{
                        message: "Error getting notifications"
                    }]
                });
            }
        });
};

exports.notificationssettingsget = function (req, res) {
    var config = {};
    if (system.isGcmConfigured()) {
        config.gcm = {
            "senderId": system.getGcmSenderId()
        };
    }
    res.status(200).json(config);
};

exports.hidenotification = function (req, res) {
    const persistedId = req.params.id;
    const deviceId = req.query['deviceId']; //optional
    if (!persistedId) {
        return res.status(400).json({
            errors: [{
                message: "Invalid request"
            }]
        });
    }
    UserDevice.find({ owner: req.user.id }, function (error, userDevices) {
        const registrationIds = [];
        for (const uDevice of userDevices) {
            // Skip the device which sent notification hide itself
            if (uDevice.deviceId !== deviceId && uDevice.fcmRegistration) {
                registrationIds.push(uDevice.fcmRegistration);
            }
        }
        if (registrationIds.length > 0) {
            logger.debug(`Hiding notification ${persistedId} on device ${deviceId} to ${JSON.stringify(registrationIds)}`);
            firebase.hideNotification(registrationIds, persistedId);
        }
        return res.status(200).json({});
    });
}
 
exports.proxyurlget = function (req, res) {
    res.status(200).json({
        'url': system.getProxyURL()
    });
};

exports.appids = function (req, res) {
    res.status(200).json({
        'ios': system.getAppleId(),
        'android': system.getAndroidId()
    });
}; 

//TODO this is copied from socket-io.js, so either consolidate this , or remove when finished testing
exports.sendnotification = function (req, res) {
    const data = req.body
    logger.debug(`sendNotificationToUser ${JSON.stringify(data)}`);

    var fcmRegistrations = [];
    var iosDeviceTokens = [];
    var newNotification = new Notification({
        user: req.user.id,
        message: data.message,
        icon: data.icon,
        severity: data.severity
    });
    newNotification.save(function (error) {
        if (error) {
            logger.error('Error saving notification: %s', error);
            return res.status(400).json({
                errors: [{
                    message: "Error saving notification"
                }]
            });
        }
    });
    UserDevice.find({
        owner: req.user.id
    }, function (error, userDevices) {
        if (error) {
            logger.warn('Error fetching devices for user: %s', error);
            return res.status(400).json({
                errors: [{
                    message: "Error fetching devices for user"
                }]
            });
        }
        if (!userDevices) {
            // User don't have any registered devices, so we will skip it.
            return res.status(400).json({
                errors: [{
                    message: "No registered devices"
                }]
            });
        }

        for (var i = 0; i < userDevices.length; i++) {
            if (userDevices[i].fcmRegistration) {
                fcmRegistrations.push(userDevices[i].fcmRegistration);
            } else if (userDevices[i].deviceType === 'ios') {
                iosDeviceTokens.push(userDevices[i].iosDeviceToken);
            }
        }
        // If we found any FCM devices, send notification
        if (fcmRegistrations.length > 0) {
            firebase.sendNotification(fcmRegistrations, newNotification._id, data);
        }
        return res.status(200).json({});
    });
}