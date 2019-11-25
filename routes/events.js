var User = require('../models/user');
var Openhab = require('../models/openhab');
var Event = require('../models/event');
var logger = require('../logger');
var moment = require('moment');
var redis = require('../redis-helper');

exports.eventsget = function(req, res) {
    var perPage = 20,
        page = req.query.page > 0 ? parseInt(req.query.page) : 0;
    req.user.openhab(function(error, openhab) {
        if (!error && openhab != null) {
            if(req.query.source){
                redis.lrange("events:" + openhab.id + ":" + req.query.source , 0, -1, function(err, reply) {
                    var events = [];
                    reply.forEach(function(e){
                        var event = JSON.parse(e);
                        event.source = req.query.source;
                        events.push(event);
                    });
                    res.render('events', { events: events, pages: 1, page: 1,
                    title: "Events", user: req.user, openhab: openhab, source: req.query.source,
                    errormessages:req.flash('error'), infomessages:req.flash('info') });
                });
            } else {
                res.redirect("/items");
            }
        }
    });
}
