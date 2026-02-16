const jwt = require('jsonwebtoken');
const config = require('../config');

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
