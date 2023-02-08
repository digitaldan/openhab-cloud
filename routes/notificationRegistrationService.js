var UserDevice = require('../models/userdevice');
var logger = require('../logger');

/**
 * Registers the Android device of the request to the logged in user, if it is not already registered,
 * otherwise it will be updated.
 *
 * @param req
 * @param res
 */
module.exports = function (req, res) {
    if (!req.query.hasOwnProperty('token') || !req.query.hasOwnProperty('deviceId')) {
        res.send(404, 'Parameters missing');
        return;
    }
    var token = req.query['token'];
    var deviceType = req.query['deviceType'];
    var deviceId = req.query['deviceId'];
    var deviceModel = req.query['deviceModel'];

    // Try to find user device by device Id
    UserDevice.findOne({
        owner: req.user.id,
        deviceType: deviceType,
        deviceId: deviceId
    }, function (error, userDevice) {
        if (error) {
            logger.warn('Error looking up device: ' + error);
            res.send(500, 'Internal server error');
            return;
        }

        if (userDevice) {
            // If found, update the changed registration id
            logger.info('Found a device for user ' + req.user.username + ', updating');
            userDevice.fcmToken = token;
            userDevice.lastUpdate = new Date();
            userDevice.save(function (error) {
                if (error) {
                    logger.error('Error saving user device: ' + error);
                }
            });
            res.send(200, 'Updated');
        } else {
            if (deviceType === 'android') {
                // If not found, try to find device by registration id. Sometimes android devices change their
                // ids dynamically, while google play services continue to return the same registration id
                // so this is still the same device and we don't want any duplicates
                findAndroidDeviceByRegistrationId(req, regId, res, deviceId, deviceModel, deviceType);
            } else {
                registerDevice(req, token, res, deviceId, deviceModel, deviceType);
            }
        }
    });

    var registerDevice = function (req, token, res, deviceId, deviceModel, deviceType) {
        logger.info(`Registering new ${deviceType} device for user ${req.user.username}`);
        const userDevice = new UserDevice({
            owner: req.user.id,
            deviceType: deviceType,
            deviceId: deviceId,
            fcmToken: token,
            deviceModel: deviceModel,
            lastUpdate: new Date(),
            registered: new Date()
        });
        userDevice.save(function (error) {
            if (error) {
                logger.error('Error saving user device: ' + error);
            }
        });
        res.send(200, 'Added');
    }

    /**
     * Tries to find an android device using the registration ID and sets the given deviceId to this UserDevice.
     *
     * @param req
     * @param registrationId
     * @param res
     * @param deviceId
     * @param deviceModel
     */
    var findAndroidDeviceByRegistrationId = function (req, registrationId, res, deviceId, deviceModel, deviceType) {
        var self = this;

        UserDevice.findOne({
            owner: req.user.id,
            deviceType: 'android',
            androidRegistration: registrationId
        },
            function (error, userDevice) {
                if (error) {
                    logger.warn('Error looking up device: ' + error);
                    res.send(500, 'Internal server error');
                    return;
                }
                if (userDevice) {
                    // If found, update the changed device id
                    userDevice.deviceId = deviceId;
                    userDevice.lastUpdate = new Date();
                    userDevice.save(function (error) {
                        if (error) {
                            logger.error('Error saving user device: ' + error);
                        }
                    });
                    res.send(200, 'Updated');
                } else {
                    registerDevice(req, token, res, deviceId, deviceModel, deviceType);
                }
            });
    };
}