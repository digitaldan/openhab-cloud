var mongoose = require('mongoose'),
    Schema = mongoose.Schema;
var ObjectId = mongoose.SchemaTypes.ObjectId;

var NotificationSchema = new Schema({
    user: {type: ObjectId, ref: 'User'},
    message: String,
    icon: String,
    severity: String,
    acknowledged: Boolean,
    payload: {
        type: Schema.Types.Mixed,
        default: {}
      },
    created: { type: Date, default: Date.now, expires: '30d' }
});

NotificationSchema.index({user:1, created:1});

module.exports = mongoose.model('Notification', NotificationSchema);
