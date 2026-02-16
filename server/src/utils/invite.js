const crypto = require('crypto');

exports.generateInviteCode = () => crypto.randomBytes(4).toString('hex');
