/*
    Here we have routes for IFTTT integration API
 */

var passport = require('passport');
var Openhab = require('../models/openhab');
var Item = require('../models/item');
var Event = require('../models/event');
var app = require('../app');
var system = require('../system');
var redis = require('../redis-helper');
var logger = require('../logger');

// IFTTT openHAB channel key
var iftttChannelKey = app.config.ifttt.iftttChannelKey
// IFTTT access token for testing the API
var iftttTestToken = app.config.ifttt.iftttTestToken

function ensureIFTTTChannelKey(req, res, next) {
    if (!req.headers.hasOwnProperty('ifttt-channel-key')) {
        res.status(401).send('Bad request');
    } else if (req.headers['ifttt-channel-key'] != iftttChannelKey) {
        res.status(401).send('Bad request');
    } else {
        return next();
    }
}

/*
    This function provides passport authentication through bearer strategy with JSON
    error responses which are required by IFTTT.
    TODO: Check if token we got has 'ifttt' scope allowed by user
 */

function iftttAuthenticate(req, res, next) {
    passport.authenticate('bearer', { session: false }, function (error, user, info) {
        if (error) {
            return res.status(401).json({ errors: [{ message: error }] });
        }
        if (!user) {
            return res.status(401).json({ errors: [{ message: "Authentication failed" }] });
        }
        req.logIn(user, function (error) {
            if (error) {
                return res.status(401).json({ errors: [{ message: error }] });
            }
            return next();
        });
    })(req, res, next);
}

/*
    user info API endpoint, called by IFTTT after user successfully authorizes IFTTT access at myopenhab.org
    provides IFTTT with some basic information about user like username and account page
 */
exports.userinfo = [
    iftttAuthenticate,
    function (req, res) {
        res.json({ data: { name: req.user.username, id: req.user._id, url: system.getBaseURL() + "/account" } });
    }
]

/*
    API status endpoint which is periodically called by IFTTT to check if myopenhab.org is up and running
    This endpoint checks if a valid IFTTT channel key was provided
 */
exports.v1status = [
    ensureIFTTTChannelKey,
    function (req, res) {
        res.send("service OK");
    }
]

/*
    A testing endpoint which is called by IFTTT prior to running an API test series
    This endpoint provides information needed by IFTTT for testing our API
 */

exports.v1testsetup = [
    ensureIFTTTChannelKey,
    function (req, res) {
        responseJson = {
            data: {
                accessToken: iftttTestToken,
                samples: {
                    triggers: {
                        itemstate: {
                            item: "Light_GF_Kitchen_Table",
                            status: "ON"
                        },
                        item_raised_above: {
                            item: "Temperature",
                            value: "19"
                        },
                        item_dropped_below: {
                            item: "Temperature",
                            value: "19"
                        }
                    },
                    actions: {
                        command: {
                            item: "DemoSwitch",
                            command: "ON"
                        }
                    }
                }
            }
        };
        res.json(responseJson);
    }
]

/*
    This series of endpoints are called when IFTTT submits an action to openHAB-cloud
    /ifttt/v1/actions/*
*/

/*
    v1actioncommand is called by IFTTT when it performs and action to send a command to an item
 */

exports.v1actioncommand = [
    iftttAuthenticate,
    function (req, res) {
        if (!req.body.actionFields) {
            return res.status(400).json({ errors: [{ message: "No actionfields" }] });
        }
        if (!req.body.actionFields.item || !req.body.actionFields.command) {
            return res.status(400).json({ errors: [{ message: "Actionfields incomplete" }] });
        }
        Openhab.findOne({ account: req.user.account }, function (error, openhab) {
            // If we can't find user's openHAB or request doesnt have action fields in body we can't serve this
            if (error || !openhab) {
                return res.status(400).json({ errors: [{ message: "Request failed" }] });
            }
            // If OH lives on another server, redirect to that internally (nginx)
            if (openhab.serverAddress != system.getInternalAddress()) {
                return res.redirect(302, 'http://' + openhab.serverAddress + req.path);
            }
            app.sio.sockets.in(openhab.uuid).emit('command', { item: req.body.actionFields.item, command: req.body.actionFields.command });
            return res.json({ data: [{ id: "12345" }] });
        });
    }
]

/*
    v1actioncommanditemoptions provides IFTTT with a list of possible Items for the command action
 */

exports.v1actioncommanditemoptions = [
    iftttAuthenticate,
    function (req, res) {
        Openhab.findOne({ account: req.user.account }, function (error, openhab) {
            if (error) {
                return res.status(400).json({ errors: [{ message: "Request failed" }] });
            }
            if (!openhab) {
                return res.status(400).json({ errors: [{ message: "Request failed" }] });
            }
            Item.find({ openhab: openhab._id }, function (error, items) {
                if (error) {

                }
                if (!items) {

                }
                var responseData = [];
                for (var i = 0; i < items.length; i++) {
                    responseData.push({ label: items[i].name, value: items[i].name })
                }
                return res.json({ data: responseData });
            });
        });
    }
]

/*
    This series of endoints are called when IFTTT polls triggers
    /ifttt/v1/triggers/*
 */

exports.v1triggeritemstate = [
    iftttAuthenticate,
    function (req, res) {
        if (req.body.limit == null)
            var eventLimit = 50;
        else
            var eventLimit = req.body.limit;
        Openhab.findOne({ account: req.user.account }, function (error, openhab) {
            if (error || !openhab) {
                return res.status(400).json({ errors: [{ message: "No openhab" }] });
            }
            if (!req.body.triggerFields) {
                return res.status(400).json({ errors: [{ message: "No triggerFields" }] });
            } else {
                var itemName = req.body.triggerFields.item;
                var status = req.body.triggerFields.status;
                var key = "events:" + openhab.id + ":" + itemName;
                var responseData = [];
                redis.lrange(key, 0, eventLimit, function (err, reply) {
                    reply.forEach(function (e, i) {
                        var event = JSON.parse(e);
                        if (event.status === status) {
                            var newEvent = {};
                            newEvent.item = itemName;
                            newEvent.status = event.status;
                            newEvent.created_at = event.when;
                            var edt = new Date(event.when);
                            var ts = Math.round(edt.getTime() / 1000);
                            newEvent.meta = {
                                id: `${key}:${ts}`,
                                timestamp: ts
                            };
                            responseData.push(newEvent);
                        }
                    });
                    return res.json({ data: responseData });
                });
            }
        });
    }
]

exports.v1triggeritem_raised_above = [
    iftttAuthenticate,
    function (req, res) {
        if (req.body.limit == null)
            var eventLimit = 50;
        else
            var eventLimit = req.body.limit;
        Openhab.findOne({ account: req.user.account }, function (error, openhab) {
            if (error || !openhab) {
                return res.status(400).json({ errors: [{ message: "No openhab" }] });
            }
            if (!req.body.triggerFields) {
                return res.status(400).json({ errors: [{ message: "No triggerFields" }] });
            } else {
                var itemName = req.body.triggerFields.item;
                var value = req.body.triggerFields.value;
                var key = "events:" + openhab.id + ":" + itemName;
                var responseData = [];
                redis.lrange(key, 0, eventLimit, function (err, reply) {
                    reply.forEach(function (e, i) {
                        if (reply.length > i + 1) {
                            var event = JSON.parse(e);
                            var prevEvent = JSON.parse(reply[i + 1]);
                            var currentValue = parseFloat(event.numericStatus);
                            var prevValue = parseFloat(prevEvent.numericStatus);

                            if (isNaN(currentValue) || isNaN(prevValue)) {
                                return;
                            }
                            if (currentValue > value && prevValue < value) {
                                var newEvent = {};
                                newEvent.item = itemName;
                                newEvent.status = currentValue;
                                newEvent.created_at = event.when;
                                var edt = new Date(event.when);
                                var ts = Math.round(edt.getTime() / 1000);
                                newEvent.meta = {
                                    id: `${key}:${ts}`,
                                    timestamp: ts
                                };
                                responseData.push(newEvent);
                            }
                        }
                    });
                    return res.json({ data: responseData });
                });
            }
        });
    }
]

exports.v1triggeritem_dropped_below = [
    iftttAuthenticate,
    function (req, res) {
        if (req.body.limit == null)
            var eventLimit = 50;
        else
            var eventLimit = req.body.limit;
        Openhab.findOne({ account: req.user.account }, function (error, openhab) {
            if (error || !openhab) {
                return res.status(400).json({ errors: [{ message: "No openhab" }] });
            }
            if (!req.body.triggerFields) {
                return res.status(400).json({ errors: [{ message: "No triggerFields" }] });
            } else {
                var itemName = req.body.triggerFields.item;
                var value = req.body.triggerFields.value;
                var key = "events:" + openhab.id + ":" + itemName;
                var responseData = [];
                redis.lrange(key, 0, eventLimit, function (err, reply) {
                    reply.forEach(function (e, i) {
                        if (reply.length > i + 1) {
                            var event = JSON.parse(e);
                            var prevEvent = JSON.parse(reply[i + 1]);
                            var currentValue = parseFloat(event.numericStatus);
                            var prevValue = parseFloat(prevEvent.numericStatus);

                            if (isNaN(currentValue) || isNaN(prevValue)) {
                                return;
                            }
                            if (currentValue < value && prevValue > value) {
                                var newEvent = {};
                                newEvent.item = itemName;
                                newEvent.status = currentValue;
                                newEvent.created_at = event.when;
                                var edt = new Date(event.when);
                                var ts = Math.round(edt.getTime() / 1000);
                                newEvent.meta = {
                                    id: `${key}:${ts}`,
                                    timestamp: ts
                                };
                                responseData.push(newEvent);
                            }
                        }
                    });
                    return res.json({ data: responseData });
                });
            }
        });
    }
]
